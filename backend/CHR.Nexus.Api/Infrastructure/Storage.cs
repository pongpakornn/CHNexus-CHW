using System;
using System.IO;
using System.Linq;

namespace Nexus.Core
{
    // 🔒 CHR-Nexus แยกจากระบบที่ใช้งานจริง: ไฟล์ของเว็บอยู่ในโฟลเดอร์ storage ของตัวเอง
    //    WPF เดิมอ่าน / เขียนที่ Share ของ Server จริง (\\192.168.10.56\ProgramCHR, \\192.168.10.3 ...)
    //    เว็บเขียน Excel ที่ Share ได้เฉพาะโฟลเดอร์ใน DirectExcelRoots / อ่านรูปจาก Share ได้อย่างเดียว (ImageFallback)
    //    storage\images\stock   = รูปสินค้าแบบใหม่ (<STOCK CODE>\<STOCK CODE>-01.png)
    //    storage\images\legacy  = รูปเก่า (ชื่อไฟล์อย่างเดียว)
    //    storage\images\storepc = รูปของ StorePC
    //    storage\excel          = ไฟล์ Excel ที่ตั้งไว้ (RPA / PR / Template) - Path เดิมในฐานข้อมูลถูกแปลงเป็นไฟล์ชื่อเดียวกันในโฟลเดอร์นี้
    public static class Storage
    {
        public static string Root { get; private set; } = Path.Combine(AppContext.BaseDirectory, "storage");

        // 📂 เขียนไฟล์ Excel ที่ Path ตรงๆ เหมือน WPF: เฉพาะ Path ที่อยู่ใต้โฟลเดอร์ที่อนุญาต (Storage:DirectExcelRoots)
        //    ไม่ได้ตั้ง = ทุกไฟล์อยู่ใน storage\excel เหมือนเดิม
        public static string[] DirectExcelRoots { get; private set; } = Array.Empty<string>();

        // 🖼 รูปที่ไม่มีใน storage -> อ่าน (อย่างเดียว) จากโฟลเดอร์รูปเดิมของ WPF (Storage:ImageFallback:Stock / Legacy / StorePc)
        //    ไม่ได้ตั้ง = ใช้เฉพาะรูปใน storage / อัปโหลดรูปจากเว็บเขียนลง storage เสมอ
        public static (string Local, string Fallback)[] ImageFallbacks { get; private set; } = Array.Empty<(string, string)>();

        // 🖼 โฟลเดอร์รูปสินค้ากลาง (Storage:ImagesRoot) เช่น \192.168.10.56\ProgramCHR\11. CHR Nexus\2. CHR Nexus - Images
        //    ตั้งแล้ว: <ImagesRoot>\<STOCK CODE>\ = รูปของแต่ละคลัง · \StorePC = รูป StorePC · \EDP Planing = รูปจากโปรแกรม EDP
        //    ไม่ได้ตั้ง = storage\images\… ในเครื่องเหมือนเดิม
        public static string ImagesRoot { get; private set; }

        public static void Init(string root, string[] directExcelRoots = null, string stockImages = null, string legacyImages = null, string storePcImages = null, string imagesRoot = null)
        {
            if (!string.IsNullOrWhiteSpace(root)) Root = Path.GetFullPath(root);
            if (!string.IsNullOrWhiteSpace(imagesRoot)) ImagesRoot = imagesRoot.Trim().TrimEnd('\\', '/');
            foreach (var d in new[] { StockImages, LegacyImages, StorePcImages, Excel }) Directory.CreateDirectory(d);
            DirectExcelRoots = Array.FindAll(directExcelRoots ?? Array.Empty<string>(), r => !string.IsNullOrWhiteSpace(r))
                                    .Select(r => r.Trim().Replace('/', '\\').TrimEnd('\\') + "\\").ToArray();
            ImageFallbacks = new[] { (StockImages, stockImages), (LegacyImages, legacyImages), (StorePcImages, storePcImages) }
                .Where(x => !string.IsNullOrWhiteSpace(x.Item2)).Select(x => (x.Item1, x.Item2.Trim())).ToArray();
        }

        // Path รูปใน storage -> Path เดียวกันในโฟลเดอร์รูปเดิม (null = ไม่มีที่สำรอง)
        public static string ImageFallbackOf(string localPath)
        {
            if (string.IsNullOrWhiteSpace(localPath)) return null;
            foreach (var (local, fallback) in ImageFallbacks)
            {
                string root = Path.GetFullPath(local).TrimEnd('\\') + "\\";
                if (localPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    return Path.Combine(fallback, localPath.Substring(root.Length));
            }
            return null;
        }

        public static bool IsDirect(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || DirectExcelRoots.Length == 0) return false;
            string full;
            try { full = Path.GetFullPath(path.Trim()); } catch { return false; }
            return DirectExcelRoots.Any(r => full.StartsWith(r, StringComparison.OrdinalIgnoreCase));
        }

        public static string StockImages => ImagesRoot ?? Path.Combine(Root, "images", "stock");
        public static string LegacyImages => Path.Combine(Root, "images", "legacy");
        public static string StorePcImages => ImagesRoot != null ? Path.Combine(ImagesRoot, "StorePC") : Path.Combine(Root, "images", "storepc");
        public static string Excel => Path.Combine(Root, "excel");

        // Path ที่ตั้งไว้ในฐานข้อมูล (เช่น \\192.168.10.56\...\RPA - PR-StoreSP.xlsx) -> storage\excel\RPA - PR-StoreSP.xlsx
        //   Path ที่อยู่ใน storage อยู่แล้ว = ใช้ตามเดิม / ไม่ออกนอก storage ไม่ว่ากรณีใด
        public static string MapExternal(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return path;
            string p = path.Trim();
            if (IsDirect(p)) return Path.GetFullPath(p);   // อนุญาตแล้ว = ใช้ Path เดิมตรงๆ (เหมือน WPF)
            try
            {
                string full = Path.GetFullPath(p);
                if (full.StartsWith(Root.TrimEnd('\\', '/') + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return full;
            }
            catch { /* Path แปลก ๆ -> ใช้ชื่อไฟล์ */ }
            string name = Path.GetFileName(p.Replace('/', '\\').TrimEnd('\\'));
            foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '-');
            return Path.Combine(Excel, string.IsNullOrWhiteSpace(name) ? "unnamed.xlsx" : name);
        }
    }
}
