using System.Globalization;
using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 🏭 MANUFACTURING › KANBAN (SystemID MFG_KANBAN, schema Kanban - scripts 72 + 73)
//   GET  /api/kanban                      : everything the 4 pages need (Dashboard · Kanban Management · สะสม / รับยอด · สั่งผลิต) in one call
//   Kanban Management: kanbans (ADD / EDIT / DEL) + flow (EDIT) · สะสมยอด: scans (ADD / DEL) + rule target / auto (EDIT)
//   รับยอด: receipts (ADD = receive · DEL = return) · สั่งผลิต: orders (ADD / DEL) · every write -> Activity Log · screens refresh live ("kanban")
[Route("api/kanban")]
public sealed class KanbanController : AppController
{
    private readonly KanbanService _svc = new();
    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง KANBAN (database/nexus/72_Mfg_Kanban.sql + 73_Mfg_Kanban_Part.sql)");
    private IActionResult Guard(bool ok) => !ok ? Deny() : !DbSchema.HasKanban ? NotReady() : null;
    private static string Text(string s, int max) { s = Regex.Replace((s ?? "").Trim(), @"\s+", " "); return s.Length == 0 ? null : s.Length > max ? s[..max] : s; }
    private static string Up(string s, int max) => Text(s, max)?.ToUpperInvariant();

    [HttpGet]
    public IActionResult All()
    {
        if (Guard(Me?.CanViewKanban == true) is { } g) return g;
        try
        {
            return Ok(new
            {
                can = new { add = Me.CanAddKanban, edit = Me.CanEditKanban, delete = Me.CanDeleteKanban },
                kanbans = _svc.Kanbans(),
                orders = _svc.Orders(),
                receipts = _svc.Receipts(),
                scans = _svc.Scans(),
                options = _svc.Options(),
                stuck = _svc.Stuck(),
            });
        }
        catch (Exception ex) { return Fail(ex, "โหลดข้อมูล KANBAN ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- KANBAN MANAGEMENT
    // part list for the form (PART A / PART NO / Product Name typeahead · filtered by the picked customer on screen)
    [HttpGet("parts")]
    public IActionResult Parts()
    {
        if (Guard(Me?.CanViewKanban == true) is { } g) return g;
        try { return Ok(_svc.Parts()); }
        catch (Exception ex) { return Fail(ex, "โหลดรายการ PART ไม่สำเร็จ"); }
    }

    // PartId = Part Information row · PART A / PART NO / Product Name are copied from it on the server (screen values are not trusted)
    public sealed record KanbanRequest(string Code, int? PartId, string Customer, int PerBox, int OrderQty, string Zone, string Note);

    [HttpPost("kanbans")]
    public IActionResult Add([FromBody] KanbanRequest req) => Save(0, req);

    [HttpPut("kanbans/{id:int}")]
    public IActionResult Edit(int id, [FromBody] KanbanRequest req) => Save(id, req);

    private IActionResult Save(int id, KanbanRequest q)
    {
        if (Guard(id == 0 ? Me?.CanAddKanban == true : Me?.CanEditKanban == true) is { } g) return g;
        var r = new KanbanRow { Code = Up(q?.Code, 60) ?? "", Customer = Up(q?.Customer, 50), PerBox = q?.PerBox ?? 0, OrderQty = q?.OrderQty ?? 0, Zone = Up(q?.Zone, 50), Note = Text(q?.Note, 300) };
        if (r.Code.Length == 0) return Fail("กรุณากรอกรหัสงาน (KANBAN CODE)");
        if (!MasterDataController.CodeOk.IsMatch(r.Code)) return Fail($"รหัสงาน \"{r.Code}\" ใช้ไม่ได้\nใช้ได้เฉพาะ A-Z 0-9 เว้นวรรค - _ . / & ( ) ยาวไม่เกิน 50 ตัว");
        if (q?.PartId is not int partId) return Fail("กรุณาเลือก PART A / PART NO / PRODUCT NAME");
        var part = _svc.Part(partId);
        if (part == null) return Fail("ไม่พบ PART นี้ใน Part Information (อาจถูกปิดใช้งาน) กรุณาเลือกใหม่");
        (r.PartId, r.PartA, r.PartNo, r.Name) = (partId, Text(part.PartA, 50), Text(part.PartNo, 100), Text(part.Name, 200) ?? Text(part.PartA, 200));
        r.Customer ??= Up(part.Customer, 50);
        if (r.PerBox is < 1 or > 1_000_000) return Fail("จำนวนชิ้นงานต่อกล่อง ต้องเป็นจำนวนเต็ม 1 - 1,000,000");
        if (r.OrderQty is < 1 or > 100_000_000) return Fail("จำนวนที่สั่งผลิต ต้องเป็นจำนวนเต็มมากกว่า 0");
        var old = id == 0 ? null : _svc.Kanban(id);
        if (id != 0 && old == null) return Fail("ไม่พบ Kanban นี้ (อาจถูกลบไปแล้ว)");
        if (r.Zone != old?.Zone && !ZoneService.ZoneExists(r.Zone)) return Fail($"ไม่พบ ZONE \"{r.Zone}\" ใน Master Data › Zone & Workstation Information");
        if (_svc.CodeExists(r.Code, id)) return Fail($"มีรหัสงาน \"{r.Code}\" อยู่แล้ว");
        try
        {
            int newId = _svc.Save(id, r, Uid);
            string now = $"{r.Code} | {r.PartA} | {r.PartNo ?? "-"} | {r.Name} | {r.Customer ?? "-"} | PER BOX {r.PerBox} | QTY {r.OrderQty} | ZONE {r.Zone ?? "-"}";
            LogService.WriteLog(Uid, old == null ? "KANBAN_ADD" : "KANBAN_EDIT",
                old == null ? "Kanban: " + now : $"Kanban: {old.Code} | {old.PartA ?? "-"} | {old.PartNo ?? "-"} | {old.Name} | {old.Customer ?? "-"} | PER BOX {old.PerBox} | QTY {old.OrderQty} | ZONE {old.Zone ?? "-"} > {now}", r.Code);
            return Ok(new { id = newId, message = old == null ? $"บันทึก Kanban {r.Code} แล้ว · ตั้งค่า FLOW ต่อได้เลย" : $"บันทึก Kanban {r.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("kanbans/{id:int}")]
    public IActionResult Delete(int id)
    {
        if (Guard(Me?.CanDeleteKanban == true) is { } g) return g;
        var old = _svc.Kanban(id);
        if (old == null) return Fail("ไม่พบ Kanban นี้ (อาจถูกลบไปแล้ว)");
        if (old.Used > 0) return Fail($"ลบไม่ได้: Kanban {old.Code} มีประวัติการใช้งานแล้ว (สะสมยอด / รับยอด / สั่งผลิต)");
        try
        {
            _svc.Delete(id);
            LogService.WriteLog(Uid, "KANBAN_DELETE", $"Kanban: {old.Code} | {old.Name}", old.Code);
            return Ok(new { message = $"ลบ Kanban {old.Code} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    public sealed record StepDto(string Zone, string Point);
    public sealed record FlowRequest(List<StepDto> Steps);

    private static (List<KStep> Steps, string Error) CleanSteps(List<StepDto> src)
    {
        var steps = (src ?? new()).Select(s => new KStep(Up(s?.Zone, 50), Text(s?.Point, 100))).ToList();
        if (steps.Count == 0) return (steps, "กรุณากำหนดจุดใน FLOW อย่างน้อย 1 จุด");
        if (steps.Count > 20) return (steps, "FLOW กำหนดได้ไม่เกิน 20 จุด");
        int bad = steps.FindIndex(s => s.Zone == null || s.Point == null);
        if (bad >= 0) return (steps, $"จุดที่ {bad + 1}: กรุณาเลือก ZONE และสถานีงาน / เครื่องจักรให้ครบ");
        bad = steps.FindIndex(s => !ZoneService.ZoneExists(s.Zone));
        return bad >= 0 ? (steps, $"จุดที่ {bad + 1}: ไม่พบ ZONE \"{steps[bad].Zone}\" ใน Master Data › Zone & Workstation Information") : (steps, null);
    }

    [HttpPut("kanbans/{id:int}/flow")]
    public IActionResult SetFlow(int id, [FromBody] FlowRequest req)
    {
        if (Guard(Me?.CanEditKanban == true || Me?.CanAddKanban == true) is { } g) return g;   // ADD can finish the flow of a Kanban just created
        var old = _svc.Kanban(id);
        if (old == null) return Fail("ไม่พบ Kanban นี้ (อาจถูกลบไปแล้ว)");
        if (old.Steps.Count > 0 && Me.CanEditKanban != true) return Deny("แก้ไข FLOW ที่ตั้งไว้แล้ว ต้องมีสิทธิ์ EDIT");
        var (steps, err) = CleanSteps(req?.Steps);
        if (err != null) return Fail(err);
        try
        {
            _svc.SetFlow(id, steps, Uid);
            LogService.WriteLog(Uid, "KANBAN_FLOW", $"Kanban: {old.Code} | {(old.Steps.Count == 0 ? "-" : string.Join(" > ", old.Steps.Select(s => s.Point)))} > {string.Join(" > ", steps.Select(s => $"{s.Point} ({s.Zone})"))}", old.Code);
            return Ok(new { message = $"บันทึก FLOW ของ {old.Code} แล้ว ({steps.Count} จุด) · พร้อมใช้งาน" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึก FLOW ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- สะสมยอด / รับยอด
    public sealed record RuleRequest(int Target, bool Auto);

    [HttpPut("kanbans/{id:int}/rule")]
    public IActionResult SetRule(int id, [FromBody] RuleRequest req)
    {
        if (Guard(Me?.CanEditKanban == true) is { } g) return g;
        var k = _svc.Kanban(id);
        if (k == null) return Fail("ไม่พบ Kanban นี้ (อาจถูกลบไปแล้ว)");
        int target = req?.Target ?? 0;
        if (target is < 0 or > 100_000_000) return Fail("ยอดที่กำหนดต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
        try
        {
            int got = _svc.SetRule(id, target, req?.Auto == true, Uid);
            LogService.WriteLog(Uid, "KANBAN_RULE", $"Kanban: {k.Code} | Target {k.Target} > {target} | Auto {(k.Auto ? "ON" : "OFF")} > {(req?.Auto == true ? "ON" : "OFF")}" + (got > 0 ? $" | Auto received {got}" : ""), k.Code);
            return Ok(new { message = $"บันทึกยอดที่กำหนดของ {k.Code} แล้ว" + (got > 0 ? $"\nAUTO รับยอด {got:N0} ชิ้นไปรอสั่งผลิตแล้ว" : "") });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    public sealed record ScanRequest(int KanbanId, int Qty, string Ref);

    [HttpPost("scans")]
    public IActionResult AddScan([FromBody] ScanRequest req)
    {
        if (Guard(Me?.CanAddKanban == true) is { } g) return g;
        var k = _svc.Kanban(req?.KanbanId ?? 0);
        if (k == null) return Fail("กรุณาเลือก Kanban");
        if (req.Qty is < 1 or > 100_000_000) return Fail("จำนวนต้องเป็นจำนวนเต็มมากกว่า 0");
        string refNo = Up(req.Ref, 50);
        try
        {
            int got = _svc.AddScan(k.Id, req.Qty, refNo, Uid);
            LogService.WriteLog(Uid, "KANBAN_SCAN_ADD", $"Kanban: {k.Code} | +{req.Qty} | Ref {refNo ?? "-"}" + (got > 0 ? $" | Auto received {got}" : ""), k.Code);
            return Ok(new { message = $"เพิ่มยอดสะสม {k.Code} +{req.Qty:N0} ชิ้นแล้ว" + (got > 0 ? $"\nAUTO รับยอด {got:N0} ชิ้นไปรอสั่งผลิตแล้ว" : "") });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("scans/{id:int}")]
    public IActionResult DeleteScan(int id)
    {
        if (Guard(Me?.CanDeleteKanban == true) is { } g) return g;
        try
        {
            var s = _svc.DeleteScan(id);
            var k = _svc.Kanban(s.KanbanId);
            LogService.WriteLog(Uid, "KANBAN_SCAN_DELETE", $"Kanban: {k?.Code} | -{s.Qty} | Ref {s.Ref ?? "-"}", k?.Code ?? "");
            return Ok(new { message = $"ลบยอดสะสม {s.Qty:N0} ชิ้นแล้ว" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    public sealed record ReceiveRequest(int KanbanId, int Qty);

    [HttpPost("receipts")]
    public IActionResult Receive([FromBody] ReceiveRequest req)
    {
        if (Guard(Me?.CanAddKanban == true) is { } g) return g;
        var k = _svc.Kanban(req?.KanbanId ?? 0);
        if (k == null) return Fail("ไม่พบ Kanban นี้ (อาจถูกลบไปแล้ว)");
        try
        {
            _svc.Receive(k.Id, req.Qty, Uid);
            LogService.WriteLog(Uid, "KANBAN_RECEIVE", $"Kanban: {k.Code} | Qty {req.Qty} | Accumulated before {k.Acc}", k.Code);
            return Ok(new { message = $"รับยอด {k.Code} {req.Qty:N0} ชิ้นไปรอสั่งผลิตแล้ว" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "รับยอดไม่สำเร็จ"); }
    }

    [HttpDelete("receipts/{id:int}")]
    public IActionResult ReturnReceipt(int id)
    {
        if (Guard(Me?.CanDeleteKanban == true) is { } g) return g;
        try
        {
            var r = _svc.ReturnReceipt(id);
            LogService.WriteLog(Uid, "KANBAN_RECEIVE_RETURN", $"Kanban: {r.Code} | Qty {r.Qty} back to accumulated", r.Code);
            return Ok(new { message = $"คืนยอด {r.Code} {r.Qty:N0} ชิ้นกลับไปที่ยอดสะสมแล้ว" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "คืนยอดไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- สั่งผลิต
    public sealed record OrderRequest(int KanbanId, int Qty, string FlowMode, string PlannedStart, List<StepDto> Steps, int? ReceiptId);

    [HttpPost("orders")]
    public IActionResult AddOrder([FromBody] OrderRequest req)
    {
        if (Guard(Me?.CanAddKanban == true) is { } g) return g;
        var k = _svc.Kanban(req?.KanbanId ?? 0);
        if (k == null) return Fail("กรุณาเลือก Kanban");
        if (req.Qty is < 1 or > 100_000_000) return Fail("กรุณากรอกจำนวนที่สั่งผลิต (จำนวนเต็มมากกว่า 0)");
        string mode = (req.FlowMode ?? "STANDARD").ToUpperInvariant();
        if (mode is not ("STANDARD" or "TEMP")) return Fail("รูปแบบ FLOW ไม่ถูกต้อง");
        List<KStep> steps;
        if (mode == "STANDARD")
        {
            if (k.Steps.Count == 0) return Fail($"Kanban {k.Code} ยังไม่ได้ตั้งค่า FLOW (ยังไม่พร้อมใช้งาน)");
            steps = k.Steps;
        }
        else
        {
            string err;
            (steps, err) = CleanSteps(req.Steps);
            if (err != null) return Fail(err);
        }
        int cards = (req.Qty + k.PerBox - 1) / k.PerBox;
        if (cards > KanbanService.MaxCards) return Fail($"ใบ Kanban เกิน {KanbanService.MaxCards:N0} ใบต่อการสั่งหนึ่งครั้ง ({cards:N0} ใบ) กรุณาแบ่งสั่ง");
        DateTime? planned = DateTime.TryParse(req.PlannedStart, CultureInfo.InvariantCulture, DateTimeStyles.None, out var p) ? p : null;
        try
        {
            int id = _svc.AddOrder(k.Id, req.Qty, k.PerBox, mode, planned, steps, req.ReceiptId, Uid);
            LogService.WriteLog(Uid, "KANBAN_ORDER_ADD", $"Order #{id} | {k.Code} | Qty {req.Qty} = {cards} cards | {mode} | {string.Join(" > ", steps.Select(s => s.Point))}" + (req.ReceiptId != null ? $" | Receipt #{req.ReceiptId}" : ""), k.Code);
            return Ok(new { id, message = $"สั่งผลิต {k.Code} แล้ว · {req.Qty:N0} ชิ้น = {cards:N0} ใบ Kanban" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "สั่งผลิตไม่สำเร็จ"); }
    }

    [HttpDelete("orders/{id:int}")]
    public IActionResult DeleteOrder(int id)
    {
        if (Guard(Me?.CanDeleteKanban == true) is { } g) return g;
        var o = _svc.Orders(1, id).FirstOrDefault();
        if (o == null) return Fail("ไม่พบใบสั่งผลิตนี้ (อาจถูกลบไปแล้ว)");
        try
        {
            _svc.DeleteOrder(id);
            LogService.WriteLog(Uid, "KANBAN_ORDER_DELETE", $"Order #{id} | {o.Code} | Qty {o.Qty} = {o.Cards} cards" + (o.ReceiptId != null ? $" | Receipt #{o.ReceiptId} back to WAITING" : ""), o.Code);
            return Ok(new { message = $"ลบใบสั่งผลิต #{id} ({o.Code}) แล้ว" + (o.ReceiptId != null ? "\nยอดที่รับไว้กลับไปรอสั่งผลิต" : "") });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }
}
