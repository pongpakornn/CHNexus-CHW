using CHR.Nexus.Api.Web.Auth;
using Nexus.Models;
using Nexus.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Web;

// ฐานของทุก Controller: ผู้ใช้ของ Request (UserSession เดียวกับ WPF) + คำตอบมาตรฐาน
[ApiController]
[Authorize]
public abstract class AppController : ControllerBase
{
    private UserSession _session;
    private bool _loaded;

    protected UserSession Me
    {
        get
        {
            if (!_loaded) { _session = HttpContext.RequestServices.GetRequiredService<ICurrentUser>().Session; _loaded = true; }
            return _session;
        }
    }

    protected string Uid => Me?.UserId;

    // ไม่มีสิทธิ์ = 403 + ข้อความไทย (หน้าเว็บซ่อนปุ่มอยู่แล้ว แต่ API ตรวจซ้ำเสมอ)
    protected IActionResult Deny(string message = "คุณไม่มีสิทธิ์ใช้งานส่วนนี้ กรุณาติดต่อ Admin") =>
        StatusCode(403, new { message = ScannerSetupService.WithContacts(message) });

    protected IActionResult Fail(string message) => BadRequest(new { message });

    // ข้อความ Exception ที่ตั้งใจเขียนให้ผู้ใช้อ่าน (ไทย) ส่งต่อได้ · ที่เหลือ (SQL / path ของ Server / บั๊กที่ไม่คาด) ส่งข้อความกลาง ๆ แทน
    // รายละเอียดเต็มอยู่ใน BUG LOG เสมอ (Admin เปิดดูได้)
    private static bool IsUserMessage(Exception ex)
    {
        if (ex is Microsoft.Data.SqlClient.SqlException) return false;
        if (ex is InvalidOperationException || ex is InvalidDataException || ex is FormatException) return true;
        return (ex.Message ?? "").Any(ch => ch >= '฀' && ch <= '๿');   // ข้อความไทยที่โค้ดเราโยนเอง
    }

    // ข้อผิดพลาดที่พบบ่อยเป็นข้อความไทยแบบเดิม
    protected IActionResult Fail(Exception ex, string prefix = null)
    {
        bool open = ex.Message.Contains("being used") || ex is IOException && ex.Message.Contains("process");
        bool show = open || IsUserMessage(ex);
        BugLog.Write("API", show ? "WARN" : "ERROR", (string.IsNullOrEmpty(prefix) ? "" : prefix + " • ") + $"{ex.GetType().Name}: {ex.Message}", ex.ToString(),
                     HttpContext?.Request.Path + HttpContext?.Request.QueryString, HttpContext?.Request.Method, 400, Uid, global::Nexus.Core.ClientContext.Machine);
        string msg = open ? "ไฟล์ Excel ถูกเปิดค้างอยู่ กรุณาปิดไฟล์ก่อนแล้วลองใหม่"
            : show ? ex.Message
            : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่ หากยังพบปัญหาให้แจ้ง Admin (รายละเอียดอยู่ใน BUG LOG)";
        return BadRequest(new { message = string.IsNullOrEmpty(prefix) ? msg : prefix + "\n" + msg });
    }

    // ส่งไฟล์แนบแชท / แจ้ง Admin: รูปปลอดภัยเท่านั้นที่เปิดในหน้าได้ · อื่น ๆ ดาวน์โหลดเสมอ + sandbox + nosniff
    protected IActionResult ServeAttachment(string kind, string full, string name, bool download)
    {
        Response.Headers["Content-Security-Policy"] = "sandbox";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (!download && ChatFiles.CanInline(kind, name)) return PhysicalFile(full, ChatFiles.ContentType(name));
        return PhysicalFile(full, "application/octet-stream", name);
    }

    protected IActionResult Download(string path, string contentType = null)
    {
        var bytes = System.IO.File.ReadAllBytes(path);
        contentType ??= Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".csv" => "text/csv",
            _ => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        };
        return File(bytes, contentType, Path.GetFileName(path));
    }

    // ไฟล์ Excel ที่อัปโหลด -> เก็บชั่วคราวที่ Server (ตัวอ่าน Excel เดิมรับเป็น path)
    protected static async Task<string> SaveUpload(IFormFile file)
    {
        if (file == null || file.Length == 0) throw new InvalidOperationException("กรุณาเลือกไฟล์ Excel");
        string ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".xlsx" && ext != ".xlsm") throw new InvalidOperationException("รองรับเฉพาะไฟล์ Excel (.xlsx)");
        string dir = Path.Combine(Path.GetTempPath(), "CHR-Nexus-Upload");
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir, $"{Guid.NewGuid():N}_{Path.GetFileName(file.FileName)}");
        await using var fs = System.IO.File.Create(path);
        await file.CopyToAsync(fs);
        return path;
    }

    protected static void TryDelete(string path)
    {
        try { if (!string.IsNullOrEmpty(path)) System.IO.File.Delete(path); } catch { }
    }
}
