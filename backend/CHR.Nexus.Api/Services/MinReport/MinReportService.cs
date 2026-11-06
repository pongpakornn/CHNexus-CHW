using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;

namespace Nexus.Services;

// 📋 MIN REPORT : สินค้าที่ค้างอยู่ใต้ค่า MIN นานเกินกำหนด (StuckDays) -> แจ้งเตือนกลางจอ -> ผู้ใช้รายงานสาเหตุ
//   Nexus.MinWatch   = ช่วงที่สินค้าอยู่ใต้ MIN (MinWatchService บันทึกเองทุก 5 นาที เฉพาะคลังที่เปิดใน SETUP)
//   Nexus.MinReports = รายงานสาเหตุ (ใคร · เมื่อไร · ค้างกี่วัน) · รายงานแล้ว = ช่วงนั้นไม่แจ้งเตือนอีก
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

public sealed class MinWatchRow
{
    public int WatchId { get; set; }
    public int StockId { get; set; }
    public string StockCode { get; set; }
    public int PartId { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public decimal? Qty { get; set; }
    public string StockBox { get; set; }
    public decimal? MinQty { get; set; }
    public decimal? MaxQty { get; set; }
    public DateTime BelowSince { get; set; }
    public DateTime LastSeen { get; set; }
    public string Source { get; set; }
    public string Customer { get; set; }
    public string Supplier { get; set; }
    public double Days => Math.Round((DateTime.Now - BelowSince).TotalDays, 1);
}

public sealed class MinReportRow
{
    public int ReportId { get; set; }
    public int StockId { get; set; }
    public string StockCode { get; set; }
    public int PartId { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public decimal? Qty { get; set; }
    public string StockBox { get; set; }
    public decimal? MinQty { get; set; }
    public decimal? MaxQty { get; set; }
    public DateTime BelowSince { get; set; }
    public decimal DaysStuck { get; set; }
    public string Reason { get; set; }
    public string ReportedBy { get; set; }
    public string ReporterName { get; set; }
    public DateTime ReportedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime? LastSeen { get; set; }      // อัพเดทยอดล่าสุดของช่วงนั้น (MinWatch.LastSeen)
    public string Customer { get; set; }
    public string Supplier { get; set; }
    public string Section { get; set; }          // แผนกของผู้รายงาน (Users.Section / Department)
}

public sealed class MinReportService
{
    public const string SnoozeKey = "MIN_REPORT_SNOOZE";
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
            // ที่เหลือ = พ้น MIN แล้ว (หรือถูกซ่อน / ลบ) -> ปิดช่วง
            foreach (int wid in open.Values)
            {
                c.Execute("UPDATE Nexus.MinWatch SET ResolvedAt = @now WHERE WatchID = @wid AND ResolvedAt IS NULL", new { now, wid });
                changed++;
            }
        }
        return changed;
    }

    // ---------------------------------------------------------------- แจ้งเตือน (ค้างครบ StuckDays · ยังไม่รายงาน)
    public List<MinWatchRow> Pending(IEnumerable<int> stockIds, int stuckDays, bool all = false)
    {
        var ids = stockIds.ToList();
        if (ids.Count == 0) return new();
        using var c = Conn();
        return c.Query<MinWatchRow>(@"SELECT w.WatchID AS WatchId, w.StockID AS StockId, s.StockCode, w.PartID AS PartId, w.PartCode, w.PartName, w.Qty, w.StockBox,
                                            w.MinQty, w.MaxQty, w.BelowSince, w.LastSeen, w.Source,
                                            NULLIF(LTRIM(RTRIM(p.Customer)), '') AS Customer, NULLIF(LTRIM(RTRIM(p.Supplier)), '') AS Supplier
                                     FROM Nexus.MinWatch w JOIN Nexus.Stocks s ON s.StockID = w.StockID
                                     LEFT JOIN Nexus.Parts p ON p.PartID = w.PartID
                                     WHERE w.ResolvedAt IS NULL AND w.ReportID IS NULL AND w.StockID IN @ids
                                       AND (@all = 1 OR w.BelowSince <= DATEADD(DAY, -@stuckDays, GETDATE()))
                                     ORDER BY w.BelowSince, s.StockCode, w.PartCode", new { ids, stuckDays, all = all ? 1 : 0 }).ToList();
    }

    public MinWatchRow GetWatch(int watchId)
    {
        using var c = Conn();
        return c.QueryFirstOrDefault<MinWatchRow>(@"SELECT w.WatchID AS WatchId, w.StockID AS StockId, s.StockCode, w.PartID AS PartId, w.PartCode, w.PartName, w.Qty, w.StockBox,
                                                         w.MinQty, w.MaxQty, w.BelowSince, w.LastSeen, w.Source
                                                  FROM Nexus.MinWatch w JOIN Nexus.Stocks s ON s.StockID = w.StockID
                                                  WHERE w.WatchID = @watchId AND w.ResolvedAt IS NULL AND w.ReportID IS NULL", new { watchId });
    }

    // รายงานสาเหตุ: เก็บสำเนาข้อมูลสินค้า ณ ตอนรายงาน + ผูกกับช่วง (ไม่แจ้งเตือนช่วงนี้อีก) · คนอื่นรายงานไปก่อน = 0
    public int Report(MinWatchRow w, string reason, string uid, string name)
    {
        using var c = Conn();
        c.Open();
        using var tx = c.BeginTransaction();
        int id = c.QuerySingle<int>(@"INSERT INTO Nexus.MinReports (WatchID, StockID, StockCode, PartID, PartCode, PartName, Qty, StockBox, MinQty, MaxQty, BelowSince, DaysStuck, Reason, ReportedBy, ReporterName)
                                      OUTPUT INSERTED.ReportID
                                      VALUES (@WatchId, @StockId, @StockCode, @PartId, @PartCode, @PartName, @Qty, @StockBox, @MinQty, @MaxQty, @BelowSince, @days, @reason, @uid, @name)",
                                    new { w.WatchId, w.StockId, w.StockCode, w.PartId, w.PartCode, w.PartName, w.Qty, w.StockBox, w.MinQty, w.MaxQty, w.BelowSince, days = (decimal)w.Days, reason, uid, name }, tx);
        int n = c.Execute("UPDATE Nexus.MinWatch SET ReportID = @id WHERE WatchID = @wid AND ReportID IS NULL AND ResolvedAt IS NULL", new { id, wid = w.WatchId }, tx);
        if (n == 0) { tx.Rollback(); return 0; }
        tx.Commit();
        return id;
    }

    public List<MinReportRow> History(IEnumerable<int> stockIds, DateTime from, DateTime to, string key)
    {
        var ids = stockIds.ToList();
        if (ids.Count == 0) return new();
        using var c = Conn();
        return c.Query<MinReportRow>(@"SELECT r.ReportID AS ReportId, r.StockID AS StockId, r.StockCode, r.PartID AS PartId, r.PartCode, r.PartName, r.Qty, r.StockBox, r.MinQty, r.MaxQty,
                                             r.BelowSince, r.DaysStuck, r.Reason, r.ReportedBy, r.ReporterName, r.ReportedAt, w.ResolvedAt, w.LastSeen,
                                             NULLIF(LTRIM(RTRIM(p.Customer)), '') AS Customer, NULLIF(LTRIM(RTRIM(p.Supplier)), '') AS Supplier,
                                             COALESCE(NULLIF(LTRIM(RTRIM(u.Section)), ''), NULLIF(LTRIM(RTRIM(u.Department)), '')) AS Section
                                      FROM Nexus.MinReports r LEFT JOIN Nexus.MinWatch w ON w.WatchID = r.WatchID
                                      LEFT JOIN Nexus.Parts p ON p.PartID = r.PartID
                                      LEFT JOIN Nexus.Users u ON u.UserID = r.ReportedBy
                                      WHERE r.StockID IN @ids AND r.ReportedAt >= @from AND r.ReportedAt < DATEADD(DAY, 1, @to)
                                        AND (@key = '' OR r.PartCode LIKE @like OR r.PartName LIKE @like OR r.Reason LIKE @like OR r.ReporterName LIKE @like OR r.ReportedBy LIKE @like)
                                      ORDER BY r.ReportedAt DESC", new { ids, from = from.Date, to = to.Date, key = key ?? "", like = "%" + (key ?? "") + "%" }).ToList();
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
}
