using CHR.Nexus.Api.Web;
using Nexus.Helpers;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Nexus.Api.Controllers;

// 💬 แชทระหว่างผู้ใช้ (หนึ่งต่อหนึ่ง) + ฟีดข้อความใหม่สำหรับ Toast
//   ทุกคำสั่งใช้ UserID ของผู้ที่ Login อยู่ = เห็นเฉพาะแชทของตัวเองเท่านั้น
[Route("api/chat")]
public sealed class ChatController : AppController
{
    private readonly ChatService _svc = new();
    private const int MaxBody = 2000;

    private IActionResult NotReady() => Fail("ระบบแชทยังไม่พร้อมใช้งาน (ยังไม่ได้รัน database/nexus/04_Add_Chat.sql)");

    [HttpGet("users")]
    public IActionResult Users()
    {
        if (Me == null) return Deny();
        return Ok(_svc.Users(Uid));
    }

    [HttpGet("conversations")]
    public IActionResult Conversations()
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return Ok(Array.Empty<object>());
        return Ok(_svc.Conversations(Uid));
    }

    [HttpGet("with/{userId}")]
    public IActionResult With(string userId)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        return Ok(_svc.With(Uid, userId));
    }

    public sealed record SendReq(string Body);

    [HttpPost("with/{userId}")]
    public IActionResult Send(string userId, [FromBody] SendReq req)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        if (string.Equals(userId, Uid, StringComparison.OrdinalIgnoreCase)) return Fail("ส่งข้อความหาตัวเองไม่ได้");
        if (!_svc.UserExists(userId)) return Fail("ไม่พบผู้ใช้นี้ หรือบัญชีถูกล็อก");
        string body = (req?.Body ?? "").Trim();
        if (body.Length == 0) return Fail("กรุณาพิมพ์ข้อความก่อนส่ง");
        if (body.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        _svc.Send(Uid, userId, body);
        return Ok(new { ok = true });
    }

    // 📎 ส่งไฟล์ / รูป (+ ข้อความประกอบได้) - เก็บใน Folder ของ UserID ผู้ส่ง
    [HttpPost("with/{userId}/file")]
    [RequestSizeLimit(ChatFiles.MaxBytes + 1024 * 1024)]
    public async Task<IActionResult> SendFile(string userId, IFormFile file, [FromForm] string body)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        if (string.Equals(userId, Uid, StringComparison.OrdinalIgnoreCase)) return Fail("ส่งข้อความหาตัวเองไม่ได้");
        if (!_svc.UserExists(userId)) return Fail("ไม่พบผู้ใช้นี้ หรือบัญชีถูกล็อก");
        string text = (body ?? "").Trim();
        if (text.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        var (saved, err) = await ChatFiles.SaveAsync(file, Uid);
        if (err != null) return Fail(err);
        _svc.Send(Uid, userId, text, saved);
        return Ok(new { ok = true });
    }

    // 📥 เปิดรูป / ดาวน์โหลดไฟล์ (เฉพาะผู้ส่ง / ผู้รับ) - ส่งไฟล์ออกไปอย่างเดียว ไม่บันทึกอะไรเพิ่ม
    [HttpGet("files/{id:int}")]
    public IActionResult Attachment(int id, [FromQuery] bool download = false)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        var f = _svc.GetFile(Uid, id);
        string full = f == null ? null : ChatFiles.FullPath(f.Kind, f.Path);
        if (full == null) return NotFound(new { message = "ไม่พบไฟล์" });
        return download ? PhysicalFile(full, ChatFiles.ContentType(f.Name), f.Name) : PhysicalFile(full, ChatFiles.ContentType(f.Name));
    }

    // 😊 กดอีโมจิตอบข้อความ (กดอันเดิมซ้ำ = ยกเลิก)
    public sealed record ReactReq(string Emoji);

    [HttpPost("messages/{id:int}/react")]
    public IActionResult React(int id, [FromBody] ReactReq req)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        if (!ChatService.Emojis.Contains(req?.Emoji)) return Fail("อีโมจินี้ใช้ไม่ได้");
        if (!_svc.CanSee(Uid, id)) return Deny();
        ChatService.SetReaction("DM", id, Uid, req.Emoji);
        return Ok(new { ok = true });
    }

    // ⌨ กำลังพิมพ์: POST = ฉันกำลังพิมพ์หาคนนี้ · GET = คนนี้กำลังพิมพ์หาฉันไหม
    [HttpPost("typing/{userId}")]
    public IActionResult Typing(string userId)
    {
        if (Me == null) return Deny();
        TypingHub.DmTyping(Uid, userId);
        return Ok(new { ok = true });
    }

    [HttpGet("typing/{userId}")]
    public IActionResult IsTyping(string userId)
    {
        if (Me == null) return Deny();
        return Ok(new { typing = TypingHub.DmIsTyping(userId, Uid) });
    }

    // ✏ แก้ไข / 🗑 ลบข้อความของตัวเอง
    [HttpPut("messages/{id:int}")]
    public IActionResult Edit(int id, [FromBody] SendReq req)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        string body = (req?.Body ?? "").Trim();
        if (body.Length == 0) return Fail("กรุณาพิมพ์ข้อความ");
        if (body.Length > MaxBody) return Fail($"ข้อความยาวได้ไม่เกิน {MaxBody} ตัวอักษร");
        return _svc.Edit(Uid, id, body) ? Ok(new { ok = true }) : Fail("แก้ไขได้เฉพาะข้อความของตัวเองที่ยังไม่ถูกลบ");
    }

    [HttpDelete("messages/{id:int}")]
    public IActionResult Delete(int id)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        return _svc.Delete(Uid, id) ? Ok(new { ok = true }) : Fail("ลบได้เฉพาะข้อความของตัวเอง");
    }

    // 🗑 ลบแชททั้งหมดกับคนนี้ (ซ่อนจากฝั่งตัวเองเท่านั้น)
    [HttpDelete("with/{userId}")]
    public IActionResult Clear(string userId)
    {
        if (Me == null) return Deny();
        if (!DbSchema.HasChat) return NotReady();
        int n = _svc.Clear(Uid, userId);
        LogService.WriteLog(Uid, "CHAT_CLEAR", $"ลบแชททั้งหมดกับ {userId} ({n} ข้อความ · ซ่อนเฉพาะฝั่งตัวเอง)", userId);
        return Ok(new { ok = true });
    }

    // ฟีดข้อความใหม่: เรียกครั้งแรกไม่ส่ง dm / sup = รับเลขล่าสุดอย่างเดียว (ไม่เด้ง Toast ย้อนหลัง)
    [HttpGet("feed")]
    public IActionResult Feed([FromQuery] int? dm, [FromQuery] int? sup)
    {
        if (Me == null) return Deny();
        bool admin = Me.IsMasterAdmin || Me.CanSetPermissions;
        var f = _svc.Feed(Uid, admin, dm, sup, DbSchema.HasChat, DbSchema.HasSupport);
        return Ok(new { dm = f.DmMax, sup = f.SupMax, items = f.Items });
    }
}
