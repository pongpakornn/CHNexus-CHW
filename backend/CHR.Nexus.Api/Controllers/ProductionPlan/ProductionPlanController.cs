using CHR.Nexus.Api.Web;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 📈 PRODUCTION PLAN  /api/pp/*  (สิทธิ์ PpDashboard / PpCapacity / PpSetup · ทุกการบันทึกลง Activity Log · จอที่เปิดอยู่อัพเดทเอง หัวข้อ "pp")
[Route("api/pp")]
public sealed class ProductionPlanController : AppController
{
    private readonly ProductionPlanService _svc = new();
    private IActionResult Guard(bool can) => Me == null || !can ? Deny() : !DbSchema.HasProductionPlan ? Fail("ฐานข้อมูลยังไม่มีตาราง Production Plan (database/nexus/33_Production_Plan.sql)") : null;

    private IActionResult Run(Func<IActionResult> f, string prefix)
    {
        try { return f(); }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, prefix); }
    }

    private static void Changed() => LiveBus.Publish("pp");
    private static DateTime Mon(string m) =>
        DateTime.TryParseExact((m ?? "") + "-01", "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var d) ? d : new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

    // ---------------------------------------------------------------- Dashboard / Capacity (ข้อมูลทั้งเดือนของหน่วยงาน)
    [HttpGet("month")]
    public IActionResult Month(string dept, string month) =>
        Guard(Me?.CanViewPpDashboard == true || Me?.CanViewPpCapacity == true) ?? Run(() => Ok(new
        {
            data = _svc.Month(ProductionPlanService.Dept(dept), Mon(month)),
            can = new { actual = Me.CanEditPpCapacity, setup = Me.CanViewPpSetup, pcs = Me.CanEditPpSetup && DbSchema.HasPpPcsOverride }
        }), "โหลด Production Plan ไม่สำเร็จ");

    // ✏ PCS ของแถว Product เฉพาะเดือน (แทน Order / Forecast · ว่าง = กลับไปใช้ยอดอัตโนมัติ) · สิทธิ์แก้ Production Plan STD
    public sealed record PcsReq(string Month, int ItemId, decimal? Pcs);

    [HttpPost("pcs")]
    public IActionResult SetPcs([FromBody] PcsReq r) => Guard(Me?.CanEditPpSetup == true) ?? (!DbSchema.HasPpPcsOverride ? Fail("ฐานข้อมูลยังไม่มีตาราง PCS (database/nexus/39_Production_Plan_Pcs_Override_Forecast_Summary.sql)") : null) ?? Run(() =>
    {
        if (r == null || r.ItemId <= 0) return Fail("ข้อมูลไม่ถูกต้อง");
        var m = Mon(r.Month);
        string label = _svc.SetPcs(m, r.ItemId, r.Pcs, Uid);
        LogService.WriteLog(Uid, "PP_PCS_SET", $"{m:MM/yyyy} | {label} | PCS {(r.Pcs == null ? "AUTO (Order / Forecast)" : r.Pcs.Value.ToString("#,##0.##"))}", $"PP-PCS-{r.ItemId}");
        Changed();
        return Ok(new { message = r.Pcs == null ? $"{label}\nกลับไปใช้ยอด Order / Forecast แล้ว" : $"{label}\nตั้ง PCS {m:MMM yyyy} = {r.Pcs:#,##0.##} แล้ว" });
    }, "บันทึก PCS ไม่สำเร็จ");

    public sealed record ActualReq(int MachineId, string Month, List<ProductionPlanService.ActualCell> Cells);

    [HttpPost("actual")]
    public IActionResult SaveActual([FromBody] ActualReq r) => Guard(Me?.CanEditPpCapacity == true) ?? Run(() =>
    {
        if (r?.Cells == null || r.Cells.Count == 0) return Fail("ไม่มีข้อมูลที่แก้ไข");
        if (r.Cells.Count > 31) return Fail("บันทึกได้ครั้งละไม่เกิน 31 วัน");
        var m = Mon(r.Month);
        int n = _svc.SaveActual(r.MachineId, m, r.Cells, Uid);
        string code = _svc.MachineCode(r.MachineId);
        string days = string.Join(", ", r.Cells.OrderBy(x => x.Day).Select(x => $"{x.Day}: {x.Hr?.ToString("0.##") ?? "-"} hr / {x.Stroke?.ToString("0.##") ?? "-"} stroke / {x.Man?.ToString("0.##") ?? "-"} man"));
        LogService.WriteLog(Uid, "PP_ACTUAL_SAVE", $"{code} {m:MM/yyyy} | {days}", $"{r.MachineId}-{m:yyyyMM}");
        Changed();
        return Ok(new { message = $"บันทึก Actual {code} ({m:MMM yyyy}) {n} วันแล้ว" });
    }, "บันทึก Actual ไม่สำเร็จ");

    // 🕘 ค่าที่เคยกรอกของผู้ใช้คนนี้ (ให้เลือกแทนการพิมพ์) · อ่านอย่างเดียว
    [HttpGet("recent")]
    public IActionResult Recent(int machineId) => Guard(Me?.CanEditPpCapacity == true) ?? Run(() => Ok(_svc.RecentValues(Uid, machineId)), "โหลดค่าล่าสุดไม่สำเร็จ");

    // ---------------------------------------------------------------- 👥 WORKLOAD (สรุปอัตรากำลังคน แผน, ผล) · ดู = สิทธิ์ Capacity · แก้คนที่มีจริง = สิทธิ์บันทึก Actual
    private IActionResult GuardWl(bool can) => Guard(can) ?? (!DbSchema.HasPpWorkload ? Fail("ฐานข้อมูลยังไม่มีตาราง Workload (database/nexus/38_Production_Plan_Workload.sql)") : null);

    [HttpGet("workload")]
    public IActionResult Workload(string month) =>
        GuardWl(Me?.CanViewPpCapacity == true) ?? Run(() => Ok(new { data = _svc.Workload(Mon(month)), can = new { edit = Me.CanEditPpCapacity } }), "โหลด Workload ไม่สำเร็จ");

    public sealed record HeadsReq(string Month, List<ProductionPlanService.WlCell> Cells);

    [HttpPost("workload/heads")]
    public IActionResult SaveHeads([FromBody] HeadsReq r) => GuardWl(Me?.CanEditPpCapacity == true) ?? Run(() =>
    {
        if (r?.Cells == null || r.Cells.Count == 0) return Fail("ไม่มีข้อมูลที่แก้ไข");
        if (r.Cells.Count > ProductionPlanService.WlRows.Length) return Fail("ข้อมูลไม่ถูกต้อง");
        var m = Mon(r.Month);
        int n = _svc.SaveHeads(m, r.Cells, Uid);
        string rows = string.Join(" | ", r.Cells.Select(x => $"{x.Row}: D {x.Direct?.ToString("0.##") ?? "-"} / I1 {x.Ind1?.ToString("0.##") ?? "-"} / I2 {x.Ind2?.ToString("0.##") ?? "-"}"));
        LogService.WriteLog(Uid, "PP_WORKLOAD_SAVE", $"{m:MM/yyyy} | {rows}", $"WL-{m:yyyyMM}");
        Changed();
        return Ok(new { message = $"บันทึกอัตรากำลังคน {m:MMM yyyy} {n} แถวแล้ว" });
    }, "บันทึกอัตรากำลังคนไม่สำเร็จ");

    // ---------------------------------------------------------------- MASTER DATA › Production Plan STD
    [HttpGet("setup")]
    public IActionResult Setup(string dept) => Guard(Me?.CanViewPpSetup == true) ?? Run(() => Ok(new
    {
        machines = _svc.Machines(ProductionPlanService.Dept(dept), activeOnly: false),
        shifts = _svc.Shifts(),
        settings = _svc.Settings(),
        can = new { add = Me.CanAddPpSetup, edit = Me.CanEditPpSetup, delete = Me.CanDeletePpSetup }
    }), "โหลด STD ไม่สำเร็จ");

    [HttpPost("machines")]
    public IActionResult SaveMachine([FromBody] ProductionPlanService.MachineForm f) =>
        Guard(f?.Id > 0 ? Me?.CanEditPpSetup == true : Me?.CanAddPpSetup == true) ?? Run(() =>
        {
            int id = _svc.SaveMachine(f, Uid);
            LogService.WriteLog(Uid, f.Id > 0 ? "PP_MACHINE_EDIT" : "PP_MACHINE_ADD",
                $"{f.Code} | {f.Group} {f.SubGroup} | Q'ty {f.Qty:0.##} | Target Eff {f.Eff * 100:0.##}% | STD Man {f.Man:0.##} | SPH {(f.Sph?.ToString("0.##") ?? "AUTO")} | Stroke {(f.ByPcs ? "= PCS" : "= PCS x Process")} | {(f.Active ? "ACTIVE" : "INACTIVE")}", id.ToString());
            Changed();
            return Ok(new { id, message = f.Id > 0 ? $"แก้ไข {f.Code} แล้ว" : $"เพิ่มเครื่องจักร {f.Code} แล้ว" });
        }, "บันทึกเครื่องจักรไม่สำเร็จ");

    [HttpDelete("machines/{id:int}")]
    public IActionResult DeleteMachine(int id) => Guard(Me?.CanDeletePpSetup == true) ?? Run(() =>
    {
        string code = _svc.DeleteMachine(id);
        LogService.WriteLog(Uid, "PP_MACHINE_DELETE", $"ลบเครื่องจักร {code} (รวมตาราง Product)", id.ToString());
        Changed();
        return Ok(new { message = $"ลบ {code} แล้ว" });
    }, "ลบเครื่องจักรไม่สำเร็จ");

    public sealed record SettingsReq(List<PpShift> Shifts, decimal Factor, decimal PerDay);

    [HttpPost("settings")]
    public IActionResult SaveSettings([FromBody] SettingsReq r) => Guard(Me?.CanEditPpSetup == true) ?? Run(() =>
    {
        _svc.SaveShifts(r.Shifts ?? new(), Uid);
        _svc.SaveSettings(r.Factor, r.PerDay, Uid);
        LogService.WriteLog(Uid, "PP_STD_SETTINGS", string.Join(" | ", (r.Shifts ?? new()).Select(s => $"{s.Name} = {s.Hours:0.##} Hrs.")) + $" | P8 x{r.Factor:0.###} | P9 ÷{r.PerDay:0.##}", "PP-STD");
        Changed();
        return Ok(new { message = "บันทึก Plan SPH / ค่ากลางแล้ว" });
    }, "บันทึกค่า STD ไม่สำเร็จ");

    [HttpGet("parts")]
    public IActionResult Parts(int machineId, string month) =>
        Guard(Me?.CanViewPpSetup == true) ?? Run(() => Ok(_svc.Parts(machineId, Mon(month))), "โหลดตาราง Product ไม่สำเร็จ");

    [HttpGet("part-search")]
    public IActionResult PartSearch(string kind, string key) => Guard(Me?.CanViewPpSetup == true) ?? Ok(_svc.SearchParts(kind, key));

    [HttpPost("parts")]
    public IActionResult SavePart([FromBody] ProductionPlanService.PartForm f) =>
        Guard(f?.Id > 0 ? Me?.CanEditPpSetup == true : Me?.CanAddPpSetup == true) ?? Run(() =>
        {
            int id = _svc.SavePart(f, Uid);
            string code = _svc.MachineCode(f.MachineId);
            LogService.WriteLog(Uid, f.Id > 0 ? "PP_PRODUCT_EDIT" : "PP_PRODUCT_ADD",
                $"{code} | PART A #{f.PartAId} | PART B #{f.PartBId?.ToString() ?? "-"} | {f.Process} | Process {f.Tp:0.##} | Pcs/Stroke {f.Col:0.##} | CT {f.Ct:0.##} | Man {f.Man?.ToString("0.##") ?? "-"}", id.ToString());
            Changed();
            return Ok(new { id, message = f.Id > 0 ? "แก้ไข Product แล้ว" : $"เพิ่ม Product ให้ {code} แล้ว" });
        }, "บันทึก Product ไม่สำเร็จ");

    [HttpDelete("parts/{id:int}")]
    public IActionResult DeletePart(int id) => Guard(Me?.CanDeletePpSetup == true) ?? Run(() =>
    {
        string label = _svc.DeletePart(id);
        LogService.WriteLog(Uid, "PP_PRODUCT_DELETE", $"ลบ Product {label}", id.ToString());
        Changed();
        return Ok(new { message = $"ลบ {label} แล้ว" });
    }, "ลบ Product ไม่สำเร็จ");
}
