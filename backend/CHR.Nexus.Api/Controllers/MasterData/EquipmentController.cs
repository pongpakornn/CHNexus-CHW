using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🏭 MASTER DATA › PRODUCT CONTROL › Machine Information (/api/master/machines) · Mold Information (/api/master/molds)
//   Same rights as Customer / Supplier (SystemID MasterData: view / add / edit / delete) · every write goes to Activity Log · screens refresh live ("master")
[Route("api/master")]
public sealed class EquipmentController : AppController
{
    private static readonly string[] MachineStatus = { "ACTIVE", "INACTIVE" };
    private static readonly string[] MoldStatus = { "ACTIVE", "REPAIR", "INACTIVE" };
    private readonly EquipmentService _svc = new();

    private object Can => new { add = Me.CanAddMasterData, edit = Me.CanEditMasterData, delete = Me.CanDeleteMasterData };
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง Machine / Mold (database/nexus/71_Master_Machine_Mold_Breaks.sql)");

    private static string Text(string s, int max) { s = Regex.Replace((s ?? "").Trim(), @"\s+", " "); return s.Length == 0 ? null : s.Length > max ? s[..max] : s; }
    private static string Up(string s, int max) => Text(s, max)?.ToUpperInvariant();
    private static string Code(string s) => Up(s, 60) ?? "";
    private static string Num(decimal? v, string label) => v is < 0 or > 1_000_000 ? $"{label} ต้องเป็นตัวเลข 0 - 1,000,000" : null;
    private static string Changes(params (string Label, object Old, object New)[] f) =>
        string.Join(" | ", f.Where(x => !Equals(x.Old?.ToString() ?? "", x.New?.ToString() ?? "")).Select(x => $"{x.Label}: {x.Old ?? "-"} > {x.New ?? "-"}")) is { Length: > 0 } s ? s : "no change";

    // zone pick list = Zone & Workstation Information (script 74) · null = not installed yet (type a zone like before)
    private static object ZoneCodes() => DbSchema.HasZones ? new ZoneService().Zones().Where(z => z.Status == "ACTIVE").Select(z => new { z.Code, z.Name }).ToList() : null;

    // ---------------------------------------------------------------- MACHINE
    public sealed record MachineRequest(string Code, string Name, string Type, string Zone, decimal? SetupMin, decimal? ChangeMoldMin, int? Speed, string Status);

    [HttpGet("machines")]
    public IActionResult Machines()
    {
        if (Me?.CanViewMasterData != true) return Deny();
        if (!DbSchema.HasEquipment) return NotReady();
        return Ok(new { can = Can, rows = _svc.Machines(), zones = ZoneCodes() });
    }

    private (MachineRow Row, string Error) CleanMachine(MachineRequest q)
    {
        var r = new MachineRow
        {
            Code = Code(q?.Code), Name = Text(q?.Name, 200), Type = Up(q?.Type, 50), Zone = Up(q?.Zone, 50),
            SetupMin = q?.SetupMin, ChangeMoldMin = q?.ChangeMoldMin, Speed = q?.Speed, Status = (q?.Status ?? "ACTIVE").ToUpperInvariant(),
        };
        if (r.Code.Length == 0) return (r, "กรุณากรอก MACHINE CODE");
        if (!MasterDataController.CodeOk.IsMatch(r.Code)) return (r, $"MACHINE CODE \"{r.Code}\" ใช้ไม่ได้\nใช้ได้เฉพาะ A-Z 0-9 เว้นวรรค - _ . / & ( ) ยาวไม่เกิน 50 ตัว");
        if (r.Type == null) return (r, "กรุณาเลือก / กรอก MACHINE TYPE");
        if (!MachineStatus.Contains(r.Status)) return (r, "STATUS ไม่ถูกต้อง");
        return (r, Num(r.SetupMin, "STD SETUP TIME") ?? Num(r.ChangeMoldMin, "CHANGE MOLD TIME") ?? Num(r.Speed, "MACHINE SPEED"));
    }

    [HttpPost("machines")]
    public IActionResult AddMachine([FromBody] MachineRequest req) => SaveMachine(0, req);

    [HttpPut("machines/{id:int}")]
    public IActionResult EditMachine(int id, [FromBody] MachineRequest req) => SaveMachine(id, req);

    private IActionResult SaveMachine(int id, MachineRequest req)
    {
        if (id == 0 ? Me?.CanAddMasterData != true : Me?.CanEditMasterData != true) return Deny();
        if (!DbSchema.HasEquipment) return NotReady();
        var old = id == 0 ? null : _svc.Machine(id);
        if (id != 0 && old == null) return Fail("ไม่พบเครื่องจักรนี้ (อาจถูกลบไปแล้ว)");
        var (r, err) = CleanMachine(req);
        if (err != null) return Fail(err);
        if (r.Zone != old?.Zone && !ZoneService.ZoneExists(r.Zone)) return Fail($"ไม่พบ ZONE \"{r.Zone}\" ใน Zone & Workstation Information");
        if (_svc.MachineCodeExists(r.Code, id)) return Fail($"มี MACHINE CODE \"{r.Code}\" อยู่แล้ว");
        try
        {
            _svc.SaveMachine(id, r, Uid);
            string detail = old == null
                ? $"{r.Code} | {r.Name ?? "-"} | TYPE {r.Type} | ZONE {r.Zone ?? "-"} | SETUP {r.SetupMin} | CHANGE MOLD {r.ChangeMoldMin} | SPEED {r.Speed} | {r.Status}"
                : $"{r.Code} | " + Changes(("Code", old.Code, r.Code), ("Name", old.Name, r.Name), ("Type", old.Type, r.Type), ("Zone", old.Zone, r.Zone),
                                          ("Setup", old.SetupMin, r.SetupMin), ("ChangeMold", old.ChangeMoldMin, r.ChangeMoldMin), ("Speed", old.Speed, r.Speed), ("Status", old.Status, r.Status));
            LogService.WriteLog(Uid, old == null ? "MASTER_MACHINE_ADD" : "MASTER_MACHINE_EDIT", "MACHINE: " + detail, r.Code);
            return Ok(new { message = old == null ? $"เพิ่มเครื่องจักร {r.Code} แล้ว" : $"บันทึกเครื่องจักร {r.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("machines/{id:int}")]
    public IActionResult DeleteMachine(int id)
    {
        if (Me?.CanDeleteMasterData != true) return Deny();
        if (!DbSchema.HasEquipment) return NotReady();
        var old = _svc.Machine(id);
        if (old == null) return Fail("ไม่พบเครื่องจักรนี้ (อาจถูกลบไปแล้ว)");
        try
        {
            _svc.DeleteMachine(id);
            LogService.WriteLog(Uid, "MASTER_MACHINE_DELETE", $"MACHINE: {old.Code} | {old.Name ?? "-"} | TYPE {old.Type}", old.Code);
            return Ok(new { message = $"ลบเครื่องจักร {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- MOLD
    public sealed record MoldRequest(string Code, string Name, string Owner, string Customer, string Zone, int? PartsPerStroke, string Status);

    [HttpGet("molds")]
    public IActionResult Molds()
    {
        if (Me?.CanViewMasterData != true) return Deny();
        if (!DbSchema.HasEquipment) return NotReady();
        return Ok(new { can = Can, rows = _svc.Molds(), zones = ZoneCodes() });
    }

    private (MoldRow Row, string Error) CleanMold(MoldRequest q)
    {
        var r = new MoldRow
        {
            Code = Code(q?.Code), Name = Text(q?.Name, 200), Owner = (q?.Owner ?? "").Trim().ToUpperInvariant(), Customer = Up(q?.Customer, 50),
            Zone = Up(q?.Zone, 50), PartsPerStroke = q?.PartsPerStroke, Status = (q?.Status ?? "ACTIVE").ToUpperInvariant(),
        };
        if (r.Code.Length == 0) return (r, "กรุณากรอก MOLD CODE");
        if (!MasterDataController.CodeOk.IsMatch(r.Code)) return (r, $"MOLD CODE \"{r.Code}\" ใช้ไม่ได้\nใช้ได้เฉพาะ A-Z 0-9 เว้นวรรค - _ . / & ( ) ยาวไม่เกิน 50 ตัว");
        if (r.Owner is not ("CUSTOMER" or "COMPANY")) return (r, "กรุณาเลือก OWNER TYPE (CUSTOMER / COMPANY)");
        if (r.Owner == "COMPANY") r.Customer = null;
        else if (r.Customer == null) return (r, "แม่พิมพ์ของลูกค้า กรุณาเลือก CUSTOMER");
        else if (!_svc.CustomerExists(r.Customer)) return (r, $"ไม่พบ CUSTOMER \"{r.Customer}\" ใน Customer Information");
        if (!MoldStatus.Contains(r.Status)) return (r, "STATUS ไม่ถูกต้อง");
        if (r.PartsPerStroke is < 1 or > 1000) return (r, "PARTS PER STROKE ต้องเป็นตัวเลข 1 - 1,000");
        return (r, null);
    }

    [HttpPost("molds")]
    public IActionResult AddMold([FromBody] MoldRequest req) => SaveMold(0, req);

    [HttpPut("molds/{id:int}")]
    public IActionResult EditMold(int id, [FromBody] MoldRequest req) => SaveMold(id, req);

    private IActionResult SaveMold(int id, MoldRequest req)
    {
        if (id == 0 ? Me?.CanAddMasterData != true : Me?.CanEditMasterData != true) return Deny();
        if (!DbSchema.HasEquipment) return NotReady();
        var old = id == 0 ? null : _svc.Mold(id);
        if (id != 0 && old == null) return Fail("ไม่พบแม่พิมพ์นี้ (อาจถูกลบไปแล้ว)");
        var (r, err) = CleanMold(req);
        if (err != null) return Fail(err);
        if (r.Zone != old?.Zone && !ZoneService.ZoneExists(r.Zone)) return Fail($"ไม่พบ ZONE \"{r.Zone}\" ใน Zone & Workstation Information");
        if (_svc.MoldCodeExists(r.Code, id)) return Fail($"มี MOLD CODE \"{r.Code}\" อยู่แล้ว");
        try
        {
            _svc.SaveMold(id, r, Uid);
            string detail = old == null
                ? $"{r.Code} | {r.Name ?? "-"} | {r.Owner} {r.Customer ?? ""} | ZONE {r.Zone ?? "-"} | PCS/STROKE {r.PartsPerStroke} | {r.Status}"
                : $"{r.Code} | " + Changes(("Code", old.Code, r.Code), ("Name", old.Name, r.Name), ("Owner", old.Owner, r.Owner), ("Customer", old.Customer, r.Customer),
                                          ("Zone", old.Zone, r.Zone), ("Pcs/Stroke", old.PartsPerStroke, r.PartsPerStroke), ("Status", old.Status, r.Status));
            LogService.WriteLog(Uid, old == null ? "MASTER_MOLD_ADD" : "MASTER_MOLD_EDIT", "MOLD: " + detail, r.Code);
            return Ok(new { message = old == null ? $"เพิ่มแม่พิมพ์ {r.Code} แล้ว" : $"บันทึกแม่พิมพ์ {r.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("molds/{id:int}")]
    public IActionResult DeleteMold(int id)
    {
        if (Me?.CanDeleteMasterData != true) return Deny();
        if (!DbSchema.HasEquipment) return NotReady();
        var old = _svc.Mold(id);
        if (old == null) return Fail("ไม่พบแม่พิมพ์นี้ (อาจถูกลบไปแล้ว)");
        try
        {
            _svc.DeleteMold(id);
            LogService.WriteLog(Uid, "MASTER_MOLD_DELETE", $"MOLD: {old.Code} | {old.Name ?? "-"} | {old.Owner} {old.Customer ?? ""}", old.Code);
            return Ok(new { message = $"ลบแม่พิมพ์ {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }
}
