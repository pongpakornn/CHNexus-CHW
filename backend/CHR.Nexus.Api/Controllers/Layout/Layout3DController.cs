using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 🧊 LAYOUT 3D (CIMS › Layout 3D): สถานะตำแหน่งจัดเก็บของโมเดล 3D - อ่านอย่างเดียว · ใช้สิทธิ์ดูคลัง (Store ( Max - Min ) › VIEW)
//   GET /api/layout3d -> { ready, locations: [ตำแหน่งใน LAYOUT SETUP], coils: [Coil ที่อยู่ในคลัง + ตำแหน่งที่สแกนไว้] }
//   หน้าเว็บอัพเดทจากสัญญาณเรียลไทม์เดิม (store / scanner / layout) ไม่มีหัวข้อใหม่
[Route("api/layout3d")]
public sealed class Layout3DController : AppController
{
    private readonly Layout3DService _svc = new();

    [HttpGet]
    public IActionResult Get()
    {
        if (Me?.CanViewStore != true) return Deny();
        // ยังไม่รัน Script LAYOUT / ทะเบียน Coil = หน้าเว็บแสดงโมเดลเปล่า + ข้อความแจ้ง
        if (!DbSchema.HasLayout || !DbSchema.HasCoilRegister) return Ok(new { ready = false });
        try { return Ok(_svc.Snapshot()); }
        catch (Exception ex) { return Fail(ex, "โหลดสถานะ Layout 3D ไม่สำเร็จ"); }
    }
}
