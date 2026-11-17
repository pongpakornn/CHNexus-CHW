using CHR.Nexus.Api.Web;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// WORK ORDER FOLLOW v2 (SystemID PC_WOF): plan = owner + customer, parts persist, quantities per month
//   view = PC_WOF VIEW · create plan = ADD · edit = owner, editors or Level 1 (month locked while SENT / APPROVED)
//   SEND -> flow steps from PC.Flows 'WOF' (sequential, several users per step = any can sign) · reject = editable again
//   setup (flow) = PC_WOF APPROVE or Level 1
[Route("api/pcwof")]
public sealed class WorkOrderFollowController : AppController
{
    private readonly WorkOrderFollowService _svc = new();
    private readonly UploadCache _uploads;
    public WorkOrderFollowController(UploadCache uploads) => _uploads = uploads;

    private IActionResult NotReady() => Fail("ฐานข้อมูลยังไม่มีตาราง WORK ORDER FOLLOW (database/nexus/62_PC_WorkOrderFollow_v2.sql)");
    private bool IsAdmin => Me?.UserLevel == 1;
    private bool CanSetup => IsAdmin || Me?.CanApprovePcWof == true;
    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    private static string Clip(string s, int n) { s = (s ?? "").Trim(); return s.Length > n ? s[..n] : s; }
    private static string Ym(DateTime d) => d.ToString("yyyy-MM");

    private bool IsOwner(WoPlan p) => Same(p.OwnerUserId, Uid);
    private bool CanEdit(WoPlan p) => IsAdmin || IsOwner(p) || _svc.IsEditor(p.PlanId, Uid);

    // null = allowed to edit the plan (parts / remarks / order), else the error result
    private IActionResult EditGuard(WoPlan p)
    {
        if (p == null) return Fail("ไม่พบแผนนี้");
        if (!CanEdit(p)) return Deny("คุณไม่มีสิทธิ์แก้ไขแผนนี้ (เฉพาะเจ้าของ / ผู้แก้ไขที่ถูกเพิ่ม)");
        return null;
    }

    // plan edit + the month is still open (DRAFT / REJECTED)
    private IActionResult MonthGuard(WoPlan p, DateTime month)
    {
        if (EditGuard(p) is { } e) return e;
        var m = _svc.GetMonth(p.PlanId, month);
        if (!WorkOrderFollowRules.Editable(m?.Status)) return Fail("เดือนนี้ส่งขออนุมัติแล้ว (SENT / APPROVED) แก้ไขไม่ได้");
        return null;
    }

    private object PlanDto(WoPlan p, Dictionary<string, string> names, List<string> editors, int items, WoMonth m, WoSums sums) => new
    {
        planId = p.PlanId, p.CustomerCode, p.CustomerName,
        owner = new { userId = p.OwnerUserId, name = names.GetValueOrDefault(p.OwnerUserId, p.OwnerUserId) },
        editors = editors.Select(u => new { userId = u, name = names.GetValueOrDefault(u, u) }),
        items,
        month = new { workOrderNo = m?.WorkOrderNo ?? "", status = m?.Status ?? "DRAFT" },
        progress = new { order = sums?.Order ?? 0, produced = (sums?.ProdD ?? 0) + (sums?.ProdN ?? 0), delivered = sums?.Del ?? 0 }
    };

    private List<object> Dtos(List<WoPlan> plans, DateTime month)
    {
        var ids = plans.Select(p => p.PlanId).ToList();
        var ed = _svc.Editors(ids); var cnt = _svc.ItemCounts(ids, month); var mo = _svc.Months(ids, month); var sums = _svc.Sums(month, ids).ToDictionary(s => s.PlanId);
        var names = _svc.Names(plans.Select(p => p.OwnerUserId).Concat(ed.Values.SelectMany(x => x)));
        return plans.Select(p => PlanDto(p, names, ed.GetValueOrDefault(p.PlanId) ?? new(), cnt.GetValueOrDefault(p.PlanId), mo.GetValueOrDefault(p.PlanId), sums.GetValueOrDefault(p.PlanId))).ToList();
    }

    [HttpGet("meta")]
    public IActionResult Meta()
    {
        if (Me == null) return Deny();
        return Ok(new { ready = DbSchema.HasPcWof, can = new { view = Me.CanViewPcWof, add = Me.CanAddPcWof, approve = Me.CanApprovePcWof, setup = CanSetup && Me.CanViewPcWof }, me = new { userId = Uid, name = Me.UserName } });
    }

    [HttpGet("customers")]
    public IActionResult Customers()
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        return Ok(_svc.Customers().Select(c => new { code = c.Code, name = c.Name }));
    }

    [HttpGet("plans")]
    public IActionResult Plans([FromQuery] string month, [FromQuery] string owner = "all")
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        return Ok(Dtos(_svc.Plans(Same(owner, "me") ? Uid : null), m));
    }

    public sealed record PlanCreate(string CustomerCode);

    [HttpPost("plans")]
    public IActionResult Create([FromBody] PlanCreate req)
    {
        if (Me?.CanAddPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        string code = Clip(req?.CustomerCode, 50);
        string name = code.Length == 0 ? null : _svc.CustomerName(code);
        if (name == null) return Fail("ไม่พบลูกค้านี้ใน Master Data");
        if (_svc.PlanExists(Uid, code)) return Fail("คุณมีแผนของลูกค้านี้อยู่แล้ว");
        try
        {
            int id = _svc.CreatePlan(Uid, code, name);
            LogService.WriteLog(Uid, "PC_WOF_PLAN_CREATE", $"Plan #{id} | {code} {name}", code);
            return Ok(new { planId = id });
        }
        catch (Exception ex) { return Fail(ex, "สร้างแผนไม่สำเร็จ"); }
    }

    public sealed record PlanUpdate(List<string> Editors);

    [HttpPut("plans/{id:int}")]
    public IActionResult Update(int id, [FromBody] PlanUpdate req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var p = _svc.GetPlan(id);
        if (p == null) return Fail("ไม่พบแผนนี้");
        if (!IsAdmin && !IsOwner(p)) return Deny("เฉพาะเจ้าของแผนเท่านั้นที่เพิ่ม / ลบผู้แก้ไขได้");
        var editors = (req?.Editors ?? new()).Select(u => (u ?? "").Trim()).Where(u => u.Length > 0 && !Same(u, p.OwnerUserId)).Distinct(StringComparer.OrdinalIgnoreCase).Take(50).ToList();
        try
        {
            var bad = editors.Where(u => !_svc.UserExists(u)).ToList();
            if (bad.Count > 0) return Fail("ไม่พบผู้ใช้: " + string.Join(", ", bad));
            _svc.SetEditors(id, editors);
            LogService.WriteLog(Uid, "PC_WOF_PLAN_EDITORS", $"Plan #{id} | {p.CustomerCode} | Editors: {string.Join(", ", editors)}", p.CustomerCode);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("plans/{id:int}")]
    public IActionResult Delete(int id)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var p = _svc.GetPlan(id);
        if (p == null) return Fail("ไม่พบแผนนี้");
        if (!IsAdmin && !IsOwner(p)) return Deny("เฉพาะเจ้าของแผนเท่านั้นที่ลบได้");
        if (!IsAdmin && _svc.AnyApproved(id)) return Fail("แผนนี้มีเดือนที่อนุมัติแล้ว ลบได้เฉพาะ Admin");
        try
        {
            _svc.DeletePlan(id);
            LogService.WriteLog(Uid, "PC_WOF_PLAN_DELETE", $"Plan #{id} | {p.CustomerCode} {p.CustomerName} | Owner: {p.OwnerUserId}", p.CustomerCode);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    // rows exist -> built from them (history), titles / users from the current flow; none -> flow steps as PREVIEW
    private object ApprovalsDto(int planId, DateTime month)
    {
        var flow = _svc.Flow(); var ap = _svc.Approvals(planId, month);
        var names = _svc.Names(flow.Select(f => f.UserId).Concat(ap.Select(a => a.SignedBy)));
        object Users(int step) => flow.Where(f => f.StepNo == step).Select(f => new { userId = f.UserId, name = names.GetValueOrDefault(f.UserId, f.UserId) }).ToList();
        string Title(int step) => flow.FirstOrDefault(f => f.StepNo == step)?.Title ?? $"Step {step}";
        if (ap.Count == 0)
            return flow.Select(f => f.StepNo).Distinct().OrderBy(x => x).Select(st => new { stepNo = st, title = Title(st), users = Users(st), status = "PREVIEW", signedBy = (object)null, signedAt = (DateTime?)null, remark = (string)null }).ToList();
        return ap.OrderBy(a => a.StepNo).Select(a => new
        {
            stepNo = a.StepNo, title = Title(a.StepNo), users = Users(a.StepNo), status = a.Status,
            signedBy = a.SignedBy == null ? null : (object)new { userId = a.SignedBy, name = names.GetValueOrDefault(a.SignedBy, a.SignedBy) }, signedAt = a.SignedAt, remark = a.Remark
        }).ToList();
    }

    [HttpGet("plans/{id:int}")]
    public IActionResult Get(int id, [FromQuery] string month)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var p = _svc.GetPlan(id);
        if (p == null) return Fail("ไม่พบแผนนี้");
        var mo = _svc.GetMonth(id, m);
        var cells = _svc.Cells(id, m);
        var items = _svc.Items(id, m).Select(i => new
        {
            i.ItemId, i.SortNo, i.PartId, i.PartCode, i.PartA, i.PartB, i.PartNo, i.PartName, i.PackSize, i.Remark,
            imageUrl = ImageUrl(i.ImageFileName), cells = cells.GetValueOrDefault(i.ItemId) ?? new()
        }).ToList();
        return Ok(new
        {
            plan = Dtos(new() { p }, m)[0],
            canEdit = CanEdit(p) && WorkOrderFollowRules.Editable(mo?.Status),
            month = new { workOrderNo = mo?.WorkOrderNo ?? "", status = mo?.Status ?? "DRAFT", approvals = ApprovalsDto(id, m) },
            items
        });
    }

    private static string ImageUrl(string f) => string.IsNullOrWhiteSpace(f) ? null : $"/api/images/file?name={Uri.EscapeDataString(f)}";

    public sealed record MonthSet(string Month, string WorkOrderNo);

    [HttpPut("plans/{id:int}/month")]
    public IActionResult SetMonth(int id, [FromBody] MonthSet req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (req == null || !WorkOrderFollowRules.TryMonth(req.Month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var p = _svc.GetPlan(id);
        if (MonthGuard(p, m) is { } err) return err;
        string wo = Clip(req.WorkOrderNo, 100);
        try
        {
            _svc.SetWorkOrder(id, m, wo);
            LogService.WriteLog(Uid, "PC_WOF_MONTH", $"Plan #{id} | {p.CustomerCode} | {Ym(m)} | W/O: {wo}", wo);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpGet("parts")]
    public IActionResult Parts([FromQuery] string customer, [FromQuery] string q)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        // customer is only a ranking hint (its parts first): parts of other customers / without customer can be added too
        return Ok(_svc.SearchParts(Clip(customer, 50), Clip(q, 100)).Select(p => new { p.PartId, p.PartCode, p.PartA, p.PartB, p.PartNo, p.PartName, p.PackSize, p.Customer, imageUrl = ImageUrl(p.ImageFileName) }));
    }

    // item writes: plan edit + month format; locked = month M (update / order) or any month from M (add / delete: they change later months too)
    private IActionResult ItemGuard(WoPlan p, string month, bool fromHere, out DateTime m)
    {
        m = default;
        if (!WorkOrderFollowRules.TryMonth(month, out m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        if (EditGuard(p) is { } e) return e;
        bool locked = fromHere ? _svc.LockedFrom(p.PlanId, m) : !WorkOrderFollowRules.Editable(_svc.GetMonth(p.PlanId, m)?.Status);
        return locked ? Fail("เดือนนี้ (หรือเดือนถัดไป) ส่งขออนุมัติ / อนุมัติแล้ว แก้ไขสินค้าไม่ได้") : null;
    }

    public sealed record ItemAdd(int PartId, string Month);

    [HttpPost("plans/{id:int}/items")]
    public IActionResult AddItem(int id, [FromBody] ItemAdd req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var pl = _svc.GetPlan(id);
        if (pl == null) return Fail("ไม่พบแผนนี้");
        if (ItemGuard(pl, req?.Month, true, out var m) is { } err) return err;
        var p = _svc.GetPart(req.PartId);
        if (p == null) return Fail("ไม่พบสินค้านี้");
        if (_svc.HasItemPart(id, p.PartId, m)) return Fail("สินค้านี้อยู่ในแผนแล้ว");
        try
        {
            int itemId = _svc.AddItem(id, m, new WorkOrderFollowService.ItemRow
            {
                PartId = p.PartId, PartCode = Clip(p.PartCode, 100), PartA = Clip(p.PartA, 100), PartB = Clip(p.PartB, 100), PartNo = Clip(p.PartNo, 100), PartName = Clip(p.PartName, 200),
                PackSize = WorkOrderFollowRules.ParsePack(p.PackSize), ImageFileName = p.ImageFileName
            });
            LogService.WriteLog(Uid, "PC_WOF_ITEM_ADD", $"Plan #{id} | Item #{itemId} | {p.PartCode} {p.PartName} | From {Ym(m)}", p.PartCode);
            _svc.Touch(id);
            return Ok(new { itemId });
        }
        catch (Exception ex) { return Fail(ex, "เพิ่มสินค้าไม่สำเร็จ"); }
    }

    public sealed record ItemUpdate(string Remark, int? PackSize, string Month);

    [HttpPut("items/{itemId:int}")]
    public IActionResult UpdateItem(int itemId, [FromBody] ItemUpdate req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var it = _svc.GetItem(itemId, out int pid);
        if (it == null) return Fail("ไม่พบรายการนี้");
        if (ItemGuard(_svc.GetPlan(pid), req?.Month, false, out _) is { } err) return err;
        if (req?.PackSize is < 1 or > 10_000_000) return Fail("จำนวนชิ้น/กล่องไม่ถูกต้อง");
        try
        {
            it.Remark = Clip(req?.Remark, 500); it.PackSize = req?.PackSize;
            _svc.UpdateItem(it);
            LogService.WriteLog(Uid, "PC_WOF_ITEM_UPDATE", $"Plan #{pid} | Item #{itemId} | {it.PartName} | Pack: {it.PackSize}", it.PartCode);
            _svc.Touch(pid);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    [HttpDelete("items/{itemId:int}")]
    public IActionResult DeleteItem(int itemId, [FromQuery] string month)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var it = _svc.GetItem(itemId, out int pid);
        if (it == null) return Fail("ไม่พบรายการนี้");
        if (ItemGuard(_svc.GetPlan(pid), month, true, out var m) is { } err) return err;
        try
        {
            bool hard = _svc.DeleteItem(itemId, pid, m);
            LogService.WriteLog(Uid, "PC_WOF_ITEM_DELETE", $"Plan #{pid} | Item #{itemId} | {it.PartName} | {(hard ? "deleted" : "ended before " + Ym(m))}", it.PartCode);
            _svc.Touch(pid);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    public sealed record OrderReq(List<int> Ids, string Month);

    [HttpPost("plans/{id:int}/items/order")]
    public IActionResult Order(int id, [FromBody] OrderReq req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var p = _svc.GetPlan(id);
        if (p == null) return Fail("ไม่พบแผนนี้");
        if (ItemGuard(p, req?.Month, false, out var m) is { } err) return err;
        var ids = (req.Ids ?? new()).Distinct().ToList();
        var own = _svc.ItemIds(id, m).ToHashSet();
        if (ids.Any(i => !own.Contains(i))) return Fail("รายการไม่ตรงกับแผน");
        try
        {
            _svc.Reorder(id, ids);
            LogService.WriteLog(Uid, "PC_WOF_ITEM_ORDER", $"Plan #{id} | {ids.Count} items reordered", p.CustomerCode);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกลำดับไม่สำเร็จ"); }
    }

    public sealed record CellEdit(int ItemId, string RowKey, int Day, decimal? Qty);
    public sealed record CellsReq(string Month, List<CellEdit> Cells);

    [HttpPut("plans/{id:int}/cells")]
    public IActionResult Cells(int id, [FromBody] CellsReq req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (req == null || !WorkOrderFollowRules.TryMonth(req.Month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var p = _svc.GetPlan(id);
        if (MonthGuard(p, m) is { } err) return err;
        var cells = req.Cells;
        if (cells == null || cells.Count == 0) return Ok(new { saved = 0 });
        if (cells.Any(c => c == null)) return Fail("ข้อมูลช่องไม่ถูกต้อง");
        if (cells.Count > 2000) return Fail("ส่งข้อมูลครั้งละไม่เกิน 2,000 ช่อง");
        int days = DateTime.DaysInMonth(m.Year, m.Month);
        var own = _svc.ItemIds(id, m).ToHashSet();
        foreach (var c in cells)
        {
            if (!own.Contains(c.ItemId)) return Fail("รายการไม่ตรงกับแผน");
            if (WorkOrderFollowRules.CheckCell(c.RowKey, c.Day, c.Qty, days) is { } msg) return Fail(msg);
        }
        try
        {
            _svc.SaveCells(id, m, cells.Select(c => (c.ItemId, c.RowKey, c.Day, c.Qty)));
            LogService.WriteLog(Uid, "PC_WOF_CELLS", $"Plan #{id} | {p.CustomerCode} | {Ym(m)} | {cells.Count} cells", p.CustomerCode);
            _svc.Touch(id);
            return Ok(new { saved = cells.Count });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- Excel TEMPLATE / IMPORT (same edit permission + month lock as typing in the grid)
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    [HttpGet("plans/{id:int}/template")]
    public IActionResult Template(int id, [FromQuery] string month)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var p = _svc.GetPlan(id);
        if (p == null) return Fail("ไม่พบแผนนี้");
        try
        {
            var cells = _svc.Cells(id, m);
            var items = _svc.Items(id, m).Select(i => new WorkOrderFollowExcel.TplItem(i.ItemId, i.PartNo, i.PartName, i.PackSize, cells.GetValueOrDefault(i.ItemId) ?? new())).ToList();
            var bytes = WorkOrderFollowExcel.Template(id, $"{p.CustomerCode} {p.CustomerName}", _svc.GetMonth(id, m)?.WorkOrderNo, m, items);
            LogService.WriteLog(Uid, "PC_WOF_TEMPLATE", $"Plan #{id} | {p.CustomerCode} | {Ym(m)}", p.CustomerCode);
            return File(bytes, XlsxType, $"WOF_Template_{p.CustomerCode}_{m:yyyy-MM}.xlsx");
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }

    private sealed record WofImport(int PlanId, DateTime Month, List<WorkOrderFollowExcel.Cell> Cells);

    private static string Q(decimal? v) => v?.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
    private static string RowLabel(string key) => WorkOrderFollowExcel.DataRows.FirstOrDefault(r => r.Key == key).Label ?? key;

    // preview rows = one per part x row (key "itemId|ROWKEY"); fields = the changed days (old -> new)
    private List<ImportRowDto> Preview(WorkOrderFollowExcel.Parsed p, int planId)
    {
        var cur = _svc.Cells(planId, p.Month);
        var items = _svc.Items(planId, p.Month).ToDictionary(i => i.ItemId);
        var rows = new List<ImportRowDto>();
        foreach (var g in p.Cells.Where(c => items.ContainsKey(c.ItemId)).GroupBy(c => (c.ItemId, c.RowKey)).OrderBy(g => items[g.Key.ItemId].SortNo).ThenBy(g => Array.FindIndex(WorkOrderFollowExcel.DataRows, r => r.Key == g.Key.RowKey)))
        {
            var it = items[g.Key.ItemId];
            var oldRow = cur.GetValueOrDefault(g.Key.ItemId)?.GetValueOrDefault(g.Key.RowKey);
            var fields = new List<ImportField>();
            bool anyOld = false, anyDiff = false;
            foreach (var c in g.OrderBy(c => c.Day))
            {
                decimal? old = oldRow != null && oldRow.TryGetValue(c.Day.ToString(), out var o) ? o : null;
                if (old != null) anyOld = true;
                if (old == c.Qty) continue;
                anyDiff = true;
                fields.Add(new ImportField($"วันที่ {c.Day}", Q(old), Q(c.Qty)));
            }
            string st = !anyDiff ? ImportReview.Same : anyOld ? ImportReview.Changed : ImportReview.New;
            rows.Add(new ImportRowDto($"{g.Key.ItemId}|{g.Key.RowKey}", st, $"{it.PartNo} · {RowLabel(g.Key.RowKey)}", it.PartName, fields, null, null));
        }
        return rows;
    }

    [HttpPost("plans/{id:int}/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> Import(int id, [FromQuery] string month, IFormFile file)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var pl = _svc.GetPlan(id);
        if (MonthGuard(pl, m) is { } err) return err;
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        try
        {
            var p = WorkOrderFollowExcel.Read(path);
            TryDelete(path);
            if (p.PlanId != id) return Fail("ไฟล์นี้เป็นของแผนอื่น · ดาวน์โหลด TEMPLATE จากแผนนี้");
            if (p.Month != m) return Fail($"ไฟล์นี้เป็นของเดือน {Ym(p.Month)} แต่หน้าที่เปิดอยู่คือเดือน {Ym(m)}");
            var rows = Preview(p, id);
            var errors = p.Errors.Select(e => new ImportErrorDto(e.Cell, e.Text)).ToList();
            if (rows.Count == 0 && errors.Count == 0) return Fail("ไม่พบตัวเลขในไฟล์ (ช่องว่างทั้งหมด)");
            string uid = _uploads.Put("", file.FileName, Uid, "wofxl", new WofImport(id, m, p.Cells));
            return Ok(new ImportPreviewDto(uid, file.FileName, $"WORK ORDER FOLLOW · {pl.CustomerCode} · {m:MMMM yyyy}", rows, errors));
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("plans/{id:int}/import/apply")]
    public IActionResult ImportApply(int id, [FromBody] ImportApplyRequest req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var it = string.IsNullOrEmpty(req?.Id) ? null : _uploads.Get(req.Id, Uid, "wofxl");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var st = (WofImport)it.State;
        if (st.PlanId != id) return Fail("ไฟล์นี้เป็นของแผนอื่น");
        var p = _svc.GetPlan(id);
        if (MonthGuard(p, st.Month) is { } err) return err;   // re-check lock + permission at apply time
        var skip = (req.Exclude ?? new()).ToHashSet();
        var own = _svc.ItemIds(id, st.Month).ToHashSet();
        var write = st.Cells.Where(c => own.Contains(c.ItemId) && !skip.Contains($"{c.ItemId}|{c.RowKey}")).ToList();
        if (write.Count == 0) { _uploads.Remove(req.Id); return Ok(new { cells = 0, message = "ไม่มียอดที่ต้องนำเข้า" }); }
        try
        {
            for (int i = 0; i < write.Count; i += 2000)
                _svc.SaveCells(id, st.Month, write.Skip(i).Take(2000).Select(c => (c.ItemId, c.RowKey, c.Day, (decimal?)c.Qty)));
            _uploads.Remove(req.Id);
            LogService.WriteLog(Uid, "PC_WOF_IMPORT", $"Plan #{id} | {p.CustomerCode} | {Ym(st.Month)} | File: {it.FileName} | {write.Count} cells", p.CustomerCode);
            _svc.Touch(id);
            return Ok(new { cells = write.Count, message = $"นำเข้า {write.Count:N0} ช่อง ({p.CustomerCode} · {st.Month:MMM yyyy}) แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- flow (SETUP FLOW)
    [HttpGet("flow")]
    public IActionResult GetFlow()
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        var f = _svc.Flow();
        var names = _svc.Names(f.Select(x => x.UserId));
        return Ok(f.GroupBy(x => x.StepNo).OrderBy(g => g.Key).Select(g => new
        {
            stepNo = g.Key, title = g.First().Title, users = g.Select(x => new { userId = x.UserId, name = names.GetValueOrDefault(x.UserId, x.UserId) })
        }));
    }

    public sealed record FlowStep(int StepNo, string Title, List<string> UserIds);

    [HttpPut("flow")]
    public IActionResult SetFlow([FromBody] List<FlowStep> req)
    {
        if (Me?.CanViewPcWof != true || !CanSetup) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (req == null || req.Any(s => s == null)) return Fail("ข้อมูลไม่ถูกต้อง");
        if (req.Count > 10) return Fail("ตั้งขั้นตอนได้ไม่เกิน 10 ขั้น");
        if (_svc.AnySent()) return Fail("มีงานรอเซ็นอยู่ ไม่สามารถแก้ FLOW ได้ กรุณาให้เซ็นหรือตีกลับก่อน");
        var steps = new List<(int, string, List<string>)>();
        int n = 0;
        foreach (var s in req.OrderBy(s => s.StepNo))
        {
            n++;
            var users = (s.UserIds ?? new()).Select(u => (u ?? "").Trim()).Where(u => u.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (users.Count == 0) return Fail($"ขั้นที่ {n} ยังไม่ได้เลือกผู้อนุมัติ");
            if (users.Count > 20) return Fail($"ขั้นที่ {n} เลือกผู้อนุมัติได้ไม่เกิน 20 คน");
            var bad = users.Where(u => !_svc.UserExists(u) || !_svc.UserCan(u, false)).ToList();
            if (bad.Count > 0) return Fail($"ผู้ใช้ไม่พบ หรือไม่มีสิทธิ์ดู WORK ORDER FOLLOW: {string.Join(", ", bad)}");
            string title = Clip(s.Title, 100);
            steps.Add((n, title.Length == 0 ? $"Step {n}" : title, users));
        }
        try
        {
            _svc.SaveFlow(steps);
            LogService.WriteLog(Uid, "PC_WOF_FLOW", string.Join(" > ", steps.Select(s => $"{s.Item1}.{s.Item2}[{string.Join(",", s.Item3)}]")), "WOF");
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- send / approve / reject
    public sealed record MonthReq(string Month, string Remark);

    [HttpPost("plans/{id:int}/send")]
    public IActionResult Send(int id, [FromBody] MonthReq req)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (req == null || !WorkOrderFollowRules.TryMonth(req.Month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var p = _svc.GetPlan(id);
        if (MonthGuard(p, m) is { } err) return err;
        var mo = _svc.GetMonth(id, m);
        if (string.IsNullOrWhiteSpace(mo?.WorkOrderNo)) return Fail("กรุณาระบุเลข Work Order ของเดือนนี้ก่อนส่งขออนุมัติ");
        if (_svc.ItemCounts(new[] { id }, m).GetValueOrDefault(id) == 0) return Fail("แผนนี้ยังไม่มีสินค้า");
        var flow = _svc.Flow();
        if (flow.Count == 0) return Fail("ยังไม่ได้ตั้งค่า FLOW การอนุมัติ (PC › SETUP FLOW) กรุณาติดต่อ Admin");
        try
        {
            var steps = flow.Select(f => f.StepNo).Distinct().OrderBy(x => x).ToList();
            _svc.Send(id, m, Uid, steps);
            LogService.WriteLog(Uid, "PC_WOF_SEND", $"Plan #{id} | {p.CustomerCode} | {Ym(m)} | W/O: {mo.WorkOrderNo} | {steps.Count} steps", mo.WorkOrderNo);
            Notify(p, m, mo.WorkOrderNo, flow.Where(f => f.StepNo == steps[0]).Select(f => f.UserId), steps[0], Uid);
            return Ok(new { message = "ส่งขออนุมัติแล้ว\nเดือนนี้ถูกล็อกจนกว่าจะอนุมัติ / ตีกลับ" });
        }
        catch (Exception ex) { return Fail(ex, "ส่งขออนุมัติไม่สำเร็จ"); }
    }

    // shared checks for approve / reject: returns the step the caller may act on, or an error
    private IActionResult ActGuard(int id, string month, out WoPlan p, out DateTime m, out WoMonth mo, out int step)
    {
        p = null; mo = null; step = 0; m = default;
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        p = _svc.GetPlan(id);
        if (p == null) return Fail("ไม่พบแผนนี้");
        mo = _svc.GetMonth(id, m);
        if (mo?.Status != "SENT") return Fail("เดือนนี้ไม่ได้อยู่ระหว่างรออนุมัติ");
        var cur = WorkOrderFollowRules.CurrentStep(_svc.Approvals(id, m).Select(a => (a.StepNo, a.Status)));
        if (cur == null) return Fail("ไม่มีขั้นที่รอลงลายเซ็น");
        if (!_svc.Flow().Any(f => f.StepNo == cur && Same(f.UserId, Uid))) return Deny("ขั้นนี้ไม่ได้ขอให้คุณลงลายเซ็น");
        step = cur.Value;
        return null;
    }

    [HttpPost("plans/{id:int}/approve")]
    public IActionResult Approve(int id, [FromBody] MonthReq req)
    {
        if (ActGuard(id, req?.Month, out var p, out var m, out var mo, out int step) is { } err) return err;
        if (!SignatureStore.Has(Uid)) return Fail("คุณยังไม่มีลายเซ็นในระบบ\nกรุณาบันทึกลายเซ็นก่อนที่ วงกลมโปรไฟล์ › ลายเซ็นของฉัน");
        try
        {
            var ap = _svc.Approvals(id, m);
            bool last = ap.All(a => a.StepNo <= step);
            if (!_svc.Sign(id, m, step, Uid, Clip(req?.Remark, 500), last)) return Fail("ขั้นนี้ลงลายเซ็นไปแล้ว");
            LogService.WriteLog(Uid, "PC_WOF_APPROVE", $"Plan #{id} | {p.CustomerCode} | {Ym(m)} | W/O: {mo.WorkOrderNo} | Step {step}" + (last ? " | APPROVED" : ""), mo.WorkOrderNo);
            if (last) NotifyOwner(p, m, mo.WorkOrderNo, "✔ WORK ORDER FOLLOW อนุมัติครบทุกขั้นแล้ว", Uid);
            else
            {
                int next = ap.Where(a => a.StepNo > step && a.Status == "PENDING").Min(a => a.StepNo);
                Notify(p, m, mo.WorkOrderNo, _svc.Flow().Where(f => f.StepNo == next).Select(f => f.UserId), next, Uid);
            }
            return Ok(new { message = last ? "ลงลายเซ็นแล้ว\n✔ อนุมัติครบทุกขั้น เดือนนี้ถูกล็อก" : $"ลงลายเซ็นขั้นที่ {step} แล้ว\nส่งต่อให้ขั้นถัดไป" });
        }
        catch (Exception ex) { return Fail(ex, "ลงลายเซ็นไม่สำเร็จ"); }
    }

    [HttpPost("plans/{id:int}/reject")]
    public IActionResult Reject(int id, [FromBody] MonthReq req)
    {
        if (ActGuard(id, req?.Month, out var p, out var m, out var mo, out int step) is { } err) return err;
        string remark = Clip(req?.Remark, 500);
        if (remark.Length == 0) return Fail("กรุณาระบุเหตุผลที่ตีกลับ");
        try
        {
            if (!_svc.Reject(id, m, step, Uid, remark)) return Fail("ขั้นนี้ดำเนินการไปแล้ว");
            LogService.WriteLog(Uid, "PC_WOF_REJECT", $"Plan #{id} | {p.CustomerCode} | {Ym(m)} | W/O: {mo.WorkOrderNo} | Step {step} | {remark}", mo.WorkOrderNo);
            NotifyOwner(p, m, mo.WorkOrderNo, $"✖ WORK ORDER FOLLOW ถูกตีกลับ: {remark}", Uid);
            return Ok(new { message = "ตีกลับแล้ว เจ้าของแผนแก้ไขและส่งใหม่ได้" });
        }
        catch (Exception ex) { return Fail(ex, "ตีกลับไม่สำเร็จ"); }
    }

    [HttpGet("sign/queue")]
    public IActionResult Queue()
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return Ok(Array.Empty<object>());
        var q = _svc.Queue(Uid);
        var names = _svc.Names(q.Select(r => r.SentBy));
        return Ok(q.Select(r => new
        {
            r.PlanId, month = Ym(r.MonthStart), r.StepNo, r.Title, r.CustomerName, r.WorkOrderNo,
            requestedBy = new { userId = r.SentBy, name = names.GetValueOrDefault(r.SentBy ?? "", r.SentBy) }, requestedAt = r.SentAt
        }));
    }

    // ---------------------------------------------------------------- dashboard
    [HttpGet("dashboard")]
    public IActionResult Dashboard([FromQuery] string month)
    {
        if (Me?.CanViewPcWof != true) return Deny();
        if (!DbSchema.HasPcWof) return NotReady();
        if (!WorkOrderFollowRules.TryMonth(month, out var m)) return Fail("เดือนไม่ถูกต้อง (yyyy-MM)");
        var plans = _svc.Plans(null);
        var ids = plans.Select(p => p.PlanId).ToList();
        var sums = _svc.Sums(m, ids);
        var mo = _svc.Months(ids, m);
        decimal order = sums.Sum(s => s.Order), prod = sums.Sum(s => s.ProdD + s.ProdN);
        string St(int id) => mo.GetValueOrDefault(id)?.Status ?? "DRAFT";
        var byStatus = new[] { "DRAFT", "SENT", "APPROVED", "REJECTED" }.ToDictionary(s => s, s => ids.Count(i => St(i) == s));
        return Ok(new
        {
            plans = plans.Count,
            parts = _svc.ItemCounts(ids, m).Values.Sum(),
            totals = new { pl = sums.Sum(s => s.Pl), or = sums.Sum(s => s.Or), order, prodD = sums.Sum(s => s.ProdD), prodN = sums.Sum(s => s.ProdN), del = sums.Sum(s => s.Del) },
            achievement = WorkOrderFollowRules.Achievement(order, prod),
            pending = byStatus["SENT"],
            byCustomer = plans.GroupBy(p => p.CustomerCode).Select(g =>
            {
                var gs = sums.Where(s => g.Any(p => p.PlanId == s.PlanId)).ToList();
                return new { code = g.Key, name = g.First().CustomerName, order = gs.Sum(s => s.Order), produced = gs.Sum(s => s.ProdD + s.ProdN), delivered = gs.Sum(s => s.Del) };
            }).OrderBy(x => x.code),
            byStatus
        });
    }

    // ---------------------------------------------------------------- notify (chat card; bell reads the queue) · chat failure never blocks the flow
    private static void Notify(WoPlan p, DateTime m, string wo, IEnumerable<string> to, int step, string from)
    {
        if (!DbSchema.HasChat) return;
        string body = $"✍ WORK ORDER FOLLOW รอลงลายเซ็น (ขั้นที่ {step})\n{p.CustomerName} · {wo} · {Ym(m)}\n[[WOF:{p.PlanId}:{Ym(m)}]]";
        foreach (var u in to.Where(u => !Same(u, from)).Distinct(StringComparer.OrdinalIgnoreCase))
            try { var chat = new ChatService(); if (chat.UserExists(u)) chat.Send(from, u, body); }
            catch { /* chat unavailable: bell still shows it */ }
    }

    private static void NotifyOwner(WoPlan p, DateTime m, string wo, string head, string from)
    {
        if (!DbSchema.HasChat || Same(p.OwnerUserId, from)) return;
        try
        {
            var chat = new ChatService();
            if (chat.UserExists(p.OwnerUserId)) chat.Send(from, p.OwnerUserId, $"{head}\n{p.CustomerName} · {wo} · {Ym(m)}\n[[WOF:{p.PlanId}:{Ym(m)}]]");
        }
        catch { /* ignore */ }
    }
}
