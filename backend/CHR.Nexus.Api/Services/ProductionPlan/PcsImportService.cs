using System.Globalization;
using ClosedXML.Excel;

namespace Nexus.Services;

// PRODUCTION PLAN > CAPACITY > PCS Excel IMPORT review (template layout + header checks stay as the controller wrote them)
//   Row key = ITEM ID · blank PCS or PCS = AUTO amount = "use AUTO (Order / Forecast)" · same ITEM ID twice = bottom row wins
public sealed class PcsImportService
{
    public sealed record Row(int Line, int ItemId, string Text, decimal? Pcs, string Error);   // Text = the cell as typed; Pcs = parsed (null = blank)
    public sealed record State(string Dept, DateTime Month, List<Row> Rows);
    public sealed record Change(int ItemId, string Label, decimal? Pcs);
    public sealed record Ev(ImportRowDto Row, Change Op);

    public static string Num(decimal v) => v.ToString("0.####", CultureInfo.InvariantCulture);

    // what the sheet says -> what would be stored. target null = use AUTO. old / new are the display values (AUTO or the PCS)
    public static (string Old, string New, decimal? Target) Classify(bool manual, decimal pcsNow, decimal auto, decimal? v)
    {
        decimal? target = v == null || v.Value == auto ? null : v;   // blank / equal to AUTO = use AUTO
        return (manual ? Num(pcsNow) : "AUTO", target == null ? "AUTO" : Num(target.Value), target);
    }

    // user-typed PCS: blank or AUTO = null, else number 0 .. 99,999,999
    public static decimal? ParsePcs(string s)
    {
        string t = (s ?? "").Replace(",", "").Trim();
        if (t.Length == 0 || t.Equals("AUTO", StringComparison.OrdinalIgnoreCase)) return null;
        if (!decimal.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var v)) throw new InvalidOperationException($"PCS ไม่ใช่ตัวเลข ({s})");
        if (v < 0 || v > 99_999_999) throw new InvalidOperationException("PCS ต้องอยู่ระหว่าง 0 - 99,999,999");
        return v;
    }

    // header cells are checked (whole-file errors throw) · each data row keeps its own error so the user sees all of them at once
    public static State Parse(IXLWorksheet ws)
    {
        string d = ws.Cell(2, 2).GetString().Trim().ToUpperInvariant();
        string ms = ws.Cell(2, 4).GetString().Trim();
        if (d.Length == 0 || !DateTime.TryParseExact(ms + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
            throw new InvalidOperationException("ไม่ใช่ไฟล์ Template PCS (ไม่พบ DEPT / MONTH ที่แถว 2) · ดาวน์โหลด TEMPLATE จากหน้า Capacity");
        if (!ws.Cell(4, 1).GetString().Trim().Equals("ITEM ID", StringComparison.OrdinalIgnoreCase) || !ws.Cell(4, 12).GetString().Contains("PCS"))
            throw new InvalidOperationException("ไม่ใช่ไฟล์ Template PCS (หัวตารางแถว 4 ไม่ตรง)");
        var rows = new List<Row>();
        int last = ws.LastRowUsed()?.RowNumber() ?? 4;
        for (int r = 5; r <= last; r++)
        {
            var idc = ws.Cell(r, 1);
            if (idc.IsEmpty() || !int.TryParse(idc.GetString().Trim(), out int id)) continue;
            var pc = ws.Cell(r, 12);
            decimal? v = null;
            string text = "", err = null;
            if (!pc.IsEmpty())
            {
                var cv = pc.HasFormula ? pc.CachedValue : pc.Value;
                text = cv.IsNumber ? Num((decimal)cv.GetNumber()) : pc.GetString().Trim();
                try { v = ParsePcs(text); } catch (InvalidOperationException e) { err = e.Message; }
            }
            rows.Add(new Row(r, id, text, v, err));
        }
        if (rows.Count == 0) throw new InvalidOperationException("ไม่พบแถวที่มี ITEM ID ในไฟล์");
        return new State(d, m, rows);
    }

    // preview rows and the writes, from the CURRENT data (apply calls this again with req = edits / exclude)
    public static List<Ev> Eval(State st, Dictionary<int, (PpMachine Machine, PpPart Part)> cur, ImportApplyRequest req)
    {
        var skip = (req?.Exclude ?? new()).ToHashSet();
        var lastLine = st.Rows.GroupBy(x => x.ItemId).ToDictionary(g => g.Key, g => g.Max(x => x.Line));
        var evs = new List<Ev>();
        foreach (var r in st.Rows)
        {
            string key = r.ItemId.ToString(CultureInfo.InvariantCulture);
            string sub = $"{st.Dept} · {st.Month:MMM yyyy} · แถว {r.Line}";
            if (r.Line != lastLine[r.ItemId]) { evs.Add(new(new(key + "#" + r.Line, ImportReview.Duplicate, $"ITEM ID {key}", sub, new(), "ITEM ID ซ้ำในไฟล์ · ใช้แถวล่างสุด แถวนี้ถูกข้าม", null), null)); continue; }
            if (!cur.TryGetValue(r.ItemId, out var x))
            { evs.Add(new(new(key, ImportReview.Invalid, $"ITEM ID {key}", sub, new(), "ITEM ID นี้ไม่มีในหน่วยงาน / เดือนนี้แล้ว (ถูกลบหรือไม่ได้ใช้งาน)", null), null)); continue; }
            var p = x.Part;
            string label = $"{x.Machine.Code} | {p.PartA}";
            decimal? v = r.Pcs;
            try
            {
                if (r.Error != null) throw new InvalidOperationException(r.Error);
                if (req?.Edits != null && req.Edits.TryGetValue(key, out var ed) && ed != null && ed.TryGetValue("PCS", out var typed)) v = ParsePcs(typed);
            }
            catch (InvalidOperationException e)
            {
                evs.Add(new(new(key, ImportReview.Invalid, label, sub, new() { new("PCS", null, r.Text, true) }, $"L{r.Line}: {e.Message}", null), null));
                continue;
            }
            bool manual = p.PcsFrom == "MANUAL";
            decimal auto = manual ? p.PcsAuto ?? 0 : p.Pcs;
            var (o, n, target) = Classify(manual, p.Pcs, auto, v);
            string status = ImportReview.Status(o, n);
            evs.Add(new(new(key, status, label, sub, new() { new("PCS", o, n, true) }, $"AUTO (Order / Forecast) = {Num(auto)}", null),
                        status == ImportReview.Changed && !skip.Contains(key) ? new Change(r.ItemId, label, target) : null));
        }
        return evs;
    }
}
