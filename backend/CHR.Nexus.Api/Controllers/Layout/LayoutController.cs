using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 📍 LAYOUT SETUP (User Management › SETUP › LAYOUT · Admin Level 1): ประเภทตำแหน่ง (RACK1) + ตำแหน่ง (3A 3B 3C) + รูปแบบข้อมูลใน QR + Export QR ตำแหน่ง
//   ทุกการเปลี่ยนแปลงลง Activity Log
//   ใช้งานที่ Multi-Scanner: คลังที่เปิดปุ่ม LAYOUT (User Management > PERMISSION > SCAN STOCKS) สแกน QR ตำแหน่งก่อน แล้วสแกนป้ายลูกค้า
[Route("api/layout")]
public sealed class LayoutController : AppController
{
    private readonly LayoutService _svc = new();
    private static readonly Regex Split = new(@"[\s,;]+", RegexOptions.Compiled);

    private bool Ready => DbSchema.HasLayout;
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง LAYOUT (database/nexus/20_Storage_Layout.sql)");
    private static string BadName(string v) => $"ชื่อ \"{v}\" ใช้ไม่ได้ - ใช้ได้เฉพาะ A-Z 0-9 - _ . / # (ไม่มีเว้นวรรค ยาวไม่เกิน 50 ตัว)";

    private object Payload()
    {
        var set = _svc.GetSettings();
        return new
        {
            ready = true,
            settings = new { fields = set.Fields, sep = set.Sep, set.UpdatedBy, set.UpdatedDate },
            types = _svc.GetTypes().Select(t => new
            {
                t.TypeId, t.TypeName, t.CreatedBy, t.CreatedAt,
                locations = t.Locations.Select(l => new { l.LocId, l.LocName, l.CreatedBy, l.CreatedAt, qr = LayoutService.QrText(set, t.TypeName, l.LocName), label = LayoutService.LabelText(t.TypeName, l.LocName) })
            }),
            can = new { add = Me.CanAddLayout, edit = Me.CanEditLayout, delete = Me.CanDeleteLayout }
        };
    }

    // ดูรายการตำแหน่ง + EXPORT QR: LAYOUT SETUP (Admin) หรือ Product Control (Inventory Registration › EXCEL · QR › EXPORT QR CODE LAYOUT) · แก้ไขได้เฉพาะ LAYOUT SETUP
    private bool CanSeeQr => Me?.CanViewLayout == true || Me?.CanViewProductControl == true;

    private void Changed() => LiveBus.Publish("layout");

    [HttpGet]
    public IActionResult Get()
    {
        if (!CanSeeQr) return Deny();
        if (!Ready) return Ok(new { ready = false });
        return Ok(Payload());
    }

    public sealed record SettingsRequest(List<string> Fields, string Sep);

    [HttpPost("settings")]
    public IActionResult SaveSettings([FromBody] SettingsRequest req)
    {
        if (Me?.CanEditLayout != true) return Deny();
        if (!Ready) return NotReady();
        try
        {
            var before = _svc.GetSettings();
            var fields = LayoutService.CleanFields(req?.Fields);
            string sep = LayoutService.CleanSep(req?.Sep);
            _svc.SaveSettings(fields, sep, Uid);
            LogService.WriteLog(Uid, "LAYOUT_SETTINGS", $"QR format: {string.Join("+", before.Fields)} [{before.Sep}] -> {string.Join("+", fields)} [{sep}]", "LAYOUT");
            Changed();
            return Ok(Payload());
        }
        catch (Exception ex) { return Fail(ex, "บันทึกรูปแบบ QR ไม่สำเร็จ"); }
    }

    public sealed record NameRequest(string Name);

    [HttpPost("types")]
    public IActionResult AddType([FromBody] NameRequest req)
    {
        if (Me?.CanAddLayout != true) return Deny();
        if (!Ready) return NotReady();
        string name = LayoutService.CleanName(req?.Name);
        if (!LayoutService.ValidName(name)) return Fail(BadName(name));
        if (_svc.TypeExists(name)) return Fail($"มีประเภท {name} อยู่แล้ว");
        try
        {
            int id = _svc.AddType(name, Uid);
            LogService.WriteLog(Uid, "LAYOUT_ADD", $"Type: {name}", name);
            Changed();
            return Ok(new { typeId = id, data = Payload() });
        }
        catch (Exception ex) { return Fail(ex, "เพิ่มประเภทไม่สำเร็จ"); }
    }

    [HttpPut("types/{id:int}")]
    public IActionResult RenameType(int id, [FromBody] NameRequest req)
    {
        if (Me?.CanEditLayout != true) return Deny();
        if (!Ready) return NotReady();
        var t = _svc.GetType(id);
        if (t == null) return Fail("ไม่พบประเภทนี้");
        string name = LayoutService.CleanName(req?.Name);
        if (!LayoutService.ValidName(name)) return Fail(BadName(name));
        if (_svc.TypeExists(name, id)) return Fail($"มีประเภท {name} อยู่แล้ว");
        try
        {
            _svc.RenameType(id, name);
            LogService.WriteLog(Uid, "LAYOUT_EDIT", $"Type: {t.TypeName} -> {name} (QR ตำแหน่งที่พิมพ์ไปแล้วต้องพิมพ์ใหม่ถ้า QR มี TYPE)", name);
            Changed();
            return Ok(Payload());
        }
        catch (Exception ex) { return Fail(ex, "แก้ชื่อประเภทไม่สำเร็จ"); }
    }

    [HttpDelete("types/{id:int}")]
    public IActionResult DeleteType(int id)
    {
        if (Me?.CanDeleteLayout != true) return Deny();
        if (!Ready) return NotReady();
        var t = _svc.GetType(id);
        if (t == null) return Fail("ไม่พบประเภทนี้");
        try
        {
            int n = _svc.DeleteType(id);
            LogService.WriteLog(Uid, "LAYOUT_DELETE", $"Type: {t.TypeName} (+ {n} locations)", t.TypeName);
            Changed();
            return Ok(Payload());
        }
        catch (Exception ex) { return Fail(ex, "ลบประเภทไม่สำเร็จ"); }
    }

    public sealed record AddLocationsRequest(string Text);

    // พิมพ์หลายตำแหน่งในช่องเดียว คั่นด้วยเว้นวรรค / , / ; เช่น "3A 3B 3C" -> บันทึกทันที
    [HttpPost("types/{id:int}/locations")]
    public IActionResult AddLocations(int id, [FromBody] AddLocationsRequest req)
    {
        if (Me?.CanAddLayout != true) return Deny();
        if (!Ready) return NotReady();
        var t = _svc.GetType(id);
        if (t == null) return Fail("ไม่พบประเภทนี้");
        var names = Split.Split(req?.Text ?? "").Select(LayoutService.CleanName).Where(n => n.Length > 0).Distinct().ToList();
        if (names.Count == 0) return Fail("กรุณาพิมพ์ชื่อตำแหน่ง เช่น 3A 3B 3C");
        if (names.Count > 500) return Fail("เพิ่มได้ครั้งละไม่เกิน 500 ตำแหน่ง");
        var bad = names.FirstOrDefault(n => !LayoutService.ValidName(n));
        if (bad != null) return Fail(BadName(bad));
        try
        {
            var added = _svc.AddLocations(id, names, Uid);
            if (added.Count > 0)
            {
                LogService.WriteLog(Uid, "LAYOUT_ADD", $"Type: {t.TypeName} | Locations: {string.Join(", ", added)}", t.TypeName);
                Changed();
            }
            var skipped = names.Except(added, StringComparer.OrdinalIgnoreCase).ToList();
            return Ok(new { added, skipped, data = Payload() });
        }
        catch (Exception ex) { return Fail(ex, "เพิ่มตำแหน่งไม่สำเร็จ"); }
    }

    [HttpPut("locations/{id:int}")]
    public IActionResult RenameLocation(int id, [FromBody] NameRequest req)
    {
        if (Me?.CanEditLayout != true) return Deny();
        if (!Ready) return NotReady();
        var l = _svc.GetLocation(id);
        if (l == null) return Fail("ไม่พบตำแหน่งนี้");
        string name = LayoutService.CleanName(req?.Name);
        if (!LayoutService.ValidName(name)) return Fail(BadName(name));
        if (_svc.LocationExists(l.TypeId, name, id)) return Fail($"มีตำแหน่ง {l.TypeName} : {name} อยู่แล้ว");
        try
        {
            _svc.RenameLocation(id, name);
            LogService.WriteLog(Uid, "LAYOUT_EDIT", $"Location: {l.TypeName} : {l.LocName} -> {name}", l.TypeName);
            Changed();
            return Ok(Payload());
        }
        catch (Exception ex) { return Fail(ex, "แก้ชื่อตำแหน่งไม่สำเร็จ"); }
    }

    public sealed record IdsRequest(List<int> Ids);

    [HttpPost("locations/delete")]
    public IActionResult DeleteLocations([FromBody] IdsRequest req)
    {
        if (Me?.CanDeleteLayout != true) return Deny();
        if (!Ready) return NotReady();
        var all = _svc.AllLocations();
        var rows = all.Where(l => req?.Ids?.Contains(l.LocId) == true).ToList();
        if (rows.Count == 0) return Fail("กรุณาเลือกตำแหน่งที่จะลบ");
        try
        {
            int n = _svc.DeleteLocations(rows.Select(r => r.LocId));
            LogService.WriteLog(Uid, "LAYOUT_DELETE", $"Locations ({n}): {string.Join(", ", rows.Select(r => LayoutService.LabelText(r.TypeName, r.LocName)))}", "LAYOUT");
            Changed();
            return Ok(Payload());
        }
        catch (Exception ex) { return Fail(ex, "ลบตำแหน่งไม่สำเร็จ"); }
    }

    public sealed record QrLogRequest(List<int> Ids, string Mode);

    [HttpPost("qr-log")]
    public IActionResult QrLog([FromBody] QrLogRequest req)
    {
        if (!CanSeeQr) return Deny();
        if (!Ready) return NotReady();
        var rows = _svc.AllLocations().Where(l => req?.Ids?.Contains(l.LocId) == true).ToList();
        LogService.WriteLog(Uid, "LAYOUT_QR_EXPORT", $"{(req?.Mode ?? "PDF").ToUpperInvariant()} | {rows.Count} QR: {string.Join(", ", rows.Take(60).Select(r => LayoutService.LabelText(r.TypeName, r.LocName)))}{(rows.Count > 60 ? " …" : "")}", "LAYOUT");
        return Ok(new { ok = true });
    }

    // ▣ EXPORT QR (PDF) แบบเดียวกับ Product Control › EXPORT SELECTED: A4 · 4 ดวงต่อแถว · QR + "RACK1 : 3A" ตัวหนาใต้ QR
    [HttpPost("qr-pdf")]
    public IActionResult QrPdf([FromBody] QrLogRequest req)
    {
        if (!CanSeeQr) return Deny();
        if (!Ready) return NotReady();
        var ids = req?.Ids ?? new();
        var rows = _svc.AllLocations().Where(l => ids.Contains(l.LocId)).OrderBy(l => ids.IndexOf(l.LocId)).ToList();
        if (rows.Count == 0) return Fail("กรุณาเลือกตำแหน่งที่ต้องการ Export อย่างน้อย 1 ตำแหน่ง");
        try
        {
            var set = _svc.GetSettings();
            string pdf = new ExportService().GenerateQrListPdf(
                rows.Select(r => (LayoutService.QrText(set, r.TypeName, r.LocName), (IList<string>)new[] { LayoutService.LabelText(r.TypeName, r.LocName) })),
                ImportTemplateService.Systems.Product, "LAYOUT_QR");
            LogService.WriteLog(Uid, "LAYOUT_QR_EXPORT", $"PDF | {rows.Count} QR: {string.Join(", ", rows.Take(60).Select(r => LayoutService.LabelText(r.TypeName, r.LocName)))}{(rows.Count > 60 ? " …" : "")}", "LAYOUT");
            return Download(pdf, "application/pdf");
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }
}
