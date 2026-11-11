using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace Nexus.Services;

// 📂 FORECAST FILE: อ่านไฟล์ FORECAST ของฝ่ายขายทั้งไฟล์ (1 ชีท = 1 ลูกค้า) แบบเดียวกับตัวกรอง Forecast_Order_Filter.html ของนนท์
//   ชีทลูกค้า: หัวตารางมีเดือน (Jan…Dec / ม.ค.…) ≥ 3 คอลัมน์ · คอลัมน์ Menu = FORECAST / ORDER / DELIVERY / DIFF ต่อ Part
//     NO · MODEL · CUS… (= PART A) · PART NO · PART NAME · "CUSTOMER : xxx" เหนือหัวตาราง = ชื่อลูกค้า
//     DEC'25 (มี 'ปี) = คอลัมน์ของปีก่อน ไม่ใช่เดือนของปีนี้ -> ใช้หาปีของไฟล์ (DEC'25 = ไฟล์ปี 2026)
//   ชีท DIFF (3): รายชื่อลูกค้า (ชีทที่สูตรอ้างถึง) + แถว Total ไว้ตรวจยอดรวม · ชีทที่ขึ้นต้นด้วย DIFF ไม่ใช่ลูกค้า (ข้าม)
//   อ่านค่าที่คำนวณไว้แล้วในไฟล์ (Cached) ไม่คำนวณสูตรใหม่ (ไฟล์ลิงก์ไปไฟล์อื่น)
public sealed class ForecastFileService
{
    public sealed class Part
    {
        public string No { get; set; } = "";
        public string Model { get; set; } = "";
        public string PartA { get; set; } = "";
        public string Tag { get; set; } = "";
        public string PartNo { get; set; } = "";
        public string PartName { get; set; } = "";
        public string Note { get; set; } = "";
        public decimal?[] F { get; set; } = new decimal?[12];
        public decimal?[] O { get; set; } = new decimal?[12];
        public decimal?[] D { get; set; } = new decimal?[12];
        public decimal?[] X { get; set; } = new decimal?[12];
    }
    public sealed record Sheet(string Name, string Customer, int[] Months, List<Part> Parts);
    public sealed record RefTotal(decimal?[] F, decimal?[] O, decimal?[] D);
    public sealed record Ref(string Name, List<string> Names, RefTotal Total);
    public sealed record Result(int? Year, List<Sheet> Sheets, Ref Ref, List<string> Skipped);

    private static readonly string[] EN = { "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec" };
    private static readonly string[] LONG = { "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december" };
    private static readonly string[] TH = { "มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "กย", "ตค", "พย", "ธค" };

    private static XLCellValue Val(IXLCell c)
    {
        try { return c.HasFormula ? c.CachedValue : c.Value; }
        catch { return Blank.Value; }
    }
    private static string Txt(IXLCell c)
    {
        var v = Val(c);
        try
        {
            if (v.IsBlank) return "";
            if (v.IsText) return v.GetText().Trim();
            if (v.IsDateTime) return v.GetDateTime().ToString("MMM", CultureInfo.InvariantCulture);
            if (v.IsNumber) return v.GetNumber().ToString(CultureInfo.InvariantCulture);
            return v.ToString().Trim();
        }
        catch { return ""; }
    }
    private static decimal? Num(IXLCell c)
    {
        var v = Val(c);
        try
        {
            if (v.IsNumber) return (decimal)v.GetNumber();
            if (v.IsText && decimal.TryParse(v.GetText().Replace(",", "").Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d)) return d;
        }
        catch { }
        return null;
    }

    // เดือน 1-12 ของหัวคอลัมน์ (0 = ไม่ใช่เดือน / DEC'25 = ปีก่อน)
    private static int MonthOf(IXLCell c)
    {
        var v = Val(c);
        if (v.IsDateTime) return v.GetDateTime().AddHours(12).Month;
        string raw = Regex.Replace(Txt(c).ToLowerInvariant(), @"[.\s]", "");
        if (raw.Length == 0 || Regex.IsMatch(raw, @"['’‘`]\d{2}$")) return 0;
        var m = Regex.Match(raw, @"^[a-zก-๙]+");
        if (!m.Success) return 0;
        string w = m.Value;
        int i;
        if (Regex.IsMatch(w, "^[a-z]+$"))
        {
            i = Array.IndexOf(EN, w);
            if (i < 0) i = Array.IndexOf(LONG, w);
            if (i < 0 && w == "sept") i = 8;
        }
        else i = Array.IndexOf(TH, w);
        return i >= 0 ? i + 1 : 0;
    }

    private static string MenuKey(string s)
    {
        string lab = Regex.Replace(s ?? "", @"\s+", "").ToUpperInvariant();
        return lab.StartsWith("FORECAST") ? "F" : lab.StartsWith("ORDER") ? "O" : lab.StartsWith("DELIVER") ? "D" : lab.StartsWith("DIFF") ? "X" : "";
    }

    private static (int Hr, Dictionary<int, int> Cols)? FindHeader(IXLWorksheet ws, int r0, int r1, int c0, int c1)
    {
        for (int r = r0; r <= Math.Min(r1, r0 + 40); r++)
        {
            var found = new Dictionary<int, int>();   // เดือน -> คอลัมน์
            for (int c = c0; c <= c1; c++)
            {
                int mo = MonthOf(ws.Cell(r, c));
                if (mo > 0 && !found.ContainsKey(mo)) found[mo] = c;
            }
            if (found.Count >= 3) return (r, found);
        }
        return null;
    }

    private static Sheet ParseSheet(IXLWorksheet ws)
    {
        var used = ws.RangeUsed();
        if (used == null) return null;
        int r0 = used.FirstRow().RowNumber(), r1 = used.LastRow().RowNumber(), c0 = used.FirstColumn().ColumnNumber(), c1 = used.LastColumn().ColumnNumber();
        var hd = FindHeader(ws, r0, r1, c0, c1);
        if (hd == null) return null;
        int hr = hd.Value.Hr;
        var monthCols = hd.Value.Cols;

        int no = -1, model = -1, item = -1, partNo = -1, partName = -1, menu = -1;
        for (int c = c0; c <= c1; c++)
        {
            string t = Regex.Replace(Txt(ws.Cell(hr, c)).ToLowerInvariant(), @"\s+", " ");
            if (t.Length == 0) continue;
            bool hasNo = Regex.IsMatch(t, "part ?no"), hasName = Regex.IsMatch(t, "part ?name");
            if (Regex.IsMatch(t, @"^no\.?$")) { if (no < 0) no = c; }
            else if (t.StartsWith("model")) { if (model < 0) model = c; }
            else if (t.StartsWith("cus")) { if (item < 0) item = c; }
            else if (hasNo) { if (partNo < 0) partNo = c; }
            else if (hasName) { if (partName < 0) partName = c; }
            else if (t == "menu") { if (menu < 0) menu = c; }
        }
        if (menu < 0)
            for (int r = hr + 1; r <= Math.Min(r1, hr + 30) && menu < 0; r++)
                for (int c = c0; c <= c1; c++)
                    if (Txt(ws.Cell(r, c)).ToUpperInvariant().StartsWith("FORECAST")) { menu = c; break; }
        if (menu < 0) return null;

        string customer = "";
        for (int r = r0; r < hr && customer.Length == 0; r++)
            for (int c = c0; c <= Math.Min(c1, c0 + 14); c++)
            {
                var mm = Regex.Match(Txt(ws.Cell(r, c)), @"customer\s*[:：]\s*(.+)", RegexOptions.IgnoreCase);
                if (mm.Success) { customer = Regex.Replace(mm.Groups[1].Value, @"\s+", " ").Trim(); break; }
            }

        var parts = new List<Part>();
        Part cur = null;
        var months = monthCols.Keys.OrderBy(x => x).ToArray();
        for (int r = hr + 1; r <= r1; r++)
        {
            string key = MenuKey(Txt(ws.Cell(r, menu)));
            if (key.Length == 0) continue;
            if (key == "F")
            {
                cur = new Part { No = no >= 0 ? Txt(ws.Cell(r, no)) : "" };
                parts.Add(cur);
                if (partNo >= 0) cur.PartNo = Txt(ws.Cell(r, partNo));
                if (partName >= 0) cur.PartName = Txt(ws.Cell(r, partName));
            }
            else if (cur != null)
            {
                if (partNo >= 0) { string pn = Txt(ws.Cell(r, partNo)); if (pn.Length > 0) cur.Note = cur.Note.Length > 0 ? cur.Note + " " + pn : pn; }
                if (partName >= 0 && cur.PartName.Length == 0) cur.PartName = Txt(ws.Cell(r, partName));
            }
            if (cur == null) continue;
            if (model >= 0 && cur.Model.Length == 0) cur.Model = Txt(ws.Cell(r, model));
            if (item >= 0)
            {
                string it = Txt(ws.Cell(r, item));
                if (it.Length > 0)
                {
                    if (key == "X") { if (it != cur.PartA) cur.Tag = it; }
                    else if (cur.PartA.Length == 0) cur.PartA = it;
                }
            }
            var arr = key switch { "F" => cur.F, "O" => cur.O, "D" => cur.D, _ => cur.X };
            foreach (int m in months) arr[m - 1] = Num(ws.Cell(r, monthCols[m]));
        }
        parts = parts.Where(p => p.PartNo.Length > 0 || p.PartA.Length > 0 || p.PartName.Length > 0).ToList();
        if (parts.Count == 0) return null;
        return new Sheet(ws.Name, customer.Length > 0 ? customer : ws.Name, months, parts);
    }

    // ชีท DIFF (3): ชีทลูกค้าที่สูตรรวมยอดอ้างถึง + แถว Total (FORECAST / ORDER / DELIVERY)
    private static Ref ParseRef(XLWorkbook wb)
    {
        var ws = wb.Worksheets.FirstOrDefault(w => Regex.IsMatch(w.Name.Trim(), @"^diff\s*\(3\)$", RegexOptions.IgnoreCase));
        var used = ws?.RangeUsed();
        if (used == null) return null;
        int r0 = used.FirstRow().RowNumber(), r1 = used.LastRow().RowNumber(), c0 = used.FirstColumn().ColumnNumber(), c1 = used.LastColumn().ColumnNumber();
        var hd = FindHeader(ws, r0, r1, c0, c1);
        int hr = hd?.Hr ?? r0 + 3;
        int labCol = -1, menuCol = -1;
        for (int c = c0; c <= c1; c++)
        {
            string h = Txt(ws.Cell(hr, c));
            if (labCol < 0 && Regex.IsMatch(h, "^customer$", RegexOptions.IgnoreCase)) labCol = c;
            if (menuCol < 0 && Regex.IsMatch(h, "^menu$", RegexOptions.IgnoreCase)) menuCol = c;
        }
        var lower = wb.Worksheets.ToDictionary(w => w.Name.Trim().ToLowerInvariant(), w => w.Name);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var cell in used.CellsUsed(c => c.HasFormula))
        {
            string f = cell.FormulaA1 ?? "";
            var m = Regex.Match(f, @"^=?'?([^'!]+)'?!");
            if (!m.Success) continue;
            string sh = m.Groups[1].Value.Trim();
            if (!Regex.IsMatch(sh, "^diff", RegexOptions.IgnoreCase)) { if (lower.TryGetValue(sh.ToLowerInvariant(), out var real)) names.Add(real); }
            else if (labCol >= 0)
                for (int rr = cell.Address.RowNumber; rr > hr; rr--)
                {
                    string lb = Txt(ws.Cell(rr, labCol));
                    if (lb.Length == 0) continue;
                    if (lower.TryGetValue(lb.ToLowerInvariant(), out var hit) && !Regex.IsMatch(hit, "^diff", RegexOptions.IgnoreCase)) names.Add(hit);
                    break;
                }
        }
        RefTotal total = null;
        if (hd != null && menuCol >= 0)
            for (int r = hr + 1; r <= r1 && total == null; r++)
                for (int c = c0; c <= c0 + 3; c++)
                {
                    if (!Regex.IsMatch(Txt(ws.Cell(r, c)), "^total$", RegexOptions.IgnoreCase)) continue;
                    if (MenuKey(Txt(ws.Cell(r, menuCol))) == "F" && MenuKey(Txt(ws.Cell(r + 1, menuCol))) == "O" && MenuKey(Txt(ws.Cell(r + 2, menuCol))) == "D")
                    {
                        decimal?[] Row(int rr) { var a = new decimal?[12]; foreach (var (mo, col) in hd.Value.Cols) a[mo - 1] = Num(ws.Cell(rr, col)); return a; }
                        total = new RefTotal(Row(r), Row(r + 1), Row(r + 2));
                    }
                    break;
                }
        return new Ref(ws.Name, names.ToList(), total);
    }

    // ปีของไฟล์: หัวคอลัมน์ DEC'25 (ธ.ค. ปีก่อน) -> 2026
    private static int? YearOf(XLWorkbook wb)
    {
        foreach (var ws in wb.Worksheets)
        {
            var used = ws.RangeUsed();
            if (used == null) continue;
            int r0 = used.FirstRow().RowNumber();
            foreach (var c in ws.Range(r0, used.FirstColumn().ColumnNumber(), Math.Min(used.LastRow().RowNumber(), r0 + 40), used.LastColumn().ColumnNumber()).CellsUsed())
            {
                var m = Regex.Match(Txt(c), @"^dec\W*(\d{2})$", RegexOptions.IgnoreCase);
                if (m.Success) return 2000 + int.Parse(m.Groups[1].Value) + 1;
            }
        }
        return null;
    }

    public Result Read(string path)
    {
        using var wb = new XLWorkbook(path);
        var sheets = new List<Sheet>();
        var skipped = new List<string>();
        foreach (var ws in wb.Worksheets)
        {
            if (Regex.IsMatch(ws.Name.Trim(), "^diff", RegexOptions.IgnoreCase)) { skipped.Add(ws.Name); continue; }
            var s = ParseSheet(ws);
            if (s != null) sheets.Add(s);
        }
        if (sheets.Count == 0) throw new InvalidOperationException("ไม่พบตารางในไฟล์นี้\nระบบมองหาหัวคอลัมน์เดือน (Jan, Feb, …) และแถว FORECAST / ORDER / DELIVERY");
        var rf = ParseRef(wb);
        if (rf != null && !sheets.Any(s => rf.Names.Contains(s.Name, StringComparer.OrdinalIgnoreCase))) rf = null;
        return new Result(YearOf(wb), sheets, rf, skipped);
    }
}
