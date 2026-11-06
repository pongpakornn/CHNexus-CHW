using System.Globalization;
using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Models;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 📋 MIN REPORT : สินค้าค้างใต้ MIN นานเกินกำหนด -> หน้าต่างแจ้งเตือนกลางจอ -> REPORT (ระบุสาเหตุ) / CANCEL (เลื่อนตามเวลาที่ตั้ง)
//   ดู / รายงาน = ผู้ที่ดูหน้า Store และคลังนั้นได้ · ตั้งค่า (วัน / แจ้งซ้ำทุกกี่นาที / คลังที่ใช้) = Admin Level 1 (SETUP)
//   ทุกการรายงาน / ตั้งค่า / Export ลง Activity Log
[Route("api/minreport")]
public sealed class MinReportController : AppController
{
    private readonly MinReportService _svc = new();
    private readonly StockService _stocks = new();

    private bool Ready => DbSchema.HasMinReport;
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง MIN REPORT (database/nexus/19_Min_Report.sql)");

    // คลังที่ผู้ใช้เห็น ∩ คลังที่เปิด MIN REPORT
    private List<StockModel> MyStocks(MinReportSettings set) =>
        Me?.CanViewStore != true || !set.Enabled ? new()
        : _stocks.GetStocks().Where(s => set.Stocks.Contains(s.StkId) && Me.CanViewStock(s)).ToList();

    private StockModel Visible(int stkId)
    {
        var s = _stocks.GetStock(stkId);
        return s != null && Me?.CanViewStore == true && Me.CanViewStock(s) ? s : null;
    }

    private static object Row(MinWatchRow x) => new
    {
        x.WatchId, stkId = x.StockId, x.StockCode, x.PartId, x.PartCode, x.PartName, x.Qty, x.StockBox, min = x.MinQty, max = x.MaxQty,
        x.BelowSince, x.LastSeen, x.Days, test = x.Source == "TEST", x.Customer, x.Supplier
    };

    // ---------------------------------------------------------------- หน้าต่างแจ้งเตือนกลางจอ (ทุกหน้า)
    [HttpGet("alerts")]
    public IActionResult Alerts()
    {
        if (Me == null) return Deny();
        if (!Ready) return Ok(new { items = Array.Empty<object>() });
        var set = _svc.GetSettings();
        var mine = MyStocks(set);
        var items = _svc.Pending(mine.Select(s => s.StkId), set.StuckDays);
        return Ok(new { set.StuckDays, set.RemindMinutes, snoozeUntil = _svc.GetSnooze(Uid), now = DateTime.Now, items = items.Select(Row) });
    }

    [HttpPost("snooze")]
    public IActionResult Snooze()
    {
        if (Me == null) return Deny();
        if (!Ready) return NotReady();
        var set = _svc.GetSettings();
        var until = _svc.Snooze(Uid, set.RemindMinutes);
        return Ok(new { until, minutes = set.RemindMinutes });
    }

    public sealed record ReportRequest(int WatchId, string Reason);

    [HttpPost("report")]
    public IActionResult Report([FromBody] ReportRequest req)
    {
        if (Me == null) return Deny();
        if (!Ready) return NotReady();
        string reason = (req?.Reason ?? "").Trim();
        if (reason.Length < 3) return Fail("กรุณาระบุหมายเหตุ / สาเหตุที่สินค้าค้างอยู่ที่ค่า MIN");
        if (reason.Length > 1000) reason = reason[..1000];
        var w = _svc.GetWatch(req.WatchId);
        if (w == null) return Fail("รายการนี้ถูกรายงานไปแล้ว หรือสินค้ากลับมาพ้นค่า MIN แล้ว");
        var s = Visible(w.StockId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        try
        {
            int id = _svc.Report(w, reason, Uid, Me.UserName);
            if (id == 0) return Fail("รายการนี้ถูกรายงานไปแล้ว");
            LogService.WriteLog(Uid, "MIN_REPORT", $"Stock: {s.Code} | {w.PartCode} {w.PartName} | Below MIN since {w.BelowSince:yyyy-MM-dd HH:mm} ({w.Days:0.#} days) | Reason: {reason}", w.PartCode);
            LiveBus.Publish("minreport");
            return Ok(new { id, message = $"บันทึกรายงานของ {w.PartCode} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกรายงานไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- หน้า Store : ปุ่ม MIN REPORT ของคลัง
    [HttpGet("stock/{stkId:int}/pending")]
    public IActionResult Pending(int stkId)
    {
        var s = Visible(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (!Ready) return Ok(new { ready = false, enabled = false, items = Array.Empty<object>() });
        var set = _svc.GetSettings();
        bool on = set.Enabled && set.Stocks.Contains(stkId);
        var items = on ? _svc.Pending(new[] { stkId }, set.StuckDays, all: true) : new();
        return Ok(new { ready = true, enabled = on, set.StuckDays, items = items.Select(Row) });
    }

    [HttpGet("stock/{stkId:int}/history")]
    public IActionResult History(int stkId, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string key)
    {
        var s = Visible(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (!Ready) return Ok(Array.Empty<object>());
        var (f, t) = Range(from, to);
        return Ok(_svc.History(new[] { stkId }, f, t, key));
    }

    [HttpGet("stock/{stkId:int}/export")]
    public IActionResult Export(int stkId, [FromQuery] string kind, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string key, [FromQuery] int? id)
    {
        var s = Visible(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (!Ready) return NotReady();
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Store, $"MinReport_{s.Code}_{(kind == "history" ? "History" : "Pending")}");
            int n;
            if (kind == "history")
            {
                var (f, t) = Range(from, to);
                var rows = _svc.History(new[] { stkId }, f, t, key);
                if (id.HasValue) rows = rows.Where(r => r.ReportId == id.Value).ToList();   // 👁 PREVIEW รายการเดียว
                MinReportService.ExcelHistory(rows, s.Code, f, t, path);
                n = rows.Count;
            }
            else
            {
                var set = _svc.GetSettings();
                var rows = _svc.Pending(new[] { stkId }, set.StuckDays, all: true);
                if (id.HasValue) rows = rows.Where(r => r.WatchId == id.Value).ToList();    // 👁 PREVIEW รายการเดียว
                MinReportService.ExcelPending(rows, set.StuckDays, s.Code, path);
                n = rows.Count;
            }
            LogService.WriteLog(Uid, "MIN_REPORT_EXPORT", $"Stock: {s.Code} | {(kind == "history" ? "HISTORY" : "PENDING")} | Rows: {n} | Excel", s.Code);
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }

    // PDF สร้างในเครื่องของผู้ใช้ (หน้าต่าง PREVIEW) -> บันทึกแค่ร่องรอยการ Export
    public sealed record PdfLog(string Kind, int Rows);

    [HttpPost("stock/{stkId:int}/pdf-log")]
    public IActionResult LogPdf(int stkId, [FromBody] PdfLog req)
    {
        var s = Visible(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        LogService.WriteLog(Uid, "MIN_REPORT_EXPORT", $"Stock: {s.Code} | {(req?.Kind == "history" ? "HISTORY" : "PENDING")} | Rows: {req?.Rows ?? 0} | PDF", s.Code);
        return Ok(new { ok = true });
    }

    private static (DateTime, DateTime) Range(DateTime? from, DateTime? to)
    {
        var t = (to ?? DateTime.Today).Date;
        var f = (from ?? t.AddDays(-30)).Date;
        return f > t ? (t, f) : (f, t);
    }

    // ---------------------------------------------------------------- ⚙ SETUP > MIN REPORT (Admin Level 1 · ทั้งระบบ)
    private bool IsAdmin => Me?.UserLevel == 1;

    [HttpGet("settings")]
    public IActionResult Settings()
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!Ready) return NotReady();
        var set = _svc.GetSettings();
        return Ok(new
        {
            set.Enabled, set.StuckDays, set.RemindMinutes, set.UpdatedBy, set.UpdatedDate,
            stocks = _stocks.GetStocks().Select(s => new { s.StkId, s.Code, s.Name, s.StockType, s.IsMain, s.IsLiveView, on = set.Stocks.Contains(s.StkId) })
        });
    }

    public sealed record SettingsRequest(bool Enabled, int StuckDays, int RemindMinutes, List<int> Stocks);

    [HttpPost("settings")]
    public IActionResult SaveSettings([FromBody] SettingsRequest req)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!Ready) return NotReady();
        if (req == null) return Fail("ข้อมูลไม่ครบ");
        if (req.StuckDays < 1 || req.StuckDays > 60) return Fail("จำนวนวันที่ค้างต้องอยู่ระหว่าง 1 - 60 วัน");
        if (req.RemindMinutes < 5 || req.RemindMinutes > 10080) return Fail("แจ้งเตือนซ้ำต้องอยู่ระหว่าง 5 นาที - 7 วัน");
        var all = _stocks.GetStocks().ToDictionary(s => s.StkId);
        var ids = (req.Stocks ?? new()).Where(all.ContainsKey).Distinct().ToList();
        try
        {
            _svc.SaveSettings(new MinReportSettings { Enabled = req.Enabled, StuckDays = req.StuckDays, RemindMinutes = req.RemindMinutes, Stocks = ids }, Uid);
            try { _svc.Sweep(); } catch { /* รอบถัดไปของ MinWatchService */ }
            string codes = ids.Count == 0 ? "-" : string.Join(", ", ids.Select(i => all[i].Code));
            LogService.WriteLog(Uid, "MIN_REPORT_SETTINGS", $"Enabled: {(req.Enabled ? "ON" : "OFF")} | Stuck: {req.StuckDays} days | Remind every {req.RemindMinutes} min | Stocks: {codes}", "MIN_REPORT");
            LiveBus.Publish("minreport");
            return Ok(new { message = $"บันทึก MIN REPORT แล้ว\n\nแจ้งเตือนเมื่อค้างที่ MIN ≥ {req.StuckDays} วัน · กด CANCEL แล้วแจ้งซ้ำทุก {Every(req.RemindMinutes)}\nคลัง: {codes}" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    private static string Every(int m) => m % 60 == 0 ? $"{m / 60} ชม." : m > 60 ? $"{m / 60} ชม. {m % 60} นาที" : $"{m} นาที";
}
