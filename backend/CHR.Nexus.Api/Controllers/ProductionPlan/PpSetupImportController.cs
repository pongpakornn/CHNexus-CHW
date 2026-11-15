using CHR.Nexus.Api.Web;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// PRODUCTION PLAN > MASTER DATA > MACHINE STD / MACHINE PRODUCTS: Excel TEMPLATE / IMPORT (preview) / APPLY
//   {kind} = machines (Machine STD + Plan SPH settings) | products (Machine Products)
//   template = PpSetup view right · import + apply = PpSetup ADD and EDIT right · add + edit only, nothing is deleted
[Route("api/pp/setup")]
public sealed class PpSetupImportController : AppController
{
    private readonly ProductionPlanService _svc = new();
    private readonly PpSetupImportService _imp = new();
    private readonly UploadCache _uploads;
    public PpSetupImportController(UploadCache uploads) => _uploads = uploads;

    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string DenyImport = "คุณไม่มีสิทธิ์ IMPORT (ต้องมีสิทธิ์ ADD และ EDIT ของ Production Plan STD)";
    private static bool KnownKind(string k) => k is "machines" or "products";
    private bool CanImport => Me?.CanAddPpSetup == true && Me?.CanEditPpSetup == true;
    private IActionResult NotReady() => !DbSchema.HasProductionPlan ? Fail("ฐานข้อมูลยังไม่มีตาราง Production Plan (database/nexus/33_Production_Plan.sql)") : null;

    [HttpGet("{kind}/template")]
    public IActionResult Template(string kind, string dept)
    {
        if (!KnownKind(kind)) return NotFound();
        if (Me?.CanViewPpSetup != true) return Deny();
        if (NotReady() is { } nr) return nr;
        string d = ProductionPlanService.Dept(dept);
        if (!PpSetupImportService.Depts.Contains(d)) return Fail($"DEPT ไม่ถูกต้อง ({d})");
        try
        {
            var machines = _svc.Machines(d, activeOnly: false);
            XLWorkbook wb;
            int rows;
            if (kind == "machines") { wb = PpSetupImportService.MachinesTemplate(d, machines, _svc.Shifts(), _svc.Settings()); rows = machines.Count; }
            else
            {
                var parts = _svc.PartsOf(machines.Select(m => m.Id).ToArray());
                wb = PpSetupImportService.ProductsTemplate(d, machines, parts);
                rows = parts.Count;
            }
            using (wb)
            {
                using var ms = new MemoryStream();
                wb.SaveAs(ms);
                LogService.WriteLog(Uid, kind == "machines" ? "PP_MACHINE_TEMPLATE" : "PP_PRODUCT_TEMPLATE", $"{d} | Rows: {rows}", "");
                return File(ms.ToArray(), XlsxType, $"{(kind == "machines" ? "MACHINE_STD" : "MACHINE_PRODUCTS")}_{d}_TEMPLATE.xlsx");
            }
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }

    [HttpPost("{kind}/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> Import(string kind, IFormFile file)
    {
        if (!KnownKind(kind)) return NotFound();
        if (!CanImport) return Deny(DenyImport);
        if (NotReady() is { } nr) return nr;
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        try
        {
            PpSetupImportService.State st;
            using (var wb = new XLWorkbook(path)) st = PpSetupImportService.Parse(kind, wb);
            TryDelete(path);
            var evs = Eval(st, null);
            var rows = evs.Select(e => e.Row).ToList();
            var errors = rows.Where(r => r.Status == ImportReview.Invalid).Select(r => new ImportErrorDto($"{r.Label} ({r.Sub})", r.Note)).ToList();
            string id = _uploads.Put("", file.FileName, Uid, "ppsetup-" + kind, st);
            return Ok(new ImportPreviewDto(id, file.FileName, st.Title, rows, errors));
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("{kind}/import/apply")]
    public IActionResult ImportApply(string kind, [FromBody] ImportApplyRequest req)
    {
        if (!KnownKind(kind)) return NotFound();
        if (!CanImport) return Deny(DenyImport);
        if (NotReady() is { } nr) return nr;
        var it = string.IsNullOrEmpty(req?.Id) ? null : _uploads.Get(req.Id, Uid, "ppsetup-" + kind);
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var st = (PpSetupImportService.State)it.State;
        try
        {
            var evs = Eval(st, req);   // re-reads current data and re-validates every row (edits / map included)
            var (added, updated, same, skipped) = _imp.Execute(evs, _svc, Uid);
            _uploads.Remove(req.Id);
            string keys = string.Join(", ", evs.Where(e => e.Op != null).Select(e => e.Row.Label).Take(30));
            LogService.WriteLog(Uid, kind == "machines" ? "PP_MACHINE_IMPORT" : "PP_PRODUCT_IMPORT",
                $"File: {it.FileName} | Added: {added} | Updated: {updated} | Same: {same} | Skipped: {skipped} | {keys}", "PP-IMPORT");
            LiveBus.Publish("pp");
            return Ok(new { added, updated, same, skipped,
                            message = $"นำเข้า {st.Title} แล้ว: เพิ่ม {added:N0} · แก้ไข {updated:N0} · เหมือนเดิม {same:N0}" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }

    private List<PpSetupImportService.Ev> Eval(PpSetupImportService.State st, ImportApplyRequest req) =>
        st.Kind == "machines" ? _imp.EvalMachines(st, _svc, req) : _imp.EvalProducts(st, _svc, req);
}
