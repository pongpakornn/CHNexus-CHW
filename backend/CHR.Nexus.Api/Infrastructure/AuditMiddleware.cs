using System.Runtime.CompilerServices;
using CHR.Nexus.Api.Web.Auth;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// 🕘 ACTIVITY LOG ครบทุกการบันทึก (ทุกระบบ: CIMS · MASTER DATA · EDP PLANNING · USER MANAGEMENT)
//   คำสั่งบันทึก (POST / PUT / PATCH / DELETE ใต้ /api) ที่สำเร็จ แต่ Controller ไม่ได้เขียน Log เอง = เก็บ Log สำรองให้ (ใคร · ทำอะไร · ที่ไหน)
//   เขียนเบื้องหลัง (LogService) ไม่หน่วงผู้ใช้ · ไม่เก็บเนื้อหา Request (กันรหัสผ่าน / ข้อมูลส่วนตัวหลุดลง Log)
//   ไม่นับ: Login (มี Log ของตัวเอง) · เรียลไทม์ · แชท · ค่าส่วนตัว (ตัวกรอง / เลื่อนแจ้งเตือน) · เปิดหน้า (OPEN_PAGE มีแล้ว)
public sealed class AuditMiddleware
{
    private readonly RequestDelegate _next;
    public AuditMiddleware(RequestDelegate next) => _next = next;

    private static readonly HashSet<string> SkipAreas = new(StringComparer.OrdinalIgnoreCase) { "auth", "live", "log", "chat", "support", "buglog", "notifications" };

    // ค่าส่วนตัวของผู้ใช้ = ไม่ใช่การแก้ข้อมูลกลาง
    public static readonly HashSet<string> PrefPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/products/filter", "/api/products/default-stocks", "/api/pr/stock", "/api/minreport/snooze", "/api/edp/alert/snooze"
    };

    private static readonly Dictionary<string, string> Verb = new(StringComparer.OrdinalIgnoreCase)
    {
        ["POST"] = "SAVE", ["PUT"] = "UPDATE", ["PATCH"] = "UPDATE", ["DELETE"] = "DELETE"
    };

    public async Task Invoke(HttpContext ctx)
    {
        var req = ctx.Request;
        if (!Verb.TryGetValue(req.Method, out var verb) || !req.Path.StartsWithSegments("/api", out var rest))
        {
            await _next(ctx);
            return;
        }
        var box = new StrongBox<bool>(false);
        LogService.RequestScope.Value = box;
        await _next(ctx);
        try
        {
            if (box.Value || ctx.Response.StatusCode >= 400) return;
            string path = req.Path.Value?.TrimEnd('/') ?? "";
            var seg = (rest.Value ?? "").Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (seg.Length == 0 || SkipAreas.Contains(seg[0]) || PrefPaths.Contains(path)) return;
            string uid = ctx.RequestServices.GetService<ICurrentUser>()?.UserId;
            if (string.IsNullOrEmpty(uid)) return;

            // ACTION เช่น EDP_SAVE / MASTER_DELETE · DETAIL = คำสั่ง + ที่อยู่ + ตัวกรอง · REFERENCE = ส่วนท้ายของที่อยู่ (รหัส / ชื่องาน)
            string area = seg[0].ToUpperInvariant();
            string action = $"{area}_{verb}";
            if (action.Length > 50) action = action[..50];
            string detail = $"{req.Method} {path}{req.QueryString}";
            string reference = string.Join("/", seg.Skip(1));
            if (reference.Length > 100) reference = reference[..100];
            LogService.WriteLog(uid, action, detail, reference);
        }
        catch
        {
            // Log สำรองล้มเหลว = ไม่กระทบคำขอที่สำเร็จไปแล้ว
        }
    }
}
