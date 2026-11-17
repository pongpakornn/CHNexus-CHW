using System.Collections.Concurrent;
using System.Net;

namespace CHR.Nexus.Api.Web;

// 🛡 ความปลอดภัยของ API (ไม่แตะฐานข้อมูล / ระบบอื่น · ทำงานในหน่วยความจำ เบา ไม่หน่วงผู้ใช้)
//   1) SecurityHeaders : กันฝังหน้าใน iframe (Clickjacking) · กันเดาชนิดไฟล์ · ไม่ส่ง Referrer ออกนอก · JSON ไม่ถูก Cache
//   2) CSRF guard      : คำสั่งบันทึก (POST / PUT / PATCH / DELETE) ที่ Browser บอกว่ามาจาก "เว็บอื่น" (Sec-Fetch-Site: cross-site) = ปฏิเสธ
//   3) LoginGuard      : รหัสผ่านผิดติดกัน 5 ครั้ง / UserID หรือ 20 ครั้ง / เครื่อง ใน 15 นาที = ล็อกชั่วคราว 15 นาที (กันเดารหัส Brute-force)
//   4) TokenRevoke     : Logout แล้ว Token เดิมใช้ไม่ได้อีก (แม้ถูกขโมยไป) · ปลดสถานะค้าง / ล็อกบัญชี = Session หายทันทีอยู่แล้ว
//   5) RequestLimit    : จำกัดจำนวนคำขอต่อเครื่อง (กันยิงถล่ม API) - long-poll เรียลไทม์ไม่นับ
public static class ClientIp
{
    // API อยู่หลัง Next (proxy เครื่องเดียวกัน) -> IP จริงอยู่ใน X-Forwarded-For (เชื่อเฉพาะเมื่อมาจาก loopback)
    public static string Of(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress;
        if (ip != null && IPAddress.IsLoopback(ip))
        {
            // shortcut: first entry as before (proxy chain on .56 unverified; LastForwarded is safer once the chain is confirmed)
            string xff = ctx.Request.Headers["X-Forwarded-For"].ToString();
            if (!string.IsNullOrWhiteSpace(xff)) return xff.Split(',')[0].Trim();
        }
        return ip?.ToString() ?? "unknown";
    }

    public static string LastForwarded(string xff)
    {
        if (string.IsNullOrWhiteSpace(xff)) return null;
        var v = xff.Split(',')[^1].Trim();
        return v.Length == 0 ? null : v;
    }

    /// <summary>Origin must match the request host, X-Forwarded-Host (our own proxy) or a configured origin. No Origin = true.</summary>
    public static bool OriginOk(string origin, string host, string fwdHost, IEnumerable<string> allowed)
    {
        if (string.IsNullOrEmpty(origin)) return true;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var u)) return false;
        bool Same(string h) => !string.IsNullOrEmpty(h) && string.Equals(u.Authority, h.Split(',')[0].Trim(), StringComparison.OrdinalIgnoreCase);
        return Same(host) || Same(fwdHost) || (allowed?.Any(a => string.Equals(a?.TrimEnd('/'), origin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)) ?? false);
    }
}

public sealed class SecurityMiddleware
{
    private readonly RequestDelegate _next;
    public SecurityMiddleware(RequestDelegate next) => _next = next;

    // ต่อเครื่อง: 1,500 คำขอ / นาที (เผื่อเครื่องสแกนที่ใช้งานหนัก) · เกิน = 429 รอ 1 นาที
    private const int PerMinute = 1500;
    private static readonly ConcurrentDictionary<string, (long Minute, int Count)> Hits = new();
    private static long _sweep;

    public async Task Invoke(HttpContext ctx)
    {
        var req = ctx.Request;
        ctx.Response.OnStarting(() =>
        {
            var h = ctx.Response.Headers;
            h["X-Content-Type-Options"] = "nosniff";
            h["X-Frame-Options"] = "DENY";
            h["Referrer-Policy"] = "same-origin";
            h["Cross-Origin-Resource-Policy"] = "same-origin";
            h["X-Permitted-Cross-Domain-Policies"] = "none";
            h["Permissions-Policy"] = "geolocation=(), microphone=(), payment=(), usb=()";
            if (!h.ContainsKey("Cache-Control") && (ctx.Response.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                h["Cache-Control"] = "no-store";
            return Task.CompletedTask;
        });

        bool unsafeMethod = !(HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method) || HttpMethods.IsOptions(req.Method));
        if (unsafeMethod && string.Equals(req.Headers["Sec-Fetch-Site"].ToString(), "cross-site", StringComparison.OrdinalIgnoreCase))
        {
            BugLog.Write("SECURITY", "WARN", $"CSRF blocked: {req.Method} {req.Path} from {req.Headers.Origin}", null, req.Path, req.Method, 403, null, ClientIp.Of(ctx));
            ctx.Response.StatusCode = 403;
            await ctx.Response.WriteAsJsonAsync(new { message = "คำขอนี้มาจากเว็บไซต์ภายนอก ระบบไม่อนุญาต" });
            return;
        }

        // Origin present on a write under /api must be our own site (no Origin = scanner device / server-side call: unchanged)
        if (unsafeMethod && req.Path.StartsWithSegments("/api") && req.Headers.Origin.Count > 0)
        {
            var rip = ctx.Connection.RemoteIpAddress;
            string fwd = rip != null && IPAddress.IsLoopback(rip) ? req.Headers["X-Forwarded-Host"].ToString() : null;
            var allowed = ctx.RequestServices.GetService<IConfiguration>()?.GetSection("Cors:Origins").Get<string[]>();
            // shortcut: log-only until production shows no false positives (proxy host / Cors:Origins), then block with 403
            if (!ClientIp.OriginOk(req.Headers.Origin.ToString(), req.Host.Value, fwd, allowed))
                BugLog.Write("SECURITY", "WARN", $"CSRF origin mismatch (not blocked yet): {req.Method} {req.Path} from {req.Headers.Origin} host {req.Host.Value} fwd {fwd}", null, req.Path, req.Method, 200, null, ClientIp.Of(ctx));
        }

        if (req.Path.StartsWithSegments("/api") && !req.Path.StartsWithSegments("/api/live") && !Allow(ClientIp.Of(ctx)))
        {
            ctx.Response.StatusCode = 429;
            ctx.Response.Headers.RetryAfter = "60";
            await ctx.Response.WriteAsJsonAsync(new { message = "มีคำขอจากเครื่องนี้มากเกินไป กรุณารอ 1 นาทีแล้วลองใหม่" });
            return;
        }
        await _next(ctx);
    }

    private static bool Allow(string ip)
    {
        long minute = Environment.TickCount64 / 60000;
        var v = Hits.AddOrUpdate(ip, _ => (minute, 1), (_, o) => o.Minute == minute ? (minute, o.Count + 1) : (minute, 1));
        if (Interlocked.Exchange(ref _sweep, minute) != minute)
            foreach (var (k, x) in Hits) if (x.Minute < minute - 1) Hits.TryRemove(k, out _);
        if (v.Count == PerMinute + 1)
            BugLog.Write("SECURITY", "WARN", $"Rate limit: {ip} > {PerMinute} requests/min", null, "/api", "", 429, null, ip);
        return v.Count <= PerMinute;
    }
}

// 🔐 กันเดารหัสผ่าน: นับครั้งที่ผิดต่อ UserID และต่อเครื่อง ภายใน 15 นาที
public static class LoginGuard
{
    private const int MaxPerUser = 5, MaxPerIp = 20;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private static readonly ConcurrentDictionary<string, List<DateTime>> Fails = new(StringComparer.OrdinalIgnoreCase);

    private static long _sweepAt;

    /// <summary>Lock key for one account from one machine: a stranger elsewhere cannot lock the owner out.</summary>
    public static string UserKey(string uid, string ip) => "u:" + uid + "|" + ip;

    // Drop keys whose newest failure is older than the window (at most once a minute) so the dictionary cannot grow forever
    private static void Sweep()
    {
        long now = Environment.TickCount64, last = Interlocked.Read(ref _sweepAt);
        if (now - last < 60000 || Interlocked.CompareExchange(ref _sweepAt, now, last) != last) return;
        var cut = DateTime.UtcNow - Window;
        foreach (var (k, l) in Fails) { bool old; lock (l) old = l.Count == 0 || l.Max() < cut; if (old) Fails.TryRemove(k, out _); }
    }

    private static int Count(string key)
    {
        if (!Fails.TryGetValue(key, out var l)) return 0;
        lock (l)
        {
            l.RemoveAll(t => t < DateTime.UtcNow - Window);
            return l.Count;
        }
    }

    /// <summary>ถูกล็อกชั่วคราวอยู่ = ข้อความแจ้ง (null = เข้าได้)</summary>
    public static string Blocked(string uid, string ip)
    {
        if (Count(UserKey(uid, ip)) >= MaxPerUser) return Wait(UserKey(uid, ip), "บัญชีนี้");
        if (Count("ip:" + ip) >= MaxPerIp) return Wait("ip:" + ip, "เครื่องนี้");
        return null;
    }

    private static string Wait(string key, string who)
    {
        DateTime first;
        var l = Fails[key];
        lock (l) first = l.Min();
        int min = Math.Max(1, (int)Math.Ceiling((first + Window - DateTime.UtcNow).TotalMinutes));
        return $"{who}ใส่รหัสผ่านผิดหลายครั้ง ระบบล็อกชั่วคราวเพื่อความปลอดภัย\nกรุณาลองใหม่ในอีก {min} นาที หรือติดต่อ Admin";
    }

    public static void Fail(string uid, string ip)
    {
        Sweep();
        foreach (var k in new[] { UserKey(uid, ip), "ip:" + ip })
        {
            var l = Fails.GetOrAdd(k, _ => new List<DateTime>());
            lock (l) l.Add(DateTime.UtcNow);
        }
    }

    public static void Success(string uid, string ip) => Fails.TryRemove(UserKey(uid, ip), out _);
}

// 🚪 Logout = Token ที่ออกก่อนเวลานี้ของผู้ใช้นี้ใช้ไม่ได้อีก (เก็บในหน่วยความจำ · Server รีสตาร์ท = Token หมดอายุตามเวลาเดิม)
public static class TokenRevoke
{
    private static readonly ConcurrentDictionary<string, DateTime> Before = new(StringComparer.OrdinalIgnoreCase);
    public static void Revoke(string uid) { if (!string.IsNullOrEmpty(uid)) Before[uid] = DateTime.UtcNow; }
    public static bool IsRevoked(string uid, DateTime issuedUtc) => uid != null && Before.TryGetValue(uid, out var t) && issuedUtc < t;
}
