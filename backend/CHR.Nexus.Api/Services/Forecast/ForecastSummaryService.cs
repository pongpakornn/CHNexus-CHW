using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 📊 FORECAST SUMMARY (Nexus.ForecastSummary · 39_Production_Plan_Pcs_Override_Forecast_Summary.sql)
//   ยอดรวมรายลูกค้า × เดือน ของชีท DIFF (2) (ลูกค้าทั้งหมด) และ DIFF (3) ในไฟล์ FORECAST ของฝ่ายขาย
//   ใช้แสดงกราฟเปรียบเทียบที่ MASTER DATA › Forecast / Order เท่านั้น (ไม่ใช้คำนวณ Capacity / Max-Min · ตัวนั้นใช้ยอดราย PART A)
public sealed class ForecastSummaryService
{
    public static readonly (string Key, string Sheet)[] Sheets = { ("DIFF3", "DIFF (3)"), ("DIFF2", "DIFF (2)") };
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    public sealed record Cell(string Key, string Customer, int Month, decimal F, decimal O, decimal D);
    public sealed record Parsed(int Year, List<Cell> Cells);

    public List<int> Years()
    {
        using var c = Conn();
        return c.Query<int>("SELECT DISTINCT YEAR(MonthStart) FROM Nexus.ForecastSummary ORDER BY 1 DESC").ToList();
    }

    // ยอดรวมรายเดือนของแต่ละชีท + ลูกค้าที่มีเฉพาะ DIFF (2)
    public object Year(int year)
    {
        using var c = Conn();
        var rows = c.Query<(string K, string C, int M, decimal F, decimal O, decimal D, DateTime U)>(@"
            SELECT SheetKey AS K, Customer AS C, MONTH(MonthStart) AS M, Forecast AS F, [Order] AS O, Delivery AS D, UpdatedAt AS U
            FROM Nexus.ForecastSummary WHERE MonthStart >= DATEFROMPARTS(@year, 1, 1) AND MonthStart < DATEFROMPARTS(@year + 1, 1, 1)", new { year }).ToList();
        object Months(string k) => Enumerable.Range(1, 12).Select(i =>
        {
            var x = rows.Where(r => r.K == k && r.M == i).ToList();
            return new { label = new DateTime(2000, i, 1).ToString("MMM", CultureInfo.InvariantCulture), forecast = x.Sum(r => r.F), order = x.Sum(r => r.O), delivery = x.Sum(r => r.D) };
        }).ToList();
        static string N(string s) => Regex.Replace(s ?? "", @"[^A-Z0-9]", "", RegexOptions.IgnoreCase).ToUpperInvariant();
        var in3 = rows.Where(r => r.K == "DIFF3").Select(r => N(r.C)).ToHashSet();
        var extra = rows.Where(r => r.K == "DIFF2" && !in3.Contains(N(r.C))).GroupBy(r => r.C)
                        .Select(g => new { customer = g.Key, forecast = g.Sum(r => r.F), order = g.Sum(r => r.O), delivery = g.Sum(r => r.D) })
                        .Where(x => x.forecast + x.order + x.delivery > 0).OrderByDescending(x => x.order + x.forecast).ToList();
        return new
        {
            year,
            updatedAt = rows.Count == 0 ? (DateTime?)null : rows.Max(r => r.U),
            diff3 = Months("DIFF3"),
            diff2 = Months("DIFF2"),
            customers = new { diff3 = rows.Where(r => r.K == "DIFF3").Select(r => r.C).Distinct().Count(), diff2 = rows.Where(r => r.K == "DIFF2").Select(r => r.C).Distinct().Count() },
            extra
        };
    }

    // อ่านไฟล์ FORECAST: ชีท DIFF (2) / DIFF (3) · หัวตาราง CUSTOMER | Menu | DEC'25 | Jan…Dec · แถว FORECAST / ORDER / DELIVERY ต่อลูกค้า · จบที่แถว Total
    public Parsed Read(string path, int fallbackYear)
    {
        using var wb = new XLWorkbook(path);
        var cells = new List<Cell>();
        int year = 0;
        foreach (var (key, sheet) in Sheets)
        {
            var ws = wb.Worksheets.FirstOrDefault(w => string.Equals(Regex.Replace(w.Name, @"\s+", ""), Regex.Replace(sheet, @"\s+", ""), StringComparison.OrdinalIgnoreCase))
                     ?? throw new InvalidOperationException($"ไม่พบชีท {sheet} ในไฟล์ (ต้องเป็นไฟล์ FORECAST ที่มีชีท DIFF (2) และ DIFF (3))");
            int last = ws.LastRowUsed()?.RowNumber() ?? 0;
            // หาแถวหัวตาราง (มีคำว่า Menu)
            int hr = 0, menu = 0;
            for (int r = 1; r <= Math.Min(12, last) && hr == 0; r++)
                foreach (var c in ws.Row(r).CellsUsed())
                    if (string.Equals(Text(c), "Menu", StringComparison.OrdinalIgnoreCase)) { hr = r; menu = c.Address.ColumnNumber; break; }
            if (hr == 0) throw new InvalidOperationException($"ชีท {sheet}: ไม่พบหัวตาราง (คอลัมน์ Menu)");
            var mcol = new Dictionary<int, int>();   // คอลัมน์ -> เดือน 1..12
            foreach (var c in ws.Row(hr).CellsUsed().Where(c => c.Address.ColumnNumber > menu))
            {
                string t = Text(c);
                var y = Regex.Match(t, @"^DEC\W*(\d{2})$", RegexOptions.IgnoreCase);
                if (y.Success && year == 0) year = 2000 + int.Parse(y.Groups[1].Value) + 1;   // DEC'25 = ธ.ค. ปีก่อน -> ปี 2026
                if (y.Success) continue;
                int mi = Array.FindIndex(CultureInfo.InvariantCulture.DateTimeFormat.AbbreviatedMonthNames, a => a.Length > 0 && t.StartsWith(a, StringComparison.OrdinalIgnoreCase));
                if (mi >= 0 && !mcol.ContainsValue(mi + 1)) mcol[c.Address.ColumnNumber] = mi + 1;
            }
            if (mcol.Count < 12) throw new InvalidOperationException($"ชีท {sheet}: ไม่พบคอลัมน์เดือน Jan - Dec ครบ");
            string cust = null;
            for (int r = hr + 1; r <= last; r++)
            {
                var row = ws.Row(r);
                if (Enumerable.Range(1, menu - 1).Any(i => string.Equals(Text(row.Cell(i)), "Total", StringComparison.OrdinalIgnoreCase))) break;
                string cc = Regex.Replace(Text(row.Cell(menu - 1)), @"\s+", " ").Trim();
                if (cc.Length > 0) cust = cc.Length > 100 ? cc[..100] : cc;
                string kind = Text(row.Cell(menu)).ToUpperInvariant();
                if (cust == null || (kind != "FORECAST" && kind != "ORDER" && kind != "DELIVERY")) continue;
                foreach (var (col, m) in mcol)
                {
                    decimal v = Num(row.Cell(col));
                    cells.Add(new Cell(key, cust, m, kind == "FORECAST" ? v : 0, kind == "ORDER" ? v : 0, kind == "DELIVERY" ? v : 0));
                }
            }
        }
        if (year == 0) year = fallbackYear;
        var merged = cells.GroupBy(x => (x.Key, x.Customer.ToUpperInvariant(), x.Month))
                          .Select(g => new Cell(g.Key.Key, g.First().Customer, g.Key.Month, g.Sum(x => x.F), g.Sum(x => x.O), g.Sum(x => x.D))).ToList();
        if (merged.Count == 0) throw new InvalidOperationException("ไม่พบยอดในชีท DIFF (2) / DIFF (3)");
        return new Parsed(year, merged);
    }

    // แทนที่ยอดทั้งปีของทั้ง 2 ชีท
    public int Save(Parsed p, string uid)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        c.Execute("DELETE FROM Nexus.ForecastSummary WHERE MonthStart >= DATEFROMPARTS(@y, 1, 1) AND MonthStart < DATEFROMPARTS(@y + 1, 1, 1)", new { y = p.Year }, t);
        c.Execute(@"INSERT INTO Nexus.ForecastSummary (SheetKey, Customer, MonthStart, Forecast, [Order], Delivery, UpdatedBy) VALUES (@Key, @Customer, @M, @F, @O, @D, @uid)",
                  p.Cells.Select(x => new { x.Key, x.Customer, M = new DateTime(p.Year, x.Month, 1), x.F, x.O, x.D, uid }), t);
        t.Commit();
        return p.Cells.Count;
    }

    private static string Text(IXLCell c)
    {
        try { var v = c.HasFormula ? c.CachedValue : c.Value; return v.IsText ? v.GetText().Trim() : v.IsBlank ? "" : v.ToString().Trim(); }
        catch { return ""; }
    }
    private static decimal Num(IXLCell c)
    {
        try { var v = c.HasFormula ? c.CachedValue : c.Value; return v.IsNumber ? (decimal)v.GetNumber() : 0; }
        catch { return 0; }
    }
}
