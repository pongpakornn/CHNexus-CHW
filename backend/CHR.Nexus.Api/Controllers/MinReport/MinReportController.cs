using CHR.Nexus.Api.Web;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 📋 MIN REPORT : สินค้าค้างใต้ MIN นานเกินกำหนด -> หน้าต่างแจ้งเตือนกลางจอ -> REPORT (เลือกหมายเหตุ + รายละเอียด) / CANCEL (เลื่อนตามเวลาที่ตั้ง)
//   ดู / รายงาน = ผู้ที่ดูหน้า Store และคลังนั้นได้ · ตั้งค่า (วัน / แจ้งซ้ำ / คลัง / รูปแบบการแสดง / FLOW ลายเซ็น) = Admin Level 1 (SETUP)
//   ✍ FLOW: ส่งรายงาน -> แจ้งคนที่ต้องเซ็นช่องถัดไป (Toast + กระดิ่ง + แชท) -> เปิดเอกสาร กดช่องของตัวเอง -> ส่งต่อจนครบ = DONE
//   ทุกการรายงาน / ลงลายเซ็น / ตั้งค่า / Export ลง Activity Log
[Route("api/minreport")]
public sealed class MinReportController : AppController
{
    private readonly MinReportService _svc = new();
    private readonly StockService _stocks = new();

    private bool Ready => DbSchema.HasMinReport;
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง MIN REPORT (database/nexus/19_Min_Report.sql)");
    private IActionResult NoSign() => Fail("ฐานข้อมูลยังไม่มีตาราง FLOW ลายเซ็น (database/nexus/21_Min_Report_Sign.sql)");

    // หมายเหตุที่เลือกได้ตอน REPORT = ตาราง Nexus.MinReportReasons (Admin ตั้งได้ที่ SETUP › MIN REASONS)
    private string[] ReasonTypes => _svc.Reasons();

    // คลังที่ผู้ใช้เห็น ∩ คลังที่เปิด MIN REPORT
    // หน้าต่างแจ้งเตือนกลางจอ: คลังที่เปิด MIN REPORT + ดูคลังนั้นได้ + อยู่ในรายชื่อผู้รับแจ้งเตือนของคลัง (ไม่ตั้ง = ทุกคน)
    private List<StockModel> MyStocks(MinReportSettings set) =>
        Me?.CanViewStore != true || !set.Enabled ? new()
        : _stocks.GetStocks().Where(s => set.Stocks.Contains(s.StkId) && Me.CanViewStock(s) && set.AlertsFor(s.StkId, Uid)).ToList();

    private StockModel Visible(int stkId)
    {
        var s = _stocks.GetStock(stkId);
        return s != null && Me?.CanViewStore == true && Me.CanViewStock(s) ? s : null;
    }

    private static object Row(MinWatchRow x) => new
    {
        x.WatchId, stkId = x.StockId, x.StockCode, x.PartId, x.PartCode, x.PartName, x.Title, x.Sub, x.Qty, x.StockBox, min = x.MinQty, max = x.MaxQty,
        x.BelowSince, x.LastSeen, x.Days, test = x.Source == "TEST", x.Customer, x.Supplier,
        x.ReportCount, x.LastReportAt, x.LastReason
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
        return Ok(new { set.StuckDays, set.RemindMinutes, snoozeUntil = _svc.GetSnooze(Uid), now = DateTime.Now, reasons = ReasonTypes, items = items.Select(Row) });
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

    public sealed record ReportRequest(int WatchId, string ReasonType, string Reason);

    [HttpPost("report")]
    public IActionResult Report([FromBody] ReportRequest req)
    {
        if (Me == null) return Deny();
        if (!Ready) return NotReady();
        string type = (req?.ReasonType ?? "").Trim();
        if (type.Length > 60) type = type[..60];
        string detail = (req?.Reason ?? "").Trim();
        if (type.Length == 0 && detail.Length < 3) return Fail("กรุณาเลือกหมายเหตุ หรือระบุสาเหตุที่สินค้าค้างอยู่ที่ค่า MIN");
        string reason = type.Length == 0 ? detail : detail.Length == 0 ? type : $"{type} · {detail}";
        if (reason.Length > 1000) reason = reason[..1000];
        var w = _svc.GetWatch(req.WatchId);
        if (w == null) return Fail("รายการนี้ถูกรายงานไปแล้ว หรือสินค้ากลับมาพ้นค่า MIN แล้ว");
        var s = Visible(w.StockId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        try
        {
            var (id, next) = _svc.Report(w, type.Length == 0 ? null : type, reason, Uid, Me.UserName);
            if (id == 0) return Fail("รายการนี้ถูกรายงานไปแล้ว");
            LogService.WriteLog(Uid, "MIN_REPORT", $"Stock: {s.Code} | {w.PartCode} {w.PartName} | Below MIN since {w.BelowSince:yyyy-MM-dd HH:mm} ({w.Days:0.#} days) | Reason: {reason}", w.PartCode);
            // ผู้รายงานอยู่ในช่องแรกเอง = เปิดเอกสารให้เซ็นต่อทันที · ไม่ใช่ = แจ้งคนที่ต้องเซ็นช่องนั้น
            bool signNow = next.HasValue && _svc.Flow(w.StockId)[next.Value - 1].Allows(Uid);
            var r = _svc.GetReport(id);
            if (next.HasValue && r != null) NotifySigners(r, next.Value, Uid);
            LiveBus.Publish("minreport");
            string msg = $"บันทึกรายงานของ {Label(w)} แล้ว" +
                         (!next.HasValue ? "" : signNow ? $"\nกรุณาลงลายเซ็นช่อง {MinReportService.SlotName(next.Value)} ในเอกสาร" : $"\nส่งให้ลงลายเซ็นช่อง {MinReportService.SlotName(next.Value)} แล้ว");
            return Ok(new { id, next, signNow, message = msg });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกรายงานไม่สำเร็จ"); }
    }

    // แถวรายงานที่รอลงลายเซ็น / ย้อนหลังของฉัน
    private object SignRow(MinReportRow r) => new
    {
        r.ReportId, r.StockId, r.StockCode, r.Title, r.Sub, r.PartCode, r.PartName, r.Customer, r.Supplier, r.Qty, r.StockBox, min = r.MinQty, max = r.MaxQty,
        r.ReasonType, r.Reason, r.ReporterName, r.ReportedBy, r.ReportedAt, r.FlowStatus, r.NextSlot, r.DoneAt,
        slotName = MinReportService.SlotName(r.NextSlot ?? 0), signs = r.Signs.Count,
        mine = r.FlowStatus == "SIGNING" && r.NextSlot is int ns && ns is >= 1 and <= 4 && _svc.Flow(r.StockId)[ns - 1].Allows(Uid)
    };

    private static string Label(MinPartBase r) => string.IsNullOrWhiteSpace(r.Title) ? (string.IsNullOrWhiteSpace(r.Sub) ? r.PartName : r.Sub) : r.Title;

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
        // ✍ รายงานของคลังนี้ที่ยังรอลงลายเซ็น (การ์ด "รอลงลายเซ็น")
        var signing = DbSchema.HasMinSign ? _svc.Signing(stkId) : new();
        return Ok(new { ready = true, enabled = on, set.StuckDays, reasons = ReasonTypes, items = items.Select(Row), signing = signing.Select(SignRow) });
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

    // 📈 MIN TRACKING: ทุกช่วงที่สินค้าใต้ MIN ในช่วงวันที่ (ยังค้าง / กลับเป็นเขียวแล้ว) + ยอดรายวัน · รายงานกี่ครั้ง · ทำไมยังไม่เขียว
    [HttpGet("stock/{stkId:int}/tracking")]
    public IActionResult Tracking(int stkId, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string key)
    {
        var s = Visible(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (!Ready) return Ok(new { tracking = false, rows = Array.Empty<object>() });
        var (f, t) = Range(from, to);
        var rows = _svc.Tracking(stkId, f, t, key);
        return Ok(new
        {
            tracking = DbSchema.HasMinTracking,
            stuckDays = _svc.GetSettings().StuckDays,
            rows = rows.Select(r => new
            {
                r.WatchId, r.PartId, r.PartCode, r.PartName, r.Title, r.Sub, r.Customer, r.Supplier, r.Qty, r.NowQty, r.NowStatus, min = r.MinQty, max = r.MaxQty,
                r.StartQty, r.ResolvedQty, r.BelowSince, r.LastSeen, r.ResolvedAt, r.Days, r.ReportCount, r.LastReportAt, r.LastReason, r.LastReporter, r.Moves,
                r.LastMoveAt, r.NextAlertAt,
                daily = r.Daily.Select(d => new { day = d.Day.ToString("yyyy-MM-dd"), d.FirstQty, d.LastQty, min = d.MinQty, max = d.MaxQty, d.Moves, d.UpdatedAt })
            })
        });
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
                if (id.HasValue) rows = rows.Where(r => r.ReportId == id.Value).ToList();
                if (rows.Count == 1) MinReportService.ExcelOne(rows[0], path);
                else MinReportService.ExcelHistory(rows, s.Code, f, t, path);
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

    // ---------------------------------------------------------------- ✍ เอกสารรายงานเดียว + ลงลายเซ็น
    //   เปิดได้: ผู้ที่ดูคลังนั้นได้ · ผู้รายงาน · ผู้ที่อยู่ใน FLOW ของคลัง · ผู้ที่เคยลงลายเซ็นรายงานนี้
    private bool CanOpen(MinReportRow r, List<MinFlowSlot> flow) =>
        Visible(r.StockId) != null || Same(r.ReportedBy, Uid) || r.Signs.Any(s => Same(s.UserId, Uid)) || flow.Any(s => s.Allows(Uid));

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private Dictionary<string, string> Names(IEnumerable<string> ids)
    {
        var list = ids.Where(i => !string.IsNullOrWhiteSpace(i)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (list.Count == 0) return new(StringComparer.OrdinalIgnoreCase);
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        return c.Query<(string UserID, string FullName)>("SELECT UserID, FullName FROM Nexus.Users WHERE UserID IN @list", new { list })
                .GroupBy(x => x.UserID, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => string.IsNullOrWhiteSpace(g.First().FullName) ? g.Key : g.First().FullName, StringComparer.OrdinalIgnoreCase);
    }

    private object Doc(MinReportRow r, List<MinFlowSlot> flow)
    {
        var names = Names(flow.SelectMany(s => s.Users));
        return new
        {
            report = r,
            stkId = r.StockId,
            slots = flow.Select(s => new
            {
                s.Slot, name = MinReportService.SlotName(s.Slot), s.Mode,
                users = s.Users.Select(u => new { userId = u, name = names.TryGetValue(u, out var n) ? n : u }),
                waiting = r.FlowStatus == "SIGNING" && r.NextSlot == s.Slot,
                mine = r.FlowStatus == "SIGNING" && r.NextSlot == s.Slot && s.Allows(Uid)
            }),
            hasSignature = SignatureStore.Has(Uid),
            canExcel = true
        };
    }

    [HttpGet("reports/{id:int}")]
    public IActionResult GetReport(int id)
    {
        if (Me == null) return Deny();
        if (!Ready) return NotReady();
        var r = _svc.GetReport(id);
        if (r == null) return Fail("ไม่พบรายงานนี้");
        var flow = _svc.Flow(r.StockId);
        if (!CanOpen(r, flow)) return Deny("คุณไม่มีสิทธิ์เปิดรายงานนี้");
        // ส่งรายงานก่อนตั้ง FLOW แล้วตอนนี้คลังมี FLOW = เริ่ม FLOW ให้เลย (เซ็นได้ทันที)
        if (DbSchema.HasMinSign && r.FlowStatus == null && r.DoneAt == null && MinReportService.NextActive(flow, 0).HasValue && StartUnflowed(r.StockId) > 0)
        {
            r = _svc.GetReport(id);
            LiveBus.Publish("minreport");
        }
        return Ok(Doc(r, flow));
    }

    [HttpGet("reports/{id:int}/excel")]
    public IActionResult ReportExcel(int id)
    {
        if (Me == null) return Deny();
        if (!Ready) return NotReady();
        var r = _svc.GetReport(id);
        if (r == null) return Fail("ไม่พบรายงานนี้");
        if (!CanOpen(r, _svc.Flow(r.StockId))) return Deny("คุณไม่มีสิทธิ์เปิดรายงานนี้");
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Store, $"MinReport_{r.StockCode}_{r.ReportId}");
            MinReportService.ExcelOne(r, path);
            LogService.WriteLog(Uid, "MIN_REPORT_EXPORT", $"Stock: {r.StockCode} | REPORT #{r.ReportId} | Excel", r.StockCode);
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }

    public sealed record SignRequest(int Slot);

    [HttpPost("reports/{id:int}/sign")]
    public IActionResult Sign(int id, [FromBody] SignRequest req)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasMinSign) return NoSign();
        var r = _svc.GetReport(id);
        if (r == null) return Fail("ไม่พบรายงานนี้");
        int slot = req?.Slot ?? 0;
        if (slot is < 1 or > 4) return Fail("ช่องลายเซ็นไม่ถูกต้อง");
        if (!SignatureStore.Has(Uid)) return Fail("คุณยังไม่มีลายเซ็นในระบบ\nกรุณาบันทึกลายเซ็นก่อนที่ วงกลมโปรไฟล์ › ลายเซ็นของฉัน");
        try
        {
            var (err, next) = _svc.Sign(r, slot, Uid, Me.UserName);
            if (err != null) return Fail(err);
            LogService.WriteLog(Uid, "MIN_REPORT_SIGN", $"Stock: {r.StockCode} | REPORT #{r.ReportId} | {Label(r)} | Signed: {MinReportService.SlotName(slot)}" + (next.HasValue ? $" | Next: {MinReportService.SlotName(next.Value)}" : " | DONE"), r.PartCode);
            var fresh = _svc.GetReport(id);
            if (next.HasValue) NotifySigners(fresh, next.Value, Uid);
            else NotifyDone(fresh, Uid);
            LiveBus.Publish("minreport");
            var flow = _svc.Flow(fresh.StockId);
            return Ok(new
            {
                message = next.HasValue ? $"ลงลายเซ็นช่อง {MinReportService.SlotName(slot)} แล้ว\nส่งต่อให้ช่อง {MinReportService.SlotName(next.Value)}" : $"ลงลายเซ็นช่อง {MinReportService.SlotName(slot)} แล้ว\n✔ เอกสารลงนามครบทุกช่อง (บันทึกในประวัติแล้ว)",
                doc = Doc(fresh, flow)
            });
        }
        catch (Exception ex) { return Fail(ex, "ลงลายเซ็นไม่สำเร็จ"); }
    }

    // 🔔 รายงานที่รอฉันลงลายเซ็น (Toast + กระดิ่ง)
    [HttpGet("sign/queue")]
    public IActionResult Queue()
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasMinSign) return Ok(Array.Empty<object>());
        return Ok(_svc.Queue(Uid).Select(r => new
        {
            r.ReportId, stkId = r.StockId, r.StockCode, title = Label(r), r.Sub, slot = r.NextSlot, slotName = MinReportService.SlotName(r.NextSlot ?? 0),
            r.ReporterName, r.ReportedBy, r.ReportedAt, r.ReasonType
        }));
    }

    // 🔀 ดู FLOW ลายเซ็น: ของคลัง (ก่อน REPORT · ผู้ที่ดูคลังนั้นได้) / ของเอกสาร (ถึงช่องไหน · ใครเซ็นแล้ว · ผู้ที่เปิดเอกสารได้)
    private object FlowView(string stockCode, List<MinFlowSlot> flow, MinReportRow r)
    {
        var names = Names(flow.SelectMany(s => s.Users));
        return new
        {
            stockCode,
            slots = flow.Select(s =>
            {
                var sg = r?.Signs.FirstOrDefault(x => x.Slot == s.Slot);
                return new
                {
                    s.Slot, name = MinReportService.SlotName(s.Slot), s.Mode,
                    users = s.Users.Select(u => new { userId = u, name = names.TryGetValue(u, out var n) ? n : u }),
                    waiting = r != null && r.FlowStatus == "SIGNING" && r.NextSlot == s.Slot,
                    signed = sg == null ? null : new { name = string.IsNullOrWhiteSpace(sg.UserName) ? sg.UserId : sg.UserName, at = sg.SignedAt }
                };
            })
        };
    }

    [HttpGet("flow/{stkId:int}")]
    public IActionResult StockFlow(int stkId)
    {
        var s = Visible(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (!DbSchema.HasMinSign) return NoSign();
        return Ok(FlowView(s.Code, _svc.Flow(stkId), null));
    }

    [HttpGet("reports/{id:int}/flow")]
    public IActionResult ReportFlow(int id)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasMinSign) return NoSign();
        var r = _svc.GetReport(id);
        if (r == null) return Fail("ไม่พบรายงานนี้");
        var flow = _svc.Flow(r.StockId);
        if (!CanOpen(r, flow)) return Deny("คุณไม่มีสิทธิ์เปิดรายงานนี้");
        return Ok(FlowView(r.StockCode, flow, r));
    }

    // 📁 ย้อนหลังของฉัน (กระดิ่ง › ประวัติ MIN REPORT): รายงานที่ฉันรายงาน / ลงลายเซ็น / อยู่ใน FLOW · ลงนามครบแล้ว หรือยังเดินอยู่
    [HttpGet("sign/mine")]
    public IActionResult Mine([FromQuery] int? days, [FromQuery] string key)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasMinSign) return Ok(Array.Empty<object>());
        int d = Math.Clamp(days ?? 90, 1, 3650);
        return Ok(_svc.Mine(Uid, d, key).Select(SignRow));
    }

    // รายงานที่ส่งก่อนตั้ง FLOW -> เริ่ม FLOW + แจ้งคนเซ็นช่องแรก (ผู้ส่ง = ผู้รายงาน) · คืนจำนวนที่เริ่ม
    internal static int StartUnflowed(int? stockId)
    {
        var svc = new MinReportService();
        var started = svc.StartUnflowed(stockId);
        foreach (var (rid, slot) in started)
            try { var r = svc.GetReport(rid); if (r != null) NotifySigners(r, slot, r.ReportedBy); }
            catch { /* แจ้งไม่ได้ ยังมีกระดิ่ง */ }
        return started.Count;
    }

    // 💬 ส่งเอกสารเข้าแชทของคนที่ต้องเซ็นช่องถัดไป (ไม่ส่งหาตัวเอง) - กดการ์ดในแชท = เปิด PREVIEW แล้วเซ็นได้ทันที
    private static void NotifySigners(MinReportRow r, int slot, string from)
    {
        if (!DbSchema.HasChat || r == null) return;
        var flow = new MinReportService().Flow(r.StockId);
        var chat = new ChatService();
        string body = $"✍ MIN REPORT รอลงลายเซ็นช่อง {MinReportService.SlotName(slot)}\n{r.StockCode} · {Label(r)}{(string.IsNullOrWhiteSpace(r.Sub) ? "" : " · " + r.Sub)}\nหมายเหตุ: {r.Reason}\n[[MINREPORT:{r.ReportId}]]";
        foreach (string to in flow[slot - 1].Users.Where(u => !Same(u, from)))
            try { if (chat.UserExists(to)) chat.Send(from, to, body); }
            catch { /* แชทส่งไม่ได้ ยังมี Toast / กระดิ่ง */ }
    }

    private static void NotifyDone(MinReportRow r, string from)
    {
        if (!DbSchema.HasChat || r == null || Same(r.ReportedBy, from)) return;
        try
        {
            var chat = new ChatService();
            if (chat.UserExists(r.ReportedBy))
                chat.Send(from, r.ReportedBy, $"✔ MIN REPORT ลงนามครบทุกช่องแล้ว\n{r.StockCode} · {Label(r)}\n[[MINREPORT:{r.ReportId}]]");
        }
        catch { /* ไม่เป็นไร */ }
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
            set.Enabled, set.StuckDays, set.RemindMinutes, set.UpdatedBy, set.UpdatedDate, hasSign = DbSchema.HasMinSign, hasUsers = DbSchema.HasMinAlertUsers,
            stocks = _stocks.GetStocks().Select(s => new
            {
                s.StkId, s.Code, s.Name, s.StockType, s.IsMain, s.IsLiveView, on = set.Stocks.Contains(s.StkId),
                users = set.AlertUsers.TryGetValue(s.StkId, out var u) ? u : new List<string>()
            }),
            users = UserList()
        });
    }

    public sealed record SettingsRequest(bool Enabled, int StuckDays, int RemindMinutes, List<int> Stocks, Dictionary<int, List<string>> Users);

    // รายชื่อผู้ใช้ที่เลือกได้ (ไม่ถูกล็อก)
    private static List<object> UserList()
    {
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        return c.Query<(string UserID, string FullName, string Department, string Section)>(
                "SELECT UserID, FullName, Department, Section FROM Nexus.Users WHERE ISNULL(IsLocked, 0) = 0 ORDER BY UserID")
            .Select(u => (object)new { userId = u.UserID, name = u.FullName, dept = string.IsNullOrWhiteSpace(u.Section) ? u.Department : u.Section }).ToList();
    }

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
            // 👥 ผู้รับแจ้งเตือนรายคลัง: เฉพาะ UserID ที่มีจริง
            var alertUsers = new Dictionary<int, List<string>>();
            if (req.Users != null)
            {
                using var uc = new SqlConnection(GlobalConfig.ConnStr);
                var known = uc.Query<string>("SELECT UserID FROM Nexus.Users").ToHashSet(StringComparer.OrdinalIgnoreCase);
                foreach (var (stk, list) in req.Users)
                    if (ids.Contains(stk))
                        alertUsers[stk] = (list ?? new()).Select(u => (u ?? "").Trim()).Where(known.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            }
            _svc.SaveSettings(new MinReportSettings { Enabled = req.Enabled, StuckDays = req.StuckDays, RemindMinutes = req.RemindMinutes, Stocks = ids, AlertUsers = alertUsers }, Uid);
            try { _svc.Sweep(); } catch { /* รอบถัดไปของ MinWatchService */ }
            string codes = ids.Count == 0 ? "-" : string.Join(", ", ids.Select(i => all[i].Code + (alertUsers.TryGetValue(i, out var au) && au.Count > 0 ? $" ({string.Join("/", au)})" : "")));
            LogService.WriteLog(Uid, "MIN_REPORT_SETTINGS", $"Enabled: {(req.Enabled ? "ON" : "OFF")} | Stuck: {req.StuckDays} days | Remind every {req.RemindMinutes} min | Stocks: {codes}", "MIN_REPORT");
            LiveBus.Publish("minreport");
            return Ok(new { message = $"บันทึก MIN REPORT แล้ว\n\nแจ้งเตือนเมื่อค้างที่ MIN ≥ {req.StuckDays} วัน · กด CANCEL แล้วแจ้งซ้ำทุก {Every(req.RemindMinutes)}\nคลัง: {codes}" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    private static string Every(int m) => m % 60 == 0 ? $"{m / 60} ชม." : m > 60 ? $"{m / 60} ชม. {m % 60} นาที" : $"{m} นาที";

    // 🏷 รูปแบบการแสดงสินค้าของคลัง: ตัวเลือก = คอลัมน์ของตาราง Store Max-Min ของคลังนั้น (+ PRODUCT CODE / NAME เสมอ)
    [HttpGet("settings/display/{stkId:int}")]
    public IActionResult GetDisplay(int stkId)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasMinSign) return NoSign();
        var s = _stocks.GetStock(stkId);
        if (s == null) return Fail("ไม่พบคลังนี้");
        var cols = StoreController.VisibleColumns(s);
        var fields = MinReportService.Fields.Where(f => f.Key is "CODE" or "NAME" || cols.Contains(f.Key))
                                            .OrderBy(f => cols.IndexOf(f.Key) is var i && i >= 0 ? i : 99)
                                            .Select(f => new { key = f.Key, label = f.Label });
        var d = _svc.Display(stkId);
        var sample = _svc.Pending(new[] { stkId }, 0, all: true).Take(3).Select(r => new
        {
            r.PartCode, r.PartName, r.PartA, r.PartB, r.PartNo, r.Model, r.Customer, r.Supplier, r.Category, r.Bin, r.PackSize
        });
        return Ok(new { fields, line1 = d.Line1, line2 = d.Line2, sample });
    }

    public sealed record DisplayRequest(List<string> Line1, List<string> Line2);

    [HttpPost("settings/display/{stkId:int}")]
    public IActionResult SaveDisplay(int stkId, [FromBody] DisplayRequest req)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasMinSign) return NoSign();
        var s = _stocks.GetStock(stkId);
        if (s == null) return Fail("ไม่พบคลังนี้");
        List<string> Clean(List<string> l) => (l ?? new()).Select(x => (x ?? "").Trim().ToUpperInvariant()).Where(MinReportService.IsField).Distinct().Take(6).ToList();
        var d = new MinDisplay { Line1 = Clean(req?.Line1), Line2 = Clean(req?.Line2) };
        if (d.Line1.Count == 0 && d.Line2.Count == 0) return Fail("กรุณาเลือกอย่างน้อย 1 ช่อง");
        try
        {
            _svc.SaveDisplay(stkId, d, Uid);
            LogService.WriteLog(Uid, "MIN_REPORT_SETTINGS", $"Display | Stock: {s.Code} | Line 1: {string.Join(" > ", d.Line1)} | Line 2: {string.Join(" > ", d.Line2)}", "MIN_REPORT");
            LiveBus.Publish("minreport");
            return Ok(new { message = $"บันทึกรูปแบบการแสดงสินค้าของ {s.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    // ✍ FLOW ลายเซ็นของคลัง: ช่อง Prepared / Checked / Checked / Approved · ANY = ทุกคนในรายชื่อลงได้ · ONE = รายบุคคล
    [HttpGet("settings/flow/{stkId:int}")]
    public IActionResult GetFlow(int stkId)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasMinSign) return NoSign();
        if (_stocks.GetStock(stkId) == null) return Fail("ไม่พบคลังนี้");
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        var users = c.Query<(string UserID, string FullName, string Department, string Section)>(
            "SELECT UserID, FullName, Department, Section FROM Nexus.Users WHERE ISNULL(IsLocked, 0) = 0 ORDER BY UserID")
            .Select(u => new { userId = u.UserID, name = u.FullName, dept = string.IsNullOrWhiteSpace(u.Section) ? u.Department : u.Section, sign = SignatureStore.Has(u.UserID) });
        var flows = _svc.Flows();
        return Ok(new
        {
            slots = _svc.Flow(stkId).Select(s => new { s.Slot, name = MinReportService.SlotName(s.Slot), s.Mode, s.Users }),
            users,
            configured = _stocks.GetStocks().Select(s => new { s.StkId, on = flows.TryGetValue(s.StkId, out var f) && f.Any(x => x.Active) })
        });
    }

    public sealed record FlowSlotDto(int Slot, string Mode, List<string> Users);
    public sealed record FlowRequest(List<FlowSlotDto> Slots);

    [HttpPost("settings/flow/{stkId:int}")]
    public IActionResult SaveFlow(int stkId, [FromBody] FlowRequest req)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasMinSign) return NoSign();
        var s = _stocks.GetStock(stkId);
        if (s == null) return Fail("ไม่พบคลังนี้");
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        var known = c.Query<string>("SELECT UserID FROM Nexus.Users").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var slots = new List<MinFlowSlot>();
        for (int i = 1; i <= 4; i++)
        {
            var x = req?.Slots?.FirstOrDefault(z => z.Slot == i);
            string mode = x?.Mode is "ANY" or "ONE" ? x.Mode : "OFF";
            var users = (x?.Users ?? new()).Select(u => (u ?? "").Trim()).Where(known.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (mode == "OFF") users.Clear();
            if (mode == "ONE" && users.Count > 1) return Fail($"ช่อง {MinReportService.SlotName(i)} (#{i}) แบบรายบุคคล เลือกได้ 1 คน");
            if (mode != "OFF" && users.Count == 0) return Fail($"ช่อง {MinReportService.SlotName(i)} (#{i}) ยังไม่ได้เลือกผู้ลงลายเซ็น");
            slots.Add(new MinFlowSlot { Slot = i, Mode = mode, Users = users });
        }
        try
        {
            _svc.SaveFlow(stkId, slots, Uid);
            string txt = string.Join(" | ", slots.Select(x => $"{MinReportService.SlotName(x.Slot)}#{x.Slot}: {(x.Mode == "OFF" ? "OFF" : x.Mode + " " + string.Join(",", x.Users))}"));
            LogService.WriteLog(Uid, "MIN_REPORT_SETTINGS", $"Sign flow | Stock: {s.Code} | {txt}", "MIN_REPORT");
            int started = StartUnflowed(stkId);    // รายงานเดิมที่ยังไม่มี FLOW = เริ่ม FLOW ให้ด้วย
            LiveBus.Publish("minreport");
            return Ok(new { message = $"บันทึก FLOW ลายเซ็นของ {s.Code} แล้ว\nรายงานของคลังนี้จะส่งไปให้ลงลายเซ็นตามลำดับ" + (started > 0 ? $"\nรายงานเดิมที่ยังไม่มี FLOW {started} รายการ เริ่ม FLOW แล้ว" : "") });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    // 📝 ตัวเลือกหมายเหตุ (SETUP › MIN REASONS): เพิ่ม / แก้ไข / ลบ / เรียงลำดับ · บันทึกทั้งชุด
    [HttpGet("settings/reasons")]
    public IActionResult GetReasons()
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        return Ok(new { ready = DbSchema.HasMinReason, items = _svc.ReasonRows() });
    }

    public sealed record ReasonDto(int Id, string Text);
    public sealed record ReasonsRequest(List<ReasonDto> Items);

    [HttpPost("settings/reasons")]
    public IActionResult SaveReasons([FromBody] ReasonsRequest req)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasMinReason) return Fail("ฐานข้อมูลยังไม่มีตารางหมายเหตุ (database/nexus/23_Min_Report_Reasons.sql)");
        var list = new List<(int, string)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in req?.Items ?? new())
        {
            string t = System.Text.RegularExpressions.Regex.Replace((x?.Text ?? "").Trim(), @"\s+", " ");
            if (t.Length == 0) continue;
            if (t.Length > 60) return Fail($"หมายเหตุ \"{t[..20]}…\" ยาวเกิน 60 ตัวอักษร");
            if (!seen.Add(t)) return Fail($"หมายเหตุ \"{t}\" ซ้ำกัน");
            list.Add((Math.Max(0, x.Id), t));
        }
        if (list.Count == 0) return Fail("ต้องมีหมายเหตุอย่างน้อย 1 รายการ");
        if (list.Count > 40) return Fail("หมายเหตุได้ไม่เกิน 40 รายการ");
        try
        {
            _svc.SaveReasons(list, Uid);
            LogService.WriteLog(Uid, "MIN_REPORT_SETTINGS", $"Reasons | {list.Count} items | {string.Join(", ", list.Select(x => x.Item2))}", "MIN_REPORT");
            LiveBus.Publish("minreport");
            return Ok(new { message = $"บันทึกตัวเลือกหมายเหตุ {list.Count} รายการแล้ว\nหน้าต่าง REPORT ของทุกเครื่องอัพเดทเอง" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }
}
