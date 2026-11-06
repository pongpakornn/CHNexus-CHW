using System.Globalization;
using ClosedXML.Excel;

namespace Nexus.Services;

// 📄 MIN REPORT -> แบบฟอร์ม FM-EN-04-22 "Improvement Plan / All" (A4 แนวนอน · 7 รายการต่อหน้า) - ใช้ได้ทุกคลัง
//   แยกหน้าตาม Customer / Supplier ของสินค้าอัตโนมัติ (หัวเอกสาร Customer : / Supplier : / Other : คลัง)
//   คอลัมน์: No. · Problem / Request · Countermeasure / Action · In Charge (Name · Sect.) · Finish (Plan · Actual) · After action / Evidence
//   ท้ายหน้า: ซ้าย = เลขที่เอกสาร FM-EN-04-22 / 0 · ขวา = วันที่เริ่มใช้เอกสาร 05-03-62 · ช่องลายเซ็น Prepared / Checked / Checked / Approved เว้นว่าง
//   หน้า PREVIEW / PDF ฝั่งเว็บวาดแบบเดียวกัน (MinReportSheet.tsx)
public static class MinReportForm
{
    public const string DocNo = "FM-EN-04-22 / 0";
    public const string DocDate = "05-03-62";
    public const int PerPage = 7;
    private const string Font = "TH SarabunPSK";
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public sealed class Item
    {
        public string Customer { get; set; }
        public string Supplier { get; set; }
        public string Problem { get; set; }
        public string Action { get; set; }
        public string Name { get; set; }
        public string Sect { get; set; }
        public string Plan { get; set; }
        public string Actual { get; set; }
        public string After { get; set; }
        // ลายเซ็นที่ลงแล้ว (ช่อง 1 Prepared · 2 Checked · 3 Checked · 4 Approved) - แสดงเมื่อหน้านั้นมีรายงานเดียว
        public List<(int Slot, byte[] Img, string Caption)> Signs { get; set; }
    }

    // บรรทัดสินค้า: บรรทัดที่ 1 / 2 ตามรูปแบบของคลัง (SETUP › MIN REPORT › รูปแบบการแสดงสินค้า)
    private static string Head(MinPartBase r)
    {
        string t = string.IsNullOrWhiteSpace(r.Title) ? "ไม่มีรหัส" : r.Title;
        return string.IsNullOrWhiteSpace(r.Sub) ? t : $"{t}  {r.Sub}";
    }

    // "3 วัน 12 ชม. 30 นาที"
    public static string Dur(TimeSpan t)
    {
        long m = Math.Max(0, (long)t.TotalMinutes);
        long d = m / 1440, h = m % 1440 / 60, mi = m % 60;
        var parts = new List<string>();
        if (d > 0) parts.Add($"{d} วัน");
        if (h > 0) parts.Add($"{h} ชม.");
        if (mi > 0 || parts.Count == 0) parts.Add(m == 0 ? "ไม่ถึง 1 นาที" : $"{mi} นาที");
        return string.Join(" ", parts);
    }

    private static string D(DateTime d) => d.ToString("dd/MM/yyyy HH:mm", Inv);
    private static string N(decimal? v) => v.HasValue ? v.Value.ToString("#,##0.###", Inv) : "-";
    private static string Nums(decimal? qty, string box, decimal? min, decimal? max) =>
        $"STOCK {N(qty)}{(string.IsNullOrWhiteSpace(box) ? "" : $" ({box} BOX)")} · MIN {N(min)} · MAX {N(max)}";

    public static Item From(MinWatchRow w) => new()
    {
        Customer = w.Customer, Supplier = w.Supplier,
        Problem = $"{Head(w)}\nค้างที่ค่า MIN {Dur(DateTime.Now - w.BelowSince)}\nตั้งแต่ {D(w.BelowSince)} - ปัจจุบัน\n{Nums(w.Qty, w.StockBox, w.MinQty, w.MaxQty)}",
        Action = "", Name = "", Sect = "", Plan = "", Actual = "",
        After = $"ยังค้างที่ค่า MIN (รอระบุสาเหตุ)\nอัพเดทล่าสุด {D(w.LastSeen)}"
    };

    public static Item From(MinReportRow r) => new()
    {
        Customer = r.Customer, Supplier = r.Supplier,
        Problem = $"{Head(r)}\nค้างที่ค่า MIN {Dur((r.ResolvedAt ?? DateTime.Now) - r.BelowSince)}\nตั้งแต่ {D(r.BelowSince)} - {(r.ResolvedAt is DateTime x ? D(x) : "ปัจจุบัน")}\n{Nums(r.Qty, r.StockBox, r.MinQty, r.MaxQty)}",
        Action = string.IsNullOrWhiteSpace(r.ReasonType) || (r.Reason ?? "").StartsWith(r.ReasonType) ? r.Reason : $"[{r.ReasonType}] {r.Reason}",
        Name = string.IsNullOrWhiteSpace(r.ReporterName) ? r.ReportedBy : r.ReporterName,
        Sect = r.Section ?? "",
        Plan = "",
        Actual = r.ResolvedAt?.ToString("dd-MM-yy", Inv) ?? "",
        After = (r.ResolvedAt is DateTime ok ? $"กลับมาพ้นค่า MIN แล้ว {D(ok)}" : $"ยังค้างที่ค่า MIN\nอัพเดทล่าสุด {(r.LastSeen is DateTime ls ? D(ls) : "-")}")
                + $"\nรายงาน {D(r.ReportedAt)} (ค้างมา {Dur(r.ReportedAt - r.BelowSince)})"
                + (r.FlowStatus == "DONE" ? $"\nลงนามครบ {(r.DoneAt is DateTime dn ? D(dn) : "")}" : r.FlowStatus == "SIGNING" ? $"\nรอลงนาม {MinReportService.SlotName(r.NextSlot ?? 0)}" : "")
    };

    // ความกว้างคอลัมน์ (px ตามแบบฟอร์มจริง) - หัวเอกสารกับตารางใช้เส้นแบ่งชุดเดียวกัน
    //   1 No · 2-3 Problem · 4-5 Countermeasure · 6 Name · 7 Sect · 8-9 Plan · 10 Actual · 11-13 After
    //   หัว: 1-2 โลโก้ · 3-4 ชื่อเอกสาร · 5-8 Customer / Supplier / Other · 9-10 Prepared · 11 Checked · 12 Checked · 13 Approved
    private static readonly int[] Px = { 31, 161, 79, 176, 85, 66, 58, 31, 31, 56, 85, 85, 79 };

    public static void Save(List<Item> items, string stock, string subject, string path)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("ALL");
        ws.Style.Font.FontName = Font;
        ws.Style.Font.FontSize = 14;
        for (int c = 0; c < Px.Length; c++) ws.Column(c + 1).Width = Px[c] / 6.6;

        byte[] logo = Logo();
        // แยกหน้าตาม Customer / Supplier (ไม่มีรายการ = หน้าว่าง 1 หน้า)
        var groups = items.GroupBy(i => (C: i.Customer ?? "", S: i.Supplier ?? "")).OrderBy(g => g.Key.C).ThenBy(g => g.Key.S).ToList();
        var pages = new List<(string C, string S, List<Item> Rows, int No)>();
        foreach (var g in groups)
        {
            var list = g.ToList();
            for (int i = 0; i < list.Count; i += PerPage) pages.Add((g.Key.C, g.Key.S, list.Skip(i).Take(PerPage).ToList(), i));
        }
        if (pages.Count == 0) pages.Add(("", "", new List<Item>(), 0));

        int r0 = 1;
        foreach (var pg in pages)
        {
            Block(ws, r0, pg.C, pg.S, stock, subject, pg.Rows, pg.No, logo);
            r0 += 14;
            if (pg != pages[^1]) ws.PageSetup.AddHorizontalPageBreak(r0 - 1);
        }

        var ps = ws.PageSetup;
        ps.PageOrientation = XLPageOrientation.Landscape;
        ps.PaperSize = XLPaperSize.A4Paper;
        ps.FitToPages(1, 0);
        ps.Margins.Left = 0.47; ps.Margins.Right = 0.47; ps.Margins.Top = 0.55; ps.Margins.Bottom = 0.4;
        ps.CenterHorizontally = true;
        ps.PrintAreas.Add(1, 1, r0 - 1, Px.Length);
        ws.SheetView.View = XLSheetViewOptions.PageBreakPreview;
        wb.SaveAs(path);
    }

    private static void Block(IXLWorksheet ws, int r, string customer, string supplier, string stock, string subject, List<Item> rows, int startNo, byte[] logo)
    {
        IXLRange M(int r1, int c1, int r2, int c2) { var x = ws.Range(r1, c1, r2, c2); if (r1 != r2 || c1 != c2) x.Merge(); return x; }
        void Box(IXLRange x) { x.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; }

        for (int i = 0; i < 3; i++) ws.Row(r + i).Height = 17;
        ws.Row(r + 3).Height = 18;
        ws.Row(r + 4).Height = 19;
        ws.Row(r + 5).Height = 17;
        for (int i = 0; i < PerPage; i++) ws.Row(r + 6 + i).Height = 66;
        ws.Row(r + 13).Height = 15;

        // หัวเอกสาร: โลโก้ · ชื่อเอกสาร · Customer / Supplier / Other · ช่องลายเซ็น
        Box(M(r, 1, r + 2, 2));
        if (logo != null)
        {
            using var ms = new MemoryStream(logo);
            ws.AddPicture(ms).MoveTo(ws.Cell(r, 1), 14, 15).WithSize(166, 26);
        }
        var title = M(r, 3, r + 2, 4);
        title.Value = "Improvement Plan / All";
        title.Style.Font.FontSize = 16; title.Style.Font.Bold = true;
        title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; title.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        Box(title);
        string[] labels = { "Customer  :  ", "Supplier    :  ", "Other        :  " };
        string[] vals = { string.IsNullOrEmpty(customer) ? "-" : customer, string.IsNullOrEmpty(supplier) ? "-" : supplier, $"STOCK {stock}" };
        for (int i = 0; i < 3; i++)
        {
            var x = M(r + i, 5, r + i, 8);
            x.Value = labels[i] + vals[i];
            x.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            x.Style.Font.FontColor = XLColor.FromHtml("#333333");
        }
        Box(ws.Range(r, 5, r + 2, 8));
        foreach (var (c1, c2, t) in new[] { (9, 10, "Prepared"), (11, 11, "Checked"), (12, 12, "Checked"), (13, 13, "Approved") })
        {
            var h = M(r, c1, r, c2);
            h.Value = t; h.Style.Font.FontSize = 12;
            h.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            Box(h);
            Box(M(r + 1, c1, r + 3, c2));   // ช่องเซ็น
        }
        // ✍ ลายเซ็นที่ลงแล้ว (หน้าที่มีรายงานเดียว): รูปกลางช่อง + ชื่อ / เวลาใต้รูป
        var signs = rows.Count == 1 ? rows[0].Signs : null;
        if (signs != null)
            foreach (var (slot, img, caption) in signs)
            {
                int col = slot switch { 1 => 9, 2 => 11, 3 => 12, 4 => 13, _ => 0 };
                if (col == 0) continue;
                double w = slot == 1 ? Px[8] + Px[9] : Px[col - 1];
                if (img != null)
                    try
                    {
                        using var ms = new MemoryStream(img);
                        var pic = ws.AddPicture(ms);
                        double scale = Math.Min((w - 8) / pic.OriginalWidth, 36.0 / pic.OriginalHeight);
                        int pw = Math.Max(1, (int)(pic.OriginalWidth * scale)), ph = Math.Max(1, (int)(pic.OriginalHeight * scale));
                        pic.MoveTo(ws.Cell(r + 1, col), (int)((w - pw) / 2), 2).WithSize(pw, ph);
                    }
                    catch { /* รูปเสียก็ยังมีชื่อ */ }
                var cap = ws.Cell(r + 3, col);
                cap.Value = caption;
                cap.Style.Font.FontSize = 9;
                cap.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                cap.Style.Alignment.Vertical = XLAlignmentVerticalValues.Bottom;
            }
        var sub = M(r + 3, 1, r + 3, 8);
        sub.Value = "Subject : " + subject;
        sub.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        Box(sub);

        // หัวตาราง
        void H(int r1, int c1, int r2, int c2, string t, double size = 16)
        {
            var x = M(r1, c1, r2, c2);
            x.Value = t; x.Style.Font.Bold = true; x.Style.Font.FontSize = size;
            x.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; x.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            Box(x);
        }
        H(r + 4, 1, r + 5, 1, "No.");
        H(r + 4, 2, r + 5, 3, "Problem / Request");
        H(r + 4, 4, r + 5, 5, "Countermeasure / Action");
        H(r + 4, 6, r + 4, 7, "In Charge", 14);
        H(r + 5, 6, r + 5, 6, "Name", 14);
        H(r + 5, 7, r + 5, 7, "Sect.", 14);
        H(r + 4, 8, r + 4, 10, "Finish", 14);
        H(r + 5, 8, r + 5, 9, "Plan", 14);
        H(r + 5, 10, r + 5, 10, "Actual", 14);
        H(r + 4, 11, r + 5, 13, "After action / Evidence");

        // รายการ 7 แถว (เส้นประคั่นแถว)
        for (int i = 0; i < PerPage; i++)
        {
            int rr = r + 6 + i;
            var it = i < rows.Count ? rows[i] : null;
            void V(int c1, int c2, string t, bool center = false)
            {
                var x = M(rr, c1, rr, c2);
                x.Value = t ?? "";
                x.Style.Alignment.WrapText = true;
                x.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                x.Style.Alignment.Horizontal = center ? XLAlignmentHorizontalValues.Center : XLAlignmentHorizontalValues.Left;
                x.Style.Font.FontSize = 12;
            }
            V(1, 1, it == null ? "" : (startNo + i + 1).ToString(Inv), true);
            V(2, 3, it?.Problem);
            V(4, 5, it?.Action);
            V(6, 6, it?.Name, true);
            V(7, 7, it?.Sect, true);
            V(8, 9, it?.Plan, true);
            V(10, 10, it?.Actual, true);
            V(11, 13, it?.After);
            var row = ws.Range(rr, 1, rr, 13);
            row.Style.Border.BottomBorder = i == PerPage - 1 ? XLBorderStyleValues.Thin : XLBorderStyleValues.Dotted;
        }
        var body = ws.Range(r + 4, 1, r + 12, 13);
        foreach (int c in new[] { 1, 3, 5, 6, 7, 9, 10 })
            ws.Range(r + 4, c, r + 12, c).Style.Border.RightBorder = c is 1 or 3 or 7 or 9 ? XLBorderStyleValues.Medium : XLBorderStyleValues.Thin;
        body.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        body.Style.Border.LeftBorder = XLBorderStyleValues.Thin;

        // ท้ายหน้า: เลขที่เอกสาร / วันที่เริ่มใช้
        var l = M(r + 13, 1, r + 13, 6);
        l.Value = DocNo; l.Style.Font.FontSize = 12;
        var rt = M(r + 13, 7, r + 13, 13);
        rt.Value = DocDate; rt.Style.Font.FontSize = 12; rt.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
    }

    private static byte[] Logo()
    {
        try
        {
            using var s = typeof(MinReportForm).Assembly.GetManifestResourceStream("CHR.Logo.png");
            if (s == null) return null;
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
        catch { return null; }
    }
}
