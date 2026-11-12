using CHR.Nexus.Api.Web;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 🏭 EDP PLANNING  /api/edp/*  (สิทธิ์ EdpSubmission / EdpPlanning / EdpPlanSetting / EdpGraph · ทุกการบันทึกลง Activity Log · จอที่เปิดอยู่อัพเดทเอง)
[Route("api/edp")]
public sealed class EdpController : AppController
{
    private readonly EdpService _svc = new();
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง EDP (database/nexus/26_EDP_Planning.sql)");
    private static string Sh(string s) => (s ?? "").ToUpperInvariant() switch { "DAY" => "DAY", "NIGHT" => "NIGHT", _ => EdpService.AllDay };

    private IActionResult Guard(bool can) => Me == null || !can ? Deny() : !DbSchema.HasEdp ? NotReady() : null;

    private IActionResult Run(Func<IActionResult> f, string prefix)
    {
        try { return f(); }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, prefix); }
    }

    // ---------------------------------------------------------------- ข้อมูลตั้งต้น
    [HttpGet("meta")]
    public IActionResult Meta() => Guard(Me?.CanViewEdpAny == true) ?? Ok(new
    {
        rounds = _svc.Rounds(),
        now = DateTime.Now,
        can = new
        {
            submit = Me.CanEditEdpSubmit, planning = Me.CanEditEdpPlanning,
            add = Me.CanAddEdpSetting, edit = Me.CanEditEdpSetting, delete = Me.CanDeleteEdpSetting
        }
    });

    [HttpGet("dates")]
    public IActionResult Dates(string shift) => Guard(Me?.CanViewEdpAny == true) ?? Ok(_svc.Dates(Sh(shift)));

    [HttpGet("parts")]
    public IActionResult Parts() => Guard(Me?.CanViewEdpSubmit == true || Me?.CanViewEdpSetting == true) ?? Ok(_svc.Parts());

    [HttpGet("cards")]
    public IActionResult Cards(DateTime date, string shift, int? round) =>
        Guard(Me?.CanViewEdpSubmit == true || Me?.CanViewEdpSetting == true)
        ?? Ok(new { status = Sh(shift) == EdpService.AllDay ? null : _svc.Status(date, Sh(shift)), sig = _svc.Signature(date, Sh(shift)), planSig = _svc.PlanSignature(date, Sh(shift)), cards = _svc.Cards(date, Sh(shift), round) });

    [HttpGet("signature")]
    public IActionResult Signature(DateTime date, string shift) =>
        Guard(Me?.CanViewEdpSubmit == true || Me?.CanViewEdpSetting == true) ?? Ok(new { sig = _svc.Signature(date, Sh(shift)) });

    // ---------------------------------------------------------------- Plan Submission
    public sealed record ShiftReq(DateTime Date, string Shift);
    public sealed record MarkReq(int PldId, int QtyAct, int HgAct, string PartNo);
    public sealed record EditReq(int PldId, bool Problem, int? PartId, int Qty, int Hg, string Remark);
    public sealed record SwapReq(int A, int B, List<EdpService.SlotTime> Times, DateTime? Date = null, string Shift = null, string PlanSig = null);

    [HttpPost("start")]
    public IActionResult Start([FromBody] ShiftReq r) => Guard(Me?.CanViewEdpSubmit == true) ?? Run(() =>
    {
        _svc.Start(r.Date, Sh(r.Shift));
        LogService.WriteLog(Uid, "EDP_START_PLAN", $"เริ่มแผน {Sh(r.Shift)} วันที่ {r.Date:dd/MM/yyyy} (IN PROGRESS)", $"{r.Date:yyyyMMdd}-{Sh(r.Shift)}");
        return Ok(new { });
    }, "เริ่มกะไม่สำเร็จ");

    [HttpPost("finish")]
    public IActionResult Finish([FromBody] ShiftReq r) => Guard(Me?.CanEditEdpSubmit == true) ?? Run(() =>
    {
        _svc.Finish(r.Date, Sh(r.Shift));
        LogService.WriteLog(Uid, "EDP_FINISH_SHIFT", $"ปิดกะ {Sh(r.Shift)} วันที่ {r.Date:dd/MM/yyyy} (COMPLETED)", $"{r.Date:yyyyMMdd}-{Sh(r.Shift)}");
        return Ok(new { message = $"ปิดกะ {Sh(r.Shift)} วันที่ {r.Date:dd/MM/yyyy} แล้ว" });
    }, "ปิดกะไม่สำเร็จ");

    [HttpPost("mark")]
    public IActionResult Mark([FromBody] MarkReq r) => Guard(Me?.CanEditEdpSubmit == true) ?? Run(() =>
    {
        if (r.QtyAct < 0 || r.HgAct < 0) return Fail("จำนวนติดลบไม่ได้");
        _svc.Mark(r.PldId, r.QtyAct, r.HgAct);
        LogService.WriteLog(Uid, "EDP_MARK_SUCCESS", $"{r.PartNo}: {r.QtyAct} PCS / {r.HgAct} HG", r.PldId.ToString());
        return Ok(new { message = $"บันทึกรายการ {r.PartNo} สำเร็จ" });
    }, "บันทึกไม่สำเร็จ");

    [HttpPost("edit")]
    public IActionResult Edit([FromBody] EditReq r) => Guard(Me?.CanEditEdpSubmit == true) ?? Run(() =>
    {
        string remark = (r.Remark ?? "").Trim();
        if (remark.Length == 0) return Fail("กรุณาระบุหมายเหตุ/ปัญหาที่พบก่อนบันทึก");
        if (remark.Length > 500) return Fail("หมายเหตุยาวเกิน 500 ตัวอักษร");
        if (!r.Problem && (r.PartId is not > 0 || r.Qty < 0 || r.Hg < 0)) return Fail("กรุณาเลือกชิ้นงานและกรอกจำนวนให้ถูกต้อง");
        var (o, n) = _svc.Edit(r.PldId, r.Problem, r.PartId, r.Qty, r.Hg, remark, Uid);
        LogService.WriteLog(Uid, r.Problem ? "EDP_REPORT_PROBLEM" : "EDP_EDIT_CARD", $"{o} -> {n} | {remark}", r.PldId.ToString());
        return Ok(new { message = r.Problem ? "บันทึกแจ้งปัญหาแล้ว" : "บันทึกการแก้ไขแล้ว" });
    }, "บันทึกไม่สำเร็จ");

    [HttpPost("swap")]
    public IActionResult Swap([FromBody] SwapReq r) => Guard(Me?.CanEditEdpSubmit == true) ?? Run(() =>
    {
        // SUB-14: แผนถูกแก้จากเครื่องอื่นหลังจากที่เครื่องนี้โหลดมา = เวลาที่คำนวณไว้อาจไม่ตรงแล้ว -> ยกเลิกแล้วโหลดใหม่
        if (r.Date.HasValue && !string.IsNullOrEmpty(r.PlanSig) && _svc.PlanSignature(r.Date.Value, Sh(r.Shift)) != r.PlanSig)
            return Fail("แผนนี้ถูกแก้ไขจากเครื่องอื่นไปแล้ว ระบบจะโหลดแผนล่าสุดให้ กรุณาลองใหม่อีกครั้ง");
        var batch = _svc.Swap(r.A, r.B, r.Times, Uid);
        LogService.WriteLog(Uid, "EDP_SWAP_CARD", $"สลับการ์ด {r.A} <-> {r.B} ({r.Times?.Count ?? 0} การ์ดเปลี่ยนเวลา) · UNDO {batch}", $"{r.A}-{r.B}");
        return Ok(new { message = "สลับการ์ดแล้ว (กด UNDO SWAP เพื่อย้อนได้)", batch });
    }, "สลับการ์ดไม่สำเร็จ");

    public sealed record UndoReq(Guid Batch);

    [HttpPost("swap/undo")]
    public IActionResult UndoSwap([FromBody] UndoReq r) => Guard(Me?.CanEditEdpSubmit == true) ?? Run(() =>
    {
        int n = _svc.UndoSwap(r.Batch);
        LogService.WriteLog(Uid, "EDP_SWAP_UNDO", $"ย้อนการสลับ {r.Batch} ({n} การ์ดกลับเวลาเดิม)", r.Batch.ToString());
        return Ok(new { message = $"ย้อนการสลับแล้ว ({n} การ์ดกลับเวลาเดิม)" });
    }, "ย้อนการสลับไม่สำเร็จ");

    // ---------------------------------------------------------------- Plan Setting
    public sealed record SaveReq(DateTime Date, string Shift, int Round, List<EdpPlanCardIn> Cards);
    public sealed record CopyReq(DateTime SrcDate, string SrcShift, int? SrcRound, DateTime TgtDate, string TgtShift, int? TgtRound);
    public sealed record ClearReq(DateTime Date, string Shift, int? Round, bool IncludeDone);
    public sealed record TplSaveReq(string Name, string Shift, int? Round, List<EdpPlanCardIn> Cards);
    public sealed record TplApplyReq(int TplId, DateTime Date, string Shift, int? Round);

    private static string Bad(List<EdpPlanCardIn> cards)
    {
        foreach (var c in cards ?? new())
        {
            if (!TimeOk(c.TimeStart) || !TimeOk(c.TimeEnd)) return "รูปแบบเวลาไม่ถูกต้อง (HH:mm-HH:mm)";
            if (c.Qty < 0 || c.Hg < 0) return "จำนวนติดลบไม่ได้";
        }
        return null;
    }
    private static bool TimeOk(string t) => t != null && System.Text.RegularExpressions.Regex.IsMatch(t, @"^\d{2}:\d{2}-\d{2}:\d{2}$");

    [HttpPost("save")]
    public IActionResult Save([FromBody] SaveReq r) => Guard(Me?.CanAddEdpSetting == true) ?? Run(() =>
    {
        if (Bad(r.Cards) is string err) return Fail(err);
        int n = _svc.Save(r.Date, Sh(r.Shift), r.Round, r.Cards ?? new(), Uid);
        LogService.WriteLog(Uid, "EDP_SAVE_PLAN", $"บันทึกแผน {r.Date:dd/MM/yyyy} กะ {Sh(r.Shift)} รอบ {r.Round} ({n} การ์ด)", $"{r.Date:yyyyMMdd}-{Sh(r.Shift)}-{r.Round}");
        return Ok(new { message = $"บันทึกแผน {r.Date:dd/MM/yyyy} กะ {Sh(r.Shift)} รอบ {r.Round} สำเร็จ ({n} รายการ)" });
    }, "เกิดข้อผิดพลาดในการบันทึก");

    [HttpPost("copy")]
    public IActionResult Copy([FromBody] CopyReq r) => Guard(Me?.CanEditEdpSetting == true) ?? Run(() =>
    {
        int n = _svc.Copy(r.SrcDate, Sh(r.SrcShift), r.SrcRound, r.TgtDate, Sh(r.TgtShift), r.TgtRound, Uid);
        if (n == 0) return Fail("ต้นทางไม่มีแผน");
        LogService.WriteLog(Uid, "EDP_COPY_PLAN", $"{r.SrcDate:dd/MM/yyyy} {Sh(r.SrcShift)} {r.SrcRound?.ToString() ?? "ทั้งกะ"} -> {r.TgtDate:dd/MM/yyyy} {Sh(r.TgtShift)} {r.TgtRound?.ToString() ?? "ทั้งกะ"} ({n})", null);
        return Ok(new { message = $"คัดลอกแผนแล้ว {n} การ์ด" });
    }, "คัดลอกแผนไม่สำเร็จ");

    [HttpGet("count")]
    public IActionResult Count(DateTime date, string shift, int? round) => Guard(Me?.CanViewEdpSetting == true) ?? Run(() =>
    {
        var (t, d) = _svc.Count(date, Sh(shift), round);
        return Ok(new { total = t, done = d });
    }, "นับการ์ดไม่สำเร็จ");

    [HttpPost("clear")]
    public IActionResult Clear([FromBody] ClearReq r) => Guard(Me?.CanDeleteEdpSetting == true) ?? Run(() =>
    {
        var (removed, kept) = _svc.Clear(r.Date, Sh(r.Shift), r.Round, r.IncludeDone);
        LogService.WriteLog(Uid, "EDP_CLEAR_PLAN", $"ล้างแผน {r.Date:dd/MM/yyyy} กะ {Sh(r.Shift)} {(r.Round?.ToString() ?? "ทั้งกะ")} ลบ {removed} เก็บ {kept}", null);
        return Ok(new { message = $"ล้างแผนแล้ว {removed} การ์ด" + (kept > 0 ? $" (เก็บการ์ดที่ MARK แล้ว {kept} ใบ)" : "") });
    }, "ล้างแผนไม่สำเร็จ");

    [HttpGet("templates")]
    public IActionResult Templates() => Guard(Me?.CanViewEdpSetting == true) ?? Ok(_svc.Templates());

    [HttpPost("templates")]
    public IActionResult SaveTemplate([FromBody] TplSaveReq r) => Guard(Me?.CanAddEdpSetting == true) ?? Run(() =>
    {
        if (Bad(r.Cards) is string err) return Fail(err);
        string shift = (r.Shift ?? "").ToUpperInvariant() == EdpService.AllDay ? EdpService.AllDay : Sh(r.Shift);
        int n = _svc.SaveTemplate(r.Name, shift, r.Round, r.Cards, Uid);
        LogService.WriteLog(Uid, "EDP_SAVE_TEMPLATE", $"แม่แบบ \"{r.Name?.Trim()}\" ({n} รายการ)", null);
        return Ok(new { message = $"บันทึกแม่แบบ \"{r.Name?.Trim()}\" แล้ว ({n} รายการ)" });
    }, "บันทึกแม่แบบไม่สำเร็จ");

    [HttpDelete("templates/{id:int}")]
    public IActionResult DeleteTemplate(int id) => Guard(Me?.CanDeleteEdpSetting == true) ?? Run(() =>
    {
        if (!_svc.DeleteTemplate(id)) return Fail("ไม่พบแม่แบบนี้แล้ว");
        LogService.WriteLog(Uid, "EDP_DELETE_TEMPLATE", $"ลบแม่แบบ {id}", id.ToString());
        return Ok(new { message = "ลบแม่แบบแล้ว" });
    }, "ลบแม่แบบไม่สำเร็จ");

    [HttpPost("templates/apply")]
    public IActionResult ApplyTemplate([FromBody] TplApplyReq r) => Guard(Me?.CanEditEdpSetting == true) ?? Run(() =>
    {
        string shift = (r.Shift ?? "").ToUpperInvariant() == EdpService.AllDay ? EdpService.AllDay : Sh(r.Shift);
        int n = _svc.ApplyTemplate(r.TplId, r.Date, shift, r.Round, Uid);
        if (n == 0) return Fail("แม่แบบนี้ไม่มีช่องของกะ / รอบที่เลือก แผนเดิมไม่ถูกแตะ");
        LogService.WriteLog(Uid, "EDP_APPLY_TEMPLATE", $"แม่แบบ {r.TplId} -> {r.Date:dd/MM/yyyy} {shift} {(r.Round?.ToString() ?? "ทั้งกะ")} ({n})", r.TplId.ToString());
        return Ok(new { message = $"ลงแม่แบบแล้ว {n} การ์ด" });
    }, "ลงแม่แบบไม่สำเร็จ");

    // ---------------------------------------------------------------- EDP Planning
    public sealed record MonitorReq(string Operator, string Remark, bool? IsDone, bool Group = false);   // IsDone = null = ไม่ได้ติ๊ก DONE (ไม่แตะสถานะ)

    [HttpGet("monitor")]
    public IActionResult Monitor(DateTime? date, string shift, string q) => Guard(Me?.CanViewEdpPlanning == true) ?? Run(() =>
    {
        var (d, rows) = _svc.Monitor(date, Sh(shift), q);
        return Ok(new { date = d, rows });
    }, "โหลดข้อมูลไม่สำเร็จ");

    [HttpPut("monitor/{id:int}")]
    public IActionResult UpdateMonitor(int id, [FromBody] MonitorReq r) => Guard(Me?.CanEditEdpPlanning == true) ?? Run(() =>
    {
        string op = (r.Operator ?? "").Trim(), remark = (r.Remark ?? "").Trim();
        if (op.Length > 100) return Fail("ชื่อ Operator ยาวเกิน 100 ตัวอักษร");
        if (!_svc.UpdateMonitor(id, op.Length == 0 ? null : op, remark.Length == 0 ? null : remark, r.IsDone, r.Group)) return Fail("ไม่พบรายการนี้แล้ว");
        LogService.WriteLog(Uid, "EDP_PLANNING_UPDATE", $"OPERATOR {op} | DONE {(r.IsDone == null ? "-" : r.IsDone.Value ? "Y" : "N")}{(r.Group && r.IsDone != null ? " (ทุกการ์ดของชิ้นงานนี้)" : "")} | {remark}", id.ToString());
        return Ok(new { message = "บันทึกแล้ว" });
    }, "บันทึกไม่สำเร็จ");

    [HttpGet("export")]
    public IActionResult Export(DateTime date) => Guard(Me?.CanViewEdpPlanning == true) ?? Run(() =>
        File(_svc.Export(date), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"EDP_Planning_{date:yyyyMMdd}.xlsx"), "Export ไม่สำเร็จ");

    // ---------------------------------------------------------------- กราฟ
    [HttpGet("graph")]
    public IActionResult Graph() => Guard(Me?.CanViewEdpGraph == true) ?? Ok(_svc.Graph());

    // ---------------------------------------------------------------- ⏰ แจ้งเตือนการ์ดเลยเวลา (เห็นเฉพาะในระบบ EDP)
    //   ผู้รับ: ไม่ได้เลือก UserID = ทุกคนที่ MARK SUCCESS ได้ (แบบเดิม) · เลือกแล้ว = เฉพาะ UserID ที่เลือก (ต้องดู Plan Submission ได้)
    //   🔊 เสียง: เสียงเตือน -> ประโยคไทย -> ประโยคพม่า -> เสียงปิดท้าย วนจนกว่าจะ MARK ครบ หรือกด CANCEL / ✕ (ซ่อนชั่วคราว ไม่มีปิดถาวร)
    public sealed record AlertReq(bool Enabled, int GraceMinutes, int RemindMinutes, bool OnlyStarted,
                                  List<string> Users = null, bool? SoundOn = null, int? SoundId = null, int? LeadRepeat = null, bool? EndChime = null, int? GapSeconds = null,
                                  decimal? AlarmVolume = null, decimal? VoiceVolume = null, decimal? VoiceRate = null, string MsgTh = null, string MsgMy = null);
    public sealed record SnoozeReq(int? Late = null, string Why = null);
    private bool IsAdmin => Me?.UserLevel == 1;
    private static readonly string[] Langs = { "th", "my" };

    // URL ไฟล์เสียงที่อัพโหลดของประโยคนี้ (ไม่มี = null -> หน้าเว็บใช้ไฟล์เสียงในระบบ / เสียงอ่านของเบราว์เซอร์)
    private static string VoiceUrl(List<EdpVoice> voices, string lang, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        string key = EdpService.TextKey(text);
        var v = voices.FirstOrDefault(x => x.Lang == lang && x.TextKey == key);
        return v == null ? null : $"/api/edp/alert/voice/{lang}/{key}?v={v.UpdatedDate.Ticks}";
    }

    private static object Sound(EdpAlertSettings s, List<EdpVoice> voices) => new
    {
        on = s.SoundOn, soundId = s.SoundId, leadRepeat = s.LeadRepeat, endChime = s.EndChime, gapSeconds = s.GapSeconds,
        alarmVolume = s.AlarmVolume, voiceVolume = s.VoiceVolume, voiceRate = s.VoiceRate,
        msgTh = s.MsgTh ?? "", msgMy = s.MsgMy ?? "",
        voiceTh = VoiceUrl(voices, "th", s.MsgTh), voiceMy = VoiceUrl(voices, "my", s.MsgMy)
    };

    // ผู้ใช้คนนี้รับแจ้งเตือนไหม
    private bool Receives(EdpAlertSettings s)
    {
        if (Me == null) return false;
        var users = DbSchema.HasEdpAlertSound ? s.Users() : new List<string>();
        return users.Count == 0 ? Me.CanEditEdpSubmit : Me.CanViewEdpSubmit && users.Contains(Uid, StringComparer.OrdinalIgnoreCase);
    }

    private object AlertRow(EdpAlertSettings s) => new
    {
        s.Enabled, s.GraceMinutes, s.RemindMinutes, s.OnlyStarted, s.UpdatedBy, s.UpdatedDate,
        users = DbSchema.HasEdpAlertSound ? s.Users() : new List<string>(),
        sound = DbSchema.HasEdpAlertSound ? Sound(s, _svc.Voices()) : null
    };

    [HttpGet("alert")]
    public IActionResult Alert()
    {
        if (Me == null || !DbSchema.HasEdpAlert) return Ok(new { enabled = false });
        var s = _svc.AlertSettings();
        if (!Receives(s)) return Ok(new { enabled = false });
        return Ok(new
        {
            s.Enabled, s.GraceMinutes, s.RemindMinutes, s.OnlyStarted, snoozeUntil = EdpService.GetSnooze(Uid), now = DateTime.Now,
            sound = DbSchema.HasEdpAlertSound ? Sound(s, _svc.Voices()) : null
        });
    }

    [HttpPost("alert/snooze")]
    public IActionResult AlertSnooze([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] SnoozeReq r = null)
    {
        if (!DbSchema.HasEdpAlert) return Fail("ฐานข้อมูลยังไม่มีตาราง EDP ALERT (database/nexus/29_EDP_Alert.sql)");
        var s = _svc.AlertSettings();
        if (!Receives(s)) return Deny();
        var until = EdpService.Snooze(Uid, s.RemindMinutes);
        string why = r?.Why == "x" ? "✕" : r?.Why == "go" ? "GO UPDATE" : "CANCEL";
        LogService.WriteLog(Uid, "EDP_ALERT_SNOOZE", $"{why} | Hide {s.RemindMinutes} min (until {until:HH:mm}) | Late cards: {r?.Late ?? 0}", "EDP_ALERT");
        return Ok(new { until, minutes = s.RemindMinutes });
    }

    [HttpGet("alert/settings")]
    public IActionResult AlertSettings()
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasEdpAlert) return Ok(new { ready = false });
        object users = null;
        if (DbSchema.HasEdpAlertSound)
        {
            using var c = new SqlConnection(GlobalConfig.ConnStr);
            users = c.Query<(string UserID, string FullName, string Department, string Section)>(
                    "SELECT UserID, FullName, Department, Section FROM Nexus.Users WHERE ISNULL(IsLocked, 0) = 0 ORDER BY UserID")
                .Select(u => new { userId = u.UserID, name = u.FullName, dept = string.IsNullOrWhiteSpace(u.Section) ? u.Department : u.Section }).ToList();
        }
        return Ok(new { ready = true, sound = DbSchema.HasEdpAlertSound, settings = AlertRow(_svc.AlertSettings()), users });
    }

    [HttpPost("alert/settings")]
    public IActionResult SaveAlertSettings([FromBody] AlertReq r)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasEdpAlert) return Fail("ฐานข้อมูลยังไม่มีตาราง EDP ALERT (database/nexus/29_EDP_Alert.sql)");
        if (r == null || r.GraceMinutes < 0 || r.GraceMinutes > 240) return Fail("เลยเวลากี่นาทีจึงแจ้งเตือน ต้องอยู่ระหว่าง 0 - 240 นาที");
        if (r.RemindMinutes < 1 || r.RemindMinutes > 480) return Fail("แจ้งเตือนซ้ำต้องอยู่ระหว่าง 1 - 480 นาที");
        var old = _svc.AlertSettings();
        var s = new EdpAlertSettings { Enabled = r.Enabled, GraceMinutes = r.GraceMinutes, RemindMinutes = r.RemindMinutes, OnlyStarted = r.OnlyStarted };
        string soundLog = "";
        if (DbSchema.HasEdpAlertSound)
        {
            if (r.SoundId is < 1 or > 18) return Fail("เลือกเสียงเตือนไม่ถูกต้อง");
            if (r.LeadRepeat is < 1 or > 5) return Fail("เสียงนำต้องอยู่ระหว่าง 1 - 5 รอบ");
            if (r.GapSeconds is < 5 or > 600) return Fail("เว้นแล้ววนซ้ำต้องอยู่ระหว่าง 5 - 600 วินาที");
            if (r.AlarmVolume is < 0.1m or > 1.5m || r.VoiceVolume is < 0 or > 1 || r.VoiceRate is < 0.5m or > 1.5m) return Fail("ค่าความดัง / ความเร็วพูดไม่ถูกต้อง");
            if ((r.MsgTh ?? "").Trim().Length > 1000 || (r.MsgMy ?? "").Trim().Length > 1000) return Fail("ประโยคยาวเกิน 1,000 ตัวอักษร");
            using (var c = new SqlConnection(GlobalConfig.ConnStr))
            {
                var known = c.Query<string>("SELECT UserID FROM Nexus.Users").ToHashSet(StringComparer.OrdinalIgnoreCase);
                var users = (r.Users ?? new()).Select(u => (u ?? "").Trim()).Where(known.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                s.AlertUsers = users.Count == 0 ? null : string.Join(",", users);
            }
            s.SoundOn = r.SoundOn ?? old.SoundOn; s.SoundId = r.SoundId ?? old.SoundId; s.LeadRepeat = r.LeadRepeat ?? old.LeadRepeat; s.EndChime = r.EndChime ?? old.EndChime;
            s.GapSeconds = r.GapSeconds ?? old.GapSeconds; s.AlarmVolume = r.AlarmVolume ?? old.AlarmVolume; s.VoiceVolume = r.VoiceVolume ?? old.VoiceVolume; s.VoiceRate = r.VoiceRate ?? old.VoiceRate;
            s.MsgTh = (r.MsgTh ?? old.MsgTh ?? "").Trim(); s.MsgMy = (r.MsgMy ?? old.MsgMy ?? "").Trim();
            soundLog = $" | Users: {s.AlertUsers ?? "ALL (can MARK)"} | Sound: {(s.SoundOn ? "ON" : "OFF")} #{s.SoundId} x{s.LeadRepeat}{(s.EndChime ? " + end" : "")} every {s.GapSeconds}s | Vol {s.AlarmVolume:0.##}/{s.VoiceVolume:0.##} | Rate {s.VoiceRate:0.##}" +
                       (s.MsgTh != (old.MsgTh ?? "") ? $" | TH: {s.MsgTh}" : "") + (s.MsgMy != (old.MsgMy ?? "") ? $" | MY: {s.MsgMy}" : "");
        }
        return Run(() =>
        {
            _svc.SaveAlertSettings(s, Uid);
            LogService.WriteLog(Uid, "EDP_ALERT_SETTINGS", $"Enabled: {(r.Enabled ? "ON" : "OFF")} | Late ≥ {r.GraceMinutes} min | Remind every {r.RemindMinutes} min | Only started: {(r.OnlyStarted ? "Y" : "N")}{soundLog}", "EDP_ALERT");
            string who = s.AlertUsers == null ? "ทุกคนที่ MARK SUCCESS ได้" : $"{s.Users().Count} คน";
            return Ok(new { message = $"บันทึก EDP ALERT แล้ว\n\n{(r.Enabled ? "แจ้งเตือน : ON" : "แจ้งเตือน : OFF")} · เลยเวลา ≥ {r.GraceMinutes} นาที · กด CANCEL แล้วแจ้งซ้ำทุก {r.RemindMinutes} นาที" +
                                        (DbSchema.HasEdpAlertSound ? $"\nผู้รับ: {who} · เสียง : {(s.SoundOn ? "ON" : "OFF")}" : "") });
        }, "บันทึกไม่สำเร็จ");
    }

    // 🗣 ไฟล์เสียงของประโยค (เล่นที่หน้าต่างแจ้งเตือน / ลองฟังที่ SETUP) · ผู้ที่ login แล้วฟังได้
    [HttpGet("alert/voice/{lang}/{key}")]
    public IActionResult AlertVoice(string lang, string key)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasEdpAlertSound || !Langs.Contains(lang) || key is not { Length: 64 }) return NotFound();
        var v = _svc.Voice(lang, key);
        if (v == null) return NotFound();
        Response.Headers.CacheControl = "private, max-age=86400";
        return File(v.Value.Audio, v.Value.ContentType);
    }

    // อัพโหลดไฟล์เสียงของประโยค (mp3 / wav / ogg / m4a ไม่เกิน 3 MB) · ผูกกับข้อความประโยค (แก้ประโยค = ต้องอัพโหลดใหม่)
    [HttpPost("alert/voice")]
    [RequestSizeLimit(4_000_000)]
    public async Task<IActionResult> UploadVoice(IFormFile file, [FromForm] string lang, [FromForm] string text)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasEdpAlertSound) return Fail("ฐานข้อมูลยังไม่มีตาราง EDP.AlertVoices (database/nexus/40_EDP_Alert_Sound_Users.sql)");
        if (!Langs.Contains(lang)) return Fail("ภาษาไม่ถูกต้อง");
        if (string.IsNullOrWhiteSpace(text) || text.Trim().Length > 1000) return Fail("กรุณากรอกประโยคก่อนอัพโหลดไฟล์เสียง");
        if (file == null || file.Length == 0 || file.Length > 3_000_000) return Fail("ไฟล์เสียงต้องไม่ว่างและไม่เกิน 3 MB");
        string ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        string ct = ext switch { ".mp3" => "audio/mpeg", ".wav" => "audio/wav", ".ogg" => "audio/ogg", ".m4a" => "audio/mp4", _ => null };
        if (ct == null) return Fail("รองรับเฉพาะไฟล์ .mp3 / .wav / .ogg / .m4a");
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        return Run(() =>
        {
            string key = _svc.SaveVoice(lang, text, ms.ToArray(), ct, Uid);
            LogService.WriteLog(Uid, "EDP_ALERT_VOICE_UPLOAD", $"Lang: {lang.ToUpperInvariant()} | File: {file.FileName} ({file.Length / 1024:N0} KB) | Text: {text.Trim()}", "EDP_ALERT");
            return Ok(new { message = $"อัพโหลดไฟล์เสียง{(lang == "th" ? "ภาษาไทย" : "ภาษาพม่า")}แล้ว", url = $"/api/edp/alert/voice/{lang}/{key}?v={DateTime.Now.Ticks}" });
        }, "อัพโหลดไม่สำเร็จ");
    }

    public sealed record VoiceDelReq(string Lang, string Text);

    [HttpPost("alert/voice/delete")]
    public IActionResult DeleteVoice([FromBody] VoiceDelReq r)
    {
        if (!IsAdmin) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasEdpAlertSound || r == null || !Langs.Contains(r.Lang)) return Fail("ข้อมูลไม่ถูกต้อง");
        return Run(() =>
        {
            bool ok = _svc.DeleteVoice(r.Lang, EdpService.TextKey(r.Text));
            if (ok) LogService.WriteLog(Uid, "EDP_ALERT_VOICE_DELETE", $"Lang: {r.Lang.ToUpperInvariant()} | Text: {(r.Text ?? "").Trim()}", "EDP_ALERT");
            return Ok(new { message = ok ? "ลบไฟล์เสียงที่อัพโหลดแล้ว (กลับไปใช้เสียงในระบบ / เสียงอ่านของเบราว์เซอร์)" : "ไม่มีไฟล์เสียงที่อัพโหลดของประโยคนี้" });
        }, "ลบไม่สำเร็จ");
    }
}
