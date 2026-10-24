using System.Collections.Concurrent;

namespace CHR.Nexus.Api.Web;

// ⌨ "กำลังพิมพ์..." เก็บในหน่วยความจำของ API (ข้อมูลชั่วคราว ไม่ต้องลงฐาน) - ไม่ได้พิมพ์เกิน 4 วินาที = หยุดพิมพ์
public static class TypingHub
{
    private static readonly ConcurrentDictionary<string, DateTime> Seen = new();
    private static readonly TimeSpan Alive = TimeSpan.FromSeconds(4);

    private static string Dm(string from, string to) => $"dm|{from}|{to}";
    private static string Sup(int threadId, string user) => $"sup|{threadId}|{user}";

    public static void DmTyping(string from, string to) => Touch(Dm(from, to));
    public static bool DmIsTyping(string from, string to) => Fresh(Dm(from, to));

    public static void SupportTyping(int threadId, string user) => Touch(Sup(threadId, user));

    /// <summary>มีคนอื่น (ไม่ใช่ฉัน) กำลังพิมพ์ในเรื่องนี้ไหม</summary>
    public static bool SupportOthersTyping(int threadId, string me)
    {
        string prefix = $"sup|{threadId}|";
        var now = DateTime.UtcNow;
        return Seen.Any(kv => kv.Key.StartsWith(prefix, StringComparison.Ordinal) && kv.Key != Sup(threadId, me) && now - kv.Value < Alive);
    }

    private static void Touch(string key)
    {
        Seen[key] = DateTime.UtcNow;
        // เก็บกวาดของเก่าเป็นครั้งคราว
        if (Seen.Count > 500)
            foreach (var kv in Seen.Where(kv => DateTime.UtcNow - kv.Value > Alive).ToList()) Seen.TryRemove(kv.Key, out _);
    }

    private static bool Fresh(string key) => Seen.TryGetValue(key, out var at) && DateTime.UtcNow - at < Alive;
}
