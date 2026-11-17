using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;

namespace Nexus.Services;

// WORK ORDER FOLLOW : pure rules (unit tested) + Dapper data access (schema PC, database/nexus/61_PC_WorkOrderFollow.sql)
public static class WorkOrderFollowRules
{
    public static readonly string[] RowKeys = { "PL", "OR", "WO", "ORDER", "PROD_D", "PROD_N", "DEL" };
    public static readonly string[] Roles = { "PREPARE", "CHECK", "APPROVE" };
    public const decimal MaxQty = 999_999_999m;

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

    // "ST." boxes = DEL / PcsPerBox (null when box size unknown)
    public static decimal? Boxes(decimal? del, int? pcsPerBox) => del.HasValue && pcsPerBox is > 0 ? Math.Round(del.Value / pcsPerBox.Value, 3) : null;
    public static decimal Total(IEnumerable<decimal> cells) => cells.Sum();

    // Nexus.Parts.PackSize is text ("1,200" / "500") -> pieces per box
    public static int? ParsePack(string s) =>
        int.TryParse((s ?? "").Replace(",", "").Trim().Split('.')[0], out var n) && n > 0 ? n : null;
}

public sealed record WoSheet(int SheetId, DateTime MonthStart, string CustomerCode, string CustomerName, string WorkOrderNo, string OwnerUserId);
public sealed record WoSign(int SheetId, string Role, string RequestedTo, string RequestedBy, DateTime? RequestedAt, string SignedBy, DateTime? SignedAt);
public sealed record WoQueueRow(int SheetId, string Role, string CustomerName, string WorkOrderNo, DateTime MonthStart, string RequestedBy, DateTime? RequestedAt);

public sealed class WorkOrderFollowService
{
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);
    private const string SheetCols = "SheetID AS SheetId, MonthStart, CustomerCode, CustomerName, WorkOrderNo, OwnerUserID AS OwnerUserId";
    private const string ItemCols = "ItemID AS ItemId, SortNo, PartID AS PartId, IntCode, PartName, PartNo, Material, PcsPerBox, BarColor, Remark";
    private const string PartCols = "PartID AS PartId, PartCode, Description, ISNULL(PartA, '') AS PartA, ISNULL(PartNumber, '') AS PartNumber, ISNULL(Category, '') AS Category, CONVERT(NVARCHAR(50), PackSize) AS PackSize, ISNULL(Customer, '') AS Customer";

    public WoSheet GetSheet(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<WoSheet>($"SELECT {SheetCols} FROM PC.WoSheets WHERE SheetID = @id AND IsDeleted = 0", new { id });
    }

    public List<WoSheet> Sheets(DateTime month)
    {
        using var c = Conn();
        return c.Query<WoSheet>($"SELECT {SheetCols} FROM PC.WoSheets WHERE MonthStart = @month AND IsDeleted = 0 ORDER BY CustomerName, WorkOrderNo", new { month = month.Date }).ToList();
    }

    public Dictionary<int, List<string>> Editors(IEnumerable<int> ids)
    {
        var l = ids.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<(int SheetID, string UserID)>("SELECT SheetID, UserID FROM PC.WoEditors WHERE SheetID IN @l", new { l }).GroupBy(x => x.SheetID).ToDictionary(g => g.Key, g => g.Select(x => x.UserID).ToList());
    }

    public Dictionary<int, int> ItemCounts(IEnumerable<int> ids)
    {
        var l = ids.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<(int SheetID, int N)>("SELECT SheetID, COUNT(*) FROM PC.WoItems WHERE SheetID IN @l GROUP BY SheetID", new { l }).ToDictionary(x => x.SheetID, x => x.N);
    }

    public List<WoSign> Signs(IEnumerable<int> ids)
    {
        var l = ids.ToList(); if (l.Count == 0) return new();
        using var c = Conn();
        return c.Query<WoSign>("SELECT SheetID AS SheetId, [Role], RequestedTo, RequestedBy, RequestedAt, SignedBy, SignedAt FROM PC.WoSigns WHERE SheetID IN @l", new { l }).ToList();
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

    public bool IsEditor(int id, string uid)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoEditors WHERE SheetID = @id AND UserID = @uid", new { id, uid }) > 0;
    }

    public bool IsLocked(int id)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(*) FROM PC.WoSigns WHERE SheetID = @id AND [Role] = 'APPROVE' AND SignedAt IS NOT NULL", new { id }) > 0;
    }

    public int Create(DateTime month, string code, string name, string wo, string owner)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("INSERT INTO PC.WoSheets (MonthStart, CustomerCode, CustomerName, WorkOrderNo, OwnerUserID) OUTPUT INSERTED.SheetID VALUES (@month, @code, @name, @wo, @owner)",
            new { month = month.Date, code, name, wo, owner });
    }

    public void Update(int id, string code, string name, string wo, IEnumerable<string> editors)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        c.Execute("UPDATE PC.WoSheets SET CustomerCode = @code, CustomerName = @name, WorkOrderNo = @wo, UpdatedAt = SYSDATETIME() WHERE SheetID = @id", new { id, code, name, wo }, tr);
        if (editors != null)
        {
            c.Execute("DELETE FROM PC.WoEditors WHERE SheetID = @id", new { id }, tr);
            foreach (var u in editors) c.Execute("INSERT INTO PC.WoEditors (SheetID, UserID) VALUES (@id, @u)", new { id, u }, tr);
        }
        tr.Commit();
    }

    public void Delete(int id)
    {
        using var c = Conn();
        c.Execute("UPDATE PC.WoSheets SET IsDeleted = 1, UpdatedAt = SYSDATETIME() WHERE SheetID = @id", new { id });
    }

    // an edit happened: bump UpdatedAt and clear a CHECK signature -> true when one was cleared
    public bool Touch(int id)
    {
        using var c = Conn();
        c.Execute("UPDATE PC.WoSheets SET UpdatedAt = SYSDATETIME() WHERE SheetID = @id", new { id });
        return c.Execute("UPDATE PC.WoSigns SET SignedBy = NULL, SignedAt = NULL, RequestedTo = NULL, RequestedBy = NULL, RequestedAt = NULL WHERE SheetID = @id AND [Role] = 'CHECK' AND SignedAt IS NOT NULL", new { id }) > 0;
    }

    // ---- items / cells
    public sealed class ItemRow
    {
        public int ItemId { get; set; }
        public int SortNo { get; set; }
        public int? PartId { get; set; }
        public string IntCode { get; set; }
        public string PartName { get; set; }
        public string PartNo { get; set; }
        public string Material { get; set; }
        public int? PcsPerBox { get; set; }
        public string BarColor { get; set; }
        public string Remark { get; set; }
    }

    public List<ItemRow> Items(int sheetId)
    {
        using var c = Conn();
        return c.Query<ItemRow>($"SELECT {ItemCols} FROM PC.WoItems WHERE SheetID = @sheetId ORDER BY SortNo, ItemID", new { sheetId }).ToList();
    }

    public ItemRow GetItem(int itemId, out int sheetId)
    {
        using var c = Conn();
        var it = c.QueryFirstOrDefault<ItemRow>($"SELECT {ItemCols} FROM PC.WoItems WHERE ItemID = @itemId", new { itemId });
        sheetId = it == null ? 0 : c.ExecuteScalar<int>("SELECT SheetID FROM PC.WoItems WHERE ItemID = @itemId", new { itemId });
        return it;
    }

    // ItemID -> RowKey -> day -> qty
    public Dictionary<int, Dictionary<string, Dictionary<string, decimal>>> Cells(int sheetId)
    {
        using var c = Conn();
        var res = new Dictionary<int, Dictionary<string, Dictionary<string, decimal>>>();
        foreach (var x in c.Query<(int ItemID, string RowKey, byte Day, decimal Qty)>("SELECT k.ItemID, k.RowKey, k.[Day], k.Qty FROM PC.WoCells k JOIN PC.WoItems i ON i.ItemID = k.ItemID WHERE i.SheetID = @sheetId", new { sheetId }))
        {
            if (!res.TryGetValue(x.ItemID, out var rows)) res[x.ItemID] = rows = new();
            if (!rows.TryGetValue(x.RowKey, out var days)) rows[x.RowKey] = days = new();
            days[x.Day.ToString()] = x.Qty;
        }
        return res;
    }

    public sealed record PartRow(int PartId, string PartCode, string Description, string PartA, string PartNumber, string Category, string PackSize, string Customer);

    // Master Data > Product Control "Part Information" = Nexus.Parts (active)
    public List<PartRow> SearchParts(string q)
    {
        using var c = Conn();
        return c.Query<PartRow>($@"SELECT TOP (50) {PartCols} FROM Nexus.Parts WITH (NOLOCK)
            WHERE IsActive = 1 AND (@q = '' OR PartCode LIKE '%' + @q + '%' OR Description LIKE '%' + @q + '%' OR ISNULL(PartA, '') LIKE '%' + @q + '%' OR ISNULL(PartNumber, '') LIKE '%' + @q + '%')
            ORDER BY CASE WHEN PartCode = @q OR PartA = @q THEN 0 WHEN PartCode LIKE @q + '%' OR PartA LIKE @q + '%' THEN 1 ELSE 2 END, PartCode", new { q = q ?? "" }).ToList();
    }

    public PartRow GetPart(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<PartRow>($"SELECT {PartCols} FROM Nexus.Parts WHERE PartID = @id", new { id });
    }

    public int AddItem(int sheetId, ItemRow i)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>(@"INSERT INTO PC.WoItems (SheetID, SortNo, PartID, IntCode, PartName, PartNo, Material, PcsPerBox, BarColor, Remark)
            OUTPUT INSERTED.ItemID VALUES (@sheetId, ISNULL((SELECT MAX(SortNo) FROM PC.WoItems WHERE SheetID = @sheetId), 0) + 1, @PartId, @IntCode, @PartName, @PartNo, @Material, @PcsPerBox, @BarColor, @Remark)",
            new { sheetId, i.PartId, i.IntCode, i.PartName, i.PartNo, i.Material, i.PcsPerBox, i.BarColor, i.Remark });
    }

    public void UpdateItem(ItemRow i)
    {
        using var c = Conn();
        c.Execute("UPDATE PC.WoItems SET IntCode = @IntCode, BarColor = @BarColor, Remark = @Remark, PcsPerBox = @PcsPerBox WHERE ItemID = @ItemId", i);
    }

    public void DeleteItem(int itemId)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        c.Execute("DELETE FROM PC.WoCells WHERE ItemID = @itemId; DELETE FROM PC.WoItems WHERE ItemID = @itemId", new { itemId }, tr);
        tr.Commit();
    }

    public void Reorder(int sheetId, IList<int> ids)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        for (int n = 0; n < ids.Count; n++) c.Execute("UPDATE PC.WoItems SET SortNo = @n WHERE ItemID = @id AND SheetID = @sheetId", new { n = n + 1, id = ids[n], sheetId }, tr);
        tr.Commit();
    }

    public List<int> ItemIds(int sheetId)
    {
        using var c = Conn();
        return c.Query<int>("SELECT ItemID FROM PC.WoItems WHERE SheetID = @sheetId", new { sheetId }).ToList();
    }

    public void SaveCells(IEnumerable<(int ItemId, string RowKey, int Day, decimal? Qty)> cells)
    {
        using var c = Conn(); c.Open();
        using var tr = c.BeginTransaction();
        foreach (var x in cells)
        {
            if (x.Qty == null) { c.Execute("DELETE FROM PC.WoCells WHERE ItemID = @ItemId AND RowKey = @RowKey AND [Day] = @Day", new { x.ItemId, x.RowKey, x.Day }, tr); continue; }
            var p = new { x.ItemId, x.RowKey, x.Day, Qty = Math.Round(x.Qty.Value, 3) };
            if (c.Execute("UPDATE PC.WoCells SET Qty = @Qty WHERE ItemID = @ItemId AND RowKey = @RowKey AND [Day] = @Day", p, tr) == 0)
                c.Execute("INSERT INTO PC.WoCells (ItemID, RowKey, [Day], Qty) VALUES (@ItemId, @RowKey, @Day, @Qty)", p, tr);
        }
        tr.Commit();
    }

    // ---- sign
    public void RequestSign(int sheetId, string role, string to, string by)
    {
        using var c = Conn();
        c.Execute(@"IF EXISTS (SELECT 1 FROM PC.WoSigns WHERE SheetID = @sheetId AND [Role] = @role)
                UPDATE PC.WoSigns SET RequestedTo = @to, RequestedBy = @by, RequestedAt = SYSDATETIME(), SignedBy = NULL, SignedAt = NULL WHERE SheetID = @sheetId AND [Role] = @role
            ELSE INSERT INTO PC.WoSigns (SheetID, [Role], RequestedTo, RequestedBy, RequestedAt) VALUES (@sheetId, @role, @to, @by, SYSDATETIME())", new { sheetId, role, to, by });
    }

    // true = signed now (only while unsigned and requested to this user)
    public bool Sign(int sheetId, string role, string uid)
    {
        using var c = Conn();
        return c.Execute("UPDATE PC.WoSigns SET SignedBy = @uid, SignedAt = SYSDATETIME() WHERE SheetID = @sheetId AND [Role] = @role AND RequestedTo = @uid AND SignedAt IS NULL", new { sheetId, role, uid }) > 0;
    }

    public List<WoQueueRow> Queue(string uid)
    {
        using var c = Conn();
        return c.Query<WoQueueRow>(@"SELECT s.SheetID AS SheetId, g.[Role], s.CustomerName, s.WorkOrderNo, s.MonthStart, g.RequestedBy, g.RequestedAt
            FROM PC.WoSigns g JOIN PC.WoSheets s ON s.SheetID = g.SheetID
            WHERE g.RequestedTo = @uid AND g.SignedAt IS NULL AND s.IsDeleted = 0 ORDER BY g.RequestedAt", new { uid }).ToList();
    }
}
