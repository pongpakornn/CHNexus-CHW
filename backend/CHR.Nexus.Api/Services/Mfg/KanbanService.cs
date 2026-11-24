using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;

namespace Nexus.Services;

// 🏭 MANUFACTURING › KANBAN (schema Kanban, scripts 72 + 73 part columns)
//   accumulated qty = sum(Scans) - sum(Receipts) per Kanban · cards per order = ceil(qty / pcs per box)
//   every write that depends on the accumulated qty locks the Kanban row first (UPDLOCK) so two screens can't take the same pieces
public sealed record KStep(string Zone, string Point);

public sealed class KanbanRow
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }        // Product Name (Part Information)
    public int? PartId { get; set; }
    public string PartA { get; set; }
    public string PartNo { get; set; }
    public string Customer { get; set; }
    public string CustomerName { get; set; }
    public int PerBox { get; set; }          // PACKING (pcs per box)
    public int OrderQty { get; set; }
    public string Zone { get; set; }
    public string Note { get; set; }
    public int? FormulaId { get; set; }      // null = default formula
    public string FormulaName { get; set; }
    public int Target { get; set; }
    public bool Auto { get; set; }
    public int Acc { get; set; }
    public int Used { get; set; }           // orders + scans + receipts (delete blocked when > 0)
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }
    public List<KStep> Steps { get; set; } = new();
}

public sealed class KOrderRow
{
    public int Id { get; set; }
    public int KanbanId { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
    public int? PartId { get; set; }
    public string PartA { get; set; }
    public string PartNo { get; set; }
    public string Customer { get; set; }
    public string Zone { get; set; }
    public int Qty { get; set; }
    public int PerBox { get; set; }
    public int Cards { get; set; }
    public string FlowMode { get; set; }
    public DateTime? PlannedStart { get; set; }
    public string CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public int Queue { get; set; }
    public int Running { get; set; }
    public int Done { get; set; }
    public int? ReceiptId { get; set; }
    public List<KStep> Steps { get; set; } = new();
}

/// <summary>card formula (script 75): CARDS = ROUND( QTY x (1 + ALLOWANCE % / 100) / PACKING ) · at least 1 card</summary>
public sealed class KFormula
{
    public int Id { get; set; }
    public string Name { get; set; }
    public string RoundMode { get; set; }   // UP / NEAREST / DOWN
    public decimal AllowancePct { get; set; }
    public bool IsDefault { get; set; }
    public int Used { get; set; }           // Kanbans using it (delete blocked when > 0)
    public string UpdatedBy { get; set; }
    public DateTime UpdatedDate { get; set; }

    public static readonly KFormula Fallback = new() { Name = "ROUND UP", RoundMode = "UP" };

    public int Cards(int qty, int packing)
    {
        if (qty <= 0 || packing <= 0) return 0;
        decimal x = qty * (1 + AllowancePct / 100m) / packing;
        decimal n = RoundMode switch { "DOWN" => Math.Floor(x), "NEAREST" => Math.Round(x, MidpointRounding.AwayFromZero), _ => Math.Ceiling(x) };
        return (int)Math.Max(1, n);
    }
}

public sealed class KanbanService
{
    public const int MaxCards = 2000;
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);
    private sealed record StepRow(int Id, int Seq, string Zone, string Point);

    private const string AccSql = @"ISNULL((SELECT SUM(s.Qty) FROM Kanban.Scans s WHERE s.KanbanID = k.KanbanID), 0)
                                  - ISNULL((SELECT SUM(r.Qty) FROM Kanban.Receipts r WHERE r.KanbanID = k.KanbanID), 0)";

    public List<KanbanRow> Kanbans(int? id = null)
    {
        using var c = Conn();
        var rows = c.Query<KanbanRow>($@"SELECT k.KanbanID AS Id, k.KanbanCode AS Code, k.KanbanName AS Name, k.PartID AS PartId, k.PartA, k.PartNo, k.CustomerCode AS Customer, cu.CustomerName,
                   k.PerBox, k.OrderQty, k.Zone, k.Note, k.FormulaID AS FormulaId, ISNULL(fo.FormulaName, df.FormulaName) AS FormulaName,
                   ISNULL(ru.TargetQty, 0) AS Target, ISNULL(ru.AutoReceive, 0) AS Auto,
                   {AccSql} AS Acc,
                   (SELECT COUNT(1) FROM Kanban.Orders o WHERE o.KanbanID = k.KanbanID) + (SELECT COUNT(1) FROM Kanban.Scans s WHERE s.KanbanID = k.KanbanID)
                   + (SELECT COUNT(1) FROM Kanban.Receipts r WHERE r.KanbanID = k.KanbanID) AS Used,
                   k.UpdatedBy, k.UpdatedDate
            FROM Kanban.Kanbans k
            LEFT JOIN Kanban.Rules ru ON ru.KanbanID = k.KanbanID
            LEFT JOIN Master.Customers cu ON cu.CustomerCode = k.CustomerCode
            LEFT JOIN Kanban.Formulas fo ON fo.FormulaID = k.FormulaID
            OUTER APPLY (SELECT TOP 1 FormulaName FROM Kanban.Formulas WHERE IsDefault = 1) df
            WHERE @id IS NULL OR k.KanbanID = @id
            ORDER BY k.KanbanCode", new { id }).ToList();
        var steps = c.Query<StepRow>("SELECT KanbanID AS Id, Seq, Zone, Point FROM Kanban.FlowSteps WHERE @id IS NULL OR KanbanID = @id ORDER BY KanbanID, Seq", new { id })
                     .ToLookup(s => s.Id);
        foreach (var r in rows) r.Steps = steps[r.Id].Select(s => new KStep(s.Zone, s.Point)).ToList();
        return rows;
    }

    public KanbanRow Kanban(int id) => Kanbans(id).FirstOrDefault();

    public List<KOrderRow> Orders(int top = 500, int? id = null)
    {
        using var c = Conn();
        var rows = c.Query<KOrderRow>(@"SELECT TOP (@top) o.OrderID AS Id, o.KanbanID, k.KanbanCode AS Code, k.KanbanName AS Name, k.PartID AS PartId, k.PartA, k.PartNo, k.CustomerCode AS Customer, k.Zone,
                   o.Qty, o.PerBox, o.Cards, o.FlowMode, o.PlannedStart, o.CreatedBy, o.CreatedAt,
                   SUM(CASE WHEN cd.Status = 'QUEUE' THEN 1 ELSE 0 END) AS Queue, SUM(CASE WHEN cd.Status = 'RUNNING' THEN 1 ELSE 0 END) AS Running,
                   SUM(CASE WHEN cd.Status = 'DONE' THEN 1 ELSE 0 END) AS Done,
                   (SELECT TOP 1 r.ReceiptID FROM Kanban.Receipts r WHERE r.OrderID = o.OrderID) AS ReceiptId
            FROM Kanban.Orders o
            JOIN Kanban.Kanbans k ON k.KanbanID = o.KanbanID
            LEFT JOIN Kanban.Cards cd ON cd.OrderID = o.OrderID
            WHERE @id IS NULL OR o.OrderID = @id
            GROUP BY o.OrderID, o.KanbanID, k.KanbanCode, k.KanbanName, k.PartID, k.PartA, k.PartNo, k.CustomerCode, k.Zone, o.Qty, o.PerBox, o.Cards, o.FlowMode, o.PlannedStart, o.CreatedBy, o.CreatedAt
            ORDER BY o.OrderID DESC", new { top, id }).ToList();
        if (rows.Count == 0) return rows;
        var ids = rows.Select(r => r.Id).ToArray();
        // TEMP orders keep their own steps · STANDARD orders also store a copy (the Kanban flow can change later)
        var steps = c.Query<StepRow>("SELECT OrderID AS Id, Seq, Zone, Point FROM Kanban.OrderSteps WHERE OrderID IN @ids ORDER BY OrderID, Seq", new { ids }).ToLookup(s => s.Id);
        foreach (var r in rows) r.Steps = steps[r.Id].Select(s => new KStep(s.Zone, s.Point)).ToList();
        return rows;
    }

    public object Receipts(int top = 300)
    {
        using var c = Conn();
        return c.Query(@"SELECT TOP (@top) r.ReceiptID AS id, r.KanbanID AS kanbanId, k.KanbanCode AS code, k.KanbanName AS name, k.CustomerCode AS customer, k.PerBox AS perBox,
                                r.Qty AS qty, r.Status AS status, r.OrderID AS orderId, r.IsAuto AS isAuto, r.ReceivedBy AS receivedBy, r.ReceivedAt AS receivedAt
                         FROM Kanban.Receipts r JOIN Kanban.Kanbans k ON k.KanbanID = r.KanbanID
                         ORDER BY CASE r.Status WHEN 'WAITING' THEN 0 ELSE 1 END, r.ReceiptID DESC", new { top }).ToList();
    }

    public object Scans(int top = 200)
    {
        using var c = Conn();
        return c.Query(@"SELECT TOP (@top) s.ScanID AS id, s.KanbanID AS kanbanId, k.KanbanCode AS code, k.KanbanName AS name, s.Qty AS qty, s.RefNo AS ref, s.CreatedBy AS [by], s.CreatedAt AS at
                         FROM Kanban.Scans s JOIN Kanban.Kanbans k ON k.KanbanID = s.KanbanID ORDER BY s.ScanID DESC", new { top }).ToList();
    }

    /// <summary>Dashboard: RUNNING cards not updated for 30+ minutes (oldest first) · point = the step the card is at</summary>
    public object Stuck(int top = 5)
    {
        using var c = Conn();
        return c.Query(@"SELECT TOP (@top) cd.CardID AS id, k.KanbanCode AS code, k.PartA AS partA, cd.Seq AS seq, o.Cards AS total,
                                ISNULL(st.Point, '-') AS point, ISNULL(st.Zone, '') AS zone, DATEDIFF(MINUTE, cd.UpdatedAt, GETDATE()) AS minutes
                         FROM Kanban.Cards cd
                         JOIN Kanban.Orders o ON o.OrderID = cd.OrderID
                         JOIN Kanban.Kanbans k ON k.KanbanID = o.KanbanID
                         LEFT JOIN Kanban.OrderSteps st ON st.OrderID = cd.OrderID AND st.Seq = cd.StepIndex + 1
                         WHERE cd.Status = 'RUNNING' AND cd.UpdatedAt < DATEADD(MINUTE, -30, GETDATE())
                         ORDER BY cd.UpdatedAt", new { top }).ToList();
    }

    /// <summary>zones + update points for Set Flow: active machines of Machine Information (script 71) + zones already used</summary>
    public object Options()
    {
        using var c = Conn();
        var machines = DbSchema.HasEquipment
            ? c.Query("SELECT ISNULL(MachineZone, '-') AS zone, MachineCode AS code, MachineName AS name, MachineType AS type FROM Master.Machines WHERE Status = 'ACTIVE' ORDER BY MachineZone, MachineCode").ToList()
            : new List<dynamic>();
        var points = c.Query<string>("SELECT Point FROM Kanban.FlowSteps UNION SELECT Point FROM Kanban.OrderSteps").ToList();
        // script 74: zones come from Zone & Workstation Information (active) + their workstations / line-side store for the flow preview
        if (DbSchema.HasZones)
        {
            var (master, stations) = new ZoneService().FlowOptions();
            return new { zones = master.Where(z => (string)z.status == "ACTIVE").Select(z => (string)z.code).ToList(), machines, points, zoneInfo = master, stations, zoneMaster = true };
        }
        var zones = c.Query<string>(@"SELECT Zone FROM Kanban.Kanbans WHERE Zone IS NOT NULL UNION SELECT Zone FROM Kanban.FlowSteps
                                      UNION SELECT Zone FROM Kanban.OrderSteps" + (DbSchema.HasEquipment ? " UNION SELECT MachineZone FROM Master.Machines WHERE MachineZone IS NOT NULL" : "")).OrderBy(z => z).ToList();
        return new { zones, machines, points, zoneInfo = new List<object>(), stations = new List<object>(), zoneMaster = false };
    }

    // PART = PART A (finished goods) or PART B of Part Information · stored in Kanbans.PartA
    private const string PartSql = "COALESCE(NULLIF(LTRIM(RTRIM(p.PartA)), ''), NULLIF(LTRIM(RTRIM(p.PartB)), ''))";

    /// <summary>Part Information (Nexus.Parts with PART A or PART B) for Kanban Management: pick by PART / PART NO / Product Name · customer filter · PACKING = PackSize</summary>
    public object Parts()
    {
        using var c = Conn();
        return c.Query($@"SELECT p.PartID AS id, {PartSql} AS partA, CASE WHEN ISNULL(LTRIM(RTRIM(p.PartA)), '') <> '' THEN 'A' ELSE 'B' END AS kind,
                                ISNULL(LTRIM(RTRIM(p.PartNumber)), '') AS partNo, ISNULL(LTRIM(RTRIM(p.Description)), '') AS name,
                                ISNULL(LTRIM(RTRIM(p.Customer)), '') AS customer, CAST(CASE WHEN p.PackSize > 0 THEN p.PackSize ELSE 0 END AS INT) AS packing
                         FROM Nexus.Parts p WITH (NOLOCK)
                         WHERE p.IsActive = 1 AND {PartSql} IS NOT NULL
                         ORDER BY 2").ToList();
    }

    public sealed record PartPick(string PartA, string PartNo, string Name, string Customer);

    /// <summary>the part picked in Kanban Management (null = not found / inactive / no PART A or B)</summary>
    public PartPick Part(int id)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<PartPick>(
            $@"SELECT {PartSql} AS PartA, NULLIF(LTRIM(RTRIM(p.PartNumber)), '') AS PartNo, LTRIM(RTRIM(p.Description)) AS Name, NULLIF(LTRIM(RTRIM(p.Customer)), '') AS Customer
               FROM Nexus.Parts p WHERE p.PartID = @id AND p.IsActive = 1 AND {PartSql} IS NOT NULL", new { id });
    }

    // ---------------------------------------------------------------- card formulas (script 75)
    public List<KFormula> Formulas()
    {
        using var c = Conn();
        return c.Query<KFormula>(@"SELECT f.FormulaID AS Id, f.FormulaName AS Name, f.RoundMode, f.AllowancePct, f.IsDefault,
                                          (SELECT COUNT(1) FROM Kanban.Kanbans k WHERE k.FormulaID = f.FormulaID OR (k.FormulaID IS NULL AND f.IsDefault = 1)) AS Used,
                                          f.UpdatedBy, f.UpdatedDate
                                   FROM Kanban.Formulas f ORDER BY f.IsDefault DESC, f.FormulaName").ToList();
    }

    /// <summary>formula of a Kanban (null / missing id = default · no default row = ROUND UP)</summary>
    public KFormula Formula(int? id)
    {
        var all = Formulas();
        return all.FirstOrDefault(f => f.Id == id) ?? all.FirstOrDefault(f => f.IsDefault) ?? KFormula.Fallback;
    }

    public int SaveFormula(int id, string name, string round, decimal pct, string uid)
    {
        using var c = Conn();
        var p = new { id, name, round, pct, uid };
        if (id == 0)
            return c.QuerySingle<int>(@"INSERT INTO Kanban.Formulas (FormulaName, RoundMode, AllowancePct, CreatedBy, UpdatedBy)
                                        OUTPUT INSERTED.FormulaID VALUES (@name, @round, @pct, @uid, @uid)", p);
        c.Execute("UPDATE Kanban.Formulas SET FormulaName = @name, RoundMode = @round, AllowancePct = @pct, UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE FormulaID = @id", p);
        return id;
    }

    public bool FormulaNameExists(string name, int exceptId)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Kanban.Formulas WHERE FormulaName = @name AND FormulaID <> @exceptId", new { name, exceptId }) > 0;
    }

    public void DeleteFormula(int id)
    {
        using var c = Conn();
        c.Execute("DELETE FROM Kanban.Formulas WHERE FormulaID = @id AND IsDefault = 0 AND NOT EXISTS (SELECT 1 FROM Kanban.Kanbans WHERE FormulaID = @id)", new { id });
    }

    public bool CodeExists(string code, int exceptId)
    {
        using var c = Conn();
        return c.ExecuteScalar<int>("SELECT COUNT(1) FROM Kanban.Kanbans WHERE KanbanCode = @code AND KanbanID <> @exceptId", new { code, exceptId }) > 0;
    }

    public int Save(int id, KanbanRow r, string uid)
    {
        using var c = Conn();
        var p = new { id, r.Code, r.Name, r.PartId, r.PartA, r.PartNo, r.Customer, r.PerBox, r.OrderQty, r.Zone, r.Note, r.FormulaId, uid };
        if (id == 0)
            return c.QuerySingle<int>(@"INSERT INTO Kanban.Kanbans (KanbanCode, KanbanName, PartID, PartA, PartNo, CustomerCode, PerBox, OrderQty, Zone, Note, FormulaID, CreatedBy, UpdatedBy)
                                        OUTPUT INSERTED.KanbanID VALUES (@Code, @Name, @PartId, @PartA, @PartNo, @Customer, @PerBox, @OrderQty, @Zone, @Note, @FormulaId, @uid, @uid)", p);
        c.Execute(@"UPDATE Kanban.Kanbans SET KanbanCode = @Code, KanbanName = @Name, PartID = @PartId, PartA = @PartA, PartNo = @PartNo, CustomerCode = @Customer, PerBox = @PerBox, OrderQty = @OrderQty,
                           Zone = @Zone, Note = @Note, FormulaID = @FormulaId, UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE KanbanID = @id", p);
        return id;
    }

    public void Delete(int id)
    {
        using var c = Conn();
        c.Execute("DELETE FROM Kanban.Kanbans WHERE KanbanID = @id", new { id });   // FlowSteps / Rules cascade
    }

    public void SetFlow(int id, List<KStep> steps, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        c.Execute("DELETE FROM Kanban.FlowSteps WHERE KanbanID = @id", new { id }, tx);
        c.Execute("INSERT INTO Kanban.FlowSteps (KanbanID, Seq, Zone, Point) VALUES (@id, @seq, @Zone, @Point)",
                  steps.Select((s, i) => new { id, seq = i + 1, s.Zone, s.Point }), tx);
        c.Execute("UPDATE Kanban.Kanbans SET UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE KanbanID = @id", new { id, uid }, tx);
        tx.Commit();
    }

    // ---------------------------------------------------------------- accumulated qty (locked per Kanban)
    private static int Lock(SqlConnection c, IDbTransaction tx, int id) =>
        c.ExecuteScalar<int?>($"SELECT {AccSql} FROM Kanban.Kanbans k WITH (UPDLOCK, HOLDLOCK) WHERE k.KanbanID = @id", new { id }, tx)
        ?? throw new InvalidOperationException("ไม่พบ Kanban นี้ (อาจถูกลบไปแล้ว)");

    /// <summary>AUTO receive: while accumulated >= target, move one target into WAITING. Returns pieces received.</summary>
    private static int AutoReceive(SqlConnection c, IDbTransaction tx, int id, string uid)
    {
        var rule = c.QueryFirstOrDefault<(int Target, bool Auto)>("SELECT TargetQty, AutoReceive FROM Kanban.Rules WHERE KanbanID = @id", new { id }, tx);
        if (!rule.Auto || rule.Target <= 0) return 0;
        int acc = Lock(c, tx, id), got = 0;
        for (int i = 0; i < 100 && acc >= rule.Target; i++, acc -= rule.Target, got += rule.Target)
            c.Execute("INSERT INTO Kanban.Receipts (KanbanID, Qty, IsAuto, ReceivedBy) VALUES (@id, @q, 1, @uid)", new { id, q = rule.Target, uid }, tx);
        return got;
    }

    public int SetRule(int id, int target, bool auto, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        Lock(c, tx, id);
        c.Execute(@"MERGE Kanban.Rules AS t USING (SELECT @id AS KanbanID) s ON t.KanbanID = s.KanbanID
                    WHEN MATCHED THEN UPDATE SET TargetQty = @target, AutoReceive = @auto, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (KanbanID, TargetQty, AutoReceive, UpdatedBy) VALUES (@id, @target, @auto, @uid);", new { id, target, auto, uid }, tx);
        int got = AutoReceive(c, tx, id, uid);
        tx.Commit();
        return got;
    }

    public int AddScan(int id, int qty, string refNo, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        Lock(c, tx, id);
        c.Execute("INSERT INTO Kanban.Scans (KanbanID, Qty, RefNo, CreatedBy) VALUES (@id, @qty, @refNo, @uid)", new { id, qty, refNo, uid }, tx);
        int got = AutoReceive(c, tx, id, uid);
        tx.Commit();
        return got;
    }

    public (int KanbanId, int Qty, string Ref) DeleteScan(int scanId)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        var s = c.QueryFirstOrDefault<(int KanbanId, int Qty, string Ref)>("SELECT KanbanID, Qty, RefNo FROM Kanban.Scans WHERE ScanID = @scanId", new { scanId }, tx);
        if (s.KanbanId == 0) throw new InvalidOperationException("ไม่พบประวัตินี้ (อาจถูกลบไปแล้ว)");
        if (Lock(c, tx, s.KanbanId) < s.Qty) throw new InvalidOperationException("ลบไม่ได้: ยอดนี้ถูกรับไปรอสั่งผลิตแล้ว");
        c.Execute("DELETE FROM Kanban.Scans WHERE ScanID = @scanId", new { scanId }, tx);
        tx.Commit();
        return s;
    }

    public void Receive(int id, int qty, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        int acc = Lock(c, tx, id);
        if (qty <= 0 || acc < qty) throw new InvalidOperationException($"ยอดสะสมไม่พอ (มี {acc:N0} ชิ้น)");
        c.Execute("INSERT INTO Kanban.Receipts (KanbanID, Qty, ReceivedBy) VALUES (@id, @qty, @uid)", new { id, qty, uid }, tx);
        tx.Commit();
    }

    public (string Code, int Qty) ReturnReceipt(int receiptId)
    {
        using var c = Conn();
        var r = c.QueryFirstOrDefault<(string Code, int Qty, string Status)>(
            "SELECT k.KanbanCode, r.Qty, r.Status FROM Kanban.Receipts r JOIN Kanban.Kanbans k ON k.KanbanID = r.KanbanID WHERE r.ReceiptID = @receiptId", new { receiptId });
        if (r.Code == null) throw new InvalidOperationException("ไม่พบยอดนี้ (อาจถูกคืนไปแล้ว)");
        if (c.Execute("DELETE FROM Kanban.Receipts WHERE ReceiptID = @receiptId AND Status = 'WAITING'", new { receiptId }) == 0)
            throw new InvalidOperationException("คืนยอดไม่ได้: ยอดนี้สั่งผลิตแล้ว");
        return (r.Code, r.Qty);
    }

    public int AddOrder(int kanbanId, int qty, int perBox, int cards, string mode, DateTime? planned, List<KStep> steps, int? receiptId, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        Lock(c, tx, kanbanId);
        if (receiptId != null)
        {
            var r = c.QueryFirstOrDefault<(int KanbanId, int Qty, string Status)>("SELECT KanbanID, Qty, Status FROM Kanban.Receipts WITH (UPDLOCK) WHERE ReceiptID = @receiptId", new { receiptId }, tx);
            if (r.KanbanId != kanbanId || r.Status != "WAITING" || r.Qty != qty) throw new InvalidOperationException("ยอดนี้ถูกสั่งผลิตไปแล้ว หรือมีการเปลี่ยนแปลง กรุณาโหลดใหม่");
        }
        int id = c.QuerySingle<int>(@"INSERT INTO Kanban.Orders (KanbanID, Qty, PerBox, Cards, FlowMode, PlannedStart, CreatedBy)
                                      OUTPUT INSERTED.OrderID VALUES (@kanbanId, @qty, @perBox, @cards, @mode, @planned, @uid)",
                                      new { kanbanId, qty, perBox, cards, mode, planned, uid }, tx);
        c.Execute("INSERT INTO Kanban.OrderSteps (OrderID, Seq, Zone, Point) VALUES (@id, @seq, @Zone, @Point)", steps.Select((s, i) => new { id, seq = i + 1, s.Zone, s.Point }), tx);
        // cards 1..N in one statement (no row-by-row loop)
        c.Execute(@"INSERT INTO Kanban.Cards (OrderID, Seq)
                    SELECT @id, n FROM (SELECT TOP (@cards) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) x", new { id, cards }, tx);
        if (receiptId != null) c.Execute("UPDATE Kanban.Receipts SET Status = 'ORDERED', OrderID = @id WHERE ReceiptID = @receiptId", new { id, receiptId }, tx);
        tx.Commit();
        return id;
    }

    /// <summary>delete an order that has not started (all cards QUEUE) · a received qty goes back to WAITING</summary>
    public void DeleteOrder(int id)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        if (c.ExecuteScalar<int>("SELECT COUNT(1) FROM Kanban.Cards WITH (UPDLOCK) WHERE OrderID = @id AND Status <> 'QUEUE'", new { id }, tx) > 0)
            throw new InvalidOperationException("ลบไม่ได้: ใบสั่งนี้เริ่มผลิตแล้ว");
        c.Execute("UPDATE Kanban.Receipts SET Status = 'WAITING', OrderID = NULL WHERE OrderID = @id", new { id }, tx);
        c.Execute("DELETE FROM Kanban.Orders WHERE OrderID = @id", new { id }, tx);   // steps / cards cascade
        tx.Commit();
    }
}
