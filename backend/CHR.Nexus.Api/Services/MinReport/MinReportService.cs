using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;

namespace Nexus.Services;

// 📋 MIN REPORT : สินค้าที่ค้างอยู่ใต้ค่า MIN นานเกินกำหนด (StuckDays) -> แจ้งเตือนกลางจอ -> ผู้ใช้รายงานสาเหตุ -> FLOW ลายเซ็น
//   Nexus.MinWatch   = ช่วงที่สินค้าอยู่ใต้ MIN (MinWatchService บันทึกเองทุก 5 นาที เฉพาะคลังที่เปิดใน SETUP)
//   Nexus.MinReports = รายงานสาเหตุ (ใคร · เมื่อไร · ค้างกี่วัน · หมายเหตุที่เลือก) · รายงานแล้ว = ช่วงนั้นไม่แจ้งเตือนอีก
//   Nexus.MinReportDisplay = ต่อคลัง: บรรทัดที่ 1 / 2 ของสินค้าแสดงช่องไหนบ้าง (คอลัมน์ของตาราง Store Max-Min)
//   Nexus.MinReportFlow / MinReportSigns = ใครลงลายเซ็นช่องไหน (Prepared · Checked · Checked · Approved) เรียงตามลำดับจนครบ = DONE
//   ใต้ MIN = เงื่อนไขเดียวกับการ์ด MIN ของหน้า Store (StockStatus UNDER_MIN / OUT_OF_STOCK และ MIN > 0)
public sealed class MinReportSettings
{
    public bool Enabled { get; set; } = true;
    public int StuckDays { get; set; } = 3;
    public int RemindMinutes { get; set; } = 60;
    public List<int> Stocks { get; set; } = new();
    public string UpdatedBy { get; set; }
    public DateTime? UpdatedDate { get; set; }
}

// ข้อมูลสินค้าที่ใช้แสดง (จาก Nexus.Parts) + บรรทัดที่ 1 / 2 ตามรูปแบบของคลัง (ApplyDisplay)
public abstract class MinPartBase
{
    public int StockId { get; set; }
    public string StockCode { get; set; }
    public int PartId { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string Customer { get; set; }
    public string Supplier { get; set; }
    public string PartA { get; set; }
    public string PartB { get; set; }
    public string PartNo { get; set; }
    public string Model { get; set; }
    public string Category { get; set; }
    public string Bin { get; set; }
    public string PackSize { get; set; }
    public string Title { get; set; }     // บรรทัดที่ 1 (ตัวหนา)
    public string Sub { get; set; }       // บรรทัดที่ 2
}

public sealed class MinWatchRow : MinPartBase
{
    public int WatchId { get; set; }
    public decimal? Qty { get; set; }
    public string StockBox { get; set; }
    public decimal? MinQty { get; set; }
    public decimal? MaxQty { get; set; }
    public DateTime BelowSince { get; set; }
    public DateTime LastSeen { get; set; }
    public string Source { get; set; }
    public double Days => Math.Round((DateTime.Now - BelowSince).TotalDays, 1);
}

public sealed class MinSign
{
    public int ReportId { get; set; }
    public int Slot { get; set; }
    public string UserId { get; set; }
    public string UserName { get; set; }
    public DateTime SignedAt { get; set; }
}

public sealed class MinReportRow : MinPartBase
{
    public int ReportId { get; set; }
    public decimal? Qty { get; set; }
    public string StockBox { get; set; }
    public decimal? MinQty { get; set; }
    public decimal? MaxQty { get; set; }
    public DateTime BelowSince { get; set; }
    public decimal DaysStuck { get; set; }
    public string Reason { get; set; }
    public string ReasonType { get; set; }
    public string ReportedBy { get; set; }
    public string ReporterName { get; set; }
    public DateTime ReportedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime? LastSeen { get; set; }      // อัพเดทยอดล่าสุดของช่วงนั้น (MinWatch.LastSeen)
    public string Section { get; set; }          // แผนกของผู้รายงาน (Users.Section / Department)
    public string FlowStatus { get; set; }       // NULL = ไม่มี FLOW · SIGNING = รอเซ็น · DONE = ลงนามครบ
    public int? NextSlot { get; set; }
    public DateTime? DoneAt { get; set; }
    public List<MinSign> Signs { get; set; } = new();
}

// รูปแบบการแสดงสินค้าของคลัง: บรรทัดละหลายช่อง เรียงตามลำดับที่เลือก
public sealed class MinDisplay
{
    public List<string> Line1 { get; set; } = new() { "CODE" };
    public List<string> Line2 { get; set; } = new() { "NAME" };
}

// FLOW ลายเซ็น 1 ช่อง: OFF = ไม่ใช้ · ANY = ผู้ใช้ในรายชื่อลงได้ทุกคน · ONE = รายบุคคล
public sealed class MinFlowSlot
{
    public int Slot { get; set; }
    public string Mode { get; set; } = "OFF";
    public List<string> Users { get; set; } = new();
    public bool Active => Mode != "OFF" && Users.Count > 0;
    public bool Allows(string uid) => Active && Users.Any(u => string.Equals(u, uid, StringComparison.OrdinalIgnoreCase));
}

public sealed class MinReportService
{
    public const string SnoozeKey = "MIN_REPORT_SNOOZE";
    public static readonly string[] SlotNames = { "", "Prepared", "Checked", "Checked", "Approved" };
    public static string SlotName(int slot) => slot is >= 1 and <= 4 ? SlotNames[slot] : "-";

    // ช่องที่เลือกแสดงได้ (ตรงกับคอลัมน์ของตาราง Store Max-Min) - CODE / NAME เลือกได้ทุกคลัง
    public static readonly (string Key, string Label)[] Fields =
    {
        ("CODE", "PRODUCT CODE"), ("NAME", "PRODUCT NAME"), ("PARTA", "PART A"), ("PARTB", "PART B"), ("PARTNO", "PART NO"), ("MODEL", "MODEL"),
        ("CUSTOMER", "CUSTOMER"), ("SUPPLIER", "SUPPLIER"), ("CATEGORY", "CATEGORY"), ("BIN", "BIN"), ("PACKSIZE", "PACK SIZE")
    };
    public static bool IsField(string k) => Fields.Any(f => f.Key == k);

    private const string PartCols = @"NULLIF(LTRIM(RTRIM(p.Customer)), '') AS Customer, NULLIF(LTRIM(RTRIM(p.Supplier)), '') AS Supplier,
        p.PartA, p.PartB, p.PartNumber AS PartNo, p.Model, p.Category, CONVERT(NVARCHAR(100), p.Bin) AS Bin, CONVERT(NVARCHAR(100), p.PackSize) AS PackSize";

    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    // ---------------------------------------------------------------- ตั้งค่า (ทั้งระบบ)
    public MinReportSettings GetSettings()
    {
        using var c = Conn();
        var s = c.QueryFirstOrDefault<MinReportSettings>("SELECT Enabled, StuckDays, RemindMinutes, UpdatedBy, UpdatedDate FROM Nexus.MinReportSettings WHERE Id = 1") ?? new MinReportSettings();
        s.Stocks = c.Query<int>("SELECT StockID FROM Nexus.MinReportStocks").ToList();
        return s;
    }

    public void SaveSettings(MinReportSettings s, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        c.Execute(@"MERGE Nexus.MinReportSettings AS t USING (SELECT 1 AS Id) AS x ON t.Id = x.Id
                    WHEN MATCHED THEN UPDATE SET Enabled = @Enabled, StuckDays = @StuckDays, RemindMinutes = @RemindMinutes, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (Id, Enabled, StuckDays, RemindMinutes, UpdatedBy) VALUES (1, @Enabled, @StuckDays, @RemindMinutes, @uid);",
                  new { s.Enabled, s.StuckDays, s.RemindMinutes, uid }, tx);
        c.Execute("DELETE FROM Nexus.MinReportStocks WHERE StockID NOT IN @ids", new { ids = s.Stocks.DefaultIfEmpty(-1) }, tx);
        foreach (int id in s.Stocks.Distinct())
            c.Execute("IF NOT EXISTS (SELECT 1 FROM Nexus.MinReportStocks WHERE StockID = @id) INSERT INTO Nexus.MinReportStocks (StockID, UpdatedBy) VALUES (@id, @uid)", new { id, uid }, tx);
        tx.Commit();
    }

    // ---------------------------------------------------------------- 🏷 รูปแบบการแสดงสินค้าต่อคลัง
    private static List<string> Split(string v) =>
        (v ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(x => x.ToUpperInvariant()).Where(IsField).Distinct().ToList();

    public Dictionary<int, MinDisplay> Displays()
    {
        if (!DbSchema.HasMinSign) return new();
        using var c = Conn();
        return c.Query<(int StockID, string Line1, string Line2)>("SELECT StockID, Line1, Line2 FROM Nexus.MinReportDisplay")
                .ToDictionary(x => x.StockID, x => new MinDisplay { Line1 = Split(x.Line1), Line2 = Split(x.Line2) });
    }

    public MinDisplay Display(int stockId) => Displays().TryGetValue(stockId, out var d) ? d : new MinDisplay();

    public void SaveDisplay(int stockId, MinDisplay d, string uid)
    {
        using var c = Conn();
        c.Execute(@"MERGE Nexus.MinReportDisplay AS t USING (SELECT @stockId AS StockID) AS x ON t.StockID = x.StockID
                    WHEN MATCHED THEN UPDATE SET Line1 = @l1, Line2 = @l2, UpdatedBy = @uid, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (StockID, Line1, Line2, UpdatedBy) VALUES (@stockId, @l1, @l2, @uid);",
                  new { stockId, l1 = string.Join(",", d.Line1), l2 = string.Join(",", d.Line2), uid });
    }

    private static string Clean(string v) => string.IsNullOrWhiteSpace(v) || v.Trim() == "-" ? "" : v.Trim();

    public static string Value(MinPartBase r, string key) => Clean(key switch
    {
        "CODE" => r.PartCode, "NAME" => r.PartName, "PARTA" => r.PartA, "PARTB" => r.PartB, "PARTNO" => r.PartNo, "MODEL" => r.Model,
        "CUSTOMER" => r.Customer, "SUPPLIER" => r.Supplier, "CATEGORY" => r.Category, "BIN" => r.Bin, "PACKSIZE" => r.PackSize, _ => ""
    });

    private static string Join(MinPartBase r, List<string> keys) => string.Join(" · ", keys.Select(k => Value(r, k)).Where(v => v.Length > 0));

    // บรรทัดที่ 1 ว่าง (เช่น PRODUCT CODE = "-") = แสดง "ไม่มีรหัส" ที่หน้าเว็บ · บรรทัดที่ 2 ว่าง = ชื่อสินค้า
    public void ApplyDisplay<T>(IEnumerable<T> rows, Dictionary<int, MinDisplay> map = null) where T : MinPartBase
    {
        map ??= Displays();
        foreach (var r in rows)
        {
            var d = map.TryGetValue(r.StockId, out var x) ? x : new MinDisplay();
            r.Title = Join(r, d.Line1);
            r.Sub = Join(r, d.Line2);
            if (r.Sub.Length == 0 && d.Line1.Count > 0 && !d.Line1.Contains("NAME")) r.Sub = Clean(r.PartName);
        }
    }

    // ---------------------------------------------------------------- ✍ FLOW ลายเซ็นต่อคลัง
    public List<MinFlowSlot> Flow(int stockId) => Flows().TryGetValue(stockId, out var f) ? f : EmptyFlow();

    private static List<MinFlowSlot> EmptyFlow() => Enumerable.Range(1, 4).Select(i => new MinFlowSlot { Slot = i }).ToList();

    public Dictionary<int, List<MinFlowSlot>> Flows()
    {
        if (!DbSchema.HasMinSign) return new();
        using var c = Conn();
        return c.Query<(int StockID, int Slot, string Mode, string Users)>("SELECT StockID, CAST(Slot AS INT), Mode, Users FROM Nexus.MinReportFlow")
                .GroupBy(x => x.StockID)
                .ToDictionary(g => g.Key, g =>
                {
                    var list = EmptyFlow();
                    foreach (var x in g)
                        if (x.Slot is >= 1 and <= 4)
                            list[x.Slot - 1] = new MinFlowSlot
                            {
                                Slot = x.Slot, Mode = x.Mode,
                                Users = (x.Users ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
                            };
                    return list;
                });
    }

    public void SaveFlow(int stockId, List<MinFlowSlot> slots, string uid)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        foreach (var s in slots)
            c.Execute(@"MERGE Nexus.MinReportFlow AS t USING (SELECT @stockId AS StockID, @slot AS Slot) AS x ON t.StockID = x.StockID AND t.Slot = x.Slot
                        WHEN MATCHED THEN UPDATE SET Mode = @mode, Users = @users, UpdatedBy = @uid, UpdatedDate = GETDATE()
                        WHEN NOT MATCHED THEN INSERT (StockID, Slot, Mode, Users, UpdatedBy) VALUES (@stockId, @slot, @mode, @users, @uid);",
                      new { stockId, slot = (byte)s.Slot, mode = s.Mode, users = s.Users.Count == 0 ? null : string.Join(",", s.Users), uid }, tx);
        tx.Commit();
    }

    public static int? NextActive(List<MinFlowSlot> flow, int after) => flow.Where(s => s.Slot > after && s.Active).Select(s => (int?)s.Slot).Min();

    // ---------------------------------------------------------------- บันทึกช่วงที่อยู่ใต้ MIN (MinWatchService)
    //   คลังที่เปิด: แถวใต้ MIN ใหม่ = เริ่มนับ · ยังใต้ MIN = อัพเดทยอดล่าสุด · พ้น MIN แล้ว = ปิดช่วง (ResolvedAt)
    public int Sweep()
    {
        var set = GetSettings();
        if (!set.Enabled || set.Stocks.Count == 0) return 0;
        int changed = 0;
        using var c = Conn();
        c.Open();
        foreach (int stk in set.Stocks)
        {
            var below = c.Query<(int PartID, string PartCode, string PartName, decimal Qty, string StockBox, decimal Min, decimal Max)>(
                @"SELECT PartID, PartCode, PartName, ISNULL(QtyStkb, 0), CONVERT(NVARCHAR(50), StockBox), ISNULL([Min], 0), ISNULL([Max], 0)
                  FROM Nexus.vw_StockMonitoring
                  WHERE StkId = @stk AND StockStatus IN ('UNDER_MIN', 'OUT_OF_STOCK') AND ISNULL([Min], 0) > 0
                  OPTION (MAX_GRANT_PERCENT = 5)", new { stk }, commandTimeout: 120).ToList();
            var open = c.Query<(int WatchID, int PartID)>("SELECT WatchID, PartID FROM Nexus.MinWatch WHERE StockID = @stk AND ResolvedAt IS NULL", new { stk }).ToDictionary(x => x.PartID, x => x.WatchID);
            var now = DateTime.Now;
            foreach (var b in below)
            {
                if (open.Remove(b.PartID, out int wid))
                    c.Execute("UPDATE Nexus.MinWatch SET LastSeen = @now, Qty = @Qty, StockBox = @StockBox, MinQty = @Min, MaxQty = @Max, PartCode = @PartCode, PartName = @PartName WHERE WatchID = @wid",
                              new { now, b.Qty, b.StockBox, b.Min, b.Max, b.PartCode, b.PartName, wid });
                else
                {
                    c.Execute(@"INSERT INTO Nexus.MinWatch (StockID, PartID, PartCode, PartName, BelowSince, LastSeen, Qty, StockBox, MinQty, MaxQty)
                                VALUES (@stk, @PartID, @PartCode, @PartName, @now, @now, @Qty, @StockBox, @Min, @Max)",
                              new { stk, b.PartID, b.PartCode, b.PartName, now, b.Qty, b.StockBox, b.Min, b.Max });
                    changed++;
                }
            }
            // ที่เหลือ = พ้น MIN แล้ว (หรือถูกซ่อน / ลบ) -> ปิดช่วง · แถวทดสอบ (TEST) ไม่ปิดเอง
            foreach (int wid in open.Values)
                changed += c.Execute("UPDATE Nexus.MinWatch SET ResolvedAt = @now WHERE WatchID = @wid AND ResolvedAt IS NULL AND Source <> 'TEST'", new { now, wid });
        }
        return changed;
    }

    // ---------------------------------------------------------------- แจ้งเตือน (ค้างครบ StuckDays · ยังไม่รายงาน)
    private const string WatchSelect = @"SELECT w.WatchID AS WatchId, w.StockID AS StockId, s.StockCode, w.PartID AS PartId, w.PartCode, w.PartName, w.Qty, w.StockBox,
                                                w.MinQty, w.MaxQty, w.BelowSince, w.LastSeen, w.Source, " + PartCols + @"
                                         FROM Nexus.MinWatch w JOIN Nexus.Stocks s ON s.StockID = w.StockID
                                         LEFT JOIN Nexus.Parts p ON p.PartID = w.PartID ";

    public List<MinWatchRow> Pending(IEnumerable<int> stockIds, int stuckDays, bool all = false)
    {
        var ids = stockIds.ToList();
        if (ids.Count == 0) return new();
        using var c = Conn();
        var rows = c.Query<MinWatchRow>(WatchSelect + @"WHERE w.ResolvedAt IS NULL AND w.ReportID IS NULL AND w.StockID IN @ids
                                                         AND (@all = 1 OR w.BelowSince <= DATEADD(DAY, -@stuckDays, GETDATE()))
                                                       ORDER BY w.BelowSince, s.StockCode, w.PartCode", new { ids, stuckDays, all = all ? 1 : 0 }).ToList();
        ApplyDisplay(rows);
        return rows;
    }

    public MinWatchRow GetWatch(int watchId)
    {
        using var c = Conn();
        var w = c.QueryFirstOrDefault<MinWatchRow>(WatchSelect + "WHERE w.WatchID = @watchId AND w.ResolvedAt IS NULL AND w.ReportID IS NULL", new { watchId });
        if (w != null) ApplyDisplay(new[] { w });
        return w;
    }

    // รายงานสาเหตุ: เก็บสำเนาข้อมูลสินค้า ณ ตอนรายงาน + ผูกกับช่วง (ไม่แจ้งเตือนช่วงนี้อีก) · คนอื่นรายงานไปก่อน = 0
    //   คลังที่ตั้ง FLOW ลายเซ็นไว้ = เริ่ม FLOW ที่ช่องแรกที่ใช้ (SIGNING)
    public (int Id, int? NextSlot) Report(MinWatchRow w, string reasonType, string reason, string uid, string name)
    {
        int? next = DbSchema.HasMinSign ? NextActive(Flow(w.StockId), 0) : null;
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        int id = c.QuerySingle<int>(@"INSERT INTO Nexus.MinReports (WatchID, StockID, StockCode, PartID, PartCode, PartName, Qty, StockBox, MinQty, MaxQty, BelowSince, DaysStuck, Reason, ReportedBy, ReporterName)
                                      OUTPUT INSERTED.ReportID
                                      VALUES (@WatchId, @StockId, @StockCode, @PartId, @PartCode, @PartName, @Qty, @StockBox, @MinQty, @MaxQty, @BelowSince, @days, @reason, @uid, @name)",
                                    new { w.WatchId, w.StockId, w.StockCode, w.PartId, w.PartCode, w.PartName, w.Qty, w.StockBox, w.MinQty, w.MaxQty, w.BelowSince, days = (decimal)w.Days, reason, uid, name }, tx);
        int n = c.Execute("UPDATE Nexus.MinWatch SET ReportID = @id WHERE WatchID = @wid AND ReportID IS NULL AND ResolvedAt IS NULL", new { id, wid = w.WatchId }, tx);
        if (n == 0) { tx.Rollback(); return (0, null); }
        if (DbSchema.HasMinSign)
            c.Execute("UPDATE Nexus.MinReports SET ReasonType = @reasonType, FlowStatus = @st, NextSlot = @next WHERE ReportID = @id",
                      new { id, reasonType, st = next.HasValue ? "SIGNING" : null, next = (byte?)next }, tx);
        tx.Commit();
        return (id, next);
    }

    private string HistoryCols => @"r.ReportID AS ReportId, r.StockID AS StockId, r.StockCode, r.PartID AS PartId, r.PartCode, r.PartName, r.Qty, r.StockBox, r.MinQty, r.MaxQty,
                                    r.BelowSince, r.DaysStuck, r.Reason, r.ReportedBy, r.ReporterName, r.ReportedAt, w.ResolvedAt, w.LastSeen, " + PartCols + @",
                                    COALESCE(NULLIF(LTRIM(RTRIM(u.Section)), ''), NULLIF(LTRIM(RTRIM(u.Department)), '')) AS Section, " +
                                   (DbSchema.HasMinSign ? "r.ReasonType, r.FlowStatus, CAST(r.NextSlot AS INT) AS NextSlot, r.DoneAt"
                                                        : "CAST(NULL AS NVARCHAR(60)) AS ReasonType, CAST(NULL AS VARCHAR(12)) AS FlowStatus, CAST(NULL AS INT) AS NextSlot, CAST(NULL AS DATETIME) AS DoneAt") + @"
                                    FROM Nexus.MinReports r LEFT JOIN Nexus.MinWatch w ON w.WatchID = r.WatchID
                                    LEFT JOIN Nexus.Parts p ON p.PartID = r.PartID
                                    LEFT JOIN Nexus.Users u ON u.UserID = r.ReportedBy ";

    public List<MinReportRow> History(IEnumerable<int> stockIds, DateTime from, DateTime to, string key)
    {
        var ids = stockIds.ToList();
        if (ids.Count == 0) return new();
        using var c = Conn();
        var rows = c.Query<MinReportRow>("SELECT " + HistoryCols + @"
                                      WHERE r.StockID IN @ids AND r.ReportedAt >= @from AND r.ReportedAt < DATEADD(DAY, 1, @to)
                                        AND (@key = '' OR r.PartCode LIKE @like OR r.PartName LIKE @like OR r.Reason LIKE @like OR r.ReporterName LIKE @like OR r.ReportedBy LIKE @like
                                             OR p.PartA LIKE @like OR p.PartNumber LIKE @like)
                                      ORDER BY r.ReportedAt DESC", new { ids, from = from.Date, to = to.Date, key = key ?? "", like = "%" + (key ?? "") + "%" }).ToList();
        Finish(c, rows);
        return rows;
    }

    public MinReportRow GetReport(int reportId)
    {
        using var c = Conn();
        var r = c.QueryFirstOrDefault<MinReportRow>("SELECT " + HistoryCols + "WHERE r.ReportID = @reportId", new { reportId });
        if (r != null) Finish(c, new List<MinReportRow> { r });
        return r;
    }

    // รายงานที่รอลงลายเซ็น (FLOW ที่ช่องถัดไปมีชื่อผู้ใช้นี้)
    public List<MinReportRow> Queue(string uid)
    {
        if (!DbSchema.HasMinSign) return new();
        var flows = Flows();
        using var c = Conn();
        var rows = c.Query<MinReportRow>("SELECT " + HistoryCols + "WHERE r.FlowStatus = 'SIGNING' ORDER BY r.ReportedAt").ToList()
                    .Where(r => r.NextSlot is int ns && flows.TryGetValue(r.StockId, out var f) && f[ns - 1].Allows(uid)).ToList();
        Finish(c, rows);
        return rows;
    }

    private void Finish(SqlConnection c, List<MinReportRow> rows)
    {
        if (rows.Count == 0) return;
        ApplyDisplay(rows);
        if (!DbSchema.HasMinSign) return;
        var signs = c.Query<MinSign>("SELECT ReportID AS ReportId, CAST(Slot AS INT) AS Slot, UserID AS UserId, UserName, SignedAt FROM Nexus.MinReportSigns WHERE ReportID IN @ids",
                                     new { ids = rows.Select(r => r.ReportId).Distinct() }).ToLookup(s => s.ReportId);
        foreach (var r in rows) r.Signs = signs[r.ReportId].OrderBy(s => s.Slot).ToList();
    }

    // ✍ ลงลายเซ็นช่องที่รออยู่ -> ไปช่องถัดไปที่ใช้ · ไม่มีช่องถัดไป = DONE (บันทึกเวลาเสร็จ)
    //   คืนค่า: error (null = สำเร็จ) · ช่องถัดไป (null = ครบแล้ว)
    public (string Error, int? Next) Sign(MinReportRow r, int slot, string uid, string name)
    {
        if (r.FlowStatus != "SIGNING" || r.NextSlot != slot) return ("ช่องนี้ไม่ได้รอลงลายเซ็นแล้ว (มีคนลงไปก่อน หรือ FLOW เปลี่ยน)", null);
        var flow = Flow(r.StockId);
        if (!flow[slot - 1].Allows(uid)) return ($"คุณไม่มีสิทธิ์ลงลายเซ็นช่อง {SlotName(slot)} ของคลัง {r.StockCode} (Admin ตั้งได้ที่ SETUP › SIGN FLOW)", null);
        int? next = NextActive(flow, slot);
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        int n = c.Execute(@"UPDATE Nexus.MinReports SET NextSlot = @next, FlowStatus = @st, DoneAt = CASE WHEN @next IS NULL THEN GETDATE() ELSE NULL END
                            WHERE ReportID = @id AND FlowStatus = 'SIGNING' AND NextSlot = @slot",
                          new { id = r.ReportId, slot = (byte)slot, next = (byte?)next, st = next.HasValue ? "SIGNING" : "DONE" }, tx);
        if (n == 0) { tx.Rollback(); return ("ช่องนี้มีคนลงลายเซ็นไปแล้ว", null); }
        c.Execute("INSERT INTO Nexus.MinReportSigns (ReportID, Slot, UserID, UserName) VALUES (@id, @slot, @uid, @name)", new { id = r.ReportId, slot = (byte)slot, uid, name }, tx);
        tx.Commit();
        return (null, next);
    }

    // ---------------------------------------------------------------- เลื่อนการแจ้งเตือน (CANCEL) ต่อผู้ใช้
    public DateTime? GetSnooze(string uid)
    {
        using var c = Conn();
        string v = c.QueryFirstOrDefault<string>("SELECT SettingValue FROM Nexus.UserSettings WHERE UserID = @uid AND SettingKey = @k", new { uid, k = SnoozeKey });
        return DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;
    }

    public DateTime Snooze(string uid, int minutes)
    {
        var until = DateTime.Now.AddMinutes(Math.Max(1, minutes));
        string v = until.ToString("yyyy-MM-ddTHH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
        using var c = Conn();
        c.Execute(@"MERGE Nexus.UserSettings AS t USING (SELECT @uid AS UserID, @k AS SettingKey) AS x ON t.UserID = x.UserID AND t.SettingKey = x.SettingKey
                    WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedDate = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (UserID, SettingKey, SettingValue, UpdatedDate) VALUES (@uid, @k, @v, GETDATE());", new { uid, k = SnoozeKey, v });
        return until;
    }

    // ---------------------------------------------------------------- 📤 Excel = แบบฟอร์ม FM-EN-04-22 Improvement Plan / All (MinReportForm)
    public static void ExcelPending(List<MinWatchRow> rows, int stuckDays, string stock, string path) =>
        MinReportForm.Save(rows.Select(MinReportForm.From).ToList(), stock, $"MIN REPORT : สินค้าค้างที่ค่า MIN ≥ {stuckDays} วัน (รอระบุสาเหตุ)", path);

    public static void ExcelHistory(List<MinReportRow> rows, string stock, DateTime from, DateTime to, string path) =>
        MinReportForm.Save(rows.Select(MinReportForm.From).ToList(), stock, $"MIN REPORT : ประวัติรายงานสาเหตุสินค้าค้างที่ค่า MIN ({from:dd/MM/yyyy} - {to:dd/MM/yyyy})", path);

    // เอกสารรายงานเดียว (+ ลายเซ็นที่ลงแล้วในช่อง Prepared / Checked / Checked / Approved)
    public static void ExcelOne(MinReportRow r, string path)
    {
        var it = MinReportForm.From(r);
        it.Signs = r.Signs.Select(s => (s.Slot, SignatureStore.Read(s.UserId), $"{s.UserName ?? s.UserId}  {s.SignedAt:dd/MM/yy HH:mm}")).ToList();
        MinReportForm.Save(new List<MinReportForm.Item> { it }, r.StockCode, $"MIN REPORT : รายงานสาเหตุสินค้าค้างที่ค่า MIN ({r.ReportedAt:dd/MM/yyyy})", path);
    }
}
