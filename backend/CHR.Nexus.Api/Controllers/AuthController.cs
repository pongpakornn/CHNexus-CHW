using CHR.Nexus.Api.Web;
using CHR.Nexus.Api.Web.Auth;
using Nexus.Models;
using Nexus.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace CHR.Nexus.Api.Controllers;

// 🔐 Login / Logout - เงื่อนไขเดิมของ LoginView + AuthService:
//    บัญชีที่ Online อยู่เครื่องอื่น = เข้าไม่ได้ (เครื่องเดิม Bypass ได้) / ล็อกแล้ว = เข้าไม่ได้ / Login = IsOnline 1 + LastLogin + LastSession
[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly JwtTokens _tokens;
    private readonly JwtOptions _opt;
    private readonly ICurrentUser _me;
    private readonly IMemoryCache _cache;

    public AuthController(JwtTokens tokens, JwtOptions opt, ICurrentUser me, IMemoryCache cache)
    {
        _tokens = tokens; _opt = opt; _me = me; _cache = cache;
    }

    public sealed record LoginRequest(string UserId, string Password);

    [AllowAnonymous]
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.UserId) || string.IsNullOrEmpty(req.Password))
            return BadRequest(new { message = "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });

        var auth = new AuthService();
        UserSession session;
        try { session = auth.Authenticate(req.UserId.Trim(), req.Password); }
        catch (Exception ex)
        {
            // ONLINE ค้างจากเครื่องอื่น แต่เครื่องนั้นไม่ได้ใช้งานแล้ว (ปิดหน้าต่าง / เงียบเกิน 3 นาที) + รหัสผ่านถูก = ปลดสถานะเดิมแล้วเข้าได้เลย
            string uid0 = req.UserId.Trim();
            if (!Presence.CanTakeOver(uid0) || !PasswordOk(uid0, req.Password)) return Conflict(new { message = ex.Message });   // Online อยู่เครื่องอื่นจริง
            auth.UpdateLogoutStatus(uid0);
            LogService.WriteLog(uid0, "AUTO_OFFLINE", "ปลดสถานะ ONLINE ค้าง (เครื่องเดิมไม่ได้ใช้งานแล้ว) แล้วเข้าสู่ระบบจากเครื่องใหม่", global::Nexus.Core.ClientContext.Machine);
            try { session = auth.Authenticate(uid0, req.Password); }
            catch (Exception ex2) { return Conflict(new { message = ex2.Message }); }
        }
        if (session == null)
        {
            return Unauthorized(new { message = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
        }

        auth.UpdateLoginStats(session.UserId);
        Presence.LoggedIn(session.UserId);
        LogService.WriteLog(session.UserId, "LOGIN", "เข้าสู่ระบบสำเร็จ", global::Nexus.Core.ClientContext.Machine);
        CurrentUser.Forget(_cache, session.UserId);

        Response.Cookies.Append(_opt.CookieName, _tokens.Create(session.UserId, global::Nexus.Core.ClientContext.Machine), new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = Request.IsHttps,
            Expires = DateTimeOffset.UtcNow.AddHours(_opt.Hours)
        });
        return Ok(MeDto.From(session));
    }

    [Authorize]
    [HttpPost("logout")]
    public IActionResult Logout()
    {
        string uid = _me.UserId;
        if (!string.IsNullOrEmpty(uid))
        {
            new AuthService().UpdateLogoutStatus(uid);
            Presence.LoggedOut(uid);
            LogService.WriteLog(uid, "LOGOUT", "ออกจากระบบสำเร็จ", "");
            CurrentUser.Forget(_cache, uid);
        }
        Response.Cookies.Delete(_opt.CookieName);
        return Ok();
    }

    // หน้าเว็บยังเปิดอยู่ (ทุก 60 วินาที แม้ซ่อนแท็บ) - Middleware นับเป็นการใช้งานให้แล้ว
    [Authorize]
    [HttpPost("ping")]
    public IActionResult Ping() => NoContent();

    // ปิดหน้าต่าง / ปิด Browser (sendBeacon) -> OFFLINE ภายในราว 20 วินาที ถ้าไม่มีหน้าไหนของผู้ใช้นี้ใช้งานต่อ
    [Authorize]
    [HttpPost("bye")]
    public IActionResult Bye()
    {
        Presence.Bye(_me.UserId);
        return NoContent();
    }

    private static bool PasswordOk(string uid, string password)
    {
        using var conn = new Microsoft.Data.SqlClient.SqlConnection(global::Nexus.Core.GlobalConfig.ConnStr);
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand("SELECT COUNT(*) FROM Nexus.Users WHERE UserID = @u AND Password = @p AND ISNULL(IsLocked, 0) = 0", conn);
        cmd.Parameters.AddWithValue("@u", uid);
        cmd.Parameters.AddWithValue("@p", password ?? "");
        conn.Open();
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        var s = _me.Session;
        if (s == null) { Response.Cookies.Delete(_opt.CookieName); return Unauthorized(); }
        return Ok(MeDto.From(s));
    }
}
