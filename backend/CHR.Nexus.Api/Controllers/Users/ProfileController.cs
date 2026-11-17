using CHR.Nexus.Api.Web;
using CHR.Nexus.Api.Web.Auth;
using Nexus.Core;
using Nexus.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace CHR.Nexus.Api.Controllers;

// 👤 โปรไฟล์ของตัวเอง (วงกลมโปรไฟล์ -> แก้ไขโปรไฟล์): ทุกคนแก้ได้เฉพาะ UserID ของตัวเอง
//   แก้ได้: ชื่อ / ตำแหน่ง / หน่วยงาน / แผนก / ฝ่าย / รหัสผ่าน (ต้องกรอกรหัสผ่านปัจจุบันก่อน)
//   แก้ไม่ได้: UserID (ผูกกับประวัติสแกน / PR / Log / สิทธิ์) / Level / สิทธิ์ / ล็อกบัญชี = ให้ Admin แก้ในหน้า User Management
[Route("api/profile")]
public sealed class ProfileController : AppController
{
    private readonly IMemoryCache _cache;
    public ProfileController(IMemoryCache cache) => _cache = cache;

    public sealed record ProfileDto(string Name, string Position, string Department, string Section, string Division);
    public sealed record PasswordDto(string Current, string Next, string Confirm);

    [HttpGet]
    public IActionResult Get()
    {
        if (Me == null) return Deny();
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        using var cmd = new SqlCommand(@"SELECT UserID, FullName, Position, Department, Section, Division, ISNULL(UserLevel, 3) AS LVL,
                                                ISNULL(IsMasterAdmin, 0) AS MA, LastLogin, LastSession
                                         FROM Nexus.Users WHERE UserID = @u", conn);
        cmd.Parameters.AddWithValue("@u", Uid);
        conn.Open();
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return Deny();
        string S(string c) => r[c] == DBNull.Value ? "" : r[c].ToString();
        int lvl = Convert.ToInt32(r["LVL"]);
        return Ok(new
        {
            userId = S("UserID"), name = S("FullName"), position = S("Position"), department = S("Department"), section = S("Section"), division = S("Division"),
            level = lvl, levelText = lvl == 1 ? "LEVEL 1 • ADMIN" : lvl == 2 ? "LEVEL 2 • MANAGER" : "LEVEL 3 • STAFF",
            masterAdmin = Convert.ToBoolean(r["MA"]),
            lastLogin = r["LastLogin"] == DBNull.Value ? null : Convert.ToDateTime(r["LastLogin"]).ToString("dd/MM/yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture),
            lastSession = S("LastSession")
        });
    }

    [HttpPut]
    public IActionResult Save([FromBody] ProfileDto f)
    {
        if (Me == null) return Deny();
        string T(string s) => (s ?? "").Trim();
        string name = T(f?.Name);
        if (name.Length == 0) return Fail("กรุณากรอก NAME");
        if (name.Length > 100) return Fail("NAME ยาวเกิน 100 ตัวอักษร");
        try
        {
            using var conn = new SqlConnection(GlobalConfig.ConnStr);
            using var cmd = new SqlCommand(@"UPDATE Nexus.Users SET FullName = @n, Position = @pos, Department = @d, Section = @sec, Division = @div WHERE UserID = @u", conn);
            object V(string s) => T(s).Length == 0 ? DBNull.Value : T(s);
            cmd.Parameters.AddWithValue("@u", Uid);
            cmd.Parameters.AddWithValue("@n", name);
            cmd.Parameters.AddWithValue("@pos", V(f.Position));
            cmd.Parameters.AddWithValue("@d", V(f.Department));
            cmd.Parameters.AddWithValue("@sec", V(f.Section));
            cmd.Parameters.AddWithValue("@div", V(f.Division));
            conn.Open();
            cmd.ExecuteNonQuery();
            CurrentUser.Forget(_cache, Uid);
            LogService.WriteLog(Uid, "PROFILE_EDIT", $"Edited own profile | {name} | {T(f.Position)} | {T(f.Department)} | {T(f.Section)} | {T(f.Division)}", Uid);
            return Ok(new { message = "บันทึกโปรไฟล์แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกโปรไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("password")]
    public IActionResult Password([FromBody] PasswordDto f)
    {
        if (Me == null) return Deny();
        if (string.IsNullOrEmpty(f?.Current)) return Fail("กรุณากรอกรหัสผ่านปัจจุบัน");
        if (string.IsNullOrEmpty(f.Next)) return Fail("กรุณากรอกรหัสผ่านใหม่");
        if (f.Next.Length < 4) return Fail("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร");
        if (f.Next != f.Confirm) return Fail("ยืนยันรหัสผ่านใหม่ไม่ตรงกัน");
        if (f.Next == f.Current) return Fail("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม");
        try
        {
            // 🔐 ตรวจรหัสเดิม + เก็บรหัสใหม่แบบ Hash (PasswordStore)
            string ip = ClientIp.Of(HttpContext);
            if (LoginGuard.Blocked(Uid, ip) is { } blocked) return StatusCode(429, new { message = blocked });
            if (!PasswordStore.Check(Uid, f.Current)) { LoginGuard.Fail(Uid, ip); return Fail("รหัสผ่านปัจจุบันไม่ถูกต้อง"); }
            LoginGuard.Success(Uid, ip);
            PasswordStore.Store(Uid, f.Next);
            LogService.WriteLog(Uid, "PROFILE_PASSWORD", "Changed own password", Uid);
            return Ok(new { message = "เปลี่ยนรหัสผ่านแล้ว ครั้งหน้าใช้รหัสผ่านใหม่ในการเข้าสู่ระบบ" });
        }
        catch (Exception ex) { return Fail(ex, "เปลี่ยนรหัสผ่านไม่สำเร็จ"); }
    }
}
