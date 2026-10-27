using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace CHR.Nexus.Api.Web;

// 🟢 สถานะออนไลน์จริง (Nexus.Users.IsOnline): เดิมเป็น 0 เฉพาะตอนกด Logout -> ปิดหน้าต่าง / ปิด Browser / เน็ตหลุด = ค้าง ONLINE
//    แล้ว Login จากเครื่องอื่นไม่ได้ ("บัญชีนี้กำลังใช้งานอยู่ในเครื่องอื่น")
//    ตอนนี้: ทุก Request ที่ Login อยู่ = "ยังใช้งาน" (หน้าเว็บส่ง ping ทุก 60 วินาที แม้ซ่อนแท็บ)
//      - เงียบเกิน 3 นาที = OFFLINE ให้เอง (เขียนเฉพาะฐาน CHR-Nexus) -> Login เครื่องอื่นได้
//      - ปิดหน้าต่าง = หน้าเว็บส่ง bye -> OFFLINE ภายในราว 20 วินาที (กด Reload / เปิดหน้าใหม่ทัน = ยัง ONLINE)
//      - ถูกตั้ง OFFLINE แต่ยังใช้งานอยู่ (เช่น Server เพิ่งเริ่ม) = กลับเป็น ONLINE เองใน Request ถัดไป
public static class Presence
{
    public static readonly TimeSpan Idle = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan ByeGrace = TimeSpan.FromSeconds(20);
    private static readonly ConcurrentDictionary<string, (DateTime At, string Device)> Seen = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, byte> Offline = new(StringComparer.OrdinalIgnoreCase); // ตั้ง OFFLINE ไปแล้ว รอใช้งานใหม่
    public static readonly DateTime Started = DateTime.UtcNow;

    public static void Touch(string uid, string device)
    {
        if (string.IsNullOrEmpty(uid)) return;
        bool first = !Seen.ContainsKey(uid); // ครั้งแรกตั้งแต่ Server เริ่ม = ยืนยัน ONLINE ในฐานให้ตรงกับที่ใช้งานจริง
        Seen[uid] = (DateTime.UtcNow, device ?? "");
        if (Offline.TryRemove(uid, out _) || first) SetOnline(uid, device);
    }

    // ปิดหน้าต่าง: ถือว่าเงียบไปแล้ว เหลือเวลาอีก ByeGrace ก่อน OFFLINE
    public static void Bye(string uid)
    {
        if (string.IsNullOrEmpty(uid)) return;
        if (Seen.TryGetValue(uid, out var s)) Seen[uid] = (DateTime.UtcNow - Idle + ByeGrace, s.Device);
    }

    // Login / Logout เอง
    public static void LoggedIn(string uid, string device) { Offline.TryRemove(uid ?? "", out _); Seen[uid] = (DateTime.UtcNow, device ?? ""); }
    public static void LoggedOut(string uid) { Seen.TryRemove(uid ?? "", out _); Offline.TryRemove(uid ?? "", out _); }

    // ยังใช้งานอยู่จริงไหม (ใช้ตอน Login เครื่องอื่น: ONLINE ค้างแต่เงียบเกิน 3 นาที = ให้เข้าได้)
    public static bool IsActive(string uid) => Seen.TryGetValue(uid ?? "", out var s) && DateTime.UtcNow - s.At < Idle;

    // Login จากเครื่องอื่นขณะ ONLINE ค้าง: เคยเห็นแต่เงียบเกิน 3 นาที / ไม่เคยเห็นเลยตั้งแต่ Server เริ่มเกิน 3 นาที = เครื่องเดิมไม่ได้ใช้แล้ว
    public static bool CanTakeOver(string uid) =>
        Seen.TryGetValue(uid ?? "", out var s) ? DateTime.UtcNow - s.At >= Idle : DateTime.UtcNow - Started >= Idle;

    // รอบเก็บกวาด (ทุก 30 วินาที): ONLINE ในฐานแต่ไม่มีการใช้งานเกิน 3 นาที = OFFLINE
    //   Server เพิ่งเริ่มยังไม่ครบ 3 นาที = รอก่อน (ให้คนที่เปิดหน้าอยู่ได้ ping เข้ามาก่อน)
    public static int Sweep()
    {
        if (DateTime.UtcNow - Started < Idle) return 0;
        var online = new List<string>();
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        conn.Open();
        using (var cmd = new SqlCommand("SELECT UserID FROM Nexus.Users WHERE IsOnline = 1", conn) { CommandTimeout = 10 })
        using (var r = cmd.ExecuteReader())
            while (r.Read()) online.Add(r.GetString(0));
        var stale = online.Where(u => !IsActive(u)).ToList();
        foreach (var u in stale)
        {
            using var up = new SqlCommand("UPDATE Nexus.Users SET IsOnline = 0 WHERE UserID = @u AND IsOnline = 1", conn) { CommandTimeout = 10 };
            up.Parameters.AddWithValue("@u", u);
            if (up.ExecuteNonQuery() > 0)
            {
                Offline[u] = 1;
                global::Nexus.Services.LogService.WriteLog(u, "AUTO_OFFLINE", "ไม่มีการใช้งานเกิน 3 นาที / ปิดหน้าต่าง -> ตั้งเป็น OFFLINE ให้อัตโนมัติ", "");
            }
        }
        // ล้างรายการเก่าในหน่วยความจำ
        foreach (var k in Seen.Where(x => DateTime.UtcNow - x.Value.At > TimeSpan.FromHours(1)).Select(x => x.Key).ToList()) Seen.TryRemove(k, out _);
        return stale.Count;
    }

    private static void SetOnline(string uid, string device)
    {
        Task.Run(() =>
        {
            try
            {
                using var conn = new SqlConnection(GlobalConfig.ConnStr);
                using var cmd = new SqlCommand("UPDATE Nexus.Users SET IsOnline = 1, LastSession = @pc WHERE UserID = @u AND ISNULL(IsLocked, 0) = 0", conn) { CommandTimeout = 10 };
                cmd.Parameters.AddWithValue("@pc", string.IsNullOrEmpty(device) ? DBNull.Value : device);
                cmd.Parameters.AddWithValue("@u", uid);
                conn.Open();
                cmd.ExecuteNonQuery();
            }
            catch { /* รอบหน้าลองใหม่ */ }
        });
    }
}

// ทุก Request ที่ Login อยู่ = ยังใช้งาน
public sealed class PresenceMiddleware
{
    private readonly RequestDelegate _next;
    public PresenceMiddleware(RequestDelegate next) => _next = next;

    public Task Invoke(HttpContext ctx)
    {
        if (ctx.User?.Identity?.IsAuthenticated == true && !ctx.Request.Path.StartsWithSegments("/api/auth/bye"))
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
                int n = Presence.Sweep();
                if (n > 0) _log.LogInformation("Presence: {Count} user(s) set OFFLINE", n);
            }
            catch (Exception ex) { _log.LogDebug(ex, "Presence sweep"); }
        }
    }
}
