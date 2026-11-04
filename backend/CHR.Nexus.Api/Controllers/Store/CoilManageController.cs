using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Models;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🧲 MANAGE STOCK ของคลังที่นับ Coil (ปุ่มในหน้าคลัง) - สิทธิ์ EDIT + APPROVE ของคลังนั้น (UserSession.CanManageCoils)
//   ADD MASTER COIL (บรรทัด PD CODE) · EDIT / TRANSFER / ADJUST (แถว Coil ลูก) · HISTORY
//   ทุกรายการลง Activity Log (ค่าเดิม -> ค่าใหม่ ใคร เวลาไหน) + ประวัติของคลัง (Nexus.CoilManageLog)
[Route("api/store/{stkId:int}/manage")]
public sealed class CoilManageController : AppController
{
    private readonly StockService _stocks = new();

    private (StockModel Stock, IActionResult Error) Allowed(int stkId)
    {
        if (Me?.CanViewStore != true) return (null, Deny());
        var s = _stocks.GetStock(stkId);
        if (s == null || !Me.CanViewStock(s)) return (null, Deny("คุณไม่มีสิทธิ์ดูคลังนี้"));
        if (!DbSchema.HasCoilRegister) return (null, Fail("ฐานข้อมูลยังไม่มีทะเบียน Coil"));
        if (!Me.CanManageCoils(s)) return (null, Deny($"คุณไม่มีสิทธิ์ MANAGE STOCK ของคลัง {s.Code}\n(ต้องมี EDIT + APPROVE ของคลังนี้ที่หน้ากำหนดสิทธิ์)"));
        return (s, null);
    }

    private CoilManageService Svc() => new(_stocks.GetStocks(), _stocks.GetFormats(activeOnly: true));

    private static bool Kg(string text, out decimal kg) => Qty.TryParse((text ?? "").Replace(",", "").Trim(), out kg) && kg > 0;

    private IActionResult Done(CoilManageService.Result r, string action, string refCode)
    {
        LogService.WriteLog(Uid, action, r.Log, refCode ?? "");
        foreach (var id in r.Stocks.Distinct()) LiveBus.Publish("store:" + id, "store");
        return Ok(new { message = r.Message, synced = r.Synced });
    }

    private IActionResult Run(Func<IActionResult> work, string fail)
    {
        try { return work(); }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, fail); }
    }

    // ข้อมูลของหน้าต่าง ADD: คลังต้นทางที่ตัดยอดได้ (เช่น STOCK-PANTA)
    [HttpGet("info")]
    public IActionResult Info(int stkId)
    {
        var (s, err) = Allowed(stkId);
        if (err != null) return err;
        var src = Svc().DeductSource(s);
        return Ok(new { source = src?.Code, hasLog = DbSchema.HasCoilManageLog });
    }

    public sealed record AddRequest(int PartId, string MasterCoil, string CoilNo, string WeightKg, string Remark, bool Deduct);

    [HttpPost("add")]
    public IActionResult Add(int stkId, [FromBody] AddRequest req)
    {
        var (s, err) = Allowed(stkId);
        if (err != null) return err;
        if (req == null || req.PartId <= 0) return Fail("ไม่พบสินค้า");
        if (!Kg(req.WeightKg, out decimal kg)) return Fail("กรุณากรอก WEIGHT (KG) เป็นตัวเลขมากกว่า 0");
        return Run(() =>
        {
            var r = Svc().Add(s.StkId, req.PartId, req.MasterCoil, req.CoilNo, kg, req.Remark, req.Deduct, Uid);
            return Done(r, "COIL_MANAGE_ADD", (req.CoilNo ?? req.MasterCoil ?? "").Trim());
        }, "เพิ่ม Coil ไม่สำเร็จ");
    }

    public sealed record EditRequest(string MasterCoil, string CoilNo, string WeightKg, string Remark);

    [HttpPut("coils/{coilId:int}")]
    public IActionResult Edit(int stkId, int coilId, [FromBody] EditRequest req)
    {
        var (s, err) = Allowed(stkId);
        if (err != null) return err;
        if (req == null) return Fail("ข้อมูลไม่ครบ");
        if (!Kg(req.WeightKg, out decimal kg)) return Fail("กรุณากรอก WEIGHT (KG) เป็นตัวเลขมากกว่า 0");
        return Run(() => Done(Svc().Edit(s.StkId, coilId, req.MasterCoil, req.CoilNo, kg, req.Remark, Uid), "COIL_MANAGE_EDIT", (req.CoilNo ?? "").Trim()), "แก้ไข Coil ไม่สำเร็จ");
    }

    [HttpPost("coils/{coilId:int}/transfer")]
    public IActionResult Transfer(int stkId, int coilId)
    {
        var (s, err) = Allowed(stkId);
        if (err != null) return err;
        return Run(() => Done(Svc().Transfer(s.StkId, coilId, Uid), "COIL_MANAGE_TRANSFER", ""), "โอนย้าย Coil ไม่สำเร็จ");
    }

    public sealed record AdjustRequest(string Mode, string Reason);

    [HttpPost("coils/{coilId:int}/adjust")]
    public IActionResult Adjust(int stkId, int coilId, [FromBody] AdjustRequest req)
    {
        var (s, err) = Allowed(stkId);
        if (err != null) return err;
        return Run(() => Done(Svc().Adjust(s.StkId, coilId, req?.Mode, req?.Reason, Uid), "COIL_MANAGE_ADJUST", ""), "ปรับปรุงยอดไม่สำเร็จ");
    }

    // 🕘 ประวัติ: วันนี้เป็นค่าเริ่มต้น · เลือกช่วงวันที่ได้ · กรองประเภทที่หน้าจอ (ADD / EDIT / TRANSFER / ADJUST)
    [HttpGet("history")]
    public IActionResult History(int stkId, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string key)
    {
        var (s, err) = Allowed(stkId);
        if (err != null) return err;
        DateTime f = (from ?? DateTime.Today).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        return Ok(new { hasLog = DbSchema.HasCoilManageLog, rows = CoilManageService.History(s.StkId, f, t, key) });
    }
}
