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

    private static (string Code, string Name, string Error) Clean(PartnerKind k, PartnerRequest req)
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
}
