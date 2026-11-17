using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace Nexus.Services;

// WORK ORDER FOLLOW Excel: TEMPLATE (parts x 7 rows x days of one month) + IMPORT reader.
//   Look = "Template Set Max-Min" (navy #002060 title band + header, Aptos, grey key columns, zebra, medium frame, frozen header + key columns)
//   Layout (1-based): row 1 title band · row 2 header · data from row 3
//     A No · B Part No · C Part Name · D Part B · E PACK/BOX · F Row · G.. day 1..N · TOTAL · then 2 HIDDEN key columns: ITEM ID, KEY
//     (hidden row 1 holds PLAN id | yyyy-MM so IMPORT knows the plan + month). Part info is merged over its 7 rows.
//   per part 7 rows: OR, W/O, สั่งผลิต, ผลิตได้ D, ผลิตได้ N, DEL., ST. (formula, never imported). Blank cell on import = untouched.
public static class WorkOrderFollowExcel
{
    public static readonly (string Key, string Label)[] DataRows =
    {
        ("OR", "OR"), ("WO", "W/O"), ("ORDER", "สั่งผลิต"), ("PROD_D", "ผลิตได้ D"), ("PROD_N", "ผลิตได้ N"), ("DEL", "DEL."),
    };
    public const int FirstCol = 7, HeadRow = 2, FirstRow = 3;
    private const string Navy = "#002060", Grey = "#EDEDED", Zebra = "#F7F9FC", Weekend = "#FEE2E2", St = "#E6F4F1";

    public sealed record TplItem(int ItemId, string PartNo, string PartName, string PartB, int? PackSize, Dictionary<string, Dictionary<string, decimal>> Cells);
    public sealed record Cell(int ItemId, string RowKey, int Day, decimal Qty, string At);
    public sealed record Parsed(int PlanId, DateTime Month, List<Cell> Cells, List<(string Cell, string Text)> Errors);

    public static byte[] Template(int planId, string customer, string owner, string workOrderNo, DateTime month, List<TplItem> items)
    {
        int days = DateTime.DaysInMonth(month.Year, month.Month);
        int totalCol = FirstCol + days, k1 = totalCol + 1, k2 = totalCol + 2;
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add($"WOF {month.ToString("MMM yyyy", CultureInfo.InvariantCulture)}");

        // header row
        string[] heads = { "No", "Part No", "Part Name", "Part B", "PACK/BOX", "Row" };
        for (int i = 0; i < heads.Length; i++) ws.Cell(HeadRow, i + 1).Value = heads[i];
        for (int d = 1; d <= days; d++) ws.Cell(HeadRow, FirstCol + d - 1).Value = d;
        ws.Cell(HeadRow, totalCol).Value = "TOTAL";
        ws.Cell(HeadRow, k1).Value = "ITEM ID"; ws.Cell(HeadRow, k2).Value = "KEY";
        var head = ws.Range(HeadRow, 1, HeadRow, totalCol);
        head.Style.Fill.BackgroundColor = XLColor.FromHtml(Navy); head.Style.Font.FontColor = XLColor.White; head.Style.Font.Bold = true;
        head.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; head.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        for (int d = 1; d <= days; d++)
            if (new DateTime(month.Year, month.Month, d).DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) ws.Cell(HeadRow, FirstCol + d - 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#C00000");
        ws.Row(HeadRow).Height = 22;

        int r = FirstRow, no = 0;
        foreach (var it in items)
        {
            int top = r; no++;
            foreach (var (key, label) in DataRows)
            {
                ws.Cell(r, 6).Value = label;
                ws.Cell(r, k1).Value = it.ItemId; ws.Cell(r, k2).Value = key;
                it.Cells.TryGetValue(key, out var row);
                for (int d = 1; d <= days; d++)
                    if (row != null && row.TryGetValue(d.ToString(CultureInfo.InvariantCulture), out var q)) ws.Cell(r, FirstCol + d - 1).Value = q;
                ws.Cell(r, totalCol).FormulaA1 = $"SUM({ws.Cell(r, FirstCol).Address}:{ws.Cell(r, totalCol - 1).Address})";
                r++;
            }
            // ST. = DEL / PACK rounded up (computed · not imported)
            int del = r - 1;
            ws.Cell(r, 6).Value = "ST."; ws.Cell(r, k1).Value = it.ItemId; ws.Cell(r, k2).Value = "ST";
            for (int c = FirstCol; c <= totalCol; c++)
                ws.Cell(r, c).FormulaA1 = $"IF(N($E${top})>0,ROUNDUP({ws.Cell(del, c).Address.ToStringRelative()}/$E${top},0),\"-\")";
            int bot = r;
            // part info merged over its 7 rows
            ws.Cell(top, 1).Value = no; ws.Cell(top, 2).Value = it.PartNo; ws.Cell(top, 3).Value = it.PartName; ws.Cell(top, 4).Value = it.PartB ?? "";
            if (it.PackSize != null) ws.Cell(top, 5).Value = it.PackSize.Value;
            for (int c = 1; c <= 5; c++) ws.Range(top, c, bot, c).Merge();
            var info = ws.Range(top, 1, bot, 5);
            info.Style.Fill.BackgroundColor = XLColor.FromHtml(Grey);
            info.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center; info.Style.Alignment.WrapText = true;
            ws.Range(top, 1, bot, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Range(top, 1, bot, 1).Style.Font.Bold = true;
            ws.Range(top, 4, bot, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Range(top, 5, bot, 5).Style.Font.Bold = true;
            ws.Range(top, 6, bot, 6).Style.Font.Bold = true;
            ws.Range(top, 6, bot, 6).Style.Fill.BackgroundColor = XLColor.FromHtml(Grey);
            // zebra per part, weekend shading on data days, ST. row tinted
            if (no % 2 == 0) ws.Range(top, FirstCol, bot - 1, totalCol).Style.Fill.BackgroundColor = XLColor.FromHtml(Zebra);
            for (int d = 1; d <= days; d++)
                if (new DateTime(month.Year, month.Month, d).DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
                    ws.Range(top, FirstCol + d - 1, bot - 1, FirstCol + d - 1).Style.Fill.BackgroundColor = XLColor.FromHtml(Weekend);
            ws.Range(bot, 6, bot, totalCol).Style.Fill.BackgroundColor = XLColor.FromHtml(St);
            ws.Range(bot, 6, bot, totalCol).Style.Font.Bold = true; ws.Range(bot, 6, bot, totalCol).Style.Font.FontColor = XLColor.FromHtml("#0F766E");
            ws.Range(top, 1, bot, totalCol).Style.Border.TopBorder = XLBorderStyleValues.Medium;
            r++;
        }
        int last = Math.Max(r - 1, HeadRow);

        // title band (like Template Set Max-Min)
        var band = ws.Range(1, 1, 1, totalCol);
        band.Merge();
        band.FirstCell().Value = $"CHR-Nexus - WORK ORDER FOLLOW TEMPLATE • {customer} • OWNER {owner} • {month.ToString("MMMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant()}" + (string.IsNullOrWhiteSpace(workOrderNo) ? "" : $" • W/O {workOrderNo}") + $" • {items.Count:N0} PARTS";
        band.Style.Fill.BackgroundColor = XLColor.FromHtml(Navy); band.Style.Font.FontColor = XLColor.White; band.Style.Font.Bold = true; band.Style.Font.FontSize = 14;
        band.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left; band.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(1).Height = 28;
        ws.Cell(1, k1).Value = planId; ws.Cell(1, k2).Value = month.ToString("yyyy-MM", CultureInfo.InvariantCulture); // hidden: plan + month for IMPORT

        // frame / fonts / widths / freeze
        var body = ws.Range(HeadRow, 1, last, totalCol);
        body.Style.Border.InsideBorder = XLBorderStyleValues.Thin; body.Style.Border.InsideBorderColor = XLColor.FromHtml("#BFBFBF");
        ws.Range(HeadRow, 1, last, totalCol).Style.Border.OutsideBorder = XLBorderStyleValues.Medium;
        ws.Range(HeadRow, 1, HeadRow, totalCol).Style.Border.BottomBorder = XLBorderStyleValues.Medium;
        ws.Range(FirstRow, FirstCol, last, totalCol).Style.NumberFormat.Format = "#,##0.##";
        ws.Range(FirstRow, FirstCol, last, totalCol).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        ws.Range(FirstRow, totalCol, last, totalCol).Style.Font.Bold = true;
        ws.Range(1, 1, last, k2).Style.Font.FontName = "Aptos";
        double[] w = { 6, 18, 32, 16, 10, 11 };
        for (int i = 0; i < w.Length; i++) ws.Column(i + 1).Width = w[i];
        for (int c = FirstCol; c < totalCol; c++) ws.Column(c).Width = 5.2;
        ws.Column(totalCol).Width = 10;
        ws.Column(k1).Hide(); ws.Column(k2).Hide();
        ws.SheetView.Freeze(HeadRow, FirstCol - 1);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static string Txt(IXLCell c)
    {
        try { var v = c.HasFormula ? c.CachedValue : c.Value; return v.IsBlank ? "" : v.IsText ? v.GetText().Trim() : v.ToString().Trim(); } catch { return ""; }
    }

    // reads the template back: plan + month from the hidden header keys, one Cell per non-blank day cell on a data row (ST. / unknown keys skipped)
    public static Parsed Read(string path)
    {
        using var wb = new XLWorkbook(path);
        IXLWorksheet ws = null; int k1 = 0;
        foreach (var w in wb.Worksheets.Where(w => w.Visibility == XLWorksheetVisibility.Visible))
        {
            int lc = w.Row(HeadRow).LastCellUsed()?.Address.ColumnNumber ?? 0;
            for (int c = FirstCol; c < lc; c++)
                if (Txt(w.Cell(HeadRow, c)) == "ITEM ID" && Txt(w.Cell(HeadRow, c + 1)) == "KEY") { ws = w; k1 = c; break; }
            if (ws != null) break;
        }
        if (ws == null) throw new InvalidOperationException("ไม่ใช่ไฟล์ Template ของ WORK ORDER FOLLOW (ไม่พบคอลัมน์ ITEM ID / KEY) · ดาวน์โหลด TEMPLATE จากหน้าแผน");
        int k2 = k1 + 1;
        if (!int.TryParse(Txt(ws.Cell(1, k1)), out int planId)) throw new InvalidOperationException("ไม่พบเลข PLAN ในไฟล์");
        if (!WorkOrderFollowRules.TryMonth(Txt(ws.Cell(1, k2)), out var month)) throw new InvalidOperationException("เดือนในไฟล์ไม่ถูกต้อง (yyyy-MM)");
        int days = DateTime.DaysInMonth(month.Year, month.Month);
        var keys = DataRows.Select(x => x.Key).ToHashSet();
        var cells = new Dictionary<(int, string, int), Cell>();
        var errors = new List<(string, string)>();
        int last = ws.LastRowUsed()?.RowNumber() ?? HeadRow;
        for (int r = FirstRow; r <= last; r++)
        {
            string key = Txt(ws.Cell(r, k2));
            if (!keys.Contains(key) || !int.TryParse(Txt(ws.Cell(r, k1)), out int itemId)) continue;
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
