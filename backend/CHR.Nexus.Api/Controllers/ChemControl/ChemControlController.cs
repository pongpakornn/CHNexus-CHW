using CHR.Nexus.Api.Web;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 🧪 CHEMICAL CONTROL  /api/chem/*  (สิทธิ์ ChemRecord / ChemSetup · ลงลายเซ็นตาม FLOW · ทุกการบันทึกลง Activity Log · จอที่เปิดอยู่อัพเดทเอง หัวข้อ "chem")
[Route("api/chem")]
public sealed class ChemControlController : AppController
{
    private readonly ChemControlService _svc = new();
    private IActionResult Guard(bool can) => Me == null || !can ? Deny() : !DbSchema.HasChemControl ? Fail("ฐานข้อมูลยังไม่มีตาราง Chemical Control (database/nexus/37_Chemical_Control.sql)") : null;
    private bool CanView => Me?.CanViewChemRecord == true || Me?.CanViewChemSetup == true;
    private static void Changed() => LiveBus.Publish("chem");
    private string MyName => _svc.Names(new[] { Uid }).TryGetValue(Uid ?? "", out var n) ? n : Me?.UserName ?? Uid;

    private IActionResult Run(Func<IActionResult> f, string prefix)
    {
        try { return f(); }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, prefix); }
    }

    private static (int y, int m) Mon(string s)
    {
        if (DateTime.TryParseExact((s ?? "") + "-01", "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var d)) return (d.Year, d.Month);
        return (DateTime.Today.Year, DateTime.Today.Month);
    }

    private object Can() => new
    {
        record = Me.CanAddChemRecord, edit = Me.CanEditChemRecord, setup = Me.CanViewChemSetup,
        add = Me.CanAddChemSetup, setupEdit = Me.CanEditChemSetup, delete = Me.CanDeleteChemSetup, admin = Me.UserLevel == 1
    };

    // ---------------------------------------------------------------- ข้อมูลตั้งต้น + Dashboard
    [HttpGet("meta")]
    public IActionResult Meta() => Guard(CanView) ?? Ok(new { parameters = _svc.Params(true), can = Can(), user = MyName, today = DateTime.Today });

    // Dashboard: ผลการตรวจวัดย้อนหลัง N วัน (ทุกพารามิเตอร์) + ใบบันทึกเดือนนี้ + รายการรอฉันลงลายเซ็น
    [HttpGet("dashboard")]
    public IActionResult Dashboard(int days = 14) => Guard(CanView) ?? Run(() =>
    {
        days = Math.Clamp(days, 1, 62);
        var to = DateTime.Today.AddDays(1);
        var t = DateTime.Today;
        var inbox = _svc.Inbox(Uid);
        var ps = _svc.Params(true);
        return Ok(new
        {
            parameters = ps,
            readings = _svc.Readings(to.AddDays(-days), to),
            sheets = _svc.SheetsOf(t.Year, t.Month),
            inbox = inbox.Select(s => new { s.Id, s.ParamId, s.Year, s.Month, slot = s.NextSlot, slotName = ChemControlService.SlotName(s.NextSlot ?? 0), s.SubmittedAt }),
            can = Can(),
            today = t
        });
    }, "โหลด Dashboard ไม่สำเร็จ");

    // ---------------------------------------------------------------- บันทึกผลการตรวจวัด
    [HttpGet("day")]
    public IActionResult Day(DateTime date) => Guard(CanView) ?? Run(() => Ok(new
    {
        parameters = _svc.Params(true),
        readings = _svc.Readings(date.Date, date.Date.AddDays(1)),
        can = Can()
    }), "โหลดผลการตรวจวัดไม่สำเร็จ");

    public sealed record ReadReq(DateTime Date, string Shift, List<ChemControlService.ReadingCell> Cells);

    [HttpPost("readings")]
    public IActionResult SaveReadings([FromBody] ReadReq r) => Guard(Me?.CanAddChemRecord == true) ?? Run(() =>
    {
        if (r?.Cells == null || r.Cells.Count == 0) return Fail("ไม่มีข้อมูลที่แก้ไข");
        if (r.Cells.Count > 500) return Fail("บันทึกได้ครั้งละไม่เกิน 500 ค่า");
        string sh = r.Shift == "N" ? "N" : "D";
        // แก้ / ลบค่าที่ผู้อื่นบันทึกไว้ = ต้องมีสิทธิ์ EDIT
        if (!Me.CanEditChemRecord)
        {
            var mine = _svc.Readings(r.Date.Date, r.Date.Date.AddDays(1)).Where(x => x.Shift == sh).ToList();
            if (r.Cells.Any(c => mine.Any(x => x.ParamId == c.ParamId && x.Slot == c.Slot && !string.Equals(x.InspectorId, Uid, StringComparison.OrdinalIgnoreCase))))
                return Deny("แก้ไข / ลบผลการตรวจวัดของผู้อื่นต้องมีสิทธิ์ EDIT ของ Chemical Control");
        }
        // ใบบันทึกที่อนุมัติแล้ว / อยู่ระหว่างลงลายเซ็น = แก้ไม่ได้
        foreach (var pid in r.Cells.Select(x => x.ParamId).Distinct())
        {
            var s = _svc.Sheet(pid, r.Date.Year, r.Date.Month);
            if (s != null && s.Status != "DRAFT") return Fail($"ใบบันทึกเดือน {r.Date:MM/yyyy} ของรายการนี้{(s.Status == "APPROVED" ? "อนุมัติแล้ว" : "อยู่ระหว่างลงลายเซ็น")} แก้ไขไม่ได้");
        }
        var (saved, removed) = _svc.SaveReadings(r.Date, sh, r.Cells, Uid, MyName);
        var ps = _svc.Params(false).ToDictionary(p => p.Id, p => p.Code);
        LogService.WriteLog(Uid, "CHEM_READING_SAVE", $"{r.Date:dd/MM/yyyy} {(sh == "D" ? "DAY" : "NIGHT")} | " +
            string.Join(" | ", r.Cells.Select(c => $"{(ps.TryGetValue(c.ParamId, out var code) ? code : c.ParamId.ToString())}#{c.Slot}={(c.Value?.ToString("0.####") ?? "DEL")}")), $"{r.Date:yyyyMMdd}-{sh}");
        Changed();
        return Ok(new { message = $"บันทึกผลการตรวจวัด {saved} ค่า" + (removed > 0 ? $" · ลบ {removed} ค่า" : "") });
    }, "บันทึกผลการตรวจวัดไม่สำเร็จ");

    // ---------------------------------------------------------------- แผนภูมิควบคุมรายเดือน
    [HttpGet("chart")]
    public IActionResult Chart(int paramId, string month) => Guard(CanView) ?? Run(() =>
    {
        var p = _svc.Param(paramId);
        if (p == null) return Fail("ไม่พบพารามิเตอร์");
        var (y, m) = Mon(month);
        var from = new DateTime(y, m, 1);
        var sheet = _svc.Sheet(paramId, y, m);
        var flow = _svc.Flow(paramId);
        var signs = sheet == null ? new List<ChemSign>() : _svc.Signs(sheet.Id);
        var names = _svc.Names(flow.SelectMany(f => f.Users).Concat(new[] { sheet?.SubmittedBy }));
        return Ok(new
        {
            parameter = p,
            month = from.ToString("yyyy-MM"),
            readings = _svc.Readings(from, from.AddMonths(1), paramId),
            actions = _svc.Actions(paramId, from, from.AddMonths(1)),
            sheet = sheet == null ? null : new { sheet.Id, sheet.Status, sheet.NextSlot, sheet.SubmittedAt, sheet.DoneAt, submittedBy = sheet.SubmittedBy == null ? null : names.GetValueOrDefault(sheet.SubmittedBy, sheet.SubmittedBy) },
            flow = flow.Select(f =>
            {
                var sg = signs.FirstOrDefault(x => x.Slot == f.Slot);
                return new
                {
                    f.Slot, name = ChemControlService.SlotName(f.Slot), f.Mode, active = f.Active,
                    users = f.Users.Select(u => new { userId = u, name = names.GetValueOrDefault(u, u) }),
                    mine = f.Allows(Uid),
                    waiting = sheet?.Status == "SIGNING" && sheet.NextSlot == f.Slot,
                    signed = sg == null ? null : new { userId = sg.UserId, name = string.IsNullOrWhiteSpace(sg.UserName) ? sg.UserId : sg.UserName, at = sg.SignedAt }
                };
            }),
            mySign = SignatureStore.Has(Uid),
            can = Can()
        });
    }, "โหลดแผนภูมิควบคุมไม่สำเร็จ");

    [HttpGet("export/excel")]
    public IActionResult Excel(int paramId, string month) => Guard(CanView) ?? Run(() =>
    {
        var p = _svc.Param(paramId);
        if (p == null) return Fail("ไม่พบพารามิเตอร์");
        var (y, m) = Mon(month);
        var from = new DateTime(y, m, 1);
        var sheet = _svc.Sheet(paramId, y, m);
        var flow = _svc.Flow(paramId);
        var bytes = ChemExcel.Build(p, y, m, _svc.Readings(from, from.AddMonths(1), paramId), _svc.Actions(paramId, from, from.AddMonths(1)), sheet,
                                    sheet == null ? new() : _svc.Signs(sheet.Id), flow, _svc.Names(flow.SelectMany(f => f.Users)));
        LogService.WriteLog(Uid, "CHEM_EXPORT_EXCEL", $"{p.Code} {m:00}/{y}", p.Code);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"CHEMICAL-{p.Code}-{y}-{m:00}.xlsx");
    }, "Export Excel ไม่สำเร็จ");

    // ---------------------------------------------------------------- บันทึกการแก้ไข (Corrective Action)
    [HttpPost("actions")]
    public IActionResult SaveAction([FromBody] ChemAction a) => Guard(a?.Id > 0 ? Me?.CanEditChemRecord == true : Me?.CanAddChemRecord == true) ?? Run(() =>
    {
        var s = _svc.Sheet(a.ParamId, a.Date.Year, a.Date.Month);
        if (s != null && s.Status != "DRAFT") return Fail("ใบบันทึกเดือนนี้ส่งลงลายเซ็นแล้ว แก้ไขไม่ได้");
        int id = _svc.SaveAction(a, Uid);
        LogService.WriteLog(Uid, a.Id > 0 ? "CHEM_ACTION_EDIT" : "CHEM_ACTION_ADD", $"#{a.ParamId} {a.Date:dd/MM/yyyy} {a.CheckTime} | {a.Problem} | {a.Before} -> {a.After} | {a.Correction} | {a.Responsible}", id.ToString());
        Changed();
        return Ok(new { id, message = a.Id > 0 ? "แก้ไขบันทึกการแก้ไขแล้ว" : "เพิ่มบันทึกการแก้ไขแล้ว" });
    }, "บันทึกการแก้ไขไม่สำเร็จ");

    [HttpDelete("actions/{id:int}")]
    public IActionResult DeleteAction(int id) => Guard(Me?.CanEditChemRecord == true) ?? Run(() =>
    {
        var a = _svc.Action(id);
        if (a == null) return Fail("ไม่พบรายการ");
        var s = _svc.Sheet(a.ParamId, a.Date.Year, a.Date.Month);
        if (s != null && s.Status != "DRAFT") return Fail("ใบบันทึกเดือนนี้ส่งลงลายเซ็นแล้ว ลบไม่ได้");
        _svc.DeleteAction(id);
        LogService.WriteLog(Uid, "CHEM_ACTION_DELETE", $"#{a.ParamId} {a.Date:dd/MM/yyyy}", id.ToString());
        Changed();
        return Ok(new { message = "ลบบันทึกการแก้ไขแล้ว" });
    }, "ลบไม่สำเร็จ");

    // ---------------------------------------------------------------- อนุมัติ (FLOW ลายเซ็น)
    public sealed record SubmitReq(int ParamId, string Month);

    [HttpPost("sheets/submit")]
    public IActionResult Submit([FromBody] SubmitReq r) => Guard(Me?.CanAddChemRecord == true) ?? Run(() =>
    {
        var p = _svc.Param(r.ParamId) ?? throw new InvalidOperationException("ไม่พบพารามิเตอร์");
        var (y, m) = Mon(r.Month);
        var s = _svc.Submit(r.ParamId, y, m, Uid);
        LogService.WriteLog(Uid, "CHEM_SHEET_SUBMIT", $"{p.Code} {m:00}/{y} -> {ChemControlService.SlotName(s.NextSlot ?? 0)}", s.Id.ToString());
        Changed();
        return Ok(new { message = $"ส่งใบบันทึก {p.Code} เดือน {m:00}/{y} เข้าลงลายเซ็นแล้ว\nรอ {ChemControlService.SlotName(s.NextSlot ?? 0)}" });
    }, "ส่งอนุมัติไม่สำเร็จ");

    [HttpPost("sheets/{id:int}/sign")]
    public IActionResult Sign(int id) => Guard(CanView || Me != null) ?? Run(() =>
    {
        var s = _svc.Sign(id, Uid, MyName);
        var p = _svc.Param(s.ParamId);
        LogService.WriteLog(Uid, "CHEM_SHEET_SIGN", $"{p?.Code} {s.Month:00}/{s.Year} | {s.Status}", id.ToString());
        Changed();
        return Ok(new { message = s.Status == "APPROVED" ? $"ลงลายเซ็นแล้ว · ใบบันทึก {p?.Code} อนุมัติครบทุกขั้นตอน" : $"ลงลายเซ็นแล้ว · ส่งต่อ {ChemControlService.SlotName(s.NextSlot ?? 0)}" });
    }, "ลงลายเซ็นไม่สำเร็จ");

    [HttpPost("sheets/{id:int}/return")]
    public IActionResult Return(int id) => Guard(Me != null) ?? Run(() =>
    {
        var s = _svc.Return(id, Uid);
        var p = _svc.Param(s.ParamId);
        LogService.WriteLog(Uid, "CHEM_SHEET_RETURN", $"{p?.Code} {s.Month:00}/{s.Year} -> DRAFT", id.ToString());
        Changed();
        return Ok(new { message = "ตีกลับใบบันทึกเป็นฉบับร่างแล้ว (แก้ไขแล้วส่งใหม่ได้)" });
    }, "ตีกลับไม่สำเร็จ");

    // ---------------------------------------------------------------- ตั้งค่าพารามิเตอร์ควบคุม
    [HttpGet("params")]
    public IActionResult Params() => Guard(Me?.CanViewChemSetup == true) ?? Ok(new { parameters = _svc.Params(false), can = Can() });

    [HttpPost("params")]
    public IActionResult SaveParam([FromBody] ChemParam p) => Guard(p?.Id > 0 ? Me?.CanEditChemSetup == true : Me?.CanAddChemSetup == true) ?? Run(() =>
    {
        int id = _svc.SaveParam(p, Uid);
        LogService.WriteLog(Uid, p.Id > 0 ? "CHEM_PARAM_EDIT" : "CHEM_PARAM_ADD",
            $"{p.Code} | {p.Name} | {p.Unit} | Spec {p.SpecMin}-{p.SpecMax} | CL {p.Lcl}-{p.Ucl} T {p.Target} | {p.Shifts} {p.DayTimes} / {p.NightTimes} | {(p.Active ? "ACTIVE" : "INACTIVE")}", id.ToString());
        Changed();
        return Ok(new { id, message = p.Id > 0 ? $"แก้ไข {p.Code} แล้ว" : $"เพิ่มพารามิเตอร์ {p.Code} แล้ว" });
    }, "บันทึกพารามิเตอร์ไม่สำเร็จ");

    [HttpDelete("params/{id:int}")]
    public IActionResult DeleteParam(int id) => Guard(Me?.CanDeleteChemSetup == true) ?? Run(() =>
    {
        string code = _svc.DeleteParam(id);
        LogService.WriteLog(Uid, "CHEM_PARAM_DELETE", $"ลบพารามิเตอร์ {code}", id.ToString());
        Changed();
        return Ok(new { message = $"ลบ {code} แล้ว" });
    }, "ลบพารามิเตอร์ไม่สำเร็จ");

    // ---------------------------------------------------------------- SETUP › SIGN FLOW (Admin) · รูปแบบเดียวกับ MIN REPORT
    [HttpGet("settings")]
    public IActionResult FlowList()
    {
        if (Me?.UserLevel != 1) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (!DbSchema.HasChemControl) return Fail("ฐานข้อมูลยังไม่มีตาราง Chemical Control");
        var on = _svc.FlowConfigured();
        var list = new List<object> { new { stkId = 0, code = "ALL (DEFAULT)", name = "ค่าเริ่มต้นทุกรายการ", stockType = (string)null, on = on.Contains(0) } };
        list.AddRange(_svc.Params(false).Select(p => (object)new { stkId = p.Id, code = p.Code, name = p.Name, stockType = (string)null, on = on.Contains(p.Id) }));
        return Ok(new { stocks = list });
    }

    [HttpGet("settings/flow/{paramId:int}")]
    public IActionResult GetFlow(int paramId)
    {
        if (Me?.UserLevel != 1) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        var users = c.Query<(string UserID, string FullName, string Department, string Section)>("SELECT UserID, FullName, Department, Section FROM Nexus.Users WHERE ISNULL(IsLocked, 0) = 0 ORDER BY UserID")
                     .Select(u => new { userId = u.UserID, name = u.FullName, dept = string.IsNullOrWhiteSpace(u.Section) ? u.Department : u.Section, sign = SignatureStore.Has(u.UserID) });
        var on = _svc.FlowConfigured();
        return Ok(new
        {
            slots = _svc.FlowRaw(paramId).Select(s => new { slot = s.Slot, name = ChemControlService.SlotName(s.Slot), mode = s.Mode, users = s.Users }),
            users,
            configured = on.Select(id => new { stkId = id, on = true })
        });
    }

    public sealed record FlowSlotReq(int Slot, string Mode, List<string> Users);
    public sealed record FlowReq(List<FlowSlotReq> Slots);

    [HttpPost("settings/flow/{paramId:int}")]
    public IActionResult SaveFlow(int paramId, [FromBody] FlowReq req)
    {
        if (Me?.UserLevel != 1) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (paramId != 0 && _svc.Param(paramId) == null) return Fail("ไม่พบพารามิเตอร์");
        try
        {
            using var c = new SqlConnection(GlobalConfig.ConnStr);
            var known = c.Query<string>("SELECT UserID FROM Nexus.Users").ToHashSet(StringComparer.OrdinalIgnoreCase);
            var slots = new List<MinFlowSlot>();
            for (int i = 1; i <= 4; i++)
            {
                var x = req?.Slots?.FirstOrDefault(z => z.Slot == i);
                string mode = x?.Mode is "ANY" or "ONE" ? x.Mode : "OFF";
                var us = mode == "OFF" ? new List<string>() : (x?.Users ?? new()).Where(known.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (mode == "ONE" && us.Count > 1) us = us.Take(1).ToList();
                slots.Add(new MinFlowSlot { Slot = i, Mode = mode, Users = us });
            }
            _svc.SaveFlow(paramId, slots, Uid);
            string txt = string.Join(" | ", slots.Select(x => $"{ChemControlService.SlotName(x.Slot)}#{x.Slot}: {(x.Mode == "OFF" ? "OFF" : x.Mode + " " + string.Join(",", x.Users))}"));
            LogService.WriteLog(Uid, "CHEM_SIGN_FLOW", $"Sign flow | {(paramId == 0 ? "DEFAULT" : _svc.Param(paramId)?.Code)} | {txt}", "CHEM");
            Changed();
            return Ok(new { message = paramId == 0 ? "บันทึก FLOW ค่าเริ่มต้นของ Chemical Control แล้ว\nรายการที่ไม่ได้ตั้ง FLOW เฉพาะจะใช้ FLOW นี้" : "บันทึก FLOW ลายเซ็นของรายการนี้แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }
}
