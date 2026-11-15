using System.Globalization;
using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// PRODUCTION PLAN > MASTER DATA > Machine STD (+ Plan SPH settings) and Machine Products: Excel TEMPLATE / IMPORT review / APPLY
//   Rules: blank cell = keep · new key = add (ACTIVE) · same key twice = bottom row wins · never delete · no key is changed
//   Machine key = DEPT + MACHINE CODE · SETTINGS key = C5..C9 / P8 / P9 · Product key = DEPT + MACHINE CODE + PART A + PART B + PROCESS
//   Field rules = ProductionPlanService.ValidateMachine / ValidatePart / ValidateShift / ValidateSettings (same as the screens)
public sealed class PpSetupImportService
{
    // mirror of frontend lib/pp.ts DEPTS
    public static readonly string[] Depts = { "PRESS1", "PRESS2", "ASSEMBLY", "PIPEPART", "PIPEASSY", "PAINTPART", "QC" };

    public static readonly string[] MachineHeads = { "DEPT", "MACHINE CODE", "GROUP", "SUB GROUP", "SORT", "Q'TY LINE", "TARGET EFF (%)", "STD MAN", "SPH 100%", "STROKE", "FROM MONTH", "TO MONTH", "STATUS" };
    public static readonly string[] SettingHeads = { "CODE", "NAME", "VALUE" };
    public static readonly string[] ProductHeads = { "DEPT", "MACHINE CODE", "PART A", "PART B", "PROCESS", "TOTAL PROCESS", "PCS / STROKE", "MC CT", "STD MAN", "STATUS" };

    // parsed file row: V = header -> trimmed text (blank cells left out)
    public sealed record Raw(int Row, Dictionary<string, string> V, string Error);
    public sealed record State(string Kind, string Title, List<Raw> Rows, List<Raw> Settings);
    // Op = what apply writes: MachineForm / PartForm / PpShift / KeyValuePair<string, decimal> (null = nothing to write)
    public sealed record Ev(ImportRowDto Row, object Op);

    public static string N(decimal v) => v.ToString("0.####", CultureInfo.InvariantCulture);
    private static string YM(DateTime? d) => d?.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    // ================================================================ PARSE
    private static string CellText(IXLCell c)
    {
        try
        {
            var v = c.HasFormula ? c.CachedValue : c.Value;
            if (v.IsNumber) return N((decimal)v.GetNumber());
            if (v.IsDateTime) return v.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            return v.IsBlank ? "" : v.ToString().Trim();
        }
        catch { return ""; }
    }

    public const int MaxRows = 20_000;

    // header row = first row (1..10) holding every required header · rows with no value (or only the ignoreAlone columns, e.g. prefilled DEPT) are skipped
    public static List<Raw> ReadRows(IXLWorksheet ws, string[] heads, string[] required, string label, params string[] ignoreAlone)
    {
        int hr = 0;
        var col = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int lastHead = Math.Min(10, ws.LastRowUsed()?.RowNumber() ?? 0);
        for (int r = 1; r <= lastHead && hr == 0; r++)
        {
            var m = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var c in ws.Row(r).CellsUsed())
            {
                string t = c.GetString().Trim();
                if (heads.Contains(t, StringComparer.OrdinalIgnoreCase) && !m.ContainsKey(t)) m[t] = c.Address.ColumnNumber;
            }
            if (required.All(m.ContainsKey)) { hr = r; col = m; }
        }
        if (hr == 0) throw new InvalidOperationException($"ไม่ใช่ไฟล์ Template {label} (ไม่พบหัวคอลัมน์ {string.Join(" / ", required)}) · ดาวน์โหลด TEMPLATE จากหน้านี้");
        var list = new List<Raw>();
        int last = ws.LastRowUsed()?.RowNumber() ?? hr;
        if (last - hr > MaxRows) throw new InvalidOperationException($"ไฟล์มีมากเกิน {MaxRows:N0} แถว ({label}) · แบ่งไฟล์แล้วนำเข้าทีละส่วน");
        for (int r = hr + 1; r <= last; r++)
        {
            var v = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (h, c) in col) { string t = CellText(ws.Cell(r, c)); if (t.Length > 0) v[h.ToUpperInvariant()] = t; }
            if (v.Keys.All(k => ignoreAlone.Contains(k, StringComparer.OrdinalIgnoreCase))) continue;
            list.Add(new Raw(r, v, null));
        }
        return list;
    }

    public static State Parse(string kind, XLWorkbook wb)
    {
        if (kind == "machines")
        {
            var ws = wb.Worksheets.FirstOrDefault(w => w.Name.Equals("MACHINES", StringComparison.OrdinalIgnoreCase)) ?? wb.Worksheets.First();
            var rows = ReadRows(ws, MachineHeads, new[] { "DEPT", "MACHINE CODE" }, "MACHINE STD", "DEPT");
            var sw = wb.Worksheets.FirstOrDefault(w => w.Name.Equals("SETTINGS", StringComparison.OrdinalIgnoreCase));
            var settings = sw == null ? new List<Raw>() : ReadRows(sw, SettingHeads, new[] { "CODE" }, "SETTINGS", "CODE");
            if (rows.Count == 0 && settings.Count == 0) throw new InvalidOperationException("ไม่พบแถวข้อมูลในไฟล์");
            return new State(kind, "MACHINE STD", rows, settings);
        }
        var wp = wb.Worksheets.FirstOrDefault(w => w.Name.Equals("PRODUCTS", StringComparison.OrdinalIgnoreCase)) ?? wb.Worksheets.First();
        var prods = ReadRows(wp, ProductHeads, new[] { "DEPT", "MACHINE CODE", "PART A" }, "MACHINE PRODUCTS", "DEPT", "MACHINE CODE");
        if (prods.Count == 0) throw new InvalidOperationException("ไม่พบแถวข้อมูลในไฟล์");
        return new State(kind, "MACHINE PRODUCTS", prods, new());
    }

    // ================================================================ shared helpers
    private static string S(Dictionary<string, string> v, string k) => v.TryGetValue(k, out var x) && x.Length > 0 ? x : null;

    private static decimal Dec(string k, string s)
    {
        if (!decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var d)) throw new InvalidOperationException($"{k} ไม่ใช่ตัวเลข ({s})");
        return d;
    }

    // the file row with the user's edits on top (blank edit = keep the file value) · only data columns can be edited, never the key
    private static Dictionary<string, string> WithEdits(Dictionary<string, string> v, string key, ImportApplyRequest req, string[] editable)
    {
        var res = new Dictionary<string, string>(v, StringComparer.OrdinalIgnoreCase);
        if (req?.Edits != null && req.Edits.TryGetValue(key, out var ed) && ed != null)
            foreach (var (f, val) in ed)
            {
                string name = editable.FirstOrDefault(h => h.Equals(f, StringComparison.OrdinalIgnoreCase));
                if (name != null && !string.IsNullOrWhiteSpace(val)) res[name] = val.Trim();
            }
        return res;
    }

    // same key twice -> bottom row wins; keys are decided before the loop so preview and apply agree
    private static Dictionary<int, bool> Superseded(IEnumerable<(int Row, string Key)> keyed)
    {
        var list = keyed.ToList();
        var last = list.GroupBy(x => x.Key).ToDictionary(g => g.Key, g => g.Max(x => x.Row));
        return list.ToDictionary(x => x.Row, x => x.Row != last[x.Key]);
    }

    private static ImportRowDto Bad(string key, string label, string sub, string note, List<ImportField> f = null) => new(key, ImportReview.Invalid, label, sub, f ?? new(), note, null);
    private static ImportRowDto Dup(string key, string label, string sub) => new(key + "#", ImportReview.Duplicate, label, sub, new(), "KEY ซ้ำในไฟล์ · ใช้แถวล่างสุด แถวนี้ถูกข้าม", null);

    private static List<ImportField> Diff(List<(string N, string V)> old, List<(string N, string V)> now) =>
        now.Select((x, i) => new ImportField(x.N, old?[i].V, x.V, true)).ToList();

    private static string Status(List<(string N, string V)> old, List<(string N, string V)> now) =>
        ImportReview.Status(old == null ? null : string.Join("\u0001", old.Select(x => x.V)), string.Join("\u0001", now.Select(x => x.V)));

    private static string MonthText(string field, string s)
    {
        string[] fmts = { "yyyy-MM", "yyyy-MM-dd", "MM/yyyy", "M/yyyy", "dd/MM/yyyy", "d/M/yyyy" };
        if (DateTime.TryParseExact(s.Trim(), fmts, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        throw new InvalidOperationException($"{field} ไม่ถูกต้อง ({s}) · ใช้รูปแบบ 2026-01");
    }

    private static bool Flag(string field, string s, string[] yes, string[] no)
    {
        string u = s.Trim().ToUpperInvariant();
        if (yes.Contains(u)) return true;
        if (no.Contains(u)) return false;
        throw new InvalidOperationException($"{field} ไม่ถูกต้อง ({s})");
    }

    // ================================================================ MACHINES
    public static ProductionPlanService.MachineForm ToForm(PpMachine m) =>
        new(m.Id, m.Dept, m.Code, m.Group, m.SubGroup, m.Sort, m.Qty, m.Eff, m.Man, m.Sph, m.ByPcs, m.Active, YM(m.FromMonth), YM(m.ToMonth));

    public static List<(string N, string V)> MDisp(ProductionPlanService.MachineForm f) => new()
    {
        ("GROUP", (f.Group ?? "").Trim().ToUpperInvariant()), ("SUB GROUP", f.SubGroup ?? ""), ("SORT", f.Sort.ToString(CultureInfo.InvariantCulture)), ("Q'TY LINE", N(f.Qty)),
        ("TARGET EFF (%)", N(f.Eff * 100)), ("STD MAN", N(f.Man)), ("SPH 100%", f.Sph == null ? "AUTO" : N(f.Sph.Value)),
        ("STROKE", f.ByPcs ? "PCS" : "PCS x PROCESS"), ("FROM MONTH", f.From ?? ""), ("TO MONTH", f.To ?? ""), ("STATUS", f.Active ? "ACTIVE" : "INACTIVE"),
    };

    // file values on top of the existing machine (null = new machine: required numbers must be given) · throws InvalidOperationException with the reason
    public static ProductionPlanService.MachineForm BuildMachine(PpMachine ex, string dept, string code, Dictionary<string, string> v, int nextSort)
    {
        bool isNew = ex == null;
        decimal Num(string k, decimal def)
        {
            var s = S(v, k);
            if (s == null) return isNew ? throw new InvalidOperationException($"{k} ต้องกรอกสำหรับเครื่องใหม่") : def;
            return Dec(k, s);
        }
        string grp = S(v, "GROUP")?.ToUpperInvariant() ?? ex?.Group;
        if (isNew && grp == null) throw new InvalidOperationException("GROUP ต้องกรอกสำหรับเครื่องใหม่");
        string sub = S(v, "SUB GROUP") ?? ex?.SubGroup;
        if (code.Length > 50 || (grp?.Length ?? 0) > 30 || (sub?.Length ?? 0) > 30) throw new InvalidOperationException("MACHINE CODE ยาวไม่เกิน 50 · GROUP / SUB GROUP ไม่เกิน 30 ตัวอักษร");
        int sort = ex?.Sort ?? nextSort;
        if (S(v, "SORT") is { } ss) { decimal d = Dec("SORT", ss); if (d < 0 || d != Math.Floor(d) || d > 100000) throw new InvalidOperationException("SORT ต้องเป็นจำนวนเต็มไม่ติดลบ"); sort = (int)d; }
        decimal qty = Num("Q'TY LINE", ex?.Qty ?? 0), eff = Num("TARGET EFF (%)", (ex?.Eff ?? 0) * 100) / 100, man = Num("STD MAN", ex?.Man ?? 0);
        decimal? sph = ex?.Sph;
        if (S(v, "SPH 100%") is { } sp) sph = sp.Equals("AUTO", StringComparison.OrdinalIgnoreCase) ? null : Dec("SPH 100%", sp);
        bool byPcs = S(v, "STROKE") is { } st ? Flag("STROKE", st, new[] { "PCS", "= PCS", "TRANSFER", "TRUE", "1", "YES" }, new[] { "PCS X PROCESS", "PCS × PROCESS", "= PCS X PROCESS", "= PCS × PROCESS", "PROCESS", "FALSE", "0", "NO" }) : ex?.ByPcs ?? false;
        string from = S(v, "FROM MONTH") is { } fm ? MonthText("FROM MONTH", fm) : YM(ex?.FromMonth);
        string to = S(v, "TO MONTH") is { } tm ? MonthText("TO MONTH", tm) : YM(ex?.ToMonth);
        // a new machine is always ACTIVE (like the screen); STATUS only changes existing machines
        bool active = isNew || (S(v, "STATUS") is { } sa ? Flag("STATUS", sa, new[] { "ACTIVE", "1", "YES", "TRUE" }, new[] { "INACTIVE", "0", "NO", "FALSE" }) : ex.Active);
        var f = new ProductionPlanService.MachineForm(ex?.Id ?? 0, dept, ex?.Code ?? code, grp, sub, sort, qty, eff, man, sph, byPcs, active, from, to);
        ProductionPlanService.ValidateMachine(f);
        return f;
    }

    private static string MKey(string dept, string code) => $"M|{dept}|{code.ToUpperInvariant()}";

    public static List<Ev> EvalMachines(List<Raw> raws, List<PpMachine> machines, ImportApplyRequest req)
    {
        var skip = (req?.Exclude ?? new()).ToHashSet();
        var evs = new List<Ev>();
        string[] editable = MachineHeads.Skip(2).ToArray();
        string DeptOf(Raw r) => (S(r.V, "DEPT") ?? "").ToUpperInvariant();
        var keyed = raws.Where(r => r.Error == null && Depts.Contains(DeptOf(r)) && S(r.V, "MACHINE CODE") != null).Select(r => (r.Row, MKey(DeptOf(r), S(r.V, "MACHINE CODE"))));
        var sup = Superseded(keyed);
        var nextSort = machines.GroupBy(m => m.Dept.ToUpperInvariant()).ToDictionary(g => g.Key, g => g.Max(m => m.Sort) + 1);
        foreach (var r in raws)
        {
            string dept = DeptOf(r), code = S(r.V, "MACHINE CODE");
            string sub = $"แถว {r.Row}";
            if (r.Error != null) { evs.Add(new(Bad($"ROW{r.Row}", code ?? $"แถว {r.Row}", sub, r.Error), null)); continue; }
            if (!Depts.Contains(dept)) { evs.Add(new(Bad($"ROW{r.Row}", code ?? $"แถว {r.Row}", sub, $"DEPT ไม่ถูกต้อง ({(dept.Length == 0 ? "ว่าง" : dept)}) · ใช้ {string.Join(" / ", Depts)}"), null)); continue; }
            if (code == null) { evs.Add(new(Bad($"ROW{r.Row}", $"แถว {r.Row}", $"{dept} · {sub}", "ไม่มี MACHINE CODE"), null)); continue; }
            string key = MKey(dept, code), label = code;
            sub = $"{dept} · {sub}";
            if (sup[r.Row]) { evs.Add(new(Dup(key + "#" + r.Row, label, sub) with { Key = key + "#" + r.Row }, null)); continue; }
            var inDept = machines.Where(m => m.Dept.Equals(dept, StringComparison.OrdinalIgnoreCase)).ToList();
            var ex = inDept.FirstOrDefault(m => m.Code.Equals(code, StringComparison.OrdinalIgnoreCase));
            var v = WithEdits(r.V, key, req, editable);
            if (ex == null)
            {
                string mapped = req?.Map != null && req.Map.TryGetValue(key, out var mc) && !string.IsNullOrWhiteSpace(mc) ? mc.Trim() : null;
                if (mapped != null)
                {
                    ex = inDept.FirstOrDefault(m => m.Code.Equals(mapped, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException($"ไม่พบเครื่อง \"{mapped}\" ที่เลือกผูก ({dept})");
                }
                else
                {
                    string nk = ImportReview.NormKey(code);
                    var near = inDept.Where(m => ImportReview.NormKey(m.Code) == nk).Take(5).Select(m => new ImportSuggest(m.Code, $"{m.Code} · {m.Group}")).ToList();
                    if (near.Count > 0)
                    {
                        var nf = editable.Where(h => S(v, h) != null).Select(h => new ImportField(h, null, S(v, h), true)).ToList();
                        evs.Add(new(new(key, ImportReview.Similar, label, sub, nf, "ไม่พบ MACHINE CODE นี้ แต่คล้ายของเดิม · เลือกผูกกับเครื่องเดิม หรือไม่ใช้แถวนี้ (เครื่องใหม่ให้แก้ CODE ในไฟล์ให้ต่างจากเดิม)", near), null));
                        continue;
                    }
                }
            }
            try
            {
                var f = BuildMachine(ex, dept, code, v, nextSort.GetValueOrDefault(dept, 1));
                var now = MDisp(f);
                var old = ex == null ? null : MDisp(ToForm(ex));
                string status = Status(old, now);
                if (ex == null) nextSort[dept] = nextSort.GetValueOrDefault(dept, 1) + 1;
                evs.Add(new(new(key, status, label, sub, Diff(old, now), ex != null && !ex.Code.Equals(code, StringComparison.Ordinal) && WasMapped(req, key) ? $"ผูกกับเครื่อง {ex.Code}" : null, null),
                            skip.Contains(key) || status == ImportReview.Same ? null : f));
            }
            catch (InvalidOperationException e)
            {
                var nf = editable.Where(h => S(v, h) != null).Select(h => new ImportField(h, null, S(v, h), true)).ToList();
                evs.Add(new(Bad(key, label, sub, e.Message, nf), null));
            }
        }
        return evs;
    }
    private static bool WasMapped(ImportApplyRequest req, string key) => req?.Map != null && req.Map.ContainsKey(key);

    // ---------------------------------------------------------------- SETTINGS (Plan SPH C5..C9 + P8 / P9)
    public static List<Ev> EvalSettings(List<Raw> raws, List<PpShift> shifts, Dictionary<string, decimal> settings, ImportApplyRequest req)
    {
        var skip = (req?.Exclude ?? new()).ToHashSet();
        var evs = new List<Ev>();
        string[] editable = { "NAME", "HOURS", "VALUE" };
        var sup = Superseded(raws.Where(r => S(r.V, "CODE") != null).Select(r => (r.Row, "S|" + S(r.V, "CODE").ToUpperInvariant())));
        foreach (var r in raws)
        {
            string code = (S(r.V, "CODE") ?? "").ToUpperInvariant(), key = "S|" + code, sub = $"SETTINGS · แถว {r.Row}";
            if (code.Length == 0) { evs.Add(new(Bad($"SROW{r.Row}", $"แถว {r.Row}", sub, "ไม่มี CODE"), null)); continue; }
            if (sup[r.Row]) { evs.Add(new(Dup(key + "#" + r.Row, code, sub) with { Key = key + "#" + r.Row }, null)); continue; }
            var v = WithEdits(r.V, key, req, editable);
            if (v.TryGetValue("HOURS", out var h)) v["VALUE"] = h;   // edit drawer uses the field name HOURS for shifts
            try
            {
                int si = code.Length == 2 && code[0] == 'C' && char.IsDigit(code[1]) ? code[1] - '0' - 5 : -1;
                if (si >= 0 && si < shifts.Count)
                {
                    var ex = shifts[si];
                    string name = S(v, "NAME") ?? ex.Name;
                    decimal hours = S(v, "VALUE") is { } hv ? Dec("HOURS", hv) : ex.Hours;
                    var ns = new PpShift { Id = ex.Id, Name = name, Hours = hours, Sort = ex.Sort };
                    ProductionPlanService.ValidateShift(ns);
                    var old = new List<(string, string)> { ("NAME", ex.Name), ("HOURS", N(ex.Hours)) };
                    var now = new List<(string, string)> { ("NAME", name), ("HOURS", N(hours)) };
                    string st = Status(old, now);
                    evs.Add(new(new(key, st, $"{code} · {ex.Name}", sub, Diff(old, now), null, null), skip.Contains(key) || st == ImportReview.Same ? null : ns));
                }
                else if (code is "P8" or "P9")
                {
                    string sk = code == "P8" ? "ManHourFactor" : "ManHourPerDay";
                    decimal cur = settings.GetValueOrDefault(sk, code == "P8" ? 1.023m : 11m);
                    decimal nv = S(v, "VALUE") is { } vv ? Dec("VALUE", vv) : cur;
                    if (code == "P8") ProductionPlanService.ValidateSettings(nv, settings.GetValueOrDefault("ManHourPerDay", 11m)); else ProductionPlanService.ValidateSettings(settings.GetValueOrDefault("ManHourFactor", 1.023m), nv);
                    var old = new List<(string, string)> { ("VALUE", N(cur)) };
                    var now = new List<(string, string)> { ("VALUE", N(nv)) };
                    string st = Status(old, now);
                    evs.Add(new(new(key, st, code == "P8" ? "P8 · MAN HOUR FACTOR" : "P9 · MAN HOUR / DAY", sub, Diff(old, now), null, null), skip.Contains(key) || st == ImportReview.Same ? null : new KeyValuePair<string, decimal>(sk, nv)));
                }
                else evs.Add(new(Bad(key, code, sub, "CODE ไม่ถูกต้อง · ใช้ C5-C9 / P8 / P9 ตาม Template"), null));
            }
            catch (InvalidOperationException e) { evs.Add(new(Bad(key, code, sub, e.Message), null)); }
        }
        return evs;
    }

    public List<Ev> EvalMachines(State st, ProductionPlanService svc, ImportApplyRequest req)
    {
        var depts = st.Rows.Select(r => (S(r.V, "DEPT") ?? "").ToUpperInvariant()).Where(Depts.Contains).Distinct();
        var evs = EvalMachines(st.Rows, depts.SelectMany(d => svc.Machines(d, activeOnly: false)).ToList(), req);
        if (st.Settings.Count > 0) evs.AddRange(EvalSettings(st.Settings, svc.Shifts(), svc.Settings(), req));
        return evs;
    }

    // ================================================================ PRODUCTS
    // active parts looked up by text: A = PART A · B = PART B, else PRODUCT CODE, else PART A (same sources as the PART B search box)
    public sealed class PartIndex
    {
        public sealed record P(int Id, string A, string B, string Code);
        private readonly List<P> _rows;
        private readonly Func<string, bool, List<ImportSuggest>> _near;
        public PartIndex(IEnumerable<P> rows, Func<string, bool, List<ImportSuggest>> near) { _rows = rows.ToList(); _near = near; }
        public List<int> Find(string t, bool isB)
        {
            List<int> Ids(Func<P, string> f) => _rows.Where(x => string.Equals((f(x) ?? "").Trim(), t, StringComparison.OrdinalIgnoreCase)).Select(x => x.Id).Distinct().ToList();
            if (!isB) return Ids(x => x.A);
            var l = Ids(x => x.B);
            if (l.Count == 0) l = Ids(x => x.Code);
            return l.Count > 0 ? l : Ids(x => x.A);
        }
        public List<ImportSuggest> Near(string t, bool isB) => _near(t, isB);
    }

    public static string PKey(string dept, string mc, string a, string b, string proc) => $"P|{dept}|{mc.ToUpperInvariant()}|{a.ToUpperInvariant()}|{(b ?? "").ToUpperInvariant()}|{(ProductionPlanService.Norm(proc) ?? "").ToUpperInvariant()}";

    public static List<(string N, string V)> PDisp(ProductionPlanService.PartForm f) => new()
    {
        ("TOTAL PROCESS", N(f.Tp)), ("PCS / STROKE", N(f.Col)), ("MC CT", N(f.Ct)), ("STD MAN", f.Man == null ? "" : N(f.Man.Value)), ("STATUS", f.Active ? "ACTIVE" : "INACTIVE"),
    };

    public static ProductionPlanService.PartForm BuildPart(PpPart ex, int machineId, int a, int? b, string proc, Dictionary<string, string> v)
    {
        bool isNew = ex == null;
        decimal Num(string k, decimal def)
        {
            var s = S(v, k);
            if (s == null) return isNew ? throw new InvalidOperationException($"{k} ต้องกรอกสำหรับ Product ใหม่") : def;
            return Dec(k, s);
        }
        decimal? man = S(v, "STD MAN") is { } ms ? Dec("STD MAN", ms) : ex?.Man;
        bool active = isNew || (S(v, "STATUS") is { } sa ? Flag("STATUS", sa, new[] { "ACTIVE", "1", "YES", "TRUE" }, new[] { "INACTIVE", "0", "NO", "FALSE" }) : ex.Active);
        var f = new ProductionPlanService.PartForm(ex?.Id ?? 0, machineId, ex?.Sort ?? 0, a, b, proc, Num("TOTAL PROCESS", ex?.Tp ?? 0), Num("PCS / STROKE", ex?.Col ?? 0), Num("MC CT", ex?.Ct ?? 0), man, active);
        ProductionPlanService.ValidatePart(f);
        return f;
    }

    private sealed record PRes(string Reason, List<ImportSuggest> Sug, string Err, PpMachine M, int A, int? B);

    private static PRes ResolveProduct(List<PpMachine> machines, PartIndex idx, string dept, string mc, string at, string bt)
    {
        var inDept = machines.Where(m => m.Dept.Equals(dept, StringComparison.OrdinalIgnoreCase)).ToList();
        var m = inDept.FirstOrDefault(x => x.Code.Equals(mc, StringComparison.OrdinalIgnoreCase));
        if (m == null)
        {
            string nk = ImportReview.NormKey(mc);
            var near = inDept.Where(x => ImportReview.NormKey(x.Code) == nk).Take(5).Select(x => new ImportSuggest(x.Code, $"{x.Code} · {x.Group}")).ToList();
            return near.Count > 0 ? new("M", near, null, null, 0, null) : new(null, null, $"ไม่พบเครื่อง {mc} ใน {dept} · เพิ่มที่ MACHINE STD ก่อน", null, 0, null);
        }
        var a = idx.Find(at, false);
        if (a.Count > 1) return new(null, null, $"PART A {at} มีหลายสินค้าในระบบ (ไม่แน่ใจว่าตัวไหน)", m, 0, null);
        if (a.Count == 0)
        {
            var near = idx.Near(at, false);
            return near.Count > 0 ? new("A", near, null, m, 0, null) : new(null, null, $"ไม่พบ PART A {at} ในระบบ", m, 0, null);
        }
        int? bId = null;
        if (bt != null)
        {
            var b = idx.Find(bt, true);
            if (b.Count > 1) return new(null, null, $"PART B {bt} มีหลายสินค้าในระบบ (ไม่แน่ใจว่าตัวไหน)", m, a[0], null);
            if (b.Count == 0)
            {
                var near = idx.Near(bt, true);
                return near.Count > 0 ? new("B", near, null, m, a[0], null) : new(null, null, $"ไม่พบ PART B {bt} ในระบบ", m, a[0], null);
            }
            bId = b[0];
        }
        return new(null, null, null, m, a[0], bId);
    }

    public static List<Ev> EvalProducts(List<Raw> raws, List<PpMachine> machines, List<PpPart> parts, PartIndex idx, ImportApplyRequest req)
    {
        var skip = (req?.Exclude ?? new()).ToHashSet();
        var evs = new List<Ev>();
        string[] editable = { "TOTAL PROCESS", "PCS / STROKE", "MC CT", "STD MAN", "STATUS" };
        string DeptOf(Raw r) => (S(r.V, "DEPT") ?? "").ToUpperInvariant();
        string Proc(Raw r) => ProductionPlanService.Norm(S(r.V, "PROCESS"));
        bool Keyable(Raw r) => r.Error == null && Depts.Contains(DeptOf(r)) && S(r.V, "MACHINE CODE") != null && S(r.V, "PART A") != null;
        var sup = Superseded(raws.Where(Keyable).Select(r => (r.Row, PKey(DeptOf(r), S(r.V, "MACHINE CODE"), S(r.V, "PART A"), S(r.V, "PART B"), Proc(r)))));
        foreach (var r in raws)
        {
            string dept = DeptOf(r), mc = S(r.V, "MACHINE CODE"), at = S(r.V, "PART A"), bt = S(r.V, "PART B"), proc = Proc(r);
            string label = at ?? $"แถว {r.Row}", sub = $"{dept} · {mc} · แถว {r.Row}";
            if (r.Error != null) { evs.Add(new(Bad($"ROW{r.Row}", label, sub, r.Error), null)); continue; }
            if (!Keyable(r)) { evs.Add(new(Bad($"ROW{r.Row}", label, sub, !Depts.Contains(dept) ? $"DEPT ไม่ถูกต้อง ({(dept.Length == 0 ? "ว่าง" : dept)})" : mc == null ? "ไม่มี MACHINE CODE" : "ไม่มี PART A"), null)); continue; }
            string key = PKey(dept, mc, at, bt, proc);
            if (bt != null) label = $"{at} / {bt}";
            if (sup[r.Row]) { evs.Add(new(Dup(key + "#" + r.Row, label, sub) with { Key = key + "#" + r.Row }, null)); continue; }
            var v = WithEdits(r.V, key, req, editable);
            var nf = editable.Where(h => S(v, h) != null).Select(h => new ImportField(h, null, S(v, h), true)).ToList();
            string mmc = mc, mat = at, mbt = bt;
            var res = ResolveProduct(machines, idx, dept, mmc, mat, mbt);
            // SIMILAR + a chosen match: swap that one text and resolve again (only one swap; a second unknown stays SIMILAR)
            if (res.Reason != null && req?.Map != null && req.Map.TryGetValue(key, out var pick) && !string.IsNullOrWhiteSpace(pick))
            {
                if (res.Reason == "M") mmc = pick.Trim(); else if (res.Reason == "A") mat = pick.Trim(); else mbt = pick.Trim();
                res = ResolveProduct(machines, idx, dept, mmc, mat, mbt);
            }
            if (res.Err != null) { evs.Add(new(Bad(key, label, sub, res.Err, nf), null)); continue; }
            if (res.Reason != null)
            {
                string what = res.Reason == "M" ? "MACHINE CODE" : res.Reason == "A" ? "PART A" : "PART B";
                evs.Add(new(new(key, ImportReview.Similar, label, sub, nf, $"ไม่พบ {what} นี้ แต่คล้ายของเดิม · เลือกผูกกับของเดิม หรือไม่ใช้แถวนี้", res.Sug), null));
                continue;
            }
            try
            {
                var ex = parts.FirstOrDefault(p => p.MachineId == res.M.Id && p.PartAId == res.A && (p.PartBId ?? 0) == (res.B ?? 0) && (ProductionPlanService.Norm(p.Process) ?? "") == (proc ?? ""));
                var f = BuildPart(ex, res.M.Id, res.A, res.B, proc, v);
                var now = PDisp(f);
                var old = ex == null ? null : PDisp(new ProductionPlanService.PartForm(ex.Id, ex.MachineId, ex.Sort, ex.PartAId, ex.PartBId, ex.Process, ex.Tp, ex.Col, ex.Ct, ex.Man, ex.Active));
                string status = Status(old, now);
                evs.Add(new(new(key, status, label, sub, Diff(old, now), null, null), skip.Contains(key) || status == ImportReview.Same ? null : f));
            }
            catch (InvalidOperationException e) { evs.Add(new(Bad(key, label, sub, e.Message, nf), null)); }
        }
        return evs;
    }

    public List<Ev> EvalProducts(State st, ProductionPlanService svc, ImportApplyRequest req)
    {
        var depts = st.Rows.Select(r => (S(r.V, "DEPT") ?? "").ToUpperInvariant()).Where(Depts.Contains).Distinct();
        var machines = depts.SelectMany(d => svc.Machines(d, activeOnly: false)).ToList();
        var parts = svc.PartsOf(machines.Select(m => m.Id).ToArray());
        return EvalProducts(st.Rows, machines, parts, LoadIndex(st.Rows), req);
    }

    private static PartIndex LoadIndex(List<Raw> raws)
    {
        var texts = raws.SelectMany(r => new[] { S(r.V, "PART A"), S(r.V, "PART B") }).Where(t => t != null).Select(t => t.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var rows = new List<PartIndex.P>();
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        for (int i = 0; i < texts.Count; i += 800)
        {
            var chunk = texts.Skip(i).Take(800).ToList();
            rows.AddRange(c.Query<PartIndex.P>(@"SELECT PartID AS Id, LTRIM(RTRIM(ISNULL(PartA, ''))) AS A, LTRIM(RTRIM(ISNULL(PartB, ''))) AS B, LTRIM(RTRIM(ISNULL(PartCode, ''))) AS Code
                                                 FROM Nexus.Parts WHERE IsActive = 1 AND (LTRIM(RTRIM(PartA)) IN @chunk OR LTRIM(RTRIM(PartB)) IN @chunk OR LTRIM(RTRIM(PartCode)) IN @chunk)", new { chunk }));
        }
        var cache = new Dictionary<string, List<ImportSuggest>>();
        List<(string KA, string KB, string KC, string A, string B, string Code, string Name)> all = null;   // every active part, loaded once and only if some text is unknown
        List<ImportSuggest> Near(string t, bool isB)
        {
            string ck = (isB ? "B|" : "A|") + t;
            if (cache.TryGetValue(ck, out var hit)) return hit;
            if (all == null)
            {
                using var c2 = new SqlConnection(GlobalConfig.ConnStr);   // own connection: the index outlives LoadIndex
                all = c2.Query<(string A, string B, string Code, string Name)>(@"SELECT LTRIM(RTRIM(ISNULL(PartA, ''))), LTRIM(RTRIM(ISNULL(PartB, ''))), LTRIM(RTRIM(ISNULL(PartCode, ''))), ISNULL(Description, '')
                                                                                FROM Nexus.Parts WHERE IsActive = 1")
                        .Select(x => (ImportReview.NormKey(x.A), ImportReview.NormKey(x.B), ImportReview.NormKey(x.Code), x.A, x.B, x.Code, x.Name)).ToList();
            }
            string k = ImportReview.NormKey(t);
            var found = all.Where(x => x.KA == k || (isB && (x.KB == k || x.KC == k))).Take(5).Select(x => (x.A, x.B, x.Code, x.Name)).ToList();
            return cache[ck] = found.Select(x => (Key: isB ? (x.B.Length > 0 ? x.B : x.Code.Length > 0 ? x.Code : x.A) : x.A, x.Name)).Where(x => x.Key.Length > 0)
                                    .Select(x => new ImportSuggest(x.Key, x.Name.Length > 0 ? $"{x.Key} · {x.Name}" : x.Key)).ToList();
        }
        return new PartIndex(rows, Near);
    }

    // ================================================================ APPLY (reuses the screen save methods in one transaction: all or nothing; never deletes)
    public (int Added, int Updated, int Same, int Skipped) Execute(List<Ev> evs, ProductionPlanService svc, string uid)
    {
        int add = 0, upd = 0;
        var shifts = new List<PpShift>();
        decimal? factor = null, perDay = null;
        var cur = evs.Any(x => x.Op is KeyValuePair<string, decimal>) ? svc.Settings() : null;   // read before the transaction
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        c.Open();
        using var t = c.BeginTransaction();
        foreach (var e in evs.Where(x => x.Op != null))
        {
            bool isNew = e.Row.Status == ImportReview.New;
            switch (e.Op)
            {
                case ProductionPlanService.MachineForm m: svc.SaveMachine(m, uid, c, t); break;
                case ProductionPlanService.PartForm p: svc.SavePart(p, uid, c, t); break;
                case PpShift s: shifts.Add(s); break;
                case KeyValuePair<string, decimal> kv: if (kv.Key == "ManHourFactor") factor = kv.Value; else perDay = kv.Value; break;
            }
            if (isNew) add++; else upd++;
        }
        if (shifts.Count > 0) svc.SaveShifts(shifts, uid, c, t);
        if (factor != null || perDay != null)
            svc.SaveSettings(factor ?? cur["ManHourFactor"], perDay ?? cur["ManHourPerDay"], uid, c, t);
        t.Commit();
        int same = evs.Count(x => x.Row.Status == ImportReview.Same);
        return (add, upd, same, evs.Count - add - upd - same);
    }

    // ================================================================ TEMPLATES
    private const string Yellow = "#FFF2CC", Gray = "#EDEDED";
    private static void Fill(IXLWorksheet ws, int r1, int c1, int r2, int c2, string hex) { if (r2 >= r1 && c2 >= c1) ws.Range(r1, c1, r2, c2).Style.Fill.BackgroundColor = XLColor.FromHtml(hex); }

    // numbers go in as numbers (so Excel aligns / sums them), text stays text
    private static void SetVal(IXLCell c, string v, bool numeric)
    {
        if (numeric && decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var d)) c.Value = d; else c.Value = v;
    }

    public static XLWorkbook MachinesTemplate(string dept, List<PpMachine> machines, List<PpShift> shifts, Dictionary<string, decimal> settings)
    {
        var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("MACHINES");
        var heads = new[] { "NO" }.Concat(MachineHeads).Append("PRODUCTS (REF)").ToArray();
        ImportTemplateService.Header(ws, heads, new double[] { 6, 12, 26, 14, 14, 8, 11, 13, 10, 11, 14, 12, 12, 11, 14 });
        int r = 2;
        foreach (var m in machines)
        {
            var f = ToForm(m);
            ws.Cell(r, 1).Value = r - 1;
            ws.Cell(r, 2).Value = m.Dept; ws.Cell(r, 3).Value = m.Code;
            var d = MDisp(f);
            for (int i = 0; i < d.Count; i++) SetVal(ws.Cell(r, 4 + i), d[i].V, i is >= 2 and <= 6);
            ws.Cell(r, 15).Value = m.Parts;
            r++;
        }
        int existingLast = r - 1;
        for (int i = 0; i < 20; i++) { ws.Cell(r, 1).Value = r - 1; ws.Cell(r, 2).Value = dept; r++; }
        int last = r - 1;
        ImportTemplateService.Body(ws, last, heads.Length);
        ImportTemplateService.LeftAlign(ws, last, 3, 4, 5);
        ws.Range(2, 2, last, 6).Style.NumberFormat.Format = "@";
        ws.Range(2, 13, last, 14).Style.NumberFormat.Format = "@";   // FROM / TO MONTH as text (2026-01)
        Fill(ws, 2, 2, last, 14, Yellow);
        Fill(ws, 2, 2, existingLast, 3, Gray);   // key of existing machines
        Fill(ws, 2, 15, last, 15, Gray);
        ws.SheetView.Freeze(1, 3);

        var ss = wb.AddWorksheet("SETTINGS");
        ImportTemplateService.Header(ss, new[] { "CODE", "NAME", "VALUE" }, new double[] { 10, 44, 14 });
        int sr = 2;
        for (int i = 0; i < shifts.Count; i++) { ss.Cell(sr, 1).Value = "C" + (5 + i); ss.Cell(sr, 2).Value = shifts[i].Name; ss.Cell(sr, 3).Value = shifts[i].Hours; sr++; }
        ss.Cell(sr, 1).Value = "P8"; ss.Cell(sr, 2).Value = "MAN HOUR FACTOR"; ss.Cell(sr, 3).Value = settings.GetValueOrDefault("ManHourFactor", 1.023m); sr++;
        ss.Cell(sr, 1).Value = "P9"; ss.Cell(sr, 2).Value = "MAN HOUR / DAY (HRS)"; ss.Cell(sr, 3).Value = settings.GetValueOrDefault("ManHourPerDay", 11m);
        ImportTemplateService.Body(ss, sr, 3);
        ImportTemplateService.LeftAlign(ss, sr, 2);
        Fill(ss, 2, 2, sr, 3, Yellow);
        Fill(ss, 2, 1, sr, 1, Gray);

        ImportTemplateService.Guide(wb, "CHR-Nexus - MASTER DATA > PRODUCTION PLAN > MACHINE STD (IMPORT EXCEL)", new[]
        {
            ("DEPT + MACHINE CODE", $"ใช้จับคู่ (สีเทา) ห้ามแก้ในแถวที่มีอยู่แล้ว · DEPT = {string.Join(" / ", Depts)} · MACHINE CODE ใหม่ = เพิ่มเครื่องใหม่ (ACTIVE)"),
            ("GROUP / Q'TY LINE / TARGET EFF (%) / STD MAN", "เครื่องใหม่ต้องกรอกครบ · TARGET EFF ใส่เป็น % เช่น 85 (1 - 150) · Q'TY > 0"),
            ("SPH 100%", "ตัวเลข > 0 · พิมพ์ AUTO = คำนวณจากตาราง Product · ช่องว่าง = คงค่าเดิม"),
            ("STROKE", "PCS = เครื่อง Transfer (Stroke = PCS ÷ Pcs./Stroke) · PCS x PROCESS = คูณ Total Process"),
            ("FROM MONTH / TO MONTH", "รูปแบบ 2026-01 · ช่องว่าง = คงค่าเดิม (ล้างช่วงเดือนทำที่หน้าเว็บ)"),
            ("STATUS", "ACTIVE / INACTIVE · ใช้กับเครื่องที่มีอยู่แล้ว (เครื่องใหม่ = ACTIVE เสมอ)"),
            ("ชีท SETTINGS", "C5-C9 = ชื่อ + ชั่วโมง Plan SPH · P8 = ตัวคูณ Man Hour · P9 = ชั่วโมง/คน/วัน · แก้ได้เฉพาะ NAME / VALUE (CODE ห้ามแก้)"),
            ("ช่องว่าง", "= คงค่าเดิม · ค่าเท่าเดิม = ไม่แตะ (แสดงเป็น SAME)"),
            ("KEY ซ้ำในไฟล์", "ใช้แถวล่างสุด แถวบนถูกข้าม (DUPLICATE)"),
            ("MACHINE CODE คล้ายของเดิม", "ต่างแค่ตัวพิมพ์ / ขีด / เว้นวรรค = SIMILAR · เลือกผูกกับเครื่องเดิมในหน้าพรีวิว"),
            ("การลบ", "ไม่มีการลบผ่าน Import · แถวที่ไม่อยู่ในไฟล์ = คงเดิม"),
            ("แถวผิด", "ค่าไม่ผ่านกฎเดียวกับหน้าจอ = ข้ามแถว และแสดงในรายการผิดพลาด"),
            ("", "กรอกในชีท MACHINES / SETTINGS แล้วกด IMPORT ในหน้า MACHINE STD"),
        });
        wb.Worksheet(1).SetTabActive();
        return wb;
    }

    public static XLWorkbook ProductsTemplate(string dept, List<PpMachine> machines, List<PpPart> parts)
    {
        var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("PRODUCTS");
        var heads = new[] { "NO" }.Concat(ProductHeads).Concat(new[] { "PRODUCT NAME (REF)", "CUSTOMER (REF)" }).ToArray();
        ImportTemplateService.Header(ws, heads, new double[] { 6, 12, 26, 18, 18, 30, 12, 12, 10, 10, 11, 40, 16 });
        int r = 2;
        foreach (var m in machines)
            foreach (var p in parts.Where(x => x.MachineId == m.Id))
            {
                ws.Cell(r, 1).Value = r - 1;
                ws.Cell(r, 2).Value = m.Dept; ws.Cell(r, 3).Value = m.Code; ws.Cell(r, 4).Value = p.PartA ?? ""; ws.Cell(r, 5).Value = p.PartB ?? ""; ws.Cell(r, 6).Value = p.Process ?? "";
                var d = PDisp(new ProductionPlanService.PartForm(p.Id, p.MachineId, p.Sort, p.PartAId, p.PartBId, p.Process, p.Tp, p.Col, p.Ct, p.Man, p.Active));
                for (int i = 0; i < d.Count; i++) { if (d[i].V.Length > 0) SetVal(ws.Cell(r, 7 + i), d[i].V, i <= 3); }
                ws.Cell(r, 12).Value = p.Name ?? ""; ws.Cell(r, 13).Value = p.Customer ?? "";
                r++;
            }
        int existingLast = r - 1;
        for (int i = 0; i < 20; i++) { ws.Cell(r, 1).Value = r - 1; ws.Cell(r, 2).Value = dept; r++; }
        int last = r - 1;
        ImportTemplateService.Body(ws, last, heads.Length);
        ImportTemplateService.LeftAlign(ws, last, 3, 4, 5, 6, 12);
        ws.Range(2, 2, last, 6).Style.NumberFormat.Format = "@";
        Fill(ws, 2, 2, last, 11, Yellow);
        Fill(ws, 2, 2, existingLast, 6, Gray);   // key of existing products
        Fill(ws, 2, 12, last, 13, Gray);
        ws.SheetView.Freeze(1, 3);

        ImportTemplateService.Guide(wb, "CHR-Nexus - MASTER DATA > PRODUCTION PLAN > MACHINE PRODUCTS (IMPORT EXCEL)", new[]
        {
            ("DEPT + MACHINE CODE + PART A + PART B + PROCESS", "ใช้จับคู่ (สีเทา) ห้ามแก้ในแถวที่มีอยู่แล้ว · ชุดใหม่ = เพิ่ม Product ใหม่ให้เครื่อง (เครื่องต้องมีอยู่ใน MACHINE STD ก่อน)"),
            ("PART A / PART B", "PART A = รหัส PART A ใน STORE-FG · PART B = PART B (หรือ PRODUCT CODE) ใน STORE-SUB · ว่าง = ชิ้นเดียวกับ PART A"),
            ("TOTAL PROCESS / PCS / STROKE / MC CT", "ตัวเลข > 0 · Product ใหม่ต้องกรอกครบ · ช่องว่างของแถวเดิม = คงค่าเดิม"),
            ("STD MAN", "ตัวเลข ≥ 0 · ช่องว่าง = คงค่าเดิม"),
            ("STATUS", "ACTIVE / INACTIVE · ใช้กับแถวที่มีอยู่แล้ว (แถวใหม่ = ACTIVE เสมอ)"),
            ("PRODUCT NAME / CUSTOMER", "ข้อมูลอ้างอิง (สีเทา) ระบบไม่อ่านค่า"),
            ("KEY ซ้ำในไฟล์", "ใช้แถวล่างสุด แถวบนถูกข้าม (DUPLICATE)"),
            ("MACHINE / PART คล้ายของเดิม", "ต่างแค่ตัวพิมพ์ / ขีด / เว้นวรรค = SIMILAR · เลือกผูกกับของเดิมในหน้าพรีวิว"),
            ("การลบ", "ไม่มีการลบผ่าน Import · แถวที่ไม่อยู่ในไฟล์ = คงเดิม"),
            ("", "กรอกในชีท PRODUCTS แล้วกด IMPORT ในหน้า MACHINE PRODUCTS"),
        });
        wb.Worksheet(1).SetTabActive();
        return wb;
    }
}
