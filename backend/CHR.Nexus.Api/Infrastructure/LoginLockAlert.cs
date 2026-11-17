using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Web;

// 🔒 บัญชีถูกล็อกชั่วคราว (ครั้งเดียวตอนล็อก) -> แจ้ง Admin
//   ข้อความเข้า "แชทแจ้ง Admin" (เรื่องของผู้ส่ง SYSTEM · ผู้ใช้ทั่วไปไม่เห็น) + สัญญาณ "support" = ChatFeed ของ Admin ที่ออนไลน์เด้ง Toast ทันที
//   [[LOCKS]] = การ์ดปุ่มเปิดหน้าปลดล็อก (/admin/users?locks=1) ใน ChatBubble
public static class LoginLockAlert
{
    public const string System = "SYSTEM", Token = "[[LOCKS]]";

    public static void Send(string uid, string ip, int fails, int lockCount, int minutes)
    {
        string machine = global::Nexus.Core.ClientContext.Machine;   // read on the request thread (per-request context)
        string where = string.IsNullOrWhiteSpace(machine) || machine == ip ? ip : $"{machine} ({ip})";
        uid = uid.Replace("[[", "[ [");   // never let an ID become a chat token
        string body = $"🔒 บัญชี {uid} ถูกล็อกชั่วคราว (ใส่รหัสผิด {fails} ครั้ง) · {where} · {DateTime.Now:dd/MM/yyyy HH:mm} · ปลดล็อกได้ที่ User Management\n{Token}";
        LogService.WriteLog(uid, "LOGIN_LOCKED", $"ล็อกชั่วคราว {minutes} นาที (ครั้งที่ {lockCount}) · รหัสผิด {fails} ครั้ง · จาก {where}", machine);
        if (!DbSchema.HasSupport) return;
        _ = Task.Run(() =>
        {
            try { new SupportService().Create(System, "PROBLEM", body); LiveBus.Publish("support"); }
            catch { /* best effort: the lock itself already works */ }
        });
    }
}
