using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🏭 MASTER DATA › ZONE & WORKSTATION INFORMATION (/api/master/zones · /stations · /stores, script 74)
//   Production Zone -> Workstations · Line-side Store (pick list) · rights = MASTER DATA (like Machine Information)
//   codes are fixed after create (Kanban flows / machines keep the zone code as text) · delete blocked while something still points at the row
//   every write goes to Activity Log · screens refresh live ("master")
[Route("api/master")]
public sealed class ZoneController : AppController
{
    private static readonly string[] Status = { "ACTIVE", "INACTIVE" };
    private readonly ZoneService _svc = new();

    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง ZONE & WORKSTATION (database/nexus/74_Master_Zones_Workstations.sql)");
    private IActionResult Guard(bool ok) => !ok ? Deny() : !DbSchema.HasZones ? NotReady() : null;
    private static string Text(string s, int max) { s = Regex.Replace((s ?? "").Trim(), @"\s+", " "); return s.Length == 0 ? null : s.Length > max ? s[..max] : s; }
    private static string Up(string s, int max) => Text(s, max)?.ToUpperInvariant();
    private static string CodeErr(string label, string code) =>
        code.Length == 0 ? $"กรุณากรอก {label}" : !MasterDataController.CodeOk.IsMatch(code) ? $"{label} \"{code}\" ใช้ไม่ได้\nใช้ได้เฉพาะ A-Z 0-9 เว้นวรรค - _ . / & ( ) ยาวไม่เกิน 50 ตัว" : null;
    private static string Changes(params (string Label, object Old, object New)[] f) =>
        string.Join(" | ", f.Where(x => !Equals(x.Old?.ToString() ?? "", x.New?.ToString() ?? "")).Select(x => $"{x.Label}: {x.Old ?? "-"} > {x.New ?? "-"}")) is { Length: > 0 } s ? s : "no change";
    private bool Can(int id) => id == 0 ? Me?.CanAddMasterData == true : Me?.CanEditMasterData == true;

    [HttpGet("zones")]
    public IActionResult All()
    {
        if (Guard(Me?.CanViewMasterData == true) is { } g) return g;
        try
        {
            var machines = DbSchema.HasEquipment ? new EquipmentService().Machines().Where(m => m.Status == "ACTIVE").Select(m => new { m.Code, m.Name, m.Type, m.Zone }).ToList<object>() : new();
            return Ok(new
            {
                can = new { add = Me.CanAddMasterData, edit = Me.CanEditMasterData, delete = Me.CanDeleteMasterData },
                zones = _svc.Zones(),
                stations = _svc.Stations(),
                stores = _svc.Stores(),
                machines,
            });
        }
        catch (Exception ex) { return Fail(ex, "โหลดข้อมูล ZONE ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- PRODUCTION ZONE
    public sealed record ZoneRequest(string Code, string Name, int? StoreId, string Status);

    [HttpPost("zones")]
    public IActionResult AddZone([FromBody] ZoneRequest req) => SaveZone(0, req);

    [HttpPut("zones/{id:int}")]
    public IActionResult EditZone(int id, [FromBody] ZoneRequest req) => SaveZone(id, req);

    private IActionResult SaveZone(int id, ZoneRequest q)
    {
        if (Guard(Can(id)) is { } g) return g;
        var old = id == 0 ? null : _svc.Zone(id);
        if (id != 0 && old == null) return Fail("ไม่พบ ZONE นี้ (อาจถูกลบไปแล้ว)");
        var r = new ZoneRow { Code = old?.Code ?? Up(q?.Code, 60) ?? "", Name = Text(q?.Name, 200), StoreId = q?.StoreId, Status = (q?.Status ?? "ACTIVE").ToUpperInvariant() };
        if (CodeErr("ZONE CODE", r.Code) is { } e) return Fail(e);
        if (!Status.Contains(r.Status)) return Fail("STATUS ไม่ถูกต้อง");
        var store = r.StoreId is int sid ? _svc.Store(sid) : null;
        if (r.StoreId != null && store == null) return Fail("ไม่พบ LINE-SIDE STORE ที่เลือก (อาจถูกลบไปแล้ว)");
        if (id == 0 && _svc.Exists("ProductionZones", "ZoneCode", r.Code, "ZoneID", 0)) return Fail($"มี ZONE CODE \"{r.Code}\" อยู่แล้ว");
        try
        {
            _svc.SaveZone(id, r, Uid);
            string detail = old == null
                ? $"{r.Code} | {r.Name ?? "-"} | STORE {store?.Code ?? "-"} | {r.Status}"
                : $"{r.Code} | " + Changes(("Name", old.Name, r.Name), ("Store", old.StoreCode, store?.Code), ("Status", old.Status, r.Status));
            LogService.WriteLog(Uid, old == null ? "MASTER_ZONE_ADD" : "MASTER_ZONE_EDIT", "ZONE: " + detail, r.Code);
            return Ok(new { message = old == null ? $"เพิ่ม ZONE {r.Code} แล้ว · เพิ่มสถานีงานของโซนนี้ต่อได้เลย" : $"บันทึก ZONE {r.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("zones/{id:int}")]
    public IActionResult DeleteZone(int id)
    {
        if (Guard(Me?.CanDeleteMasterData == true) is { } g) return g;
        var old = _svc.Zone(id);
        if (old == null) return Fail("ไม่พบ ZONE นี้ (อาจถูกลบไปแล้ว)");
        if (old.Stations > 0) return Fail($"ลบไม่ได้: ZONE {old.Code} ยังมีสถานีงาน {old.Stations} สถานี\nกรุณาลบหรือย้ายสถานีงานออกก่อน");
        try
        {
            _svc.Delete("ProductionZones", "ZoneID", id);
            LogService.WriteLog(Uid, "MASTER_ZONE_DELETE", $"ZONE: {old.Code} | {old.Name ?? "-"}", old.Code);
            return Ok(new { message = $"ลบ ZONE {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- WORKSTATION
    public sealed record StationRequest(int ZoneId, string Code, string Name, string Machine, int? Operators, string Status);

    [HttpPost("stations")]
    public IActionResult AddStation([FromBody] StationRequest req) => SaveStation(0, req);

    [HttpPut("stations/{id:int}")]
    public IActionResult EditStation(int id, [FromBody] StationRequest req) => SaveStation(id, req);

    private IActionResult SaveStation(int id, StationRequest q)
    {
        if (Guard(Can(id)) is { } g) return g;
        var old = id == 0 ? null : _svc.Station(id);
        if (id != 0 && old == null) return Fail("ไม่พบสถานีงานนี้ (อาจถูกลบไปแล้ว)");
        var zone = _svc.Zone(q?.ZoneId ?? 0);
        if (zone == null) return Fail("กรุณาเลือก ZONE ของสถานีงาน");
        var r = new StationRow { ZoneId = zone.Id, Code = old?.Code ?? Up(q?.Code, 60) ?? "", Name = Text(q?.Name, 200), Machine = Up(q?.Machine, 50), Operators = q?.Operators ?? 1, Status = (q?.Status ?? "ACTIVE").ToUpperInvariant() };
        if (CodeErr("WORKSTATION CODE", r.Code) is { } e) return Fail(e);
        if (r.Operators is < 1 or > 99) return Fail("จำนวนพนักงานต่อสถานี ต้องเป็นตัวเลข 1 - 99");
        if (!Status.Contains(r.Status)) return Fail("STATUS ไม่ถูกต้อง");
        if (r.Machine != null && !_svc.MachineExists(r.Machine)) return Fail($"ไม่พบเครื่องจักร \"{r.Machine}\" ใน Machine Information");
        if (id == 0 && _svc.Exists("Workstations", "StationCode", r.Code, "StationID", 0)) return Fail($"มี WORKSTATION CODE \"{r.Code}\" อยู่แล้ว");
        try
        {
            _svc.SaveStation(id, r, Uid);
            string detail = old == null
                ? $"{r.Code} | ZONE {zone.Code} | {r.Name ?? "-"} | MACHINE {r.Machine ?? "-"} | OPERATORS {r.Operators} | {r.Status}"
                : $"{r.Code} | " + Changes(("Zone", old.Zone, zone.Code), ("Name", old.Name, r.Name), ("Machine", old.Machine, r.Machine), ("Operators", old.Operators, r.Operators), ("Status", old.Status, r.Status));
            LogService.WriteLog(Uid, old == null ? "MASTER_STATION_ADD" : "MASTER_STATION_EDIT", "WORKSTATION: " + detail, r.Code);
            return Ok(new { message = old == null ? $"เพิ่มสถานีงาน {r.Code} ใน ZONE {zone.Code} แล้ว" : $"บันทึกสถานีงาน {r.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("stations/{id:int}")]
    public IActionResult DeleteStation(int id)
    {
        if (Guard(Me?.CanDeleteMasterData == true) is { } g) return g;
        var old = _svc.Station(id);
        if (old == null) return Fail("ไม่พบสถานีงานนี้ (อาจถูกลบไปแล้ว)");
        try
        {
            _svc.Delete("Workstations", "StationID", id);
            LogService.WriteLog(Uid, "MASTER_STATION_DELETE", $"WORKSTATION: {old.Code} | ZONE {old.Zone} | {old.Name ?? "-"}", old.Code);
            return Ok(new { message = $"ลบสถานีงาน {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- LINE-SIDE STORE (pick list only for now)
    public sealed record StoreRequest(string Code, string Name, string Status);

    [HttpPost("stores")]
    public IActionResult AddStore([FromBody] StoreRequest req) => SaveStore(0, req);

    [HttpPut("stores/{id:int}")]
    public IActionResult EditStore(int id, [FromBody] StoreRequest req) => SaveStore(id, req);

    private IActionResult SaveStore(int id, StoreRequest q)
    {
        if (Guard(Can(id)) is { } g) return g;
        var old = id == 0 ? null : _svc.Store(id);
        if (id != 0 && old == null) return Fail("ไม่พบ LINE-SIDE STORE นี้ (อาจถูกลบไปแล้ว)");
        var r = new StoreRow { Code = old?.Code ?? Up(q?.Code, 60) ?? "", Name = Text(q?.Name, 200), Status = (q?.Status ?? "ACTIVE").ToUpperInvariant() };
        if (CodeErr("LINE-SIDE STORE CODE", r.Code) is { } e) return Fail(e);
        if (!Status.Contains(r.Status)) return Fail("STATUS ไม่ถูกต้อง");
        if (id == 0 && _svc.Exists("LineSideStores", "StoreCode", r.Code, "StoreID", 0)) return Fail($"มี LINE-SIDE STORE CODE \"{r.Code}\" อยู่แล้ว");
        try
        {
            _svc.SaveStore(id, r, Uid);
            string detail = old == null ? $"{r.Code} | {r.Name ?? "-"} | {r.Status}" : $"{r.Code} | " + Changes(("Name", old.Name, r.Name), ("Status", old.Status, r.Status));
            LogService.WriteLog(Uid, old == null ? "MASTER_LSSTORE_ADD" : "MASTER_LSSTORE_EDIT", "LINE-SIDE STORE: " + detail, r.Code);
            return Ok(new { message = old == null ? $"เพิ่ม LINE-SIDE STORE {r.Code} แล้ว" : $"บันทึก LINE-SIDE STORE {r.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("stores/{id:int}")]
    public IActionResult DeleteStore(int id)
    {
        if (Guard(Me?.CanDeleteMasterData == true) is { } g) return g;
        var old = _svc.Store(id);
        if (old == null) return Fail("ไม่พบ LINE-SIDE STORE นี้ (อาจถูกลบไปแล้ว)");
        if (old.Zones > 0) return Fail($"ลบไม่ได้: LINE-SIDE STORE {old.Code} ถูกใช้อยู่ใน {old.Zones} ZONE\nกรุณาเปลี่ยน LINE-SIDE STORE ของ ZONE เหล่านั้นก่อน");
        try
        {
            _svc.Delete("LineSideStores", "StoreID", id);
            LogService.WriteLog(Uid, "MASTER_LSSTORE_DELETE", $"LINE-SIDE STORE: {old.Code} | {old.Name ?? "-"}", old.Code);
            return Ok(new { message = $"ลบ LINE-SIDE STORE {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }
}
