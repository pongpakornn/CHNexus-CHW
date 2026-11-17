using ClosedXML.Excel;
using Nexus.Models;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Nexus.Services
{
    // 📄 ไฟล์ Template สำหรับปุ่ม Import (หัวคอลัมน์ตรงกับที่ตัวอ่านไฟล์รู้จัก - กรอกแล้ว Import กลับได้ทันที)
    //    ชีทแรก = ตารางกรอกข้อมูล (ตัวอ่านไฟล์อ่านชีทแรกเท่านั้น) / ชีทถัดไป = วิธีกรอก + รายการอ้างอิง
    public class ImportTemplateService
    {
        // Web: ไฟล์ Export สร้างที่ Server (โฟลเดอร์ชั่วคราว) แล้วส่งให้ Browser ดาวน์โหลด (WPF เดิม = Desktop\CIMS_Export)
        public static string ExportFolder => Path.Combine(Path.GetTempPath(), "CHR-Nexus-Export");

        // เปิดไฟล์ที่สร้างเสร็จขึ้นมาเลย (Excel) - เปิดไม่ได้ (เช่นเครื่องไม่มี Excel) -> เปิดโฟลเดอร์แล้วเลือกไฟล์ไว้ให้
        // Web: ไม่เปิดไฟล์ที่ Server - Controller ส่งไฟล์ให้ Browser ดาวน์โหลดแทน
        public static void OpenFile(string path) { }

        // 📁 ทุก Export / Template แยกโฟลเดอร์ตามหน้าระบบ: Desktop\CIMS_Export\<หน้า>\<ชื่อที่เลือก>_<วัน-เดือน-ปี-เวลา>.xlsx
        //    เช่น Desktop\CIMS_Export\Store Max-Min\STOCK-MAT_10-10-2026-11.11.00.xlsx
        public static class Systems
        {
            public const string Store = "Store Max-Min";
            public const string Product = "Product Control";
            public const string Scanner = "Multi-Scanner";
            public const string PickList = "Pick List";
            public const string MaxMinCalc = "Max-Min Calculator";
            public const string Forecast = "Forecast Order";
            public const string PR = "PR Management";
            public const string ActivityLog = "Activity Log";
            public const string Users = "User Management";
        }

        public static string FolderFor(string system)
        {
            string dir = Path.Combine(ExportFolder, SafeName(system));
            Directory.CreateDirectory(dir);
            return dir;
        }

        public static string Stamp() => DateTime.Now.ToString("dd-MM-yyyy-HH.mm.ss", CultureInfo.InvariantCulture);

        // Export limits (Activity Log / Scan History): date range <= 366 days, rows <= MaxExportRows, 60 s query timeout
        public const int MaxExportRows = 200000, ExportTimeoutSec = 60;
        public static void CheckExportRange(DateTime from, DateTime to)
        {
            if ((to.Date - from.Date).TotalDays > 366) throw new InvalidOperationException("ช่วงวันที่ Export ยาวเกิน 366 วัน กรุณาเลือกช่วงวันที่ให้สั้นลง");
        }
        public static void CheckExportRows(int count)
        {
            if (count > MaxExportRows) throw new InvalidOperationException($"ข้อมูลมากเกิน {MaxExportRows:N0} รายการ กรุณาเลือกช่วงวันที่หรือตัวกรองให้แคบลง");
        }

        // ชื่อไฟล์ใหม่ (สร้างโฟลเดอร์ให้เลย) - ext = ".xlsx" / ".pdf"
        public static string NewPath(string system, string name, string ext = ".xlsx")
        {
            string dir = FolderFor(system);
            string file = $"{SafeName(name)}_{Stamp()}";
            string path = Path.Combine(dir, file + ext);
            for (int i = 2; File.Exists(path); i++) path = Path.Combine(dir, $"{file}_{i}{ext}");   // กดซ้ำในวินาทีเดียวกัน
            return path;
        }

        // ข้อความแจ้งผู้ใช้: Desktop\CIMS_Export\Store Max-Min\STOCK-MAT_10-10-2026-11.11.00.xlsx
        public static string ShortPath(string path) =>
            "Desktop\\CIMS_Export\\" + (path.StartsWith(ExportFolder, StringComparison.OrdinalIgnoreCase) ? path.Substring(ExportFolder.Length).TrimStart('\\') : Path.GetFileName(path));

        private static string SafeName(string s)
        {
            foreach (char c in Path.GetInvalidFileNameChars()) s = (s ?? "").Replace(c, '-');
            return s.Trim();
        }

        // หัวตารางแบบเดียวกับไฟล์ Template ของบริษัท (#002060 ตัวขาวหนา กึ่งกลาง)
        public static void Header(IXLWorksheet ws, string[] heads, double[] widths)
        {
            for (int i = 0; i < heads.Length; i++) ws.Cell(1, i + 1).Value = heads[i];
            var h = ws.Range(1, 1, 1, heads.Length);
            h.Style.Fill.BackgroundColor = XLColor.FromHtml("#002060");
            h.Style.Font.FontColor = XLColor.White;
            h.Style.Font.Bold = true;
            h.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            h.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            h.Style.Alignment.WrapText = true;
            ws.Row(1).Height = 34.5;
            for (int i = 0; i < widths.Length && i < heads.Length; i++) ws.Column(i + 1).Width = widths[i];
            ws.SheetView.FreezeRows(1);
        }

        public static void Body(IXLWorksheet ws, int lastRow, int cols)
        {
            if (lastRow < 2) return;
            var r = ws.Range(2, 1, lastRow, cols);
            r.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            r.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            r.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            r.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            ws.Rows(2, lastRow).Height = 20.25;
        }

        // ---------------------------------------------------------------- ไฟล์ EXPORT ทุกหน้าใช้รูปแบบเดียวกัน (หัวตาราง / เส้น / แถวกลุ่ม แบบเดียวกับ Export ของ Forecast)
        // แถวคั่นกลุ่ม (เหมือนแถบกลุ่มในตารางของโปรแกรม)
        public static void GroupRow(IXLWorksheet ws, int row, int cols, string text)
        {
            var g = ws.Range(row, 1, row, cols);
            g.Merge();
            g.FirstCell().Value = text;
            g.Style.Font.Bold = true;
            g.Style.Font.FontColor = XLColor.FromHtml("#002060");
            g.Style.Fill.BackgroundColor = XLColor.FromHtml("#D9E1F2");
            g.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            g.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            g.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        }

        // ข้อความยาว (รายละเอียด / บาร์โค้ด / ชื่อสินค้า) ชิดซ้าย
        public static void LeftAlign(IXLWorksheet ws, int lastRow, params int[] cols)
        {
            if (lastRow < 2) return;
            foreach (int c in cols) ws.Range(2, c, lastRow, c).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
        }

        // ตัวเลขยอดตามการตั้งค่าคลัง (DECIMAL QTY = 1,234.50 / ไม่เปิด = 1,234)
        public static string QtyFormat(bool allowDecimal) => allowDecimal ? "#,##0.00#" : "#,##0";

        public static void Guide(XLWorkbook wb, string title, IEnumerable<(string Col, string Text)> lines)
        {
            var g = wb.AddWorksheet("HOW TO");
            g.Cell(1, 1).Value = title;
            g.Cell(1, 1).Style.Font.Bold = true; g.Cell(1, 1).Style.Font.FontSize = 14;
            g.Cell(3, 1).Value = "COLUMN"; g.Cell(3, 2).Value = "วิธีกรอก";
            var h = g.Range(3, 1, 3, 2);
            h.Style.Fill.BackgroundColor = XLColor.FromHtml("#002060"); h.Style.Font.FontColor = XLColor.White; h.Style.Font.Bold = true;
            int r = 4;
            foreach (var (col, text) in lines) { g.Cell(r, 1).Value = col; g.Cell(r, 2).Value = text; g.Cell(r, 1).Style.Font.Bold = true; r++; }
            g.Column(1).Width = 22; g.Column(2).Width = 110;
            g.Range(4, 2, r, 2).Style.Alignment.WrapText = true;
        }

        // ---------------------------------------------------------------- MASTER DATA › Product Control (IMPORT EXCEL)
        public static readonly string[] PartHeads =
        {
            "NO", "PRODUCT CODE", "PRODUCT NAME", "SUPPLIER", "CUSTOMER", "CATEGORY", "PART A", "PART B", "PART NO", "MODEL",
            "PACK SIZE", "BIN", "NUMBER COIL", "MASTER COIL", "QR CODE", "IMAGE", "STOCK1", "STOCK2", "STOCK3", "SHOW/HIDE", "MAX", "MIN",
            "STOCK (UNIT)", "STOCK (BOX)", "STOCK (COIL)", "STOCK (PCS)", "REMARK"
        };

        private static readonly Dictionary<string, double> PartWidths = new Dictionary<string, double>
        {
            ["NO"] = 6.4, ["PRODUCT CODE"] = 18, ["PRODUCT NAME"] = 34, ["SUPPLIER"] = 14, ["CUSTOMER"] = 14, ["CATEGORY"] = 14, ["PART A"] = 16, ["PART B"] = 16,
            ["PART NO"] = 18, ["MODEL"] = 14, ["PACK SIZE"] = 10, ["BIN"] = 14, ["NUMBER COIL"] = 16, ["MASTER COIL"] = 16, ["QR CODE"] = 16,
            ["IMAGE"] = 28, ["STOCK1"] = 14, ["STOCK2"] = 14, ["STOCK3"] = 14, ["SHOW/HIDE"] = 11, ["REMARK"] = 24
        };

        // หัวคอลัมน์ของ Template ตามคลังที่เลือก: คอลัมน์ที่คลังนั้นแสดงใน Store (Max-Min) เรียงตามที่ตั้งไว้ (TABLE COLUMNS)
        //   + ข้อมูลที่ต้องใช้ลงทะเบียน (SUPPLIER / CATEGORY / PACK SIZE / BIN / QR CODE / STOCK1 / SHOW/HIDE)
        //   คลังที่นับ Coil มี NUMBER COIL / MASTER COIL ถัดจาก BIN / หัวยอดใช้หน่วยของคลัง เช่น STOCK (KG.) / MAX (COIL)
        private static bool SameHead(string a, string b) =>
            string.Equals(new string((a ?? "").Where(char.IsLetterOrDigit).ToArray()), new string((b ?? "").Where(char.IsLetterOrDigit).ToArray()), StringComparison.OrdinalIgnoreCase);

        public static string[] PartHeadsFor(StockModel s)
        {
            if (s == null) return PartHeads;
            var heads = new List<string> { "NO" };
            foreach (string key in s.ColumnOrderList())
            {
                switch (key)
                {
                    case "IMAGE": if (s.ColImage) heads.Add("IMAGE"); break;
                    case "CUSTOMER": if (s.ColCustomer) heads.Add("CUSTOMER"); break;
                    case "CODE": heads.Add("PRODUCT CODE"); break;
                    case "PARTA": if (s.ColPartA) heads.Add("PART A"); break;
                    case "PARTB": if (s.ColPartB) heads.Add("PART B"); break;
                    case "PARTNO": if (s.ColPartNo) heads.Add("PART NO"); break;
                    case "MODEL": if (s.ColModel) heads.Add("MODEL"); break;
                    case "NAME": heads.Add("PRODUCT NAME"); break;
                    case "MAXMIN": if (s.UseMaxMin) { heads.Add(s.MaxHeader); heads.Add(s.MinHeader); } break;
                    case "QTY": if (s.ColQty) heads.Add(s.QtyHeader); break;
                    case "BOX": if (s.ColStockBox && !s.CountCoil) heads.Add("STOCK (BOX)"); break;
                    case "COIL": if (s.CountCoil) heads.Add("STOCK (COIL)"); break;
                    // คลังหน่วย PCS: ยอดคงคลังคือ STOCK (PCS.) อยู่แล้ว ไม่ใส่ STOCK (PCS) ซ้ำอีกคอลัมน์
                    case "PCS": if (s.ColStockPcs && !SameHead(s.QtyHeader, "STOCK (PCS)")) heads.Add("STOCK (PCS)"); break;
                    case "REMARK": if (s.ColRemark) heads.Add("REMARK"); break;
                }
            }
            foreach (var must in new[] { "PRODUCT CODE", "PRODUCT NAME" }) if (!heads.Contains(must)) heads.Insert(1, must);
            // ยอดคงคลังต้องมีเสมอ (คลังที่ซ่อนคอลัมน์ยอด) - คลัง Coil ใช้เป็นน้ำหนักของแต่ละ Coil
            if (!heads.Contains(s.QtyHeader)) heads.Add(s.QtyHeader);
            heads.AddRange(new[] { "SUPPLIER", "CATEGORY", "PACK SIZE", "BIN" });
            if (s.CountCoil) heads.AddRange(new[] { "NUMBER COIL", "MASTER COIL" });
            heads.AddRange(new[] { "QR CODE", "STOCK1", "SHOW/HIDE" });
            return heads.Distinct().ToArray();
        }

        // 📄 TEMPLATE MAX-MIN (หน้า Store (Max-Min)): คอลัมน์ตามที่คลังแสดงในตาราง (ไม่รวม IMAGE / REMARK) + กลุ่มของคลัง + BIN
        //   + MASTER COIL / NUMBER COIL (คลังที่นับ Coil) + SHOW/HIDE เช่น STOCK-MAT:
        //   NO · PRODUCT CODE · PRODUCT NAME · MAX (COIL) · MIN (COIL) · STOCK (COIL) · STOCK (KG.) · CATEGORY · BIN · MASTER COIL · NUMBER COIL · SHOW/HIDE
        public static string[] MaxMinHeadsFor(StockModel s)
        {
            var heads = new List<string> { "NO" };
            foreach (string key in s.ColumnOrderList())
            {
                switch (key)
                {
                    case "CUSTOMER": if (s.ColCustomer) heads.Add("CUSTOMER"); break;
                    case "CODE": heads.Add("PRODUCT CODE"); break;
                    case "PARTA": if (s.ColPartA) heads.Add("PART A"); break;
                    case "PARTB": if (s.ColPartB) heads.Add("PART B"); break;
                    case "PARTNO": if (s.ColPartNo) heads.Add("PART NO"); break;
                    case "MODEL": if (s.ColModel) heads.Add("MODEL"); break;
                    case "NAME": heads.Add("PRODUCT NAME"); break;
                    case "PACKSIZE": heads.Add("PACK SIZE"); break;
                    case "SUPPLIER": heads.Add("SUPPLIER"); break;
                    case "CATEGORY": heads.Add("CATEGORY"); break;
                    case "MAXMIN": if (s.UseMaxMin) { heads.Add(s.MaxHeader); heads.Add(s.MinHeader); } break;
                    case "COIL": if (s.CountCoil) heads.Add("STOCK (COIL)"); break;
                    case "QTY": heads.Add(s.QtyHeader); break;
                    case "BOX": if (s.ColStockBox && !s.CountCoil) heads.Add("STOCK (BOX)"); break;
                    case "PCS": if (s.ColStockPcs && !SameHead(s.QtyHeader, "STOCK (PCS)")) heads.Add("STOCK (PCS)"); break;
                }
            }
            foreach (var must in new[] { "PRODUCT NAME", "PRODUCT CODE" }) if (!heads.Contains(must)) heads.Insert(1, must);
            if (s.UseMaxMin && !heads.Contains(s.MaxHeader)) heads.AddRange(new[] { s.MaxHeader, s.MinHeader });
            if (s.CountCoil && !heads.Contains("STOCK (COIL)")) heads.Add("STOCK (COIL)");
            if (!heads.Contains(s.QtyHeader)) heads.Add(s.QtyHeader);
            heads.Add(s.GroupByCustomer ? "CUSTOMER" : s.GroupBySupplier ? "SUPPLIER" : "CATEGORY");
            heads.Add("BIN");
            if (s.CountCoil) heads.AddRange(new[] { "MASTER COIL", "NUMBER COIL" });
            heads.Add("SHOW/HIDE");
            return heads.Distinct().ToArray();
        }

        // ✍️ Template ตามช่องกรอกลงทะเบียนของคลัง (ADMIN > FORM FIELDS) เรียงตามช่อง
        //   WEIGHT: คลังที่นับ Coil = น้ำหนักของ Coil / คลังอื่น = น้ำหนักสินค้า · ท้ายไฟล์ = ยอดคงเหลือ (คลังไม่นับ Coil) + STOCK1 + SHOW/HIDE
        public static string[] PartHeadsForForm(StockModel s, IList<string> formFields)
        {
            if (s == null || formFields == null) return PartHeadsFor(s);
            List<CustomFieldDef> customDefs = null;
            var heads = new List<string> { "NO" };
            foreach (string key in formFields)
            {
                switch (key)
                {
                    case "IMAGE": heads.Add("IMAGE"); break;
                    case "SUPPLIER": heads.Add("SUPPLIER"); break;
                    case "CUSTOMER": heads.Add("CUSTOMER"); break;
                    case "CATEGORY": heads.Add("CATEGORY"); break;
                    case "MODEL": heads.Add("MODEL"); break;
                    case "CODE": heads.Add("PRODUCT CODE"); break;
                    case "PARTA": heads.Add("PART A"); break;
                    case "PARTB": heads.Add("PART B"); break;
                    case "PARTNO": heads.Add("PART NO"); break;
                    case "NAME": heads.Add("PRODUCT NAME"); break;
                    case "PACKSIZE": heads.Add("PACK SIZE"); break;
                    case "BIN": heads.Add("BIN"); break;
                    case "MOTHER": if (s.CountCoil) heads.Add("MASTER COIL"); break;
                    case "COILNO": if (s.CountCoil) heads.Add("NUMBER COIL"); break;
                    case "WEIGHT": heads.Add("WEIGHT (KG)"); break;
                    case "QRCODE": heads.Add("QR CODE"); break;
                    default:
                        // ช่องกรอกเพิ่มเองของคลัง (CF12) -> หัวคอลัมน์ = ชื่อช่อง (Import อ่านกลับด้วยชื่อเดียวกัน)
                        if (CustomFields.IsKey(key) && (customDefs ??= new CustomFieldService().GetDefs(s.StkId)).FirstOrDefault(d => d.FieldId == CustomFields.IdOf(key)) is { } cf)
                            heads.Add(cf.Label);
                        break;
                }
            }
            foreach (var must in new[] { "PRODUCT NAME", "PRODUCT CODE" }) if (!heads.Contains(must)) heads.Insert(1, must);
            // ยอดคงเหลือเริ่มต้น: คลังที่นับ Coil ใช้น้ำหนักของ Coil (WEIGHT) แทน
            if (!s.CountCoil || !heads.Contains("WEIGHT (KG)")) heads.Add(s.QtyHeader);
            heads.AddRange(new[] { "STOCK1", "SHOW/HIDE" });
            return heads.Distinct().ToArray();
        }

        // forStock = null -> Template ทุกคอลัมน์ (ทุกคลัง) / เลือกคลัง -> คอลัมน์ตามช่องกรอกของคลังนั้น + STOCK1 ใส่รหัสคลังให้แล้ว
        public void CreatePartTemplate(string path, List<StockModel> stocks, StockModel forStock = null, IList<string> formFields = null)
        {
            using (var wb = new XLWorkbook())
            {
                var ws = wb.AddWorksheet("PRODUCTS");
                var heads = forStock != null && formFields != null ? PartHeadsForForm(forStock, formFields) : PartHeadsFor(forStock);
                Header(ws, heads, heads.Select(h => PartWidths.TryGetValue(h, out double w) ? w : 12).ToArray());
                int lastRow = forStock == null ? 31 : 101;   // ทุกคอลัมน์ 30 แถว / ตามคลัง 100 แถว
                Body(ws, lastRow, heads.Length);
                for (int r = 2; r <= lastRow; r++) ws.Cell(r, 1).Value = r - 1;
                int stockCol = Array.IndexOf(heads, "STOCK1") + 1;
                if (forStock != null && stockCol > 0) ws.Range(2, stockCol, lastRow, stockCol).Value = forStock.Code;
                foreach (var h in new[] { "PRODUCT CODE", "BIN", "NUMBER COIL", "MASTER COIL", "QR CODE", "PART A", "PART B", "PART NO" })
                {
                    int c = Array.IndexOf(heads, h) + 1;
                    if (c > 0) ws.Range(2, c, lastRow, c).Style.NumberFormat.Format = "@";   // เลขรหัสขึ้นต้น 0 ไม่หาย
                }
                // same look as the other import templates: yellow = fill in · gray = NO / STOCK1 already filled for the chosen stock
                ws.Range(2, 2, lastRow, heads.Length).Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
                ws.Range(2, 1, lastRow, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#EDEDED");
                if (forStock != null && stockCol > 0) ws.Range(2, stockCol, lastRow, stockCol).Style.Fill.BackgroundColor = XLColor.FromHtml("#EDEDED");

                Guide(wb, forStock == null ? "CHR-Nexus - MASTER DATA › Product Control (IMPORT EXCEL)" : $"CHR-Nexus - MASTER DATA › Product Control (IMPORT EXCEL) -> {forStock.Code}  •  STOCK1 = {forStock.Code} ใส่ให้แล้ว", new[]
                {
                    ("PRODUCT CODE *", "รหัสสินค้า (บังคับ) - ไม่มีรหัสให้ใส่ -  /  สินค้า 1 รายการ = PRODUCT CODE + PART A (ซ้ำกับที่มีในระบบจะถูกข้าม)"),
                    ("PRODUCT NAME *", "ชื่อสินค้า (บังคับ)"),
                    ("SUPPLIER / CUSTOMER", "ผู้ขาย / ลูกค้า (ไม่บังคับ) - ใช้แสดงกลุ่มในคลังที่ตั้งจัดกลุ่มตาม SUPPLIER / CUSTOMER"),
                    ("CATEGORY", "กลุ่มสินค้า - ว่าง = GENERAL"),
                    ("PART A / PART NO / MODEL", "รหัสเพิ่มเติม (ไม่บังคับ) - ใช้ค้นหาและสแกนได้"),
                    ("PACK SIZE", "จำนวนต่อ 1 กล่อง / 1 ป้าย (ตัวเลข)"),
                    ("BIN / QR CODE", "ตำแหน่งเก็บ / รหัส QR ของสินค้า (ไม่บังคับ) - BIN ว่าง = N/A"),
                    ("NUMBER COIL", "เลข Coil ตามป้าย (คลังที่นับ Coil เช่น STOCK-MAT / PANTA) - 1 แถว = 1 Coil / ห้ามซ้ำ / น้ำหนักของ Coil นี้ใส่ที่ STOCK (UNIT) ของแถว"),
                    ("สินค้า 1 ตัว หลาย Coil", "แถวแรกใส่ข้อมูลสินค้าครบ + NUMBER COIL / แถวถัดไปใส่แค่ BIN / NUMBER COIL / MASTER COIL / น้ำหนัก (เว้น PRODUCT CODE ว่างได้ หรือใส่ PRODUCT CODE ซ้ำก็ได้) - แถวละ 1 Coil / STOCK (UNIT) ของสินค้า = น้ำหนักรวมของ Coil ในคลังนั้น / STOCK (COIL) = จำนวน Coil"),
                    ("น้ำหนัก Coil", "ช่องยอดคงคลัง เช่น STOCK (KG.) / STOCK (UNIT) ของแถว Coil = น้ำหนักของ Coil นั้น (ตัวเลขเท่านั้น ห้ามใส่คำว่า KG)"),
                    ("MASTER COIL", "Master Coilที่ Coil นี้ตัดมา (ไม่บังคับ) - Coil ที่เป็น Master Coilเองให้เว้นว่าง เช่น NUMBER COIL = CWD1477A, MASTER COIL = ว่าง"),
                    ("IMAGE", "ชื่อไฟล์รูปในโฟลเดอร์ 1. Image Stock เช่น STOCK-4C\\STOCK-4C-01.png (ไม่บังคับ / ว่าง = ไม่มีรูป หรือไม่เปลี่ยนรูปเดิม) - ใส่รูปทีละรายการได้ที่ปุ่มรูปในหน้า MASTER DATA › Product Control"),
                    ("STOCK1 - STOCK3", "รหัสคลังที่สินค้าอยู่ ช่องละ 1 คลัง (ดูชีท STOCK CODES) - ไม่ใส่เลย = คลังหลัก"),
                    ("SHOW/HIDE", "1 = แสดง / 0 = ซ่อน ในตาราง Store (Max-Min) - ว่าง = แสดง"),
                    ("MAX / MIN", "MAX / MIN ของคลังที่ใส่ (ทศนิยมได้ถ้าคลังเปิด DECIMAL QTY) - หัวคอลัมน์ใส่หน่วยได้ เช่น MAX (KG.) / MIN (BOX)"),
                    ("STOCK (UNIT) / STOCK (BOX)", "ยอดคงเหลือตามหน่วยของคลัง (KG / PCS ...) / จำนวนกล่อง - ใส่อย่างใดอย่างหนึ่งหรือทั้งคู่ (ไม่ใส่ = 0) - หัวคอลัมน์ใส่หน่วยได้ เช่น STOCK (KG.)"),
                    ("STOCK (COIL)", "จำนวน Coil (จำนวนเต็ม) ของคลังที่นับ Coil เช่นคลัง KG - ยอด KG ใส่ที่ STOCK (UNIT) แยกกัน / คลังอื่นไม่ใช้ช่องนี้"),
                    ("STOCK (PCS)", "ยอดเป็นชิ้น (ตัวเลขเดียวกับ STOCK (UNIT) ของคลังที่นับเป็นชิ้น) - ใส่ช่องใดช่องหนึ่ง ถ้าใส่ทั้งคู่ต้องเท่ากัน"),
                    ("REMARK", "หมายเหตุ (ไม่บังคับ)"),
                    ("NO", "ลำดับ - ระบบไม่ได้ใช้ ลบหรือเว้นว่างได้"),
                    ("สีของช่อง", "สีเหลือง = ช่องกรอก · สีเทา = ระบบใส่ให้ / ไม่ต้องแก้"),
                    ("หน้าตรวจก่อนนำเข้า", "NEW = ลงทะเบียนใหม่ · SIMILAR = รหัสคล้ายสินค้าเดิม (ต่างแค่ตัวพิมพ์ / ขีด / เว้นวรรค) เลือกใช้ตัวเดิมหรือเพิ่มใหม่ · DUPLICATE = PRODUCT CODE + PART A ซ้ำในไฟล์ ใช้แถวบนสุด · INVALID = ข้อมูลไม่ถูกต้อง หรือมีในระบบแล้ว (ไม่นำเข้า) · แก้ค่า / กด ไม่ใช้ ได้ก่อนกด IMPORT"),
                    ("", "กรอกข้อมูลในชีท PRODUCTS (ชีทแรก) ได้ไม่จำกัดแถว แล้วกด IMPORT EXCEL ในหน้า MASTER DATA › Product Control"),
                });

                // 📘 ชีท EX = ตัวอย่างที่กรอกแล้ว (หัวคอลัมน์เดียวกับ PRODUCTS · ไม่ถูก Import เพราะตัวอ่านไฟล์อ่านชีทแรกเท่านั้น)
                ExampleSheet(wb, heads, forStock);
                var g = wb.Worksheet("HOW TO");
                int gr = (g.LastRowUsed()?.RowNumber() ?? 20) + 2;
                g.Cell(gr, 1).Value = "ดูตัวอย่างที่กรอกแล้วที่ชีท EX · กรอกจริงที่ชีท PRODUCTS (ชีทแรก) แล้วกด IMPORT EXCEL";
                g.Cell(gr, 1).Style.Font.Bold = true;
                g.Cell(gr, 1).Style.Font.FontColor = XLColor.FromHtml("#C62828");

                if (forStock == null)
                {
                    var s = wb.AddWorksheet("STOCK CODES");
                    Header(s, new[] { "STOCK CODE", "STOCK NAME", "UNIT", "MAIN" }, new double[] { 18, 32, 10, 8 });
                    int row = 2;
                    foreach (var st in stocks ?? new List<StockModel>())
                    {
                        s.Cell(row, 1).Value = st.Code; s.Cell(row, 2).Value = st.Name; s.Cell(row, 3).Value = st.Unit; s.Cell(row, 4).Value = st.IsMain ? "Y" : "";
                        row++;
                    }
                    Body(s, row - 1, 4);
                }
                wb.Worksheet(1).SetTabActive();
                wb.SaveAs(path);
            }
        }

        // 📘 ชีท EX ของ Template Product Control: ตัวอย่าง 3 แถวตามหัวคอลัมน์ของคลัง (คลังที่นับ Coil = สินค้า 1 ตัว 3 Coil)
        private static void ExampleSheet(XLWorkbook wb, string[] heads, StockModel st)
        {
            var ex = wb.AddWorksheet("EX");
            Header(ex, heads, heads.Select(h => PartWidths.TryGetValue(h, out double w) ? w : 14).ToArray());
            bool coil = st?.CountCoil == true;
            string stock = st?.Code ?? "STOCK-MAT";
            string qty = st?.QtyHeader ?? "STOCK (UNIT)";
            object V(string h, int i)
            {
                if (h == "NO") return i + 1;
                if (coil && i > 0)
                {
                    // แถว Coil ถัดไปของสินค้าเดียวกัน: ใส่แค่ BIN / NUMBER COIL / MASTER COIL / น้ำหนัก / STOCK1
                    return h switch
                    {
                        "BIN" => "A-01",
                        "NUMBER COIL" => i == 1 ? "CWD1477B" : "CTF0256A",
                        "MASTER COIL" => "",
                        "STOCK1" => stock,
                        _ when h == qty || h == "WEIGHT (KG)" => i == 1 ? 11470 : 10260,
                        _ => "",
                    };
                }
                string[] code = { "PD-0001", "PD-0002", "PD-0003" };
                return h switch
                {
                    "PRODUCT CODE" => coil ? "CC03-1600-0050" : code[i],
                    "PRODUCT NAME" => coil ? "SPHC-P(SPH270C) 1.6x1295xC" : $"ตัวอย่างสินค้า {(char)('A' + i)}",
                    "SUPPLIER" => coil ? "PANTA" : "SUP-A",
                    "CUSTOMER" => "CUST-A",
                    "CATEGORY" => coil ? "MATERIAL" : "GENERAL",
                    "MODEL" => $"MODEL-{i + 1}",
                    "PART A" => $"A974-0000{i + 1}",
                    "PART B" => $"B171-0001{i + 1}",
                    "PART NO" => $"12345-AB{i + 1}",
                    "PACK SIZE" => 50,
                    "PACKSIZE" => 50,
                    "BIN" => coil ? "A-01" : $"A-0{i + 1}",
                    "NUMBER COIL" => coil ? "CWD1477A" : "",
                    "MASTER COIL" => "",
                    "QR CODE" => "",
                    "IMAGE" => "",
                    "STOCK1" => stock,
                    "STOCK2" => "",
                    "STOCK3" => "",
                    "SHOW/HIDE" => 1,
                    "REMARK" => i == 0 ? "ตัวอย่าง" : "",
                    "WEIGHT (KG)" => coil ? 3936 : 1.5,
                    "STOCK (COIL)" => "",
                    "STOCK (BOX)" => 3,
                    "STOCK (PCS)" => 150,
                    _ when h.StartsWith("MAX") => coil ? 5 : 200,
                    _ when h.StartsWith("MIN") => coil ? 2 : 50,
                    _ when h == qty || h.StartsWith("STOCK (") => coil ? 3936 : 150,
                    _ => "",
                };
            }
            for (int i = 0; i < 3; i++)
                for (int c = 0; c < heads.Length; c++)
                {
                    var v = V(heads[c], i);
                    if (!(v is string t && t.Length == 0)) ex.Cell(i + 2, c + 1).Value = XLCellValue.FromObject(v);
                }
            Body(ex, 4, heads.Length);
            ex.Cell(6, 1).Value = coil
                ? $"ตัวอย่าง: สินค้า 1 ตัว มี 3 Coil ในคลัง {stock} - แถวที่ 2-3 เว้น PRODUCT CODE ได้ (หรือใส่ซ้ำก็ได้) · ผล: STOCK (KG.) = น้ำหนักรวมของ 3 Coil · STOCK (COIL) = 3"
                : "ตัวอย่าง: สินค้า 3 รายการ · กรอกจริงที่ชีท PRODUCTS (ชีทแรก) · ช่องว่าง = ไม่ใส่ค่า";
            ex.Cell(6, 1).Style.Font.Bold = true;
            ex.Cell(6, 1).Style.Font.FontColor = XLColor.FromHtml("#C62828");
            ex.SheetView.FreezeRows(1);
        }

        // ---------------------------------------------------------------- Forecast / Order / Delivery
        public static readonly string[] ForecastHeads = { "NO", "CUSTOMER", "PART A", "PART NO", "PRODUCT NAME", "MONTH", "FORECAST", "ORDER", "DELIVERY", "WORK DAYS" };

        // rows = ข้อมูลเดือนนั้นที่มีอยู่แล้ว (แก้ตัวเลขแล้ว Import กลับได้เลย) / ไม่มี = แถวว่าง
        public void CreateForecastTemplate(string path, DateTime month, IList<ForecastOrderRow> rows)
        {
            using (var wb = new XLWorkbook())
            {
                var ws = wb.AddWorksheet("FORECAST ORDER");
                Header(ws, ForecastHeads, new double[] { 6.4, 16, 20, 22, 36, 12, 14, 14, 14, 12 });
                string mon = month.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                int r = 2;
                foreach (var x in rows ?? new List<ForecastOrderRow>())
                {
                    ws.Cell(r, 1).Value = r - 1;
                    ws.Cell(r, 2).Value = x.Customer;
                    ws.Cell(r, 3).Value = x.PartA;
                    ws.Cell(r, 4).Value = x.PartNo;
                    ws.Cell(r, 5).Value = x.ProductName;
                    ws.Cell(r, 6).Value = mon;
                    ws.Cell(r, 7).Value = x.Forecast;
                    ws.Cell(r, 8).Value = x.Order;
                    ws.Cell(r, 9).Value = x.Delivery;
                    r++;
                }
                int last = Math.Max(r - 1, 31);   // แถวว่างพร้อมเส้นตารางให้กรอกต่อ (ไม่ใส่เลข NO ในแถวว่าง)
                Body(ws, last, ForecastHeads.Length);
                ws.Range(2, 3, last, 4).Style.NumberFormat.Format = "@";   // PART A / PART NO เป็นข้อความ (เลขนำหน้า 0 ไม่หาย)
                ws.Range(2, 6, last, 6).Style.NumberFormat.Format = "@";   // MONTH เป็นข้อความ 2026-10 (Excel ไม่แปลงเป็นวันที่)
                ws.Range(2, 7, last, 9).Style.NumberFormat.Format = "#,##0";
                // input = yellow (PART A of new rows, MONTH, numbers, WORK DAYS) · key of existing rows + view-only columns = gray
                const string Yellow = "#FFF2CC", Gray = "#EDEDED";
                int existingLast = r - 1;
                ws.Range(2, 3, last, 3).Style.Fill.BackgroundColor = XLColor.FromHtml(Yellow);
                ws.Range(2, 6, last, 10).Style.Fill.BackgroundColor = XLColor.FromHtml(Yellow);
                ws.Range(2, 2, last, 2).Style.Fill.BackgroundColor = XLColor.FromHtml(Gray);
                ws.Range(2, 4, last, 5).Style.Fill.BackgroundColor = XLColor.FromHtml(Gray);
                if (existingLast >= 2) ws.Range(2, 3, existingLast, 3).Style.Fill.BackgroundColor = XLColor.FromHtml(Gray);
                ws.SheetView.Freeze(1, 3);

                Guide(wb, "CHR-Nexus - Import Forecast / Order / Delivery", new[]
                {
                    ("PART A *", "PART A ของสินค้า (บังคับ) - ระบบตรวจสอบสินค้าด้วย PART A อย่างเดียว เพราะเป็นเลขเฉพาะของสินค้า / ไม่มี PART A หรือไม่พบในระบบ = ข้ามแถว"),
                    ("CUSTOMER", "ไว้ดูเท่านั้น - ระบบใช้ CUSTOMER ของสินค้าตาม PART A (ในไฟล์ไม่ตรง = ใช้ของระบบ และแจ้งตอนยืนยัน)"),
                    ("PART NO", "ไว้ดูเท่านั้น - ระบบใช้ PART NO ของสินค้าตาม PART A"),
                    ("PRODUCT NAME", "ไว้ดูเท่านั้น - ระบบใช้ชื่อสินค้าตาม PART A"),
                    ("MONTH", $"เดือนของยอด เช่น {mon} (หรือ 10/2026, Oct 2026) - ว่าง = เดือนปัจจุบัน"),
                    ("FORECAST / ORDER / DELIVERY", "ยอดพยากรณ์ / ยอดสั่ง / ยอดส่ง (ตัวเลขไม่ติดลบ) - ช่องว่าง = 0"),
                    ("WORK DAYS", "จำนวนวันทำงานของเดือน (ไม่บังคับ)"),
                    ("NO", "ลำดับ - ระบบไม่ได้ใช้"),
                    ("สีช่อง", "สีเหลือง = กรอกได้ · สีเทา = ข้อมูลอ้างอิง / PART A ของแถวที่มีอยู่แล้ว (ห้ามแก้ ใช้จับคู่)"),
                    ("ยอดเท่าเดิม", "ไม่แตะ (แสดงเป็น SAME ในพรีวิว)"),
                    ("ยอดต่างจากในระบบ", "อัพเดทเป็นยอดใหม่ (พรีวิวแสดงยอดเดิม → ยอดใหม่ ก่อนกด IMPORT) · ช่องตัวเลขว่าง = 0"),
                    ("PART A + MONTH ซ้ำในไฟล์", "ใช้แถวล่างสุด แถวบนถูกข้าม (แสดงเป็น DUPLICATE ในพรีวิว)"),
                    ("PART A คล้ายของเดิม", "เช่น ต่างแค่ตัวพิมพ์ / ขีด / เว้นวรรค = SIMILAR · เลือกผูกกับ PART A เดิมในหน้าพรีวิว"),
                    ("แถวผิด", "เช่น ไม่มี PART A / เดือนผิด / ตัวเลขผิด / ติดลบ = ข้ามแถว และแสดงในรายการผิดพลาด"),
                    ("การลบ", "ไม่มีการลบผ่าน Import · รายการที่ไม่อยู่ในไฟล์ = คงเดิม"),
                    ("", "กดปุ่ม IMPORT แล้วเลือก: IMPORT + คำนวณ MAX / MIN AUTO (คำนวณคลังที่เปิด AUTO CALC ทันที) หรือ IMPORT อย่างเดียว (ไม่คำนวณ) / ลูกค้า + สินค้า + เดือนเดียวกับที่เคยนำเข้า จะถูกแทนที่ด้วยค่าใหม่"),
                });
                wb.Worksheet(1).SetTabActive();
                wb.SaveAs(path);
            }
        }
    }
}
