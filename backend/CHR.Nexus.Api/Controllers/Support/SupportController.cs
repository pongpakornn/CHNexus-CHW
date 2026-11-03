using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 💬 แชทแจ้ง Admin (ปุ่มหูฟัง + เมนูวงกลมโปรไฟล์)
//   ผู้ใช้ทุกคน: เปิดเรื่องใหม่ (PROBLEM / UPDATE / PERMISSION) และคุยในเรื่องของตัวเอง
//   Admin (กำหนดสิทธิ์ได้ใน User Management หรือ Master Admin): เห็นทุกเรื่อง ตอบ และปิด / เปิดเรื่อง
[Route("api/support")]
public sealed class SupportController : AppController
{
    private readonly SupportService _svc = new();
    private const int MaxBody = 2000;

    private bool IsAdmin => Me != null && (Me.IsMasterAdmin || Me.CanSetPermissions);

    // เบอร์ติดต่อ = ALERT CONTACT ของหน้า User Management
    [HttpGet("info")]
    public IActionResult Info()
    {
        if (Me == null) return Deny();
        var contacts = DbSchema.HasAdminContacts
            ? new ScannerSetupService().GetAdminContacts().Select(c => new { c.FullName, c.Phone, c.Nickname })
            : Enumerable.Empty<object>();
        return Ok(new { enabled = DbSchema.HasSupport, isAdmin = IsAdmin, me = Uid, contacts });
    }

    [HttpGet("threads")]
    public IActionResult Threads()
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasSupport) return Ok(Array.Empty<object>());
        bool admin = IsAdmin;
        return Ok(_svc.Threads(Uid, admin).Select(t => new
        {
            t.ThreadId, t.UserId, t.UserName, t.Topic, t.Status, t.LastSender, t.UpdatedAt, t.CreatedAt,
            mine = t.UserId == Uid, unread = SupportService.Unread(t, admin && t.UserId != Uid), last = t.LastBody
        }));
    }

    [HttpGet("threads/{id:int}")]
    public IActionResult Thread(int id)
    {
        if (Me == null) return Deny();
        var t = _svc.GetThread(id);
        if (t == null) return NotFound(new { message = "ไม่พบเรื่องนี้" });
        bool mine = t.UserId == Uid;
        if (!mine && !IsAdmin) return Deny();
        _svc.MarkRead(id, !mine);
        return Ok(new { thread = new { t.ThreadId, t.UserId, t.UserName, t.Topic, t.Status, t.CreatedAt }, mine, messages = _svc.Messages(id) });
    }

    public sealed record NewThread(string Topic, string Body);

    [HttpPost("threads")]
    public IActionResult Create([FromBody] NewThread req)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasSupport) return Fail("ระบบแชทแจ้ง Admin ยังไม่พร้อมใช้งาน (ยังไม่ได้รัน database/nexus/03_Add_Support.sql)");
        string topic = (req?.Topic ?? "").Trim().ToUpperInvariant();
        if (!SupportService.Topics.Contains(topic)) return Fail("กรุณาเลือกเรื่องที่ต้องการแจ้ง");
        string body = (req?.Body ?? "").Trim();
        if (body.Length == 0) return Fail("กรุณาพิมพ์รายละเอียดก่อนส่ง");
        if (body.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        int id = _svc.Create(Uid, topic, body);
        LogService.WriteLog(Uid, "SUPPORT_NEW", $"แจ้ง Admin #{id} [{topic}] {Short(body)}", id.ToString());
        return Ok(new { threadId = id });
    }

    public sealed record NewMessage(string Body);

    [HttpPost("threads/{id:int}/messages")]
    public IActionResult Reply(int id, [FromBody] NewMessage req)
    {
        if (Me == null) return Deny();
        var t = _svc.GetThread(id);
        if (t == null) return NotFound(new { message = "ไม่พบเรื่องนี้" });
        bool mine = t.UserId == Uid;
        if (!mine && !IsAdmin) return Deny();
        string body = (req?.Body ?? "").Trim();
        if (body.Length == 0) return Fail("กรุณาพิมพ์ข้อความก่อนส่ง");
        if (body.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        _svc.Reply(id, Uid, !mine, body);
        LogService.WriteLog(Uid, mine ? "SUPPORT_MSG" : "SUPPORT_REPLY", $"แจ้ง Admin #{id} {Short(body)}", id.ToString());
        return Ok(new { ok = true });
    }

    public sealed record StatusReq(bool Close);

    [HttpPost("threads/{id:int}/status")]
    public IActionResult Status(int id, [FromBody] StatusReq req)
    {
        if (!IsAdmin) return Deny();
        if (_svc.GetThread(id) == null) return NotFound(new { message = "ไม่พบเรื่องนี้" });
        _svc.SetStatus(id, req?.Close ?? true, Uid);
        LogService.WriteLog(Uid, "SUPPORT_STATUS", $"แจ้ง Admin #{id} -> {((req?.Close ?? true) ? "CLOSED" : "OPEN")}", id.ToString());
        return Ok(new { ok = true });
    }

    // 📎 ส่งไฟล์ / รูปในเรื่องนี้ - เก็บใน Folder ของ UserID ผู้ส่ง
    [HttpPost("threads/{id:int}/file")]
    [RequestSizeLimit(ChatFiles.MaxBytes + 1024 * 1024)]
    public async Task<IActionResult> SendFile(int id, IFormFile file, [FromForm] string body)
    {
        if (Me == null) return Deny();
        var t = _svc.GetThread(id);
        if (t == null) return NotFound(new { message = "ไม่พบเรื่องนี้" });
        bool mine = t.UserId == Uid;
        if (!mine && !IsAdmin) return Deny();
        string text = (body ?? "").Trim();
        if (text.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        var (saved, err) = await ChatFiles.SaveAsync(file, Uid);
        if (err != null) return Fail(err);
        _svc.Reply(id, Uid, !mine, text, saved);
        LogService.WriteLog(Uid, mine ? "SUPPORT_MSG" : "SUPPORT_REPLY", $"แจ้ง Admin #{id} แนบไฟล์ {saved.Name}", id.ToString());
        return Ok(new { ok = true });
    }

    // 📥 เปิดรูป / ดาวน์โหลดไฟล์ (เจ้าของเรื่อง / Admin)
    [HttpGet("files/{id:int}")]
    public IActionResult Attachment(int id, [FromQuery] bool download = false)
    {
        if (Me == null) return Deny();
        var f = _svc.GetFile(id);
        if (f == null) return NotFound(new { message = "ไม่พบไฟล์" });
        var t = _svc.GetThread(f.ThreadId);
        if (t == null || (t.UserId != Uid && !IsAdmin)) return Deny();
        string full = ChatFiles.FullPath(f.Kind, f.Path);
        if (full == null) return NotFound(new { message = "ไม่พบไฟล์" });
        return download ? PhysicalFile(full, ChatFiles.ContentType(f.Name), f.Name) : PhysicalFile(full, ChatFiles.ContentType(f.Name));
    }

    // 😊 กดอีโมจิตอบข้อความ
    public sealed record ReactReq(string Emoji);

    [HttpPost("messages/{id:int}/react")]
    public IActionResult React(int id, [FromBody] ReactReq req)
    {
        if (Me == null) return Deny();
        if (!ChatService.Emojis.Contains(req?.Emoji)) return Fail("อีโมจินี้ใช้ไม่ได้");
        int? tid = _svc.ThreadOf(id);
        var t = tid == null ? null : _svc.GetThread(tid.Value);
        if (t == null || (t.UserId != Uid && !IsAdmin)) return Deny();
        ChatService.SetReaction("SUPPORT", id, Uid, req.Emoji);
        return Ok(new { ok = true });
    }

    // ⌨ กำลังพิมพ์ในเรื่องนี้ (เจ้าของเรื่อง / Admin)
    [HttpPost("threads/{id:int}/typing")]
    public IActionResult Typing(int id)
    {
        if (Me == null) return Deny();
        var t = _svc.GetThread(id);
        if (t == null || (t.UserId != Uid && !IsAdmin)) return Deny();
        TypingHub.SupportTyping(id, Uid);
        return Ok(new { ok = true });
    }

    [HttpGet("threads/{id:int}/typing")]
    public IActionResult IsTyping(int id)
    {
        if (Me == null) return Deny();
        var t = _svc.GetThread(id);
        if (t == null || (t.UserId != Uid && !IsAdmin)) return Deny();
        return Ok(new { typing = TypingHub.SupportOthersTyping(id, Uid) });
    }

    // ✏ แก้ไข / 🗑 ลบข้อความของตัวเอง
    [HttpPut("messages/{id:int}")]
    public IActionResult EditMessage(int id, [FromBody] NewMessage req)
    {
        if (Me == null) return Deny();
        string body = (req?.Body ?? "").Trim();
        if (body.Length == 0) return Fail("กรุณาพิมพ์ข้อความ");
        if (body.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        if (!_svc.EditMessage(id, Uid, body)) return Fail("แก้ไขได้เฉพาะข้อความของตัวเองที่ยังไม่ถูกลบ");
        LogService.WriteLog(Uid, "SUPPORT_EDIT", $"แก้ไขข้อความแจ้ง Admin #{id}", id.ToString());
        return Ok(new { ok = true });
    }

    [HttpDelete("messages/{id:int}")]
    public IActionResult DeleteMessage(int id)
    {
        if (Me == null) return Deny();
        if (!_svc.DeleteMessage(id, Uid)) return Fail("ลบได้เฉพาะข้อความของตัวเอง");
        LogService.WriteLog(Uid, "SUPPORT_DELMSG", $"ลบข้อความแจ้ง Admin #{id}", id.ToString());
        return Ok(new { ok = true });
    }

    // 🗑 ลบทั้งเรื่อง: เจ้าของเรื่อง หรือ Admin
    [HttpDelete("threads/{id:int}")]
    public IActionResult DeleteThread(int id)
    {
        if (Me == null) return Deny();
        var t = _svc.GetThread(id);
        if (t == null) return NotFound(new { message = "ไม่พบเรื่องนี้" });
        if (t.UserId != Uid && !IsAdmin) return Deny();
        _svc.DeleteThread(id);
        LogService.WriteLog(Uid, "SUPPORT_DELETE", $"ลบเรื่องแจ้ง Admin #{id} [{t.Topic}] ของ {t.UserId}", id.ToString());
        return Ok(new { ok = true });
    }

    private static string Short(string s) => s.Length > 80 ? s[..80] + "…" : s;
}
