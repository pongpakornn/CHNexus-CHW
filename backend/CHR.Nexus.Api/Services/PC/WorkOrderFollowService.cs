using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// WORK ORDER FOLLOW v2 : pure rules (unit tested) + Dapper data access (schema PC, database/nexus/62_PC_WorkOrderFollow_v2.sql)
public static class WorkOrderFollowRules
{
    public static readonly string[] RowKeys = { "PL", "OR", "WO", "ORDER", "PROD_D", "PROD_N", "DEL" };
    public const decimal MaxQty = 999_999_999m;
    public const string FlowKey = "WOF";

    public static bool TryMonth(string s, out DateTime first) =>
        DateTime.TryParseExact((s ?? "").Trim(), "yyyy-MM", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out first);

    // null = valid, else Thai message
    public static string CheckCell(string rowKey, int day, decimal? qty, int daysInMonth)
    {
        if (!RowKeys.Contains(rowKey ?? "")) return $"แถว \"{rowKey}\" ไม่ถูกต้อง";
        if (day < 1 || day > daysInMonth) return $"วันที่ {day} ไม่อยู่ในเดือนนี้ (1-{daysInMonth})";
        if (qty is < 0) return "จำนวนต้องไม่ติดลบ";
        if (qty > MaxQty) return "จำนวนมากเกินไป";
        return null;
    }

    // month data may be edited while DRAFT / REJECTED (or no row yet)
    public static bool Editable(string status) => status is null or "" or "DRAFT" or "REJECTED";

    // achievement % = produced / order (null when nothing ordered)
    public static decimal? Achievement(decimal order, decimal produced) => order > 0 ? Math.Round(produced * 100m / order, 1) : null;

    // step waiting for a signature = lowest PENDING step (null when none / a step was rejected)
    public static int? CurrentStep(IEnumerable<(int Step, string Status)> approvals)
    {
        var l = approvals.ToList();
        if (l.Any(a => a.Status == "REJECTED")) return null;
        var p = l.Where(a => a.Status == "PENDING").Select(a => a.Step).OrderBy(x => x).ToList();
        return p.Count == 0 ? null : p[0];
    }

    // Nexus.Parts.PackSize is text ("1,200" / "500") -> pieces per box
    public static int? ParsePack(string s) =>
        int.TryParse((s ?? "").Replace(",", "").Trim().Split('.')[0], out var n) && n > 0 ? n : null;
}

public sealed record WoPlan(int PlanId, string OwnerUserId, string CustomerCode, string CustomerName);
public sealed record WoMonth(string WorkOrderNo, string Status, string SentBy, DateTime? SentAt);
public sealed record WoApproval(int StepNo, string Status, string SignedBy, DateTime? SignedAt, string Remark);
public sealed record WoFlowRow(int StepNo, string Title, string UserId);
public sealed record WoQueueRow(int PlanId, DateTime MonthStart, int StepNo, string Title, string CustomerName, string WorkOrderNo, string SentBy, DateTime? SentAt);
public sealed record WoSums(int PlanId, string CustomerCode, decimal Pl, decimal Or, decimal Order, decimal ProdD, decimal ProdN, decimal Del);

public sealed class WorkOrderFollowService
{
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);
    private const string PlanCols = "PlanID AS PlanId, OwnerUserID AS OwnerUserId, CustomerCode, CustomerName";
    private const string ItemCols = "ItemID AS ItemId, SortNo, PartID AS PartId, PartCode, PartA, PartB, PartNo, PartName, PackSize, ImageFileName, Remark";
    private const string Vis = "(i.FromMonth IS NULL OR i.FromMonth <= @m) AND (i.ToMonth IS NULL OR i.ToMonth >= @m)";
    private const string PartCols = "PartID AS PartId, PartCode, ISNULL(PartA, '') AS PartA, ISNULL(PartB, '') AS PartB, ISNULL(PartNumber, '') AS PartNo, Description AS PartName, CONVERT(NVARCHAR(50), PackSize) AS PackSize, ImageFileName";

    // ---- customers / plans
    public List<(string Code, string Name)> Customers()
    {
        using var c = Conn();
        return c.Query<(string, string)>("SELECT CustomerCode, ISNULL(NULLIF(LTRIM(RTRIM(CustomerName)), ''), CustomerCode) FROM Master.Customers WHERE IsActive = 1 ORDER BY CustomerCode").ToList();
    }

    public string CustomerName(string code)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<string>("SELECT ISNULL(NULLIF(LTRIM(RTRIM(CustomerName)), ''), CustomerCode) FROM Master.Customers WHERE CustomerCode = @code AND IsActive = 1", new { code });
    }

    public WoPlan GetPlan(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<WoPlan>($"SELECT {PlanCols} FROM PC.WoPlans WHERE PlanID = @id AND IsDeleted = 0", new { id });
    }

    public List<WoPlan> Plans(string owner)
    {
        using var c = Conn();
        return c.Query<WoPlan>($"SELECT {PlanCols} FROM PC.WoPlans WHERE IsDeleted = 0 AND (@owner IS NULL OR OwnerUserID = @owner) ORDER BY CustomerCode, OwnerUserID", new { owner }).ToList();
    }

    public bool PlanExists(string owner, string code)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoPlans WHERE OwnerUserID = @owner AND CustomerCode = @code AND IsDeleted = 0", new { owner, code }) > 0;
    }

    public int CreatePlan(string owner, string code, string name)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("INSERT INTO PC.WoPlans (OwnerUserID, CustomerCode, CustomerName) OUTPUT INSERTED.PlanID VALUES (@owner, @code, @name)", new { owner, code, name });
    }

    public void SetEditors(int id, IEnumerable<string> editors)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        c.Execute("DELETE FROM PC.WoEditors WHERE PlanID = @id; UPDATE PC.WoPlans SET UpdatedAt = SYSDATETIME() WHERE PlanID = @id", new { id }, tr);
        foreach (var u in editors) c.Execute("INSERT INTO PC.WoEditors (PlanID, UserID) VALUES (@id, @u)", new { id, u }, tr);
        tr.Commit();
    }

    public void DeletePlan(int id)
    {
        using var c = Conn();
        c.Execute("UPDATE PC.WoPlans SET IsDeleted = 1, UpdatedAt = SYSDATETIME() WHERE PlanID = @id", new { id });
    }

    public Dictionary<int, List<string>> Editors(IEnumerable<int> ids)
    {
        var l = ids.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<(int PlanID, string UserID)>("SELECT PlanID, UserID FROM PC.WoEditors WHERE PlanID IN @l", new { l }).GroupBy(x => x.PlanID).ToDictionary(g => g.Key, g => g.Select(x => x.UserID).ToList());
    }

    public Dictionary<int, int> ItemCounts(IEnumerable<int> ids, DateTime month)
    {
        var l = ids.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<(int PlanID, int N)>($"SELECT i.PlanID, COUNT(*) FROM PC.WoItems i WHERE i.PlanID IN @l AND {Vis} GROUP BY i.PlanID", new { l, m = month.Date }).ToDictionary(x => x.PlanID, x => x.N);
    }

    public bool IsEditor(int id, string uid)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoEditors WHERE PlanID = @id AND UserID = @uid", new { id, uid }) > 0;
    }

    public Dictionary<string, string> Names(IEnumerable<string> ids)
    {
        var l = ids.Where(i => !string.IsNullOrWhiteSpace(i)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (l.Count == 0) return new(StringComparer.OrdinalIgnoreCase);
        using var c = Conn();
        return c.Query<(string UserID, string FullName)>("SELECT UserID, FullName FROM Nexus.Users WHERE UserID IN @l", new { l })
                .GroupBy(x => x.UserID, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => string.IsNullOrWhiteSpace(g.First().FullName) ? g.Key : g.First().FullName, StringComparer.OrdinalIgnoreCase);
    }

    public bool UserExists(string uid)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.Users WHERE UserID = @uid AND ISNULL(IsLocked, 0) = 0", new { uid }) > 0;
    }

    // target user's PC_WOF permission (Level 1 = all)
    public bool UserCan(string uid, bool approve)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>(@"SELECT COUNT(*) FROM Nexus.Users u WHERE u.UserID = @uid AND (ISNULL(u.UserLevel, 3) = 1 OR EXISTS
            (SELECT 1 FROM Nexus.Permissions p WHERE p.UserID = u.UserID AND p.SystemID = 'PC_WOF' AND p.CanView = 'Y' AND (@approve = 0 OR p.CanApprove = 'Y')))", new { uid, approve }) > 0;
    }

    // ---- months
    public WoMonth GetMonth(int planId, DateTime month)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<WoMonth>("SELECT WorkOrderNo, [Status], SentBy, SentAt FROM PC.WoMonths WHERE PlanID = @planId AND MonthStart = @m", new { planId, m = month.Date });
    }

    public Dictionary<int, WoMonth> Months(IEnumerable<int> ids, DateTime month)
    {
        var l = ids.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<(int PlanID, string WorkOrderNo, string Status, string SentBy, DateTime? SentAt)>("SELECT PlanID, WorkOrderNo, [Status], SentBy, SentAt FROM PC.WoMonths WHERE PlanID IN @l AND MonthStart = @m", new { l, m = month.Date })
                .ToDictionary(x => x.PlanID, x => new WoMonth(x.WorkOrderNo, x.Status, x.SentBy, x.SentAt));
    }

    public void SetWorkOrder(int planId, DateTime month, string wo)
    {
        using var c = Conn();
        c.Execute(@"IF EXISTS (SELECT 1 FROM PC.WoMonths WHERE PlanID = @planId AND MonthStart = @m) UPDATE PC.WoMonths SET WorkOrderNo = @wo WHERE PlanID = @planId AND MonthStart = @m
            ELSE INSERT INTO PC.WoMonths (PlanID, MonthStart, WorkOrderNo) VALUES (@planId, @m, @wo);
            UPDATE PC.WoPlans SET UpdatedAt = SYSDATETIME() WHERE PlanID = @planId", new { planId, m = month.Date, wo });
    }

    public bool AnyApproved(int planId)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoMonths WHERE PlanID = @planId AND [Status] = 'APPROVED'", new { planId }) > 0;
    }

    // plan month statuses for the dashboard (no row = DRAFT)
    public void Touch(int planId)
    {
        using var c = Conn();
        c.Execute("UPDATE PC.WoPlans SET UpdatedAt = SYSDATETIME() WHERE PlanID = @planId", new { planId });
    }

    // ---- items / cells
    public sealed class ItemRow
    {
        public int ItemId { get; set; }
        public int SortNo { get; set; }
        public int? PartId { get; set; }
        public string PartCode { get; set; }
        public string PartA { get; set; }
        public string PartB { get; set; }
        public string PartNo { get; set; }
        public string PartName { get; set; }
        public int? PackSize { get; set; }
        public string ImageFileName { get; set; }
        public string Remark { get; set; }
    }

    public List<ItemRow> Items(int planId, DateTime month)
    {
        using var c = Conn();
        return c.Query<ItemRow>($"SELECT {ItemCols} FROM PC.WoItems i WHERE i.PlanID = @planId AND {Vis} ORDER BY SortNo, ItemID", new { planId, m = month.Date }).ToList();
    }

    public ItemRow GetItem(int itemId, out int planId)
    {
        using var c = Conn();
        var it = c.QueryFirstOrDefault<ItemRow>($"SELECT {ItemCols} FROM PC.WoItems WHERE ItemID = @itemId", new { itemId });
        planId = it == null ? 0 : c.ExecuteScalar<int>("SELECT PlanID FROM PC.WoItems WHERE ItemID = @itemId", new { itemId });
        return it;
    }

    // ItemID -> RowKey -> day -> qty (one month)
    public Dictionary<int, Dictionary<string, Dictionary<string, decimal>>> Cells(int planId, DateTime month)
    {
        using var c = Conn();
        var res = new Dictionary<int, Dictionary<string, Dictionary<string, decimal>>>();
        foreach (var x in c.Query<(int ItemID, string RowKey, byte Day, decimal Qty)>("SELECT k.ItemID, k.RowKey, k.[Day], k.Qty FROM PC.WoCells k JOIN PC.WoItems i ON i.ItemID = k.ItemID WHERE i.PlanID = @planId AND k.MonthStart = @m AND (i.FromMonth IS NULL OR i.FromMonth <= @m) AND (i.ToMonth IS NULL OR i.ToMonth >= @m)", new { planId, m = month.Date }))
        {
            if (!res.TryGetValue(x.ItemID, out var rows)) res[x.ItemID] = rows = new();
            if (!rows.TryGetValue(x.RowKey, out var days)) rows[x.RowKey] = days = new();
            days[x.Day.ToString()] = x.Qty;
        }
        return res;
    }

    // any month of the plan from M onward is SENT / APPROVED (adding / removing a part changes those months too)
    public bool LockedFrom(int planId, DateTime month)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoMonths WHERE PlanID = @planId AND MonthStart >= @m AND [Status] IN ('SENT','APPROVED')", new { planId, m = month.Date }) > 0;
    }

    public bool AnySent()
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoMonths WHERE [Status] = 'SENT'") > 0;
    }

    public sealed record PartRow(int PartId, string PartCode, string PartA, string PartB, string PartNo, string PartName, string PackSize, string ImageFileName);

    // Nexus.Parts of one customer (Parts.Customer = customer code)
    public List<PartRow> SearchParts(string customer, string q)
    {
        using var c = Conn();
        return c.Query<PartRow>($@"SELECT TOP (100) {PartCols} FROM Nexus.Parts WITH (NOLOCK)
            WHERE IsActive = 1 AND Customer = @customer AND (@q = '' OR PartCode LIKE '%' + @q + '%' OR Description LIKE '%' + @q + '%' OR ISNULL(PartA, '') LIKE '%' + @q + '%' OR ISNULL(PartB, '') LIKE '%' + @q + '%' OR ISNULL(PartNumber, '') LIKE '%' + @q + '%')
            ORDER BY PartCode", new { customer, q = q ?? "" }).ToList();
    }

    public PartRow GetPart(int id, string customer)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<PartRow>($"SELECT {PartCols} FROM Nexus.Parts WHERE PartID = @id AND Customer = @customer", new { id, customer });
    }

    public bool HasItemPart(int planId, int partId, DateTime month)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>($"SELECT COUNT(*) FROM PC.WoItems i WHERE i.PlanID = @planId AND i.PartID = @partId AND {Vis}", new { planId, partId, m = month.Date }) > 0;
    }

    public int AddItem(int planId, DateTime month, ItemRow i)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>(@"INSERT INTO PC.WoItems (PlanID, SortNo, PartID, PartCode, PartA, PartB, PartNo, PartName, PackSize, ImageFileName, Remark, FromMonth)
            OUTPUT INSERTED.ItemID VALUES (@planId, ISNULL((SELECT MAX(SortNo) FROM PC.WoItems WHERE PlanID = @planId), 0) + 1, @PartId, @PartCode, @PartA, @PartB, @PartNo, @PartName, @PackSize, @ImageFileName, @Remark, @m)",
            new { planId, m = month.Date, i.PartId, i.PartCode, i.PartA, i.PartB, i.PartNo, i.PartName, i.PackSize, i.ImageFileName, i.Remark });
    }

    public void UpdateItem(ItemRow i)
    {
        using var c = Conn();
        c.Execute("UPDATE PC.WoItems SET Remark = @Remark, PackSize = @PackSize WHERE ItemID = @ItemId", i);
    }

    // from month M: hard delete only when the part was added in M and has quantities in no other month; else ToMonth = M-1 (history kept)
    // returns true = hard deleted. SortNo is re-sequenced among the parts still visible in M
    public bool DeleteItem(int itemId, int planId, DateTime month)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        var k = new { itemId, planId, m = month.Date };
        bool hard = c.ExecuteScalar<int>(@"SELECT COUNT(*) FROM PC.WoItems i WHERE i.ItemID = @itemId AND i.FromMonth = @m
            AND NOT EXISTS (SELECT 1 FROM PC.WoCells k WHERE k.ItemID = i.ItemID AND k.MonthStart <> @m)", k, tr) > 0;
        if (hard) c.Execute("DELETE FROM PC.WoCells WHERE ItemID = @itemId; DELETE FROM PC.WoItems WHERE ItemID = @itemId", k, tr);
        else c.Execute("UPDATE PC.WoItems SET ToMonth = DATEADD(month, -1, @m) WHERE ItemID = @itemId", k, tr);
        c.Execute($";WITH r AS (SELECT i.SortNo, ROW_NUMBER() OVER (ORDER BY i.SortNo, i.ItemID) AS n FROM PC.WoItems i WHERE i.PlanID = @planId AND {Vis}) UPDATE r SET SortNo = n", k, tr);
        tr.Commit();
        return hard;
    }

    public void Reorder(int planId, IList<int> ids)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        for (int n = 0; n < ids.Count; n++) c.Execute("UPDATE PC.WoItems SET SortNo = @n WHERE ItemID = @id AND PlanID = @planId", new { n = n + 1, id = ids[n], planId }, tr);
        tr.Commit();
    }

    public List<int> ItemIds(int planId, DateTime month)
    {
        using var c = Conn();
        return c.Query<int>($"SELECT ItemID FROM PC.WoItems i WHERE i.PlanID = @planId AND {Vis}", new { planId, m = month.Date }).ToList();
    }

    // month status is re-checked inside the transaction (row lock) so a concurrent SEND cannot be overwritten; MERGE + HOLDLOCK = no duplicate key on concurrent inserts
    public void SaveCells(int planId, DateTime month, IEnumerable<(int ItemId, string RowKey, int Day, decimal? Qty)> cells)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        var st = c.QueryFirstOrDefault<string>("SELECT [Status] FROM PC.WoMonths WITH (UPDLOCK, HOLDLOCK) WHERE PlanID = @planId AND MonthStart = @m", new { planId, m = month.Date }, tr);
        if (!WorkOrderFollowRules.Editable(st)) throw new InvalidOperationException("เดือนนี้ส่งขออนุมัติแล้ว (SENT / APPROVED) แก้ไขไม่ได้");
        foreach (var x in cells)
        {
            if (x.Qty == null) { c.Execute("DELETE FROM PC.WoCells WHERE ItemID = @ItemId AND MonthStart = @m AND RowKey = @RowKey AND [Day] = @Day", new { x.ItemId, m = month.Date, x.RowKey, x.Day }, tr); continue; }
            c.Execute(@"MERGE PC.WoCells WITH (HOLDLOCK) AS t USING (SELECT @ItemId AS ItemID, @m AS MonthStart, @RowKey AS RowKey, @Day AS [Day]) AS s
                ON t.ItemID = s.ItemID AND t.MonthStart = s.MonthStart AND t.RowKey = s.RowKey AND t.[Day] = s.[Day]
                WHEN MATCHED THEN UPDATE SET Qty = @Qty
                WHEN NOT MATCHED THEN INSERT (ItemID, MonthStart, RowKey, [Day], Qty) VALUES (@ItemId, @m, @RowKey, @Day, @Qty);",
                new { x.ItemId, m = month.Date, x.RowKey, x.Day, Qty = Math.Round(x.Qty.Value, 3) }, tr);
        }
        tr.Commit();
    }

    // per plan sums of one month (dashboard / plan cards)
    public List<WoSums> Sums(DateTime month, IEnumerable<int> planIds)
    {
        var l = planIds.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<WoSums>(@"SELECT p.PlanID AS PlanId, p.CustomerCode,
                ISNULL(SUM(CASE WHEN k.RowKey = 'PL' THEN k.Qty END), 0) AS Pl, ISNULL(SUM(CASE WHEN k.RowKey = 'OR' THEN k.Qty END), 0) AS [Or],
                ISNULL(SUM(CASE WHEN k.RowKey = 'ORDER' THEN k.Qty END), 0) AS [Order], ISNULL(SUM(CASE WHEN k.RowKey = 'PROD_D' THEN k.Qty END), 0) AS ProdD,
                ISNULL(SUM(CASE WHEN k.RowKey = 'PROD_N' THEN k.Qty END), 0) AS ProdN, ISNULL(SUM(CASE WHEN k.RowKey = 'DEL' THEN k.Qty END), 0) AS Del
            FROM PC.WoPlans p LEFT JOIN PC.WoItems i ON i.PlanID = p.PlanID AND (i.FromMonth IS NULL OR i.FromMonth <= @m) AND (i.ToMonth IS NULL OR i.ToMonth >= @m) LEFT JOIN PC.WoCells k ON k.ItemID = i.ItemID AND k.MonthStart = @m
            WHERE p.PlanID IN @l GROUP BY p.PlanID, p.CustomerCode", new { l, m = month.Date }).ToList();
    }

    // ---- flow (SETUP FLOW)
    public List<WoFlowRow> Flow()
    {
        using var c = Conn();
        return c.Query<WoFlowRow>("SELECT StepNo, Title, UserID AS UserId FROM PC.Flows WHERE FlowKey = @k ORDER BY StepNo, UserID", new { k = WorkOrderFollowRules.FlowKey }).ToList();
    }

    public void SaveFlow(IEnumerable<(int Step, string Title, List<string> Users)> steps)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        c.Execute("DELETE FROM PC.Flows WHERE FlowKey = @k", new { k = WorkOrderFollowRules.FlowKey }, tr);
        foreach (var s in steps)
            foreach (var u in s.Users)
                c.Execute("INSERT INTO PC.Flows (FlowKey, StepNo, Title, UserID) VALUES (@k, @step, @title, @u)", new { k = WorkOrderFollowRules.FlowKey, step = s.Step, title = s.Title, u }, tr);
        tr.Commit();
    }

    // ---- send / approve / reject
    public List<WoApproval> Approvals(int planId, DateTime month)
    {
        using var c = Conn();
        return c.Query<WoApproval>("SELECT StepNo, [Status], SignedBy, SignedAt, Remark FROM PC.WoApprovals WHERE PlanID = @planId AND MonthStart = @m ORDER BY StepNo", new { planId, m = month.Date }).ToList();
    }

    // DRAFT / REJECTED -> SENT with a fresh approval row per flow step
    public void Send(int planId, DateTime month, string by, IEnumerable<int> steps)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        var k = new { planId, m = month.Date, by };
        c.Execute("DELETE FROM PC.WoApprovals WHERE PlanID = @planId AND MonthStart = @m", k, tr);
        c.Execute("UPDATE PC.WoMonths SET [Status] = 'SENT', SentBy = @by, SentAt = SYSDATETIME() WHERE PlanID = @planId AND MonthStart = @m", k, tr);
        foreach (var s in steps) c.Execute("INSERT INTO PC.WoApprovals (PlanID, MonthStart, StepNo) VALUES (@planId, @m, @s)", new { planId, m = month.Date, s }, tr);
        tr.Commit();
    }

    // sign the current step; last step -> month APPROVED
    public bool Sign(int planId, DateTime month, int step, string uid, string remark, bool last)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        int n = c.Execute("UPDATE PC.WoApprovals SET [Status] = 'SIGNED', SignedBy = @uid, SignedAt = SYSDATETIME(), Remark = @remark WHERE PlanID = @planId AND MonthStart = @m AND StepNo = @step AND [Status] = 'PENDING'",
            new { planId, m = month.Date, step, uid, remark }, tr);
        if (n > 0 && last) c.Execute("UPDATE PC.WoMonths SET [Status] = 'APPROVED' WHERE PlanID = @planId AND MonthStart = @m AND [Status] = 'SENT'", new { planId, m = month.Date }, tr);
        tr.Commit();
        return n > 0;
    }

    public bool Reject(int planId, DateTime month, int step, string uid, string remark)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        int n = c.Execute("UPDATE PC.WoApprovals SET [Status] = 'REJECTED', SignedBy = @uid, SignedAt = SYSDATETIME(), Remark = @remark WHERE PlanID = @planId AND MonthStart = @m AND StepNo = @step AND [Status] = 'PENDING'",
            new { planId, m = month.Date, step, uid, remark }, tr);
        if (n > 0) c.Execute("UPDATE PC.WoMonths SET [Status] = 'REJECTED' WHERE PlanID = @planId AND MonthStart = @m AND [Status] = 'SENT'", new { planId, m = month.Date }, tr);
        tr.Commit();
        return n > 0;
    }

    // my pending: month SENT, my step is the lowest PENDING one and I am in that flow step
    public List<WoQueueRow> Queue(string uid)
    {
        using var c = Conn();
        return c.Query<WoQueueRow>(@"SELECT a.PlanID AS PlanId, a.MonthStart, a.StepNo, f.Title, p.CustomerName, m.WorkOrderNo, m.SentBy, m.SentAt
            FROM PC.WoApprovals a
            JOIN PC.WoMonths m ON m.PlanID = a.PlanID AND m.MonthStart = a.MonthStart AND m.[Status] = 'SENT'
            JOIN PC.WoPlans p ON p.PlanID = a.PlanID AND p.IsDeleted = 0
            JOIN PC.Flows f ON f.FlowKey = 'WOF' AND f.StepNo = a.StepNo AND f.UserID = @uid
            WHERE a.[Status] = 'PENDING' AND a.StepNo = (SELECT MIN(x.StepNo) FROM PC.WoApprovals x WHERE x.PlanID = a.PlanID AND x.MonthStart = a.MonthStart AND x.[Status] = 'PENDING')
            ORDER BY m.SentAt", new { uid }).ToList();
    }
}
