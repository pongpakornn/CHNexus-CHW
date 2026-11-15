using System.Globalization;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Models;

namespace Nexus.Services;

// FORECAST / ORDER > Excel IMPORT review (preview rows + apply plan). The file parser stays MaxMinCalcService.ReadForecastExcel.
//   Row key = "PARTA|yyyy-MM" · "ROWn" (invalid) · same PART A + month on several lines = SUMMED into one row (as the import always did)
public sealed class ForecastImportService
{
    public sealed record State(string Title, List<CalcImportRow> Rows, bool WithCalc, string MonthText, string Last);
    public sealed record Fc(decimal F, decimal O, decimal D);
    public enum Kind { Ready, Similar, Invalid }
    public sealed record Item(CalcImportRow Row, string Key, Kind Kind, int Count = 1);   // Count = file rows summed into this item

    private sealed class PartRef { public string PartA { get; set; } public string Customer { get; set; } }

    public static string Num(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture);
    private static string OldKey(string cust, string part, DateTime m) => $"{(cust ?? "").Trim().ToUpperInvariant()}|{(part ?? "").Trim().ToUpperInvariant()}|{m:yyyy-MM}";

    // NEW / CHANGED / SAME for one part x month (old == null -> not in system yet)
    public static string Classify(Fc old, Fc @new) => old == null ? ImportReview.New : old == @new ? ImportReview.Same : ImportReview.Changed;

    // sort every parsed row into a kind + key. Unknown PART A (with PART A + month) is a SIMILAR candidate; same key twice -> bottom row wins
    public static List<Item> Index(List<CalcImportRow> rows)
    {
        var items = new List<Item>();
        foreach (var r in rows)
        {
            bool keyed = !string.IsNullOrWhiteSpace(r.PartA) && r.Month != default;
            string key = keyed ? $"{r.PartA.Trim().ToUpperInvariant()}|{r.Month:yyyy-MM}" : $"ROW{r.RowNumber}";
            bool unknown = r.Error != null && r.Error.StartsWith(MaxMinCalcService.PartANotFound, StringComparison.Ordinal);
            items.Add(new(r, key, r.IsValid ? Kind.Ready : keyed && unknown ? Kind.Similar : Kind.Invalid));
        }
        // same key on several lines: one item, F / O / D summed, shown at the first line
        var res = new List<Item>();
        foreach (var g in items.GroupBy(i => i.Kind == Kind.Invalid ? i.Key + "#" + i.Row.RowNumber : i.Key))
        {
            var first = g.First();
            if (g.Count() == 1) { res.Add(first); continue; }
            var r = first.Row;
            var sum = new CalcImportRow { RowNumber = r.RowNumber, Customer = r.Customer, PartA = r.PartA, Part = r.Part, PartName = r.PartName, Month = r.Month, Error = r.Error, Note = r.Note,
                                          Forecast = g.Sum(x => x.Row.Forecast), Order = g.Sum(x => x.Row.Order), Delivery = g.Sum(x => x.Row.Delivery), Workdays = g.Select(x => x.Row.Workdays).FirstOrDefault(w => w.HasValue) };
            res.Add(first with { Row = sum, Count = g.Count() });
        }
        return res.OrderBy(i => i.Row.RowNumber).ToList();
    }

    // rows the user can see; old = "CUSTOMER|PARTA|yyyy-MM" -> current system value · similar = file PART A (upper) -> near matches
    public static List<ImportRowDto> BuildRows(List<Item> items, Dictionary<string, Fc> old, Dictionary<string, List<ImportSuggest>> similar)
    {
        var list = new List<ImportRowDto>();
        foreach (var i in items)
        {
            var r = i.Row;
            string label = string.IsNullOrWhiteSpace(r.PartA) ? $"แถว {r.RowNumber}" : r.PartA.Trim();
            string sub = (r.Month != default ? r.Month.ToString("MMM yyyy", CultureInfo.InvariantCulture) + " · " : "") + $"แถว {r.RowNumber}";
            var f = new List<ImportField>();
            switch (i.Kind)
            {
                case Kind.Invalid: list.Add(new(i.Key, ImportReview.Invalid, label, sub, f, r.Error, null)); continue;
                case Kind.Similar:
                    f.Add(new("F", null, Num(r.Forecast), true)); f.Add(new("O", null, Num(r.Order), true)); f.Add(new("D", null, Num(r.Delivery), true));
                    var sg = similar.TryGetValue(r.PartA.Trim().ToUpperInvariant(), out var s) ? s : null;
                    list.Add(sg is { Count: > 0 }
                        ? new(i.Key, ImportReview.Similar, label, sub, f, "ไม่พบ PART A นี้ แต่คล้ายของเดิม · เลือกผูกกับ PART A เดิม หรือไม่ใช้แถวนี้", sg)
                        : new(i.Key, ImportReview.Invalid, label, sub, f, r.Error, null));
                    continue;
            }
            old.TryGetValue(OldKey(r.Customer, r.Part, r.Month), out var was);
            var now = new Fc(r.Forecast, r.Order, r.Delivery);
            f.Add(new("F", was == null ? null : Num(was.F), Num(now.F), true));
            f.Add(new("O", was == null ? null : Num(was.O), Num(now.O), true));
            f.Add(new("D", was == null ? null : Num(was.D), Num(now.D), true));
            string sd = $"{sub} · {r.Customer}";
            list.Add(new(i.Key, Classify(was, now), label, sd, f, string.Join(" · ", new[] { i.Count > 1 ? $"รวม {i.Count} แถวในไฟล์" : null, r.Note }.Where(x => x != null)).NullIfEmpty(), null));
        }
        return list;
    }

    // errors card: every INVALID row (and unknown PART A without a near match)
    public static List<ImportErrorDto> Errors(List<ImportRowDto> rows, List<Item> items) =>
        rows.Where(x => x.Status == ImportReview.Invalid).Select(x => new ImportErrorDto("แถว " + items.First(i => i.Key == x.Key).Row.RowNumber, x.Note)).ToList();

    // ---------------------------------------------------------------- preview (reads DB, writes nothing)
    public ImportPreviewDto Preview(string id, string file, List<Item> items)
    {
        var ready = items.Where(i => i.Kind == Kind.Ready).Select(i => i.Row).ToList();
        var old = new Dictionary<string, Fc>();
        foreach (var d in new MaxMinCalcService().ForecastDetail(ready).Where(d => d.OldF != null))
            old[OldKey(d.Customer, d.PartA, d.Month)] = new Fc(d.OldF.Value, d.OldO ?? 0, d.OldD ?? 0);
        var rows = BuildRows(items, old, SimilarParts(items));
        return new ImportPreviewDto(id, file, "FORECAST / ORDER", rows, Errors(rows, items));
    }

    // near match = same PART A ignoring case / space / - _ .
    private static Dictionary<string, List<ImportSuggest>> SimilarParts(List<Item> items)
    {
        var res = new Dictionary<string, List<ImportSuggest>>();
        var want = items.Where(i => i.Kind == Kind.Similar).Select(i => i.Row.PartA.Trim().ToUpperInvariant()).Distinct().ToList();
        if (want.Count == 0) return res;
        List<PartRef> parts;
        using (var c = new SqlConnection(GlobalConfig.ConnStr))
            parts = c.Query<PartRef>("SELECT DISTINCT LTRIM(RTRIM(PartA)) AS PartA, LTRIM(RTRIM(ISNULL(Customer, ''))) AS Customer FROM Nexus.Parts WHERE ISNULL(LTRIM(RTRIM(PartA)), '') <> ''").ToList();
        foreach (var w in want)
        {
            string k = ImportReview.NormKey(w);
            res[w] = parts.Where(p => ImportReview.NormKey(p.PartA) == k).Take(5)
                          .Select(p => new ImportSuggest(p.PartA, p.Customer.Length > 0 ? $"{p.PartA} · {p.Customer}" : p.PartA)).ToList();
        }
        return res;
    }

    // ---------------------------------------------------------------- apply: rows to write (pure; re-validates edits). Mapped = SIMILAR rows the user bound to an existing PART A (caller re-matches them)
    public static (List<CalcImportRow> Rows, List<CalcImportRow> Mapped, int Skipped) MakeRows(State st, ImportApplyRequest req)
    {
        var skip = (req.Exclude ?? new()).ToHashSet();
        var rows = new List<CalcImportRow>();
        var mapped = new List<CalcImportRow>();
        int skipped = 0;
        foreach (var i in Index(st.Rows))
        {
            string mc = null;
            bool bound = i.Kind == Kind.Similar && req.Map != null && req.Map.TryGetValue(i.Key, out mc) && !string.IsNullOrWhiteSpace(mc);
            if (i.Kind == Kind.Invalid || (i.Kind == Kind.Similar && !bound) || skip.Contains(i.Key)) { skipped++; continue; }
            var r = i.Row;
            var c = new CalcImportRow { RowNumber = r.RowNumber, Customer = r.Customer, PartA = r.PartA, Part = r.Part, PartName = r.PartName, Month = r.Month, Forecast = r.Forecast, Order = r.Order, Delivery = r.Delivery, Workdays = r.Workdays, Note = r.Note };
            if (bound) { c.PartA = c.Part = mc.Trim(); c.Customer = ""; mapped.Add(c); }
            if (req.Edits != null && req.Edits.TryGetValue(i.Key, out var ed) && ed != null)
            {
                if (ed.TryGetValue("F", out var f)) c.Forecast = Parse(f, "F", i.Key);
                if (ed.TryGetValue("O", out var o)) c.Order = Parse(o, "O", i.Key);
                if (ed.TryGetValue("D", out var d)) c.Delivery = Parse(d, "D", i.Key);
            }
            rows.Add(c);
        }
        var clash = rows.GroupBy(x => $"{x.Part.Trim().ToUpperInvariant()}|{x.Month:yyyy-MM}").FirstOrDefault(g => g.Count() > 1);
        if (clash != null) throw new InvalidOperationException($"PART A {clash.First().Part} เดือน {clash.First().Month:yyyy-MM} ซ้ำกัน {clash.Count()} แถว (ผูกกับ PART A เดิมซ้ำ) · ให้เลือกไม่ใช้แถวใดแถวหนึ่ง");
        return (rows, mapped, skipped);
    }

    // blank = 0 · not negative · plain number
    private static decimal Parse(string s, string field, string key)
    {
        if (string.IsNullOrWhiteSpace(s)) return 0;
        if (!decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) || v < 0 || v > 999_999_999_999m)
            throw new InvalidOperationException($"{key}: ค่า {field} ไม่ถูกต้อง (ต้องเป็นตัวเลขไม่ติดลบ)");
        return v;
    }
}

static class StrExt { public static string NullIfEmpty(this string s) => string.IsNullOrEmpty(s) ? null : s; }
