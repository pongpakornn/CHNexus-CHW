namespace CHR.Nexus.Api.Web;

// 📎 ไฟล์ / รูปที่แนบในแชท (ตั้งค่าได้ที่ Storage:ChatFiles / Storage:ChatImages)
//   เก็บใน Folder ของ UserID ผู้ส่งเท่านั้น: ไฟล์ -> ...\1. Chat Files\<UserID>\<guid>.<นามสกุล> · รูป -> ...\2. Chat Images\<UserID>\<guid>.<นามสกุล>
//   ผู้รับกดเปิด / ดาวน์โหลด = ส่งไฟล์ออกไปอย่างเดียว ไม่บันทึกอะไรเพิ่มบน Server
//   ฐานข้อมูลเก็บแค่ชื่อไฟล์เดิม + ที่อยู่แบบสั้น (<UserID>\<guid>.ext) · เปิด / ดาวน์โหลดผ่าน API ที่ตรวจสิทธิ์แล้วเท่านั้น
public static class ChatFiles
{
    public const long MaxBytes = 25L * 1024 * 1024;
    public const long UserQuotaBytes = 500L * 1024 * 1024;

    private static long UsedBytes(string folder)
    {
        long n = 0;
        foreach (var root in new[] { FilesRoot, ImagesRoot })
        {
            string d = System.IO.Path.Combine(root ?? "", folder);
            if (Directory.Exists(d)) foreach (var f in new DirectoryInfo(d).EnumerateFiles()) n += f.Length;
        }
        return n;
    }

    private static readonly HashSet<string> ImageExt = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp" };
    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
        { ".exe", ".bat", ".cmd", ".com", ".msi", ".ps1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".scr", ".dll", ".sys", ".lnk", ".hta", ".cpl", ".reg", ".jar",
          ".html", ".htm", ".xhtml", ".svg", ".xml", ".mht", ".mhtml" };
    // แสดงในหน้าเว็บ (inline) ได้เฉพาะรูปชนิดนี้ · ที่เหลือบังคับดาวน์โหลดเสมอ (กัน script ในไฟล์รันบนเว็บของเรา)
    private static readonly HashSet<string> InlineExt = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp" };
    public static bool CanInline(string kind, string name) => kind == "IMAGE" && InlineExt.Contains(System.IO.Path.GetExtension(name ?? ""));

    public static string FilesRoot { get; private set; } = "";
    public static string ImagesRoot { get; private set; } = "";

    public static void Init(string filesRoot, string imagesRoot)
    {
        FilesRoot = filesRoot ?? "";
        ImagesRoot = imagesRoot ?? "";
    }

    public sealed record Saved(string Name, string Path, long Size, string Kind);

    /// <summary>ตรวจไฟล์ (ขนาด / นามสกุลอันตราย) แล้วบันทึกลงโฟลเดอร์ของรูป หรือไฟล์ทั่วไป</summary>
    public static async Task<(Saved File, string Error)> SaveAsync(IFormFile file, string senderUserId)
    {
        string folder = string.Concat((senderUserId ?? "").Where(ch => !System.IO.Path.GetInvalidFileNameChars().Contains(ch))).Trim('.', ' ');
        if (folder.Length == 0) return (null, "ไม่พบผู้ส่ง");
        if (file == null || file.Length == 0) return (null, "ไม่พบไฟล์ที่แนบ");
        if (file.Length > MaxBytes) return (null, "ไฟล์ใหญ่เกิน 25 MB");
        string name = System.IO.Path.GetFileName(file.FileName ?? "file");
        string ext = System.IO.Path.GetExtension(name);
        if (Blocked.Contains(ext)) return (null, $"ไม่อนุญาตให้ส่งไฟล์ {ext}");
        bool image = ImageExt.Contains(ext) && (file.ContentType ?? "").StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        string root = image ? ImagesRoot : FilesRoot;
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return (null, "ไม่พบโฟลเดอร์เก็บไฟล์แชท กรุณาติดต่อ Admin");

        if (UsedBytes(folder) + file.Length > UserQuotaBytes) return (null, "พื้นที่ไฟล์แนบของคุณเต็ม (สูงสุด 500 MB) กรุณาติดต่อ Admin");
        string rel = System.IO.Path.Combine(folder, Guid.NewGuid().ToString("N") + ext.ToLowerInvariant());
        string full = System.IO.Path.Combine(root, rel);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(full)!);
        await using (var fs = new FileStream(full, FileMode.CreateNew, FileAccess.Write))
            await file.CopyToAsync(fs);
        return (new Saved(name.Length > 260 ? name[^260..] : name, rel, file.Length, image ? "IMAGE" : "FILE"), null);
    }

    /// <summary>ที่อยู่จริงของไฟล์ (กันการอ้างไฟล์นอกโฟลเดอร์แชท)</summary>
    public static string FullPath(string kind, string rel)
    {
        if (string.IsNullOrWhiteSpace(rel)) return null;
        string root = System.IO.Path.GetFullPath(kind == "IMAGE" ? ImagesRoot : FilesRoot);
        string full = System.IO.Path.GetFullPath(System.IO.Path.Combine(root, rel));
        return full.StartsWith(root.TrimEnd('\\', '/') + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.Exists(full) ? full : null;
    }

    public static string ContentType(string name)
    {
        new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider().TryGetContentType(name, out var ct);
        return ct ?? "application/octet-stream";
    }

    // ข้อความแสดงในรายการแชท / Toast เมื่อส่งไฟล์โดยไม่มีข้อความ
    public const string PreviewSql = @"CASE WHEN {0}.DeletedAt IS NOT NULL THEN N'(ข้อความถูกลบ)'
        WHEN {0}.Body = N'' AND {0}.AttachKind = N'IMAGE' THEN N'📷 รูปภาพ'
        WHEN {0}.Body = N'' AND {0}.AttachName IS NOT NULL THEN N'📎 ' + {0}.AttachName
        ELSE {0}.Body END";
}
