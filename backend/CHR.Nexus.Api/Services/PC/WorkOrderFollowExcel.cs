using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace Nexus.Services;

// WORK ORDER FOLLOW Excel: TEMPLATE (parts x 7 rows x days of one month) + IMPORT reader. Look = PP "Actual Capacity" export (dark header bands, thin borders).
//   Layout (1-based): row 1 title · row 2 "PLAN" | planId · row 3 "MONTH" | yyyy-MM · row 5 band · row 6 column heads · data from row 7
//   columns: A ITEM ID · B KEY · C PART NO · D PART NAME · E PACK · F ROW · G.. day 1..N · last = TOTAL
//   per part 7 rows: OR, W/O, สั่งผลิต, ผลิตได้ D, ผลิตได้ N, DEL., ST. (formula, never imported). Blank cell on import = untouched.
public static class WorkOrderFollowExcel
{
    public static readonly (string Key, string Label)[] DataRows =
    {
        ("OR", "OR"), ("WO", "W/O"), ("ORDER", "สั่งผลิต"), ("PROD_D", "ผลิตได้ D"), ("PROD_N", "ผลิตได้ N"), ("DEL", "DEL."),
    };
    public const int FirstCol = 7, HeadRow = 6, FirstRow = 7;

    public sealed record TplItem(int ItemId, string PartNo, string PartName, int? PackSize, Dictionary<string, Dictionary<string, decimal>> Cells);
    public sealed record Cell(int ItemId, string RowKey, int Day, decimal Qty, string At);
    public sealed record Parsed(int PlanId, DateTime Month, List<Cell> Cells, List<(string Cell, string Text)> Errors);

    private static void Head(IXLRange r, string hex)
    {
        r.Style.Font.Bold = true; r.Style.Font.FontColor = XLColor.White; r.Style.Fill.BackgroundColor = XLColor.FromHtml(hex);
        r.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center; r.Style.Alignment.WrapText = true;
    }

    public static byte[] Template(int planId, string customer, string workOrderNo, DateTime month, List<TplItem> items)
    {
        int days = DateTime.DaysInMonth(month.Year, month.Month);
        int totalCol = FirstCol + days;
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add($"WOF {month.ToString("MMM yyyy", CultureInfo.InvariantCulture)}");
        ws.Cell(1, 1).Value = $"WORK ORDER FOLLOW TEMPLATE • {customer} • {month.ToString("MMMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant()}" + (string.IsNullOrWhiteSpace(workOrderNo) ? "" : $" • W/O {workOrderNo}");
        ws.Cell(1, 1).Style.Font.Bold = true; ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(2, 1).Value = "PLAN"; ws.Cell(2, 2).Value = planId;
        ws.Cell(3, 1).Value = "MONTH"; ws.Cell(3, 2).Value = month.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        ws.Cell(2, 4).Value = "กรอกจำนวนในช่องวัน แล้ว IMPORT กลับ · ช่องว่าง = ไม่แตะยอดเดิม · อย่าแก้คอลัมน์ ITEM ID / KEY · แถว ST. คำนวณให้ (ไม่นำเข้า)";
        ws.Cell(2, 4).Style.Font.FontColor = XLColor.FromHtml("#b45309");
        ws.Range(2, 1, 3, 2).Style.Font.FontColor = XLColor.Gray;

        ws.Cell(5, FirstCol).Value = $"{month.ToString("MMMM yyyy", CultureInfo.InvariantCulture)}";
        ws.Range(5, FirstCol, 5, totalCol - 1).Merge();
        Head(ws.Range(5, FirstCol, 5, totalCol - 1), "#4c1d95");
        Head(ws.Range(5, 1, 5, FirstCol - 1), "#3f3f46");
        ws.Cell(5, 1).Value = "KEYS (อย่าแก้)"; ws.Range(5, 1, 5, 2).Merge();
        ws.Cell(5, 3).Value = "PART"; ws.Range(5, 3, 5, FirstCol - 1).Merge();
        ws.Cell(5, totalCol).Value = "TOTAL"; Head(ws.Cell(5, totalCol).AsRange(), "#3f3f46");
        string[] heads = { "ITEM ID", "KEY", "PART NO", "PART NAME", "PACK", "ROW" };
        for (int i = 0; i < heads.Length; i++) ws.Cell(HeadRow, i + 1).Value = heads[i];
        for (int d = 1; d <= days; d++)
        {
            var dow = new DateTime(month.Year, month.Month, d).DayOfWeek;
            ws.Cell(HeadRow, FirstCol + d - 1).Value = $"{d} {dow.ToString()[..3].ToUpperInvariant()}";
        }
        Head(ws.Range(HeadRow, 1, HeadRow, totalCol), "#52525b");
        for (int d = 1; d <= days; d++)
        {
            var dow = new DateTime(month.Year, month.Month, d).DayOfWeek;
            if (dow is DayOfWeek.Saturday or DayOfWeek.Sunday) ws.Cell(HeadRow, FirstCol + d - 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#7f1d1d");
        }

        int r = FirstRow;
        foreach (var it in items)
        {
            int top = r;
            foreach (var (key, label) in DataRows)
            {
                ws.Cell(r, 1).Value = it.ItemId; ws.Cell(r, 2).Value = key;
                ws.Cell(r, 3).Value = it.PartNo; ws.Cell(r, 4).Value = it.PartName;
                if (it.PackSize != null) ws.Cell(r, 5).Value = it.PackSize.Value;
                ws.Cell(r, 6).Value = label;
                it.Cells.TryGetValue(key, out var row);
                for (int d = 1; d <= days; d++)
                    if (row != null && row.TryGetValue(d.ToString(CultureInfo.InvariantCulture), out var q)) ws.Cell(r, FirstCol + d - 1).Value = q;
                ws.Cell(r, totalCol).FormulaA1 = $"SUM({ws.Cell(r, FirstCol).Address}:{ws.Cell(r, totalCol - 1).Address})";
                r++;
            }
            // ST. = DEL / PACK rounded up (computed · not imported)
            int del = r - 1;
            ws.Cell(r, 1).Value = it.ItemId; ws.Cell(r, 2).Value = "ST"; ws.Cell(r, 3).Value = it.PartNo; ws.Cell(r, 4).Value = it.PartName;
            if (it.PackSize != null) ws.Cell(r, 5).Value = it.PackSize.Value;
            ws.Cell(r, 6).Value = "ST.";
            for (int c = FirstCol; c <= totalCol; c++)
                ws.Cell(r, c).FormulaA1 = $"IF(N($E{r})>0,ROUNDUP({ws.Cell(del, c).Address.ToStringRelative()}/$E{r},0),\"-\")";
            ws.Range(r, 1, r, totalCol).Style.Font.Bold = true;
            ws.Range(r, 1, r, totalCol).Style.Font.FontColor = XLColor.FromHtml("#0f766e");
            ws.Range(r, 1, r, totalCol).Style.Fill.BackgroundColor = XLColor.FromHtml("#f0fdfa");
            // weekend shading on data rows
            for (int d = 1; d <= days; d++)
            {
                var dow = new DateTime(month.Year, month.Month, d).DayOfWeek;
                if (dow is DayOfWeek.Saturday or DayOfWeek.Sunday) ws.Range(top, FirstCol + d - 1, r - 1, FirstCol + d - 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#fef2f2");
            }
            ws.Range(top, 1, r, totalCol).Style.Border.TopBorder = XLBorderStyleValues.Medium;
            ws.Range(top, 1, r, 2).Style.Font.FontColor = XLColor.Gray;
            ws.Range(top, 6, r, 6).Style.Font.Bold = true;
            r++;
        }
        int last = Math.Max(r - 1, HeadRow);
        var body = ws.Range(5, 1, last, totalCol);
        body.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; body.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        ws.Range(FirstRow, FirstCol, last, totalCol).Style.NumberFormat.Format = "#,##0.##";
        ws.Column(1).Width = 9; ws.Column(2).Width = 9; ws.Column(3).Width = 16; ws.Column(4).Width = 28; ws.Column(5).Width = 8; ws.Column(6).Width = 12;
        for (int c = FirstCol; c < totalCol; c++) ws.Column(c).Width = 7.5;
        ws.Column(totalCol).Width = 11;
        ws.SheetView.FreezeRows(HeadRow); ws.SheetView.FreezeColumns(FirstCol - 1);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static string Txt(IXLCell c)
    {
        try { var v = c.HasFormula ? c.CachedValue : c.Value; return v.IsBlank ? "" : v.IsText ? v.GetText().Trim() : v.ToString().Trim(); } catch { return ""; }
    }

    // reads the template back: plan + month from the header keys, one Cell per non-blank day cell on a data row (ST. / unknown keys skipped)
    public static Parsed Read(string path)
    {
        using var wb = new XLWorkbook(path);
        var ws = wb.Worksheets.Where(w => w.Visibility == XLWorksheetVisibility.Visible).FirstOrDefault(w => Txt(w.Cell(2, 1)) == "PLAN" && Txt(w.Cell(3, 1)) == "MONTH")
                 ?? throw new InvalidOperationException("ไม่ใช่ไฟล์ Template ของ WORK ORDER FOLLOW (ไม่พบ PLAN / MONTH ที่หัวไฟล์) · ดาวน์โหลด TEMPLATE จากหน้าแผน");
        if (!int.TryParse(Txt(ws.Cell(2, 2)), out int planId)) throw new InvalidOperationException("ไม่พบเลข PLAN ในไฟล์");
        if (!WorkOrderFollowRules.TryMonth(Txt(ws.Cell(3, 2)), out var month)) throw new InvalidOperationException("เดือนในไฟล์ไม่ถูกต้อง (yyyy-MM)");
        int days = DateTime.DaysInMonth(month.Year, month.Month);
        var keys = DataRows.Select(x => x.Key).ToHashSet();
        var cells = new Dictionary<(int, string, int), Cell>();
        var errors = new List<(string, string)>();
        int last = ws.LastRowUsed()?.RowNumber() ?? HeadRow;
        for (int r = FirstRow; r <= last; r++)
        {
            string key = Txt(ws.Cell(r, 2));
            if (!keys.Contains(key) || !int.TryParse(Txt(ws.Cell(r, 1)), out int itemId)) continue;
            for (int d = 1; d <= days; d++)
            {
                var c = ws.Cell(r, FirstCol + d - 1);
                string t = Txt(c);
                if (t.Length == 0) continue;
                if (!decimal.TryParse(t.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var q)) { errors.Add((c.Address.ToString(), $"{key} วันที่ {d}: ไม่ใช่ตัวเลข ({t})")); continue; }
                if (WorkOrderFollowRules.CheckCell(key, d, q, days) is { } msg) { errors.Add((c.Address.ToString(), $"{key} วันที่ {d}: {msg}")); continue; }
                cells[(itemId, key, d)] = new Cell(itemId, key, d, Math.Round(q, 2, MidpointRounding.AwayFromZero), c.Address.ToString()); // same cell twice = bottom wins
            }
        }
        return new Parsed(planId, month, cells.Values.ToList(), errors);
    }

    // normalised near-match key for part search (ignore space - _ . and case)
    public static string NormQ(string s) => Regex.Replace(s ?? "", @"[\s\-_.]+", "");
}
