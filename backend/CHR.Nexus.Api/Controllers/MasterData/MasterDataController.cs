using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🗂 MASTER DATA : ข้อมูลกลางของทุกระบบ (สิทธิ์ SystemID MasterData · ทุกการเปลี่ยนแปลงลง Activity Log · จอทุกเครื่องอัพเดทเอง)
//   /api/master/customers | suppliers  : ดู / เพิ่ม / แก้ไข (ACTIVE-INACTIVE) / ลบ
//   /api/master/menu                   : คลังของ Product Control แยกตามประเภท (เมนู Sidebar: Part / Material / Component …)
[Route("api/master")]
public sealed class MasterDataController : AppController
{
    // รหัส: A-Z 0-9 เว้นวรรค - _ . / & ( ) · ยาวไม่เกิน 50 (ตรงกับข้อความในสินค้าเดิม)
    private static readonly Regex CodeOk = new(@"^[A-Z0-9][A-Z0-9 ._/&()\-]{0,49}$", RegexOptions.Compiled);

    private readonly UploadCache _uploads;
    public MasterDataController(UploadCache uploads) => _uploads = uploads;

    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง MASTER DATA (database/nexus/24_Master_Data.sql)");

    private object Can => new { add = Me.CanAddMasterData, edit = Me.CanEditMasterData, delete = Me.CanDeleteMasterData };

    // ---------------------------------------------------------------- เมนู Product Control (คลังที่ดูได้ แยกประเภท)
    [HttpGet("menu")]
    public IActionResult Menu()
    {
        if (Me == null) return Deny();
        if (!Me.CanViewProductControl) return Ok(Array.Empty<object>());
        return Ok(new StockService().GetStocks().Where(s => Me.CanViewStock(s))
                                    .Select(s => new { s.StkId, s.Code, s.Name, type = (s.StockType ?? "OTHER").ToUpperInvariant() }));
    }

    // ---------------------------------------------------------------- Customer / Supplier
    [HttpGet("{kind}")]
    public IActionResult List(string kind)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (Me?.CanViewMasterData != true) return Deny();
        if (!DbSchema.HasMasterData) return NotReady();
        return Ok(new { label = k.Label, can = Can, rows = new PartnerService(k).List() });
    }

    public sealed record PartnerRequest(string Code, string Name, bool? IsActive);

    internal static (string Code, string Name, string Error) Clean(PartnerKind k, PartnerRequest req)
    {
        string code = Regex.Replace((req?.Code ?? "").Trim().ToUpperInvariant(), @"\s+", " ");
        string name = Regex.Replace((req?.Name ?? "").Trim(), @"\s+", " ");
        if (code.Length == 0) return (code, name, $"กรุณากรอก {k.Label} CODE");
        if (!CodeOk.IsMatch(code)) return (code, name, $"{k.Label} CODE \"{code}\" ใช้ไม่ได้\nใช้ได้เฉพาะ A-Z 0-9 เว้นวรรค - _ . / & ( ) ยาวไม่เกิน 50 ตัว");
        if (name.Length > 200) return (code, name, $"{k.Label} NAME ยาวเกิน 200 ตัวอักษร");
        return (code, name.Length == 0 ? null : name, null);
    }

    [HttpPost("{kind}")]
    public IActionResult Add(string kind, [FromBody] PartnerRequest req)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (Me?.CanAddMasterData != true) return Deny();
        if (!DbSchema.HasMasterData) return NotReady();
        var (code, name, err) = Clean(k, req);
        if (err != null) return Fail(err);
        var svc = new PartnerService(k);
        if (svc.CodeExists(code)) return Fail($"มี {k.Label} CODE \"{code}\" อยู่แล้ว");
        try
        {
            int id = svc.Add(code, name, Uid);
            LogService.WriteLog(Uid, $"MASTER_{k.Label}_ADD", $"{k.Label}: {code} | {name ?? "-"} | ACTIVE", code);
            return Ok(new { id, message = $"เพิ่ม {k.Label} {code} แล้ว (ACTIVE)" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpPut("{kind}/{id:int}")]
    public IActionResult Update(string kind, int id, [FromBody] PartnerRequest req)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (Me?.CanEditMasterData != true) return Deny();
        if (!DbSchema.HasMasterData) return NotReady();
        var svc = new PartnerService(k);
        var old = svc.Get(id);
        if (old == null) return Fail($"ไม่พบ {k.Label} นี้ (อาจถูกลบไปแล้ว)");
        var (code, name, err) = Clean(k, req);
        if (err != null) return Fail(err);
        // รหัสผูกกับสินค้าเดิมด้วยข้อความ -> มีสินค้าใช้อยู่ = เปลี่ยนรหัสไม่ได้ (เปลี่ยนชื่อ / สถานะได้)
        if (code != old.Code && old.Parts > 0) return Fail($"{k.Label} CODE \"{old.Code}\" มีสินค้าใช้อยู่ {old.Parts:N0} รายการ\nเปลี่ยนรหัสไม่ได้ (แก้ชื่อ / สถานะได้)");
        if (code != old.Code && svc.CodeExists(code, id)) return Fail($"มี {k.Label} CODE \"{code}\" อยู่แล้ว");
        bool active = req?.IsActive ?? old.IsActive;
        try
        {
            svc.Update(id, code, name, active, Uid);
            var changes = new List<string>();
            if (code != old.Code) changes.Add($"Code: {old.Code} > {code}");
            if ((name ?? "") != (old.Name ?? "")) changes.Add($"Name: {old.Name ?? "-"} > {name ?? "-"}");
            if (active != old.IsActive) changes.Add($"Status: {(old.IsActive ? "ACTIVE" : "INACTIVE")} > {(active ? "ACTIVE" : "INACTIVE")}");
            LogService.WriteLog(Uid, $"MASTER_{k.Label}_EDIT", $"{k.Label}: {code} | {(changes.Count == 0 ? "no change" : string.Join(" | ", changes))}", code);
            return Ok(new { message = $"บันทึก {k.Label} {code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("{kind}/{id:int}")]
    public IActionResult Delete(string kind, int id)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (Me?.CanDeleteMasterData != true) return Deny();
        if (!DbSchema.HasMasterData) return NotReady();
        var svc = new PartnerService(k);
        var old = svc.Get(id);
        if (old == null) return Fail($"ไม่พบ {k.Label} นี้ (อาจถูกลบไปแล้ว)");
        if (old.Parts > 0) return Fail($"{k.Label} \"{old.Code}\" มีสินค้าใช้อยู่ {old.Parts:N0} รายการ ลบไม่ได้\nเปลี่ยนสถานะเป็น INACTIVE แทน");
        try
        {
            svc.Delete(id);
            LogService.WriteLog(Uid, $"MASTER_{k.Label}_DELETE", $"{k.Label}: {old.Code} | {old.Name ?? "-"}", old.Code);
            return Ok(new { message = $"ลบ {k.Label} {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- Excel TEMPLATE / IMPORT (preview) / APPLY
    //   template = view right · import + apply = add AND edit right · nothing is deleted · STATUS never changes
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private bool CanImport => Me?.CanAddMasterData == true && Me?.CanEditMasterData == true;
    private const string DenyImport = "คุณไม่มีสิทธิ์ IMPORT (ต้องมีสิทธิ์ ADD และ EDIT ของ MASTER DATA)";

    [HttpGet("{kind}/template")]
    public IActionResult Template(string kind)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (Me?.CanViewMasterData != true) return Deny();
        if (!DbSchema.HasMasterData) return NotReady();
        try
        {
            var rows = new PartnerService(k).List();
            using var wb = new PartnerImportService(k).Template(rows);
            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            LogService.WriteLog(Uid, $"MASTER_{k.Label}_TEMPLATE", $"{k.Label} | Rows: {rows.Count}", "");
            return File(ms.ToArray(), XlsxType, $"{k.Label}_TEMPLATE.xlsx");
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }

    [HttpPost("{kind}/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> Import(string kind, IFormFile file)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (!CanImport) return Deny(DenyImport);
        if (!DbSchema.HasMasterData) return NotReady();
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        try
        {
            var svc = new PartnerImportService(k);
            List<PartnerImportService.Src> src;
            List<ImportErrorDto> errors;
            using (var wb = new ClosedXML.Excel.XLWorkbook(path)) (src, errors) = svc.Parse(wb.Worksheets.First());
            TryDelete(path);
            var rows = svc.Preview(src, new PartnerService(k).List());
            string id = _uploads.Put("", file.FileName, Uid, "partner-" + k.Key, new PartnerImportService.State(k.Label, src));
            return Ok(new ImportPreviewDto(id, file.FileName, k.Label, rows, errors));
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("{kind}/import/apply")]
    public IActionResult ImportApply(string kind, [FromBody] ImportApplyRequest req)
    {
        var k = PartnerService.Of(kind);
        if (k == null) return NotFound();
        if (!CanImport) return Deny(DenyImport);
        if (!DbSchema.HasMasterData) return NotReady();
        var it = string.IsNullOrEmpty(req?.Id) ? null : _uploads.Get(req.Id, Uid, "partner-" + k.Key);
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        try
        {
            var svc = new PartnerImportService(k);
            var plan = svc.MakePlan((PartnerImportService.State)it.State, new PartnerService(k).List(), req);   // re-reads current data
            svc.Execute(plan, Uid);
            _uploads.Remove(req.Id);
            LogService.WriteLog(Uid, $"MASTER_{k.Label}_IMPORT",
                $"File: {it.FileName} | Added: {plan.Inserts.Count} | Updated: {plan.Updates.Count} | Same: {plan.Same} | Skipped: {plan.Skipped} | {string.Join(", ", plan.Inserts.Select(x => x.Code).Concat(plan.Updates.Select(x => x.Code)).Take(30))}",
                "MASTER-IMPORT");
            LiveBus.Publish("master");
            return Ok(new { added = plan.Inserts.Count, updated = plan.Updates.Count, same = plan.Same, skipped = plan.Skipped,
                            message = $"นำเข้า {k.Label} แล้ว: เพิ่ม {plan.Inserts.Count:N0} · แก้ไข {plan.Updates.Count:N0} · เหมือนเดิม {plan.Same:N0}" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }
}
