namespace Nexus.Services;

// ✍ ลายเซ็นของผู้ใช้ (โปรไฟล์ › ลายเซ็น): ไฟล์ <UserID>-Signature.png ในโฟลเดอร์ Storage:Signatures
//   ค่าเริ่มต้น = \\192.168.10.56\ProgramCHR\11. CHR Nexus\2. CHR Nexus - Signature (โฟลเดอร์เดียวกับไฟล์แชทของ CHR Nexus)
//   ฐานข้อมูลไม่เก็บรูป · เปิดรูปผ่าน API ที่ต้อง Login เท่านั้น · บันทึกใหม่ = ทับไฟล์เดิมของตัวเอง
public static class SignatureStore
{
    public const string DefaultRoot = @"\\192.168.10.56\ProgramCHR\11. CHR Nexus\2. CHR Nexus - Signature";
    public const int MaxBytes = 2 * 1024 * 1024;
    public static string Root { get; private set; } = DefaultRoot;

    public static void Init(string root)
    {
        if (!string.IsNullOrWhiteSpace(root)) Root = root.Trim();
    }

    private static string Safe(string uid) => string.Concat((uid ?? "").Where(ch => !Path.GetInvalidFileNameChars().Contains(ch))).Trim('.', ' ');

    public static string FileOf(string uid)
    {
        string s = Safe(uid);
        return s.Length == 0 ? null : Path.Combine(Root, s + "-Signature.png");
    }

    public static bool Has(string uid)
    {
        try { string f = FileOf(uid); return f != null && File.Exists(f); }
        catch { return false; }
    }

    public static DateTime? Updated(string uid)
    {
        try { string f = FileOf(uid); return f != null && File.Exists(f) ? File.GetLastWriteTime(f) : null; }
        catch { return null; }
    }

    public static byte[] Read(string uid)
    {
        try { string f = FileOf(uid); return f != null && File.Exists(f) ? File.ReadAllBytes(f) : null; }
        catch { return null; }
    }

    // PNG เท่านั้น (หน้าเว็บแปลงรูป / ลายเซ็นที่วาดเป็น PNG พื้นใสให้ก่อน)
    public static string Save(string uid, byte[] png)
    {
        string f = FileOf(uid);
        if (f == null) return "ไม่พบผู้ใช้";
        if (png == null || png.Length < 100) return "ไม่พบรูปลายเซ็น";
        if (png.Length > MaxBytes) return "รูปลายเซ็นใหญ่เกิน 2 MB";
        byte[] sig = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        if (!png.Take(8).SequenceEqual(sig)) return "รูปลายเซ็นต้องเป็นไฟล์ PNG";
        try
        {
            Directory.CreateDirectory(Root);
            string tmp = f + ".tmp";
            File.WriteAllBytes(tmp, png);
            File.Move(tmp, f, true);
            return null;
        }
        catch (Exception ex) { return "บันทึกลายเซ็นไม่สำเร็จ: " + ex.Message; }
    }

    public static string Delete(string uid)
    {
        try { string f = FileOf(uid); if (f != null && File.Exists(f)) File.Delete(f); return null; }
        catch (Exception ex) { return "ลบลายเซ็นไม่สำเร็จ: " + ex.Message; }
    }
}
