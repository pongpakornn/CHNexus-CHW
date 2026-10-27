using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace CHR.Nexus.Api.Web;

// 🟢 สถานะออนไลน์จริง (Nexus.Users.IsOnline + LastSeenAt - database/nexus/11_User_LastSeen.sql)
//    เดิม IsOnline เป็น 0 เฉพาะตอนกด Logout -> ปิดหน้าต่าง / ปิด Browser / เน็ตหลุด = ค้าง ONLINE แล้ว Login เครื่องอื่นไม่ได้
//    ตอนนี้ (ตารางผู้ใช้ใช้ร่วมกับโปรแกรม WPF):
//      - เว็บที่ Login อยู่ = heartbeat: LastSeenAt = ตอนนี้ (เขียนฐานไม่เกิน 1 ครั้ง / 30 วินาที / ผู้ใช้) + IsOnline = 1
//      - ปิดหน้าต่าง = bye -> LastSeenAt ถอยไป ให้ OFFLINE ในราว 20 วินาที (Reload ทัน = ยัง ONLINE)
//      - รอบเก็บกวาด: ONLINE + LastSeenAt เก่ากว่า 3 นาที = OFFLINE (ทั้งเว็บ และ WPF ที่ส่ง heartbeat แล้ว)
//      - LastSeenAt = NULL (WPF เวอร์ชันเก่า) = ไม่แตะ ใช้เงื่อนไขเดิมของ WPF
//    เก็บในฐาน -> Server เริ่มใหม่ / หลายเครื่อง (pm2) ใช้ค่าเดียวกัน · เขียนเฉพาะ Nexus.Users ในฐาน CHR-Nexus
public static class Presence
{
    public const int IdleSeconds = 180;
    private const int ByeGraceSeconds = 20;
    private static readonly TimeSpan WriteEvery = TimeSpan.FromSeconds(30);
    private static readonly ConcurrentDictionary<string, DateTime> Written = new(StringComparer.OrdinalIgnoreCase);
    private static bool? _ready;

    // ยังไม่รัน 11_User_LastSeen.sql = ปิดระบบนี้ (กลับไปใช้แบบเดิม)
    public static bool Ready
    {
        get
        {
            if (_ready.HasValue) return _ready.Value;
            try
            {
                using var conn = new SqlConnection(GlobalConfig.ConnStr);
                using var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.Users', 'LastSeenAt') IS NULL THEN 0 ELSE 1 END", conn);
                conn.Open();
                _ready = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
            }
            catch { return false; }
            return _ready.Value;
        }
    }

    private static string Key(string uid) => (uid ?? "").Trim();

    // Request ของผู้ใช้ที่ Login อยู่ = ยังใช้งาน
    public static void Touch(string uid, string device)
    {
        uid = Key(uid);
        if (uid.Length == 0 || !Ready) return;
        var now = DateTime.UtcNow;
        if (Written.TryGetValue(uid, out var at) && now - at < WriteEvery) return;
        Written[uid] = now;
        Exec("UPDATE Nexus.Users SET LastSeenAt = SYSDATETIME(), IsOnline = 1, LastSession = ISNULL(@pc, LastSession) WHERE UserID = @u AND ISNULL(IsLocked, 0) = 0",
             uid, string.IsNullOrEmpty(device) ? null : device);
    }

    // ปิดหน้าต่าง: เหลือเวลา ByeGrace ก่อน OFFLINE (มี Request ใหม่ก่อนนั้น = ยัง ONLINE)
    public static void Bye(string uid)
    {
        uid = Key(uid);
        if (uid.Length == 0 || !Ready) return;
        Written.TryRemove(uid, out _);
        Exec($"UPDATE Nexus.Users SET LastSeenAt = DATEADD(SECOND, -{IdleSeconds - ByeGraceSeconds}, SYSDATETIME()) WHERE UserID = @u", uid, null);
    }

    public static void LoggedIn(string uid)
    {
        uid = Key(uid);
        Written[uid] = DateTime.UtcNow;
        if (Ready) Exec("UPDATE Nexus.Users SET LastSeenAt = SYSDATETIME() WHERE UserID = @u", uid, null);
    }

    public static void LoggedOut(string uid) => Written.TryRemove(Key(uid), out _);

    // Login จากเครื่องอื่นขณะ ONLINE ค้าง: ปลดได้เมื่อเครื่องเดิมไม่ได้ส่ง heartbeat เกิน 3 นาที
    //   หรือเป็น session ของเว็บที่ไม่เคยส่ง heartbeat (ก่อนมีระบบนี้) · WPF เวอร์ชันเก่า (ไม่มี LastSeenAt) = ไม่ปลด
    public static bool CanTakeOver(string uid)
    {
        if (!Ready) return false;
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        using var cmd = new SqlCommand($@"SELECT COUNT(*) FROM Nexus.Users WHERE UserID = @u AND IsOnline = 1 AND (
                                             (LastSeenAt IS NOT NULL AND LastSeenAt < DATEADD(SECOND, -{IdleSeconds}, SYSDATETIME()))
                                          OR (LastSeenAt IS NULL AND LastSession LIKE 'WEB-%'))", conn);
        cmd.Parameters.AddWithValue("@u", Key(uid));
        conn.Open();
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    // รอบเก็บกวาด: ONLINE แต่ heartbeat เงียบเกิน 3 นาที (และไม่ได้เพิ่ง Login) = OFFLINE + ลง Activity Log
    public static List<(string User, string Session, int Quiet)> Sweep()
    {
        var done = new List<(string, string, int)>();
        if (!Ready) return done;
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        using var cmd = new SqlCommand($@"
            UPDATE Nexus.Users SET IsOnline = 0
            OUTPUT inserted.UserID, inserted.LastSession, DATEDIFF(SECOND, inserted.LastSeenAt, SYSDATETIME())
             WHERE IsOnline = 1 AND LastSeenAt IS NOT NULL
               AND LastSeenAt < DATEADD(SECOND, -{IdleSeconds}, SYSDATETIME())
               AND (LastLogin IS NULL OR LastLogin < DATEADD(SECOND, -{IdleSeconds}, GETDATE()))", conn) { CommandTimeout = 15 };
        conn.Open();
        using (var r = cmd.ExecuteReader())
            while (r.Read()) done.Add((r.GetString(0).Trim(), r.IsDBNull(1) ? "" : r.GetString(1), r.IsDBNull(2) ? 0 : r.GetInt32(2)));
        foreach (var (u, s, q) in done)
        {
            Written.TryRemove(u, out _);
            global::Nexus.Services.LogService.WriteLog(u, "AUTO_OFFLINE", $"ไม่มีการใช้งาน {q} วินาที (ปิดหน้าต่าง / ปิดโปรแกรม / เน็ตหลุด) -> ตั้งเป็น OFFLINE ให้อัตโนมัติ • เครื่อง {s}", "");
        }
        return done;
    }

    private static void Exec(string sql, string uid, string device)
    {
        Task.Run(() =>
        {
            try
            {
                using var conn = new SqlConnection(GlobalConfig.ConnStr);
                using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 10 };
                cmd.Parameters.AddWithValue("@u", uid);
                if (sql.Contains("@pc")) cmd.Parameters.AddWithValue("@pc", (object)device ?? DBNull.Value);
                conn.Open();
                cmd.ExecuteNonQuery();
            }
            catch { Written.TryRemove(uid, out _); /* รอบหน้าลองใหม่ */ }
        });
    }
}

// ทุก Request ที่ Login อยู่ = ยังใช้งาน (ยกเว้น bye / logout)
public sealed class PresenceMiddleware
{
    private readonly RequestDelegate _next;
    public PresenceMiddleware(RequestDelegate next) => _next = next;

    public Task Invoke(HttpContext ctx)
    {
        if (ctx.User?.Identity?.IsAuthenticated == true && !ctx.Request.Path.StartsWithSegments("/api/auth/bye") && !ctx.Request.Path.StartsWithSegments("/api/auth/logout"))
            Presence.Touch(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier), ctx.User.FindFirstValue("device"));
        return _next(ctx);
    }
}

// เก็บกวาดสถานะค้างทุก 30 วินาที
public sealed class PresenceSweeper : BackgroundService
{
    private readonly ILogger<PresenceSweeper> _log;
    public PresenceSweeper(ILogger<PresenceSweeper> log) => _log = log;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await Task.Delay(TimeSpan.FromSeconds(30), ct); } catch (OperationCanceledException) { return; }
            try
            {
                var n = Presence.Sweep();
                if (n.Count > 0) _log.LogInformation("Presence: {Count} user(s) set OFFLINE", n.Count);
            }
            catch (Exception ex) { _log.LogDebug(ex, "Presence sweep"); }
        }
    }
}
