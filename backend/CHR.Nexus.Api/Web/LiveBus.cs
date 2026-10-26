using System.Collections.Concurrent;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// ⚡ เรียลไทม์ทันที (แทนการให้ทุกจอถามทุก 3 วินาที)
//   หัวข้อ (topic): "store:{stkId}" = ตัวเลข / โครงตาราง / Coil / ตั้งค่าของคลังนั้น · "store" = คลังใดคลังหนึ่งเปลี่ยน (Dashboard / การ์ดคลัง)
//                   "data" + ชื่อหมวด API (เช่น "pr", "picklist", "scanner") = มีการบันทึกผ่าน API
//   จอถาม GET /api/live/wait?topics=...&v=... แล้วรอ (ไม่เกิน 20 วินาที) จนกว่าหัวข้อที่สนใจเปลี่ยน -> ตอบกลับทันทีที่เปลี่ยน
public static class LiveBus
{
    private static readonly object Gate = new();
    private static readonly ConcurrentDictionary<string, long> Topics = new(StringComparer.OrdinalIgnoreCase);
    private static long _ver;
    private static TaskCompletionSource _next = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public static long Version => Interlocked.Read(ref _ver);

    // เวอร์ชันของข้อมูลกลาง (บันทึกผ่าน API / ตัวเลขคลังเปลี่ยน) - ไม่นับ Log เปิดหน้า / แชท
    public static long DataVersion => Math.Max(Topics.GetValueOrDefault("data"), Topics.GetValueOrDefault("store"));

    public static void Publish(params string[] topics)
    {
        TaskCompletionSource done;
        lock (Gate)
        {
            long v = ++_ver;
            foreach (var t in topics) Topics[t] = v;
            done = _next;
            _next = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        done.TrySetResult();
    }

    // รับงานรอ "ก่อน" เช็คว่าเปลี่ยนหรือยัง -> ไม่พลาดการเปลี่ยนที่เกิดระหว่างเช็ค
    public static Task Next()
    {
        lock (Gate) return _next.Task;
    }

    public static List<string> ChangedSince(long v, IEnumerable<string> topics) =>
        topics.Where(t => Topics.TryGetValue(t, out var x) && x > v).Distinct().ToList();
}

// 👀 เฝ้าคลังที่มีคนเปิดดูอยู่ (ทุก 1 วินาที หรือทันทีที่มีการบันทึก) - เทียบ Token แบบเบา ๆ เปลี่ยน = แจ้ง "store:{id}"
//    จับได้ทั้งที่บันทึกผ่านระบบเรา และที่เปลี่ยนจากภายนอก (เช่น STORE-PC ที่โปรแกรมเดิมเขียน - อ่านอย่างเดียว)
//    เซิร์ฟเวอร์เช็คคลังละ 1 ครั้ง / วินาที ไม่ว่าจะเปิดดูกี่จอ · ไม่มีใครดูเกิน 60 วินาที = เลิกเฝ้า
public sealed class LiveWatcher : BackgroundService
{
    private static readonly ConcurrentDictionary<int, DateTime> Watched = new();
    private static readonly ConcurrentDictionary<int, string> Last = new();
    private static TaskCompletionSource _poke = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly ILogger<LiveWatcher> _log;

    public LiveWatcher(ILogger<LiveWatcher> log) => _log = log;

    public static void Watch(int stkId) => Watched[stkId] = DateTime.UtcNow;

    // มีการบันทึก -> เช็คเดี๋ยวนี้ (ไม่ต้องรอรอบ 1 วินาที)
    public static void Poke() => Interlocked.Exchange(ref _poke, new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously)).TrySetResult();

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await Task.WhenAny(Task.Delay(1000, ct), _poke.Task); }
            catch (OperationCanceledException) { break; }
            await Task.Delay(60, ct).ContinueWith(_ => { }, CancellationToken.None); // รวมการบันทึกที่มาติด ๆ กันเป็นรอบเดียว

            var stale = DateTime.UtcNow.AddSeconds(-60);
            foreach (var (id, seen) in Watched)
            {
                if (seen < stale)
                {
                    Watched.TryRemove(id, out _);
                    Last.TryRemove(id, out _);
                    continue;
                }
                try
                {
                    string now = Token(id);
                    if (Last.TryGetValue(id, out var was) && was != now) LiveBus.Publish("store:" + id, "store");
                    Last[id] = now;
                }
                catch (Exception ex)
                {
                    _log.LogDebug(ex, "LiveWatcher stock {Stock}", id); // รอบหน้าลองใหม่
                }
            }
        }
    }

    // Token เดียวกับที่หน้าคลังใช้อยู่ (ตัวเลข + ตั้งค่า + โครงตาราง + Coil) - คลังถูกลบ = "-"
    private static string Token(int stkId)
    {
        var s = new StockService().GetStock(stkId);
        if (s == null) return "-";
        return string.Join("|", new StoreProductService().GetChangeToken(s), StoreLive.Settings(stkId), StoreLive.Structure(s), StoreLive.Coils(s));
    }
}

// ✍️ ทุกคำสั่งบันทึกที่สำเร็จ (POST / PUT / PATCH / DELETE ใต้ /api) -> แจ้ง "data" + หมวด API + ให้ตัวเฝ้าคลังเช็คทันที
public sealed class LivePublishMiddleware
{
    private readonly RequestDelegate _next;
    public LivePublishMiddleware(RequestDelegate next) => _next = next;

    private static readonly HashSet<string> OwnTopicAreas = new(StringComparer.OrdinalIgnoreCase) { "log", "chat", "support" };
    private static readonly HashSet<string> PrefPaths = new(StringComparer.OrdinalIgnoreCase) { "/api/products/filter", "/api/products/default-stocks", "/api/pr/stock" };

    public async Task Invoke(HttpContext ctx)
    {
        await _next(ctx);
        if (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method) || HttpMethods.IsOptions(ctx.Request.Method)) return;
        if (ctx.Response.StatusCode >= 400) return;
        var path = ctx.Request.Path;
        if (!path.StartsWithSegments("/api", out var rest) || path.StartsWithSegments("/api/live") || path.StartsWithSegments("/api/auth")) return;
        string area = rest.Value?.Trim('/').Split('/', 2)[0].ToLowerInvariant() ?? "";
        // ค่าส่วนตัวของผู้ใช้ (ตัวกรอง / คลังที่เลือกค้าง) ไม่ใช่ข้อมูลกลาง = ไม่ต้องให้จอใครโหลดใหม่
        if (PrefPaths.Contains(path.Value?.TrimEnd('/') ?? "")) return;
        // Log เปิดหน้า / แชท = แจ้งเฉพาะจอที่แสดงเรื่องนั้น (ไม่ใช่ "data" -> จอทุกคนไม่ต้องโหลดใหม่ทุกครั้งที่มีคนเปลี่ยนหน้า)
        if (OwnTopicAreas.Contains(area)) { LiveBus.Publish(area); return; }
        LiveBus.Publish(area.Length > 0 ? new[] { "data", area } : new[] { "data" });
        LiveWatcher.Poke();
    }
}

// 🧠 ผลคำนวณที่ใช้ร่วมกันทุกคน (เช่น สรุปยอดทุกคลังของกระดิ่ง / Dashboard): คำนวณครั้งเดียวแล้วแบ่งกันใช้
//   ใช้ซ้ำจนกว่าข้อมูลเปลี่ยน (LiveBus.DataVersion ขยับ) หรือครบ maxAge · หลายคนขอพร้อมกัน = รอผลรอบเดียวกัน ไม่คำนวณซ้อน
public static class LiveCache
{
    private sealed record Entry(long Ver, DateTime At, Lazy<object> Value);
    private static readonly ConcurrentDictionary<string, Entry> Items = new();

    public static T Get<T>(string key, TimeSpan maxAge, Func<T> make) where T : class
    {
        long v = LiveBus.DataVersion;
        var e = Items.AddOrUpdate(key,
            _ => new Entry(v, DateTime.UtcNow, new Lazy<object>(() => make())),
            (_, old) => old.Ver == v && DateTime.UtcNow - old.At < maxAge ? old : new Entry(v, DateTime.UtcNow, new Lazy<object>(() => make())));
        try { return (T)e.Value.Value; }
        catch { Items.TryRemove(new KeyValuePair<string, Entry>(key, e)); throw; } // คำนวณพลาด = ไม่จำค่าเสีย รอบหน้าลองใหม่
    }
}
