using CHR.Nexus.Api.Web;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// WORK ORDER FOLLOW (SystemID PC_WOF): monthly follow sheet per customer + work order
//   view = PC_WOF VIEW · create = ADD · edit (fields / items / cells) = owner, editors or Level 1 and sheet not locked
//   sign flow = PREPARE / CHECK / APPROVE (requested user signs with their stored signature) · APPROVE signed = locked · editing clears CHECK
[Route("api/pcwof")]
public sealed class WorkOrderFollowController : AppController
{
    private readonly WorkOrderFollowService _svc = new();

    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง WORK ORDER FOLLOW (database/nexus/61_PC_WorkOrderFollow.sql)");
    private bool IsAdmin => Me?.UserLevel == 1;
    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    private static string Clip(string s, int n) { s = (s ?? "").Trim(); return s.Length > n ? s[..n] : s; }

    private bool IsOwner(WoSheet s) => Same(s.OwnerUserId, Uid);
    private bool CanEdit(WoSheet s) => IsAdmin || IsOwner(s) || _svc.IsEditor(s.SheetId, Uid);

    // null = allowed to edit, else the error result
    private IActionResult EditGuard(WoSheet s)
    {
        if (s == null) return Fail("ไม่พบเอกสารนี้");
        if (!CanEdit(s)) return Deny("คุณไม่มีสิทธิ์แก้ไขเอกสารนี้ (เฉพาะเจ้าของ / ผู้แก้ไขที่ถูกเพิ่ม)");
        if (_svc.IsLocked(s.SheetId)) return Fail("เอกสารถูกอนุมัติ (APPROVE) แล้ว แก้ไขไม่ได้");
        return null;
    }

    // after any edit: touch + clear CHECK signature (logged)
    private void Edited(WoSheet s)
    {
        if (_svc.Touch(s.SheetId)) LogService.WriteLog(Uid, "PC_WOF_CHECK_CLEARED", $"Sheet #{s.SheetId} {s.CustomerName} / {s.WorkOrderNo} {s.MonthStart:yyyy-MM} | CHECK signature cleared by edit", s.WorkOrderNo);
    }

    private object SheetDto(WoSheet s, Dictionary<string, string> names, List<string> editors, int items, List<WoSign> signs) => new
    {
        sheetId = s.SheetId, month = s.MonthStart.ToString("yyyy-MM"), s.CustomerCode, s.CustomerName, s.WorkOrderNo,
        owner = new { userId = s.OwnerUserId, name = names.GetValueOrDefault(s.OwnerUserId, s.OwnerUserId) },
        editors = editors.Select(u => new { userId = u, name = names.GetValueOrDefault(u, u) }),
        items,
        signs = signs.Select(g => new { g.Role, g.RequestedTo, g.SignedBy, g.SignedAt })
    };

    private List<object> Dtos(List<WoSheet> sheets)
    {
        var ids = sheets.Select(s => s.SheetId).ToList();
        var ed = _svc.Editors(ids); var cnt = _svc.ItemCounts(ids); var sg = _svc.Signs(ids);
        var names = _svc.Names(sheets.Select(s => s.OwnerUserId).Concat(ed.Values.SelectMany(x => x)));
        return sheets.Select(s => SheetDto(s, names, ed.GetValueOrDefault(s.SheetId) ?? new(), cnt.GetValueOrDefault(s.SheetId), sg.Where(g => g.SheetId == s.SheetId).ToList())).ToList();
    }

    [HttpGet("meta")]
    public IActionResult Meta()
    {
        if (Me == null) return Deny();
        return Ok(new { ready = DbSchema.HasPcWof, can = new { view = Me.CanViewPcWof, add = Me.CanAddPcWof, approve = Me.CanApprovePcWof }, me = new { userId = Uid, name = Me.UserName } });
    }

    [HttpGet("sheets")]
    public IActionResult Sheets([FromQuery] string month)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        return Ok(Dtos(_svc.Sheets(m)));
    }

    public sealed record SheetCreate(string Month, string CustomerCode, string CustomerName, string WorkOrderNo);

    [HttpPost("sheets")]
    public IActionResult Create([FromBody] SheetCreate req)
    {
        if (Me?.CanAddPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (req == null || !WorkOrderFollowRules.TryMonth(req.Month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        string code = Clip(req.CustomerCode, 50), name = Clip(req.CustomerName, 200), wo = Clip(req.WorkOrderNo, 100);
        if (name.Length == 0 || wo.Length == 0) return Fail("กรุณาระบุลูกค้าและ Work Order");
        try
        {
            int id = _svc.Create(m, code, name, wo, Uid);
            LogService.WriteLog(Uid, "PC_WOF_CREATE", $"Sheet #{id} | {name} / {wo} | {m:yyyy-MM}", wo);
            return Ok(new { sheetId = id });
        }
        catch (Exception ex) { return Fail(ex, "สร้างเอกสารไม่สำเร็จ"); }
    }

    public sealed record SheetUpdate(string CustomerCode, string CustomerName, string WorkOrderNo, List<string> Editors);

    [HttpPut("sheets/{id:int}")]
    public IActionResult Update(int id, [FromBody] SheetUpdate req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (s == null) return Fail("ไม่พบเอกสารนี้");
        if (!IsAdmin && !IsOwner(s)) return Deny("เฉพาะเจ้าของเอกสารเท่านั้นที่แก้ไขข้อมูลเอกสาร / ผู้แก้ไขได้");
        if (_svc.IsLocked(id)) return Fail("เอกสารถูกอนุมัติ (APPROVE) แล้ว แก้ไขไม่ได้");
        string code = Clip(req?.CustomerCode, 50), name = Clip(req?.CustomerName, 200), wo = Clip(req?.WorkOrderNo, 100);
        if (name.Length == 0 || wo.Length == 0) return Fail("กรุณาระบุลูกค้าและ Work Order");
        var editors = (req.Editors ?? new()).Select(u => (u ?? "").Trim()).Where(u => u.Length > 0 && !Same(u, s.OwnerUserId)).Distinct(StringComparer.OrdinalIgnoreCase).Take(50).ToList();
        try
        {
            var bad = editors.Where(u => !_svc.UserExists(u)).ToList();
            if (bad.Count > 0) return Fail("ไม่พบผู้ใช้: " + string.Join(", ", bad));
            _svc.Update(id, code, name, wo, editors);
            LogService.WriteLog(Uid, "PC_WOF_UPDATE", $"Sheet #{id} | {name} / {wo} | Editors: {string.Join(", ", editors)}", wo);
            Edited(s);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("sheets/{id:int}")]
    public IActionResult Delete(int id)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (s == null) return Fail("ไม่พบเอกสารนี้");
        if (!IsAdmin && !IsOwner(s)) return Deny("เฉพาะเจ้าของเอกสารเท่านั้นที่ลบได้");
        if (!IsAdmin && _svc.IsLocked(id)) return Fail("เอกสารถูกอนุมัติ (APPROVE) แล้ว ลบได้เฉพาะ Admin");
        try
        {
            _svc.Delete(id);
            LogService.WriteLog(Uid, "PC_WOF_DELETE", $"Sheet #{id} | {s.CustomerName} / {s.WorkOrderNo} | {s.MonthStart:yyyy-MM}", s.WorkOrderNo);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    [HttpGet("sheets/{id:int}")]
    public IActionResult Get(int id)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (s == null) return Fail("ไม่พบเอกสารนี้");
        var cells = _svc.Cells(id);
        var items = _svc.Items(id).Select(i => new
        {
            i.ItemId, i.SortNo, i.PartId, i.IntCode, i.PartName, i.PartNo, i.Material, i.PcsPerBox, i.BarColor, i.Remark,
            cells = cells.GetValueOrDefault(i.ItemId) ?? new()
        }).ToList();
        return Ok(new { sheet = Dtos(new() { s })[0], canEdit = CanEdit(s) && !_svc.IsLocked(id), items });
    }

    public sealed record ItemAdd(int PartId, string IntCode, string BarColor, string Remark);

    [HttpPost("sheets/{id:int}/items")]
    public IActionResult AddItem(int id, [FromBody] ItemAdd req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (EditGuard(s) is { } err) return err;
        var p = req == null ? null : _svc.GetPart(req.PartId);
        if (p == null) return Fail("ไม่พบสินค้านี้ใน Part Information");
        try
        {
            int itemId = _svc.AddItem(id, new WorkOrderFollowService.ItemRow
            {
                PartId = p.PartId, IntCode = Clip(req.IntCode, 50), PartName = Clip(p.Description, 200), PartNo = Clip(p.PartNumber, 100), Material = Clip(p.Category, 100),
                PcsPerBox = WorkOrderFollowRules.ParsePack(p.PackSize), BarColor = Clip(req.BarColor, 20), Remark = Clip(req.Remark, 500)
            });
            LogService.WriteLog(Uid, "PC_WOF_ITEM_ADD", $"Sheet #{id} | Item #{itemId} | {p.PartCode} {p.Description}", p.PartCode);
            Edited(s);
            return Ok(new { itemId });
        }
        catch (Exception ex) { return Fail(ex, "เพิ่มสินค้าไม่สำเร็จ"); }
    }

    public sealed record ItemUpdate(string IntCode, string BarColor, string Remark, int? PcsPerBox);

    [HttpPut("items/{itemId:int}")]
    public IActionResult UpdateItem(int itemId, [FromBody] ItemUpdate req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var it = _svc.GetItem(itemId, out int sid);
        if (it == null) return Fail("ไม่พบรายการนี้");
        var s = _svc.GetSheet(sid);
        if (EditGuard(s) is { } err) return err;
        if (req?.PcsPerBox is < 1 or > 10_000_000) return Fail("จำนวนชิ้น/กล่องไม่ถูกต้อง");
        try
        {
            it.IntCode = Clip(req?.IntCode, 50); it.BarColor = Clip(req?.BarColor, 20); it.Remark = Clip(req?.Remark, 500); it.PcsPerBox = req?.PcsPerBox;
            _svc.UpdateItem(it);
            LogService.WriteLog(Uid, "PC_WOF_ITEM_UPDATE", $"Sheet #{sid} | Item #{itemId} | {it.PartName} | Pcs/Box: {it.PcsPerBox}", it.IntCode);
            Edited(s);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("items/{itemId:int}")]
    public IActionResult DeleteItem(int itemId)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var it = _svc.GetItem(itemId, out int sid);
        if (it == null) return Fail("ไม่พบรายการนี้");
        var s = _svc.GetSheet(sid);
        if (EditGuard(s) is { } err) return err;
        try
        {
            _svc.DeleteItem(itemId);
            LogService.WriteLog(Uid, "PC_WOF_ITEM_DELETE", $"Sheet #{sid} | Item #{itemId} | {it.PartName}", it.IntCode);
            Edited(s);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    public sealed record OrderReq(List<int> Ids);

    [HttpPost("sheets/{id:int}/items/order")]
    public IActionResult Order(int id, [FromBody] OrderReq req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (EditGuard(s) is { } err) return err;
        var ids = (req?.Ids ?? new()).Distinct().ToList();
        var own = _svc.ItemIds(id).ToHashSet();
        if (ids.Any(i => !own.Contains(i))) return Fail("รายการไม่ตรงกับเอกสาร");
        try
        {
            _svc.Reorder(id, ids);
            LogService.WriteLog(Uid, "PC_WOF_ITEM_ORDER", $"Sheet #{id} | {ids.Count} items reordered", s.WorkOrderNo);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกลำดับไม่สำเร็จ"); }
    }

    public sealed record CellEdit(int ItemId, string RowKey, int Day, decimal? Qty);

    [HttpPut("sheets/{id:int}/cells")]
    public IActionResult Cells(int id, [FromBody] List<CellEdit> req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (EditGuard(s) is { } err) return err;
        if (req == null || req.Count == 0) return Ok(new { saved = 0 });
        if (req.Any(c => c == null)) return Fail("ข้อมูลช่องไม่ถูกต้อง");
        if (req.Count > 2000) return Fail("ส่งข้อมูลครั้งละไม่เกิน 2,000 ช่อง");
        int days = DateTime.DaysInMonth(s.MonthStart.Year, s.MonthStart.Month);
        var own = _svc.ItemIds(id).ToHashSet();
        foreach (var c in req)
        {
            if (!own.Contains(c.ItemId)) return Fail("รายการไม่ตรงกับเอกสาร");
            if (WorkOrderFollowRules.CheckCell(c.RowKey, c.Day, c.Qty, days) is { } msg) return Fail(msg);
        }
        try
        {
            _svc.SaveCells(req.Select(c => (c.ItemId, c.RowKey, c.Day, c.Qty)));
            LogService.WriteLog(Uid, "PC_WOF_CELLS", $"Sheet #{id} | {s.CustomerName} / {s.WorkOrderNo} | {req.Count} cells", s.WorkOrderNo);
            Edited(s);
            return Ok(new { saved = req.Count });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpGet("parts")]
    public IActionResult Parts([FromQuery] string q)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        return Ok(_svc.SearchParts(Clip(q, 100)).Select(p => new
        {
            p.PartId, p.PartA, p.PartCode, partNo = p.PartNumber, name = p.Description, p.PackSize, p.Customer
        }));
    }

    // ---------------------------------------------------------------- sign (MIN REPORT style: request -> chat + bell -> requested user signs)
    public sealed record SignReq(string Role, string UserId);

    [HttpPost("sheets/{id:int}/sign/request")]
    public IActionResult SignRequest(int id, [FromBody] SignReq req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (EditGuard(s) is { } err) return err;
        string role = (req?.Role ?? "").Trim().ToUpperInvariant(), to = (req?.UserId ?? "").Trim();
        if (!WorkOrderFollowRules.Roles.Contains(role)) return Fail("ช่องลายเซ็นไม่ถูกต้อง");
        if (to.Length == 0 || !_svc.UserExists(to)) return Fail("ไม่พบผู้ใช้ที่ต้องการขอลายเซ็น");
        if (!_svc.UserCan(to, role == "APPROVE")) return Fail(role == "APPROVE" ? "ผู้ใช้นี้ไม่มีสิทธิ์ APPROVE ของ WORK ORDER FOLLOW" : "ผู้ใช้นี้ไม่มีสิทธิ์ดู WORK ORDER FOLLOW");
        try
        {
            _svc.RequestSign(id, role, to, Uid);
            LogService.WriteLog(Uid, "PC_WOF_SIGN_REQUEST", $"Sheet #{id} | {s.CustomerName} / {s.WorkOrderNo} | {role} -> {to}", s.WorkOrderNo);
            Notify(s, role, to, Uid);
            return Ok(new { message = $"ส่งให้ {to} ลงลายเซ็นช่อง {role} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ส่งขอลายเซ็นไม่สำเร็จ"); }
    }

    public sealed record SignDo(string Role);

    [HttpPost("sheets/{id:int}/sign")]
    public IActionResult Sign(int id, [FromBody] SignDo req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var s = _svc.GetSheet(id);
        if (s == null) return Fail("ไม่พบเอกสารนี้");
        string role = (req?.Role ?? "").Trim().ToUpperInvariant();
        if (!WorkOrderFollowRules.Roles.Contains(role)) return Fail("ช่องลายเซ็นไม่ถูกต้อง");
        if (role == "APPROVE" && !Me.CanApprovePcWof) return Deny("คุณไม่มีสิทธิ์ APPROVE");
        if (role != "APPROVE" && _svc.IsLocked(id)) return Fail("เอกสารถูกอนุมัติ (APPROVE) แล้ว ลงลายเซ็นเพิ่มไม่ได้");
        if (!SignatureStore.Has(Uid)) return Fail("คุณยังไม่มีลายเซ็นในระบบ\nกรุณาบันทึกลายเซ็นก่อนที่ วงกลมโปรไฟล์ › ลายเซ็นของฉัน");
        try
        {
            if (!_svc.Sign(id, role, Uid)) return Fail("ช่องนี้ไม่ได้ขอให้คุณลงลายเซ็น หรือลงลายเซ็นไปแล้ว");
            LogService.WriteLog(Uid, "PC_WOF_SIGN", $"Sheet #{id} | {s.CustomerName} / {s.WorkOrderNo} | Signed: {role}", s.WorkOrderNo);
            NotifyDone(s, role, Uid);
            return Ok(new { message = $"ลงลายเซ็นช่อง {role} แล้ว" + (role == "APPROVE" ? "\nเอกสารถูกล็อก แก้ไขไม่ได้แล้ว" : "") });
        }
        catch (Exception ex) { return Fail(ex, "ลงลายเซ็นไม่สำเร็จ"); }
    }

    [HttpGet("sign/queue")]
    public IActionResult Queue()
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return Ok(Array.Empty<object>());
        var q = _svc.Queue(Uid);
        var names = _svc.Names(q.Select(r => r.RequestedBy));
        return Ok(q.Select(r => new
        {
            r.SheetId, r.Role, r.CustomerName, r.WorkOrderNo, month = r.MonthStart.ToString("yyyy-MM"),
            requestedBy = new { userId = r.RequestedBy, name = names.GetValueOrDefault(r.RequestedBy, r.RequestedBy) }, r.RequestedAt
        }));
    }

    // chat card to the requested user (bell shows it via /api/notifications) · chat failure never blocks the flow
    private static void Notify(WoSheet s, string role, string to, string from)
    {
        if (!DbSchema.HasChat || Same(to, from)) return;
        try
        {
            var chat = new ChatService();
            if (chat.UserExists(to))
                chat.Send(from, to, $"✍ WORK ORDER FOLLOW รอลงลายเซ็นช่อง {role}\n{s.CustomerName} · {s.WorkOrderNo} · {s.MonthStart:yyyy-MM}\n[[WOF:{s.SheetId}]]");
        }
        catch { /* chat unavailable: bell still shows it */ }
    }

    private static void NotifyDone(WoSheet s, string role, string from)
    {
        if (!DbSchema.HasChat || Same(s.OwnerUserId, from)) return;
        try
        {
            var chat = new ChatService();
            if (chat.UserExists(s.OwnerUserId))
                chat.Send(from, s.OwnerUserId, $"✔ WORK ORDER FOLLOW ลงลายเซ็นช่อง {role} แล้ว\n{s.CustomerName} · {s.WorkOrderNo} · {s.MonthStart:yyyy-MM}\n[[WOF:{s.SheetId}]]");
        }
        catch { /* ignore */ }
    }
}
