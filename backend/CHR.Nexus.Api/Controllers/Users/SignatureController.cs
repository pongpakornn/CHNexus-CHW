using CHR.Nexus.Api.Web;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// ✍ ลายเซ็นของฉัน (วงกลมโปรไฟล์ › ลายเซ็นของฉัน): วาด / อัปโหลดรูป -> บันทึกเป็น <UserID>-Signature.png (SignatureStore)
//   ทุกคนบันทึก / ลบได้เฉพาะลายเซ็นของตัวเอง · รูปของคนอื่นเปิดดูได้เมื่อ Login (ใช้แสดงในเอกสาร MIN REPORT)
[Route("api/signature")]
public sealed class SignatureController : AppController
{
    [HttpGet("me")]
    public IActionResult Mine()
    {
        if (Me == null) return Deny();
        return Ok(new { has = SignatureStore.Has(Uid), updated = SignatureStore.Updated(Uid), file = Path.GetFileName(SignatureStore.FileOf(Uid) ?? "") });
    }

    [HttpPost]
    [RequestSizeLimit(SignatureStore.MaxBytes + 64 * 1024)]
    public async Task<IActionResult> Save(IFormFile file)
    {
        if (Me == null) return Deny();
        if (file == null || file.Length == 0) return Fail("ไม่พบรูปลายเซ็น");
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        string err = SignatureStore.Save(Uid, ms.ToArray());
        if (err != null) return Fail(err);
        LogService.WriteLog(Uid, "SIGNATURE_SAVE", $"Saved signature {Path.GetFileName(SignatureStore.FileOf(Uid))}", Uid);
        return Ok(new { message = "บันทึกลายเซ็นแล้ว", updated = SignatureStore.Updated(Uid) });
    }

    [HttpDelete]
    public IActionResult Delete()
    {
        if (Me == null) return Deny();
        string err = SignatureStore.Delete(Uid);
        if (err != null) return Fail(err);
        LogService.WriteLog(Uid, "SIGNATURE_DELETE", "Deleted signature", Uid);
        return Ok(new { message = "ลบลายเซ็นแล้ว" });
    }

    [HttpGet("{userId}/image")]
    public IActionResult Image(string userId)
    {
        if (Me == null) return Deny();
        var b = SignatureStore.Read(userId);
        if (b == null) return NotFound();
        Response.Headers.CacheControl = "private, no-cache";
        return File(b, "image/png");
    }
}
