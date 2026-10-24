using CHR.Nexus.Api.Web;
using Microsoft.AspNetCore.Mvc;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// ⚡ รอการเปลี่ยนแปลง (long-poll): ตอบทันทีที่หัวข้อที่สนใจเปลี่ยน · ไม่มีอะไรเปลี่ยนภายใน 20 วินาที = ตอบว่าง แล้วจอถามใหม่
//    v = เลขรุ่นล่าสุดที่จอรู้ (ครั้งแรกไม่ส่ง = ตอบเลขรุ่นปัจจุบันทันที) · ใช้ HTTP ธรรมดา ผ่าน Proxy ของ Next ได้
[Route("api/live")]
public sealed class LiveController : AppController
{
    [HttpGet("wait")]
    public async Task<IActionResult> Wait([FromQuery] string topics, [FromQuery] long? v, CancellationToken ct)
    {
        if (Me == null) return Deny();
        var list = (topics ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(20).ToList();
        foreach (var t in list)
            if (t.StartsWith("store:", StringComparison.OrdinalIgnoreCase) && int.TryParse(t[6..], out int id) && id > 0)
            {
                var s = new StockService().GetStock(id);
                if (s != null && Me.CanViewStock(s)) LiveWatcher.Watch(id);
            }
        if (v == null) return Ok(new { v = LiveBus.Version, changed = Array.Empty<string>() });

        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (!ct.IsCancellationRequested)
        {
            var next = LiveBus.Next();
            var changed = LiveBus.ChangedSince(v.Value, list);
            if (changed.Count > 0) return Ok(new { v = LiveBus.Version, changed });
            var left = deadline - DateTime.UtcNow;
            if (left <= TimeSpan.Zero) break;
            try { await next.WaitAsync(left, ct); }
            catch (TimeoutException) { break; }
            catch (OperationCanceledException) { break; }
        }
        return Ok(new { v = LiveBus.Version, changed = Array.Empty<string>() });
    }
}
