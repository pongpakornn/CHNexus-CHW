using System.Globalization;
using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 📄 PRODUCTION PLAN › TEMPLATE / IMPORT ช่องที่ต้องกรอก (รูปแบบเดียวกับ Template ของ Product Control)
//   CAPACITY › M/C ACTUAL · INPUT : 1 เครื่อง = 3 แถว (WORKING HOUR / STROKE / MAN) · คอลัมน์ = วันที่ 1 … สิ้นเดือน · DEPT / MONTH ใส่ให้แล้ว
//   WORKLOAD › Current (คนที่มีจริง) : 1 หน่วยงาน = 1 แถว (DIRECT / IND1 / IND2) · MONTH ใส่ให้แล้ว
//   IMPORT แบบ Forecast: ยอดเท่าเดิม = ไม่แตะ · ยอดต่าง = อัพเดทเป็นยอดใหม่ · ยังไม่มียอด = เพิ่ม
//     ช่องว่าง: มียอดอยู่แล้ว = คงยอดเดิม · ยังไม่มียอด = ใส่ 0 (Capacity เฉพาะวันทำงานที่ถึงแล้ว) · พิมพ์ 0 = เปลี่ยนเป็น 0
//     ช่องสูตร / Link = อ่านค่าที่ Excel คำนวณไว้ตอน Save · สูตร Error (#REF! / #N/A …) = แสดงในการ์ดข้อผิดพลาดแล้วข้ามช่องนั้น
//     ทศนิยมเก็บได้ 2 ตำแหน่ง (เกิน = ปัด)
[Route("api/pp")]
public sealed class PpImportController : AppController
{
    private readonly ProductionPlanService _svc = new();
    private readonly UploadCache _uploads;
    public PpImportController(UploadCache uploads) => _uploads = uploads;
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly string[] Items = { "WORKING HOUR", "STROKE", "MAN" };
    private static readonly string[] WlFields = { "DIRECT", "IND1", "IND2" };

    public sealed record PvCell(string Group, string Label, string Status, decimal? Old, decimal New, int Sort);
    public sealed record PvError(string Cell, string Text);
    private sealed record ActChange(int Mid, DateTime Month, int Day, int F, decimal V);
    private sealed record WlChange(DateTime Month, string Row, int F, decimal V);

    private static DateTime Mon(string m) =>
        DateTime.TryParseExact((m ?? "") + "-01", "yyyy-MM-dd", Inv, DateTimeStyles.None, out var d) ? d : new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
    private static byte[] Bytes(XLWorkbook wb)
    {
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ---------------------------------------------------------------- อ่านช่อง
    private static string ErrName(XLError e) => e switch
    {
        XLError.NoValueAvailable => "#N/A",
        XLError.CellReference => "#REF!",
        XLError.DivisionByZero => "#DIV/0!",
        XLError.IncompatibleValue => "#VALUE!",
        XLError.NameNotRecognized => "#NAME?",
        XLError.NumberInvalid => "#NUM!",
        _ => "#ERROR",
    };

    // ว่าง / ตัวเลข / ผิด · ช่องสูตร = ค่าที่ Excel คำนวณไว้ตอน Save (สูตรคืนค่า "" หรือ "-" = ว่าง)
    private static (bool Blank, decimal V, string Err) Read(IXLCell c)
    {
        XLCellValue v;
        try { v = c.HasFormula ? c.CachedValue : c.Value; } catch { return (false, 0, "อ่านค่าไม่ได้"); }
        if (v.IsBlank) return (true, 0, null);
        if (v.IsError) return (false, 0, $"สูตร Error {ErrName(v.GetError())}");
        if (v.IsNumber) return (false, (decimal)v.GetNumber(), null);
        string s = v.IsText ? v.GetText().Trim() : "";
        if (v.IsText && (s == "" || s == "-")) return (true, 0, null);
        if (v.IsText && decimal.TryParse(s.Replace(",", ""), NumberStyles.Any, Inv, out var d)) return (false, d, null);
        return (false, 0, $"ไม่ใช่ตัวเลข ({(v.IsText ? s : c.GetFormattedString())})");
    }

    private static DateTime? MonthOf(IXLCell c)
    {
        XLCellValue v;
        try { v = c.HasFormula ? c.CachedValue : c.Value; } catch { return null; }
        if (v.IsDateTime) { var d = v.GetDateTime(); return new DateTime(d.Year, d.Month, 1); }
        if (v.IsNumber) { try { var d = DateTime.FromOADate(v.GetNumber()); return new DateTime(d.Year, d.Month, 1); } catch { return null; } }
        string s = v.IsText ? v.GetText().Trim() : "";
        foreach (var f in new[] { "yyyy-MM", "yyyy-M", "MM/yyyy", "M/yyyy", "MMM yyyy", "MMMM yyyy", "MMM-yy", "MMM-yyyy" })
            if (DateTime.TryParseExact(s, f, Inv, DateTimeStyles.None, out var d)) return new DateTime(d.Year, d.Month, 1);
        return null;
    }

    private static string Norm(string s) => Regex.Replace(s ?? "", @"\s+", " ").Trim().ToUpperInvariant();

    // หาแถวหัวตาราง (10 แถวแรก) ที่มีคอลัมน์ must
    private static (int Row, Dictionary<string, int> Cols) FindHead(IXLWorksheet ws, string must)
    {
        int last = Math.Min(10, ws.LastRowUsed()?.RowNumber() ?? 0);
        for (int r = 1; r <= last; r++)
        {
            var cols = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var c in ws.Row(r).CellsUsed())
            {
                string t = Norm(c.GetString());
                if (t != "" && !cols.ContainsKey(t)) cols[t] = c.Address.ColumnNumber;
            }
            if (cols.ContainsKey(must)) return (r, cols);
        }
        return (0, null);
    }

    private static string St(decimal? old, decimal v) => old == null ? "NEW" : old.Value == v ? "SAME" : "CHANGED";
    private static string N(decimal v) => v.ToString("#,##0.##", Inv);

    private object Summary(string id, string file, string title, List<PvCell> items, List<PvError> errors, IEnumerable<string> unknown, int rounded) => new
    {
        id,
        file,
        title,
        items = items.OrderBy(x => x.Sort).ThenBy(x => x.Group).ToList(),
        errors,
        unknown = unknown.ToList(),
        rounded,
        count = items.Count(x => x.Status != "SAME"),
    };

    // ================================================================ CAPACITY › M/C ACTUAL · INPUT
    [HttpGet("actual/template")]
    public IActionResult ActualTemplate(string dept, string month)
    {
        if (Me?.CanViewPpCapacity != true) return Deny();
        if (!DbSchema.HasProductionPlan) return Fail("ฐานข้อมูลยังไม่มีตาราง Production Plan");
        string d = ProductionPlanService.Dept(dept);
        var m = Mon(month);
        try
        {
            var mcs = _svc.Machines(d, true);
            var act = _svc.Actuals(mcs.Select(x => x.Id), m).GroupBy(a => (a.MachineId, a.Day)).ToDictionary(g => g.Key, g => g.First());
            var wd = _svc.Workdays(m).ToHashSet();
            int nd = DateTime.DaysInMonth(m.Year, m.Month);
            string mk = m.ToString("yyyy-MM", Inv);
            var heads = new List<string> { "NO", "DEPT", "MONTH", "MACHINE", "ITEM" };
            for (int i = 1; i <= nd; i++) heads.Add($"{i}\n{new DateTime(m.Year, m.Month, i).ToString("ddd", Inv).ToUpperInvariant()}");
            var widths = new List<double> { 6, 11, 10, 24, 15 };
            widths.AddRange(Enumerable.Repeat(7.5, nd));

            using var wb = new XLWorkbook();
            var ws = wb.AddWorksheet("ACTUAL");
            ImportTemplateService.Header(ws, heads.ToArray(), widths.ToArray());
            int r = 2;
            foreach (var mc in mcs)
                for (int k = 0; k < 3; k++)
                {
                    ws.Cell(r, 1).Value = r - 1;
                    ws.Cell(r, 2).Value = d;
                    ws.Cell(r, 3).Value = mk;
                    ws.Cell(r, 4).Value = mc.Code;
                    ws.Cell(r, 5).Value = Items[k];
                    for (int day = 1; day <= nd; day++)
                        if (act.TryGetValue((mc.Id, day), out var a))
                        {
                            var v = k == 0 ? a.Hr : k == 1 ? a.Stroke : a.Man;
                            if (v != null) ws.Cell(r, 5 + day).Value = v.Value;
                        }
                    r++;
                }
            int last = Math.Max(2, r - 1);
            ImportTemplateService.Body(ws, last, heads.Count);
            ws.Range(2, 3, last, 3).Style.NumberFormat.Format = "@";
            ws.Range(2, 4, last, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            var input = ws.Range(2, 6, last, 5 + nd);
            input.Style.NumberFormat.Format = "#,##0.##";
            input.Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
            for (int day = 1; day <= nd; day++)
                if (!wd.Contains(day))
                {
                    ws.Cell(1, 5 + day).Style.Fill.BackgroundColor = XLColor.FromHtml("#7F7F7F");
                    ws.Range(2, 5 + day, last, 5 + day).Style.Fill.BackgroundColor = XLColor.FromHtml("#EDEDED");
                }
            // เส้นแบ่งเครื่อง (ทุก 3 แถว)
            for (int rr = 4; rr <= last; rr += 3) ws.Range(rr, 1, rr, heads.Count).Style.Border.BottomBorder = XLBorderStyleValues.Medium;
            ws.SheetView.Freeze(1, 5);

            ImportTemplateService.Guide(wb, $"CHR-Nexus - PRODUCTION PLAN › CAPACITY › {d} (IMPORT M/C ACTUAL) • {m.ToString("MMMM yyyy", Inv).ToUpperInvariant()}", new[]
            {
                ("DEPT / MONTH / MACHINE / ITEM", "ใส่ให้แล้ว ห้ามแก้ (ระบบใช้จับคู่เครื่องและเดือน) · MONTH = ปี-เดือน เช่น " + mk),
                ("ITEM", "WORKING HOUR (0 - 24 ชม.) / STROKE / MAN (คน) · 1 เครื่อง = 3 แถว"),
                ("1 - " + nd, "ยอดของวันที่นั้น (ช่องสีเหลือง) · คอลัมน์สีเทา = วันหยุดตามปฏิทินบริษัท · ทศนิยมได้ 2 ตำแหน่ง (เกินจะปัด)"),
                ("ยอดเท่าเดิม", "ไม่แตะ"),
                ("ยอดต่างจากในระบบ", "อัพเดทเป็นยอดใหม่ (หน้าพรีวิวแสดงยอดเดิม → ยอดใหม่ ก่อนกด IMPORT)"),
                ("ช่องว่าง", "มียอดอยู่แล้ว = คงยอดเดิม · ยังไม่มียอด = ใส่ 0 ให้ (เฉพาะวันทำงานที่ถึงแล้ว วันข้างหน้าเว้นว่างไว้)"),
                ("พิมพ์ 0", "เปลี่ยนยอดเป็น 0"),
                ("Link สูตร / Copy วาง", "ใช้ได้ · ระบบอ่านค่าที่ Excel คำนวณไว้ตอน Save → เปิดไฟล์ใน Excel ให้ Link อัพเดทก่อน แล้ว Save ปิด แล้วค่อย IMPORT"),
                ("Link ช่องว่าง", "สูตร =ไฟล์อื่น!A1 ที่ต้นทางว่างจะได้ 0 (= เปลี่ยนเป็น 0) · ถ้าอยากให้ว่าง ใช้ =IF(ต้นทาง=\"\",\"\",ต้นทาง)"),
                ("สูตร Error", "#REF! / #N/A / #VALUE! … ระบบแจ้งในการ์ด ข้อผิดพลาด แล้วข้ามช่องนั้น ช่องอื่น IMPORT ได้ตามปกติ"),
                ("", "กรอกในชีท ACTUAL (ชีทแรก) แล้วกด IMPORT ACTUAL ในหน้า PRODUCTION PLAN › CAPACITY"),
            });
            wb.Worksheet(1).SetTabActive();
            LogService.WriteLog(Uid, "PP_ACTUAL_TEMPLATE", $"{d} | {m:MM/yyyy} | Machines: {mcs.Count}", "");
            return File(Bytes(wb), XlsxType, $"ACTUAL_{d}_{m:yyyy-MM}.xlsx");
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }

    [HttpPost("actual/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ActualImport(IFormFile file)
    {
        if (Me?.CanEditPpCapacity != true) return Deny("คุณไม่มีสิทธิ์บันทึก Actual (CAPACITY › EDIT)");
        if (!DbSchema.HasProductionPlan) return Fail("ฐานข้อมูลยังไม่มีตาราง Production Plan");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            var errors = new List<PvError>();
            var unknown = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            int rounded = 0;
            // (DEPT, MONTH, MACHINE, ITEM, DAY) -> ค่าสุดท้ายในไฟล์ (แถวซ้ำ = แถวล่างสุด)
            var cells = new Dictionary<(string Dept, DateTime M, string Code, int F, int Day), (bool Blank, decimal V)>();
            using (var wb = new XLWorkbook(path))
            {
                var ws = wb.Worksheets.First();
                var (hr, cols) = FindHead(ws, "MACHINE");
                if (hr == 0 || !cols.ContainsKey("ITEM") || !cols.ContainsKey("MONTH"))
                    throw new InvalidOperationException("ไม่ใช่ไฟล์ Template ACTUAL (ไม่พบหัวคอลัมน์ MONTH / MACHINE / ITEM) · ดาวน์โหลด ACTUAL TEMPLATE จากหน้า Capacity");
                var days = cols.Select(kv => (M: Regex.Match(kv.Key, @"^(\d{1,2})(\s|$)"), Col: kv.Value))
                               .Where(x => x.M.Success).Select(x => (Day: int.Parse(x.M.Groups[1].Value), x.Col))
                               .Where(x => x.Day is >= 1 and <= 31).ToList();
                if (days.Count == 0) throw new InvalidOperationException("ไม่พบคอลัมน์วันที่ (1 - 31) ในแถวหัวตาราง");
                cols.TryGetValue("DEPT", out int cDept);
                int last = ws.LastRowUsed()?.RowNumber() ?? hr;
                for (int r = hr + 1; r <= last; r++)
                {
                    string code = Norm(ws.Cell(r, cols["MACHINE"]).GetString());
                    string item = Norm(ws.Cell(r, cols["ITEM"]).GetString());
                    if (code == "" && item == "") continue;
                    int f = item.StartsWith("WORK") ? 0 : item.StartsWith("STROKE") ? 1 : item.StartsWith("MAN") ? 2 : -1;
                    if (code == "") { errors.Add(new($"แถว {r}", "ไม่มี MACHINE")); continue; }
                    if (f < 0) { errors.Add(new($"แถว {r}", $"{code}: ITEM ไม่รู้จัก ({item}) · ใช้ WORKING HOUR / STROKE / MAN")); continue; }
                    var mon = MonthOf(ws.Cell(r, cols["MONTH"]));
                    if (mon == null) { errors.Add(new($"แถว {r}", $"{code}: MONTH ไม่ถูกต้อง ({ws.Cell(r, cols["MONTH"]).GetString()}) · ใช้รูปแบบ 2026-11")); continue; }
                    string dp = cDept > 0 ? Norm(ws.Cell(r, cDept).GetString()) : "";
                    int nd = DateTime.DaysInMonth(mon.Value.Year, mon.Value.Month);
                    foreach (var (day, col) in days)
                    {
                        var c = ws.Cell(r, col);
                        var (blank, v, err) = Read(c);
                        string at = c.Address.ToString();
                        if (err != null) { errors.Add(new(at, $"{code} · {Items[f]} · วันที่ {day}: {err}")); continue; }
                        if (day > nd) { if (!blank) errors.Add(new(at, $"{code}: เดือน {mon:MMM yyyy} ไม่มีวันที่ {day}")); continue; }
                        if (!blank)
                        {
                            var rv = Math.Round(v, 2, MidpointRounding.AwayFromZero);
                            if (rv != v) rounded++;
                            v = rv;
                            string bad = f == 0 ? (v is < 0 or > 24 ? "Working hour ต้องอยู่ระหว่าง 0 - 24" : null)
                                       : f == 1 ? (v is < 0 or > 9_999_999_999m ? "Stroke ไม่ถูกต้อง" : null)
                                       : (v is < 0 or > 999 ? "Man ต้องอยู่ระหว่าง 0 - 999" : null);
                            if (bad != null) { errors.Add(new(at, $"{code} · วันที่ {day}: {bad} ({N(v)})")); continue; }
                        }
                        cells[(dp, mon.Value, code, f, day)] = (blank, v);
                    }
                }
            }
            TryDelete(path);
            if (cells.Count == 0 && errors.Count == 0) throw new InvalidOperationException("ไม่พบแถวข้อมูลในไฟล์");

            // จับคู่เครื่อง: DEPT + MACHINE (ไม่มี DEPT = MACHINE ที่ไม่ซ้ำหน่วยงาน)
            var all = _svc.AllMachines();
            var byDc = all.GroupBy(x => $"{x.Dept}|{x.Code}", StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
            var byCode = all.GroupBy(x => x.Code, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() == 1).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
            var mOf = new Dictionary<(string, string), PpMachine>();
            foreach (var k in cells.Keys.Select(k => (k.Dept, k.Code)).Distinct())
            {
                PpMachine mc = null;
                if (k.Dept != "") byDc.TryGetValue($"{k.Dept}|{k.Code}", out mc); else byCode.TryGetValue(k.Code, out mc);
                if (mc == null) unknown.Add(k.Dept == "" ? k.Code : $"{k.Dept} · {k.Code}");
                else mOf[k] = mc;
            }

            var today = DateTime.Today;
            var items = new List<PvCell>();
            var changes = new List<ActChange>();
            foreach (var grp in cells.Where(x => mOf.ContainsKey((x.Key.Dept, x.Key.Code))).GroupBy(x => x.Key.M))
            {
                var mon = grp.Key;
                var wd = _svc.Workdays(mon).ToHashSet();
                var ids = grp.Select(x => mOf[(x.Key.Dept, x.Key.Code)].Id).Distinct().ToList();
                var cur = _svc.Actuals(ids, mon).GroupBy(a => (a.MachineId, a.Day)).ToDictionary(g => g.Key, g => g.First());
                foreach (var (k, val) in grp)
                {
                    var mc = mOf[(k.Dept, k.Code)];
                    cur.TryGetValue((mc.Id, k.Day), out var a);
                    decimal? old = a == null ? null : k.F == 0 ? a.Hr : k.F == 1 ? a.Stroke : a.Man;
                    decimal v = val.V;
                    string st;
                    if (!val.Blank) st = St(old, v);
                    else
                    {
                        // ว่าง: มียอดอยู่แล้ว = คงไว้ · ยังไม่มียอด = 0 (เฉพาะวันทำงานที่ถึงแล้ว)
                        if (old != null || !wd.Contains(k.Day) || mon.AddDays(k.Day - 1) > today) continue;
                        st = "ZERO"; v = 0;
                    }
                    var date = mon.AddDays(k.Day - 1);
                    items.Add(new PvCell($"{mc.Dept} · {mc.Code} · {Items[k.F]}", date.ToString("dd MMM yyyy (ddd)", Inv), st, old, v,
                                         mc.Sort * 100000 + (int)(mon.Year * 12 + mon.Month) % 1000 * 100 + k.Day));
                    if (st != "SAME") changes.Add(new ActChange(mc.Id, mon, k.Day, k.F, v));
                }
            }
            string id = _uploads.Put("", file.FileName, Uid, "ppact", changes);
            string months = string.Join(", ", cells.Keys.Select(k => k.M).Distinct().OrderBy(x => x).Select(x => x.ToString("MMM yyyy", Inv)));
            return Ok(Summary(id, file.FileName, $"M/C ACTUAL · {months}", items, errors, unknown, rounded));
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("actual/import/apply")]
    public IActionResult ActualApply([FromBody] string id)
    {
        if (Me?.CanEditPpCapacity != true) return Deny("คุณไม่มีสิทธิ์บันทึก Actual (CAPACITY › EDIT)");
        var it = _uploads.Get(id, Uid, "ppact");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var changes = (List<ActChange>)it.State;
        try
        {
            int days = 0;
            var codes = new SortedSet<string>();
            foreach (var g in changes.GroupBy(x => (x.Mid, x.Month)))
            {
                // อ่านยอดล่าสุดอีกรอบ แล้วแก้เฉพาะช่องที่เปลี่ยน (ช่องอื่นของวันเดียวกันคงเดิม)
                var cur = _svc.Actuals(new[] { g.Key.Mid }, g.Key.Month).GroupBy(a => a.Day).ToDictionary(x => x.Key, x => x.First());
                var cells = g.GroupBy(x => x.Day).Select(dg =>
                {
                    cur.TryGetValue(dg.Key, out var a);
                    decimal? h = a?.Hr, s = a?.Stroke, mn = a?.Man;
                    foreach (var x in dg) { if (x.F == 0) h = x.V; else if (x.F == 1) s = x.V; else mn = x.V; }
                    return new ProductionPlanService.ActualCell(dg.Key, h, s, mn);
                }).ToList();
                days += _svc.SaveActual(g.Key.Mid, g.Key.Month, cells, Uid);
                codes.Add($"{_svc.MachineCode(g.Key.Mid)} {g.Key.Month:MM/yyyy}");
            }
            _uploads.Remove(id);
            LogService.WriteLog(Uid, "PP_ACTUAL_IMPORT", $"File: {it.FileName} | Cells: {changes.Count} | Days: {days} | {string.Join(", ", codes.Take(30))}{(codes.Count > 30 ? " …" : "")}", "PP-ACTUAL-IMPORT");
            LiveBus.Publish("pp");
            return Ok(new { message = $"นำเข้า Actual แล้ว {changes.Count:N0} ช่อง ({codes.Count:N0} เครื่อง-เดือน)" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }

    // ================================================================ WORKLOAD › Current (คนที่มีจริง)
    [HttpGet("workload/current/template")]
    public IActionResult CurrentTemplate(string month)
    {
        if (Me?.CanViewPpCapacity != true) return Deny();
        if (!DbSchema.HasPpWorkload) return Fail("ฐานข้อมูลยังไม่มีตาราง Workload");
        var m = Mon(month);
        try
        {
            var heads = _svc.Heads(m).ToDictionary(h => h.Row, StringComparer.OrdinalIgnoreCase);
            string mk = m.ToString("yyyy-MM", Inv);
            string[] hd = { "NO", "MONTH", "CODE", "แผนก", "หน่วยงาน", "DIRECT", "IND1", "IND2" };
            using var wb = new XLWorkbook();
            var ws = wb.AddWorksheet("CURRENT");
            ImportTemplateService.Header(ws, hd, new double[] { 6, 10, 12, 32, 26, 12, 12, 12 });
            int r = 2;
            foreach (var (key, grp, name) in PpExcelController.WlRows)
            {
                ws.Cell(r, 1).Value = r - 1;
                ws.Cell(r, 2).Value = mk;
                ws.Cell(r, 3).Value = key;
                ws.Cell(r, 4).Value = grp;
                ws.Cell(r, 5).Value = name;
                if (heads.TryGetValue(key, out var h))
                {
                    if (h.Direct != null) ws.Cell(r, 6).Value = h.Direct.Value;
                    if (h.Ind1 != null) ws.Cell(r, 7).Value = h.Ind1.Value;
                    if (h.Ind2 != null) ws.Cell(r, 8).Value = h.Ind2.Value;
                }
                r++;
            }
            int last = r - 1;
            ImportTemplateService.Body(ws, last, hd.Length);
            ws.Range(2, 2, last, 2).Style.NumberFormat.Format = "@";
            ws.Range(2, 4, last, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            var input = ws.Range(2, 6, last, 8);
            input.Style.NumberFormat.Format = "#,##0.##";
            input.Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
            ImportTemplateService.Guide(wb, $"CHR-Nexus - PRODUCTION PLAN › WORKLOAD › Current ({m.ToString("MMM", Inv)}) คนที่มีจริง (IMPORT) • {m.ToString("MMMM yyyy", Inv).ToUpperInvariant()}", new[]
            {
                ("MONTH / CODE", "ใส่ให้แล้ว ห้ามแก้ (ระบบใช้จับคู่หน่วยงานและเดือน) · MONTH = ปี-เดือน เช่น " + mk),
                ("DIRECT / IND1 / IND2", "จำนวนคนที่มีจริงของเดือน (ช่องสีเหลือง) · 0 - 9,999 · ทศนิยมได้ 2 ตำแหน่ง (เกินจะปัด)"),
                ("ยอดเท่าเดิม", "ไม่แตะ"),
                ("ยอดต่างจากในระบบ", "อัพเดทเป็นยอดใหม่ (หน้าพรีวิวแสดงยอดเดิม → ยอดใหม่ ก่อนกด IMPORT)"),
                ("ช่องว่าง", "มียอดอยู่แล้ว = คงยอดเดิม · ยังไม่มียอด = ใส่ 0 ให้"),
                ("พิมพ์ 0", "เปลี่ยนยอดเป็น 0"),
                ("Link สูตร / Copy วาง", "ใช้ได้ · ระบบอ่านค่าที่ Excel คำนวณไว้ตอน Save → เปิดไฟล์ใน Excel ให้ Link อัพเดทก่อน แล้ว Save ปิด แล้วค่อย IMPORT"),
                ("Link ช่องว่าง", "สูตร =ไฟล์อื่น!A1 ที่ต้นทางว่างจะได้ 0 (= เปลี่ยนเป็น 0) · ถ้าอยากให้ว่าง ใช้ =IF(ต้นทาง=\"\",\"\",ต้นทาง)"),
                ("สูตร Error", "#REF! / #N/A / #VALUE! … ระบบแจ้งในการ์ด ข้อผิดพลาด แล้วข้ามช่องนั้น"),
                ("", "กรอกในชีท CURRENT (ชีทแรก) แล้วกด IMPORT CURRENT ในหน้า PRODUCTION PLAN › CAPACITY › WORKLOAD"),
            });
            wb.Worksheet(1).SetTabActive();
            LogService.WriteLog(Uid, "PP_WORKLOAD_CURRENT_TEMPLATE", $"{m:MM/yyyy}", "");
            return File(Bytes(wb), XlsxType, $"WORKLOAD_CURRENT_{m:yyyy-MM}.xlsx");
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }

    [HttpPost("workload/current/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> CurrentImport(IFormFile file)
    {
        if (Me?.CanEditPpCapacity != true) return Deny("คุณไม่มีสิทธิ์บันทึกคนที่มีจริง (CAPACITY › EDIT)");
        if (!DbSchema.HasPpWorkload) return Fail("ฐานข้อมูลยังไม่มีตาราง Workload");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            var errors = new List<PvError>();
            var unknown = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            int rounded = 0;
            var rows = PpExcelController.WlRows;
            var byName = rows.ToDictionary(x => Norm(x.Name), x => x.Key);
            var cells = new Dictionary<(DateTime M, string Row, int F), (bool Blank, decimal V)>();
            using (var wb = new XLWorkbook(path))
            {
                var ws = wb.Worksheets.First();
                var (hr, cols) = FindHead(ws, "DIRECT");
                if (hr == 0 || !cols.ContainsKey("MONTH"))
                    throw new InvalidOperationException("ไม่ใช่ไฟล์ Template CURRENT (ไม่พบหัวคอลัมน์ MONTH / DIRECT) · ดาวน์โหลด CURRENT TEMPLATE จากหน้า Workload");
                cols.TryGetValue("CODE", out int cCode);
                cols.TryGetValue("หน่วยงาน", out int cName);
                var fcols = WlFields.Select(f => cols.TryGetValue(f, out int c) ? c : 0).ToArray();
                int last = ws.LastRowUsed()?.RowNumber() ?? hr;
                for (int r = hr + 1; r <= last; r++)
                {
                    string code = cCode > 0 ? Norm(ws.Cell(r, cCode).GetString()) : "";
                    string name = cName > 0 ? Norm(ws.Cell(r, cName).GetString()) : "";
                    if (code == "" && name == "") continue;
                    string key = rows.Any(x => x.Key == code) ? code : byName.TryGetValue(name, out var k) ? k : null;
                    if (key == null) { unknown.Add(code != "" ? code : name); continue; }
                    var mon = MonthOf(ws.Cell(r, cols["MONTH"]));
                    if (mon == null) { errors.Add(new($"แถว {r}", $"{key}: MONTH ไม่ถูกต้อง ({ws.Cell(r, cols["MONTH"]).GetString()}) · ใช้รูปแบบ 2026-11")); continue; }
                    for (int f = 0; f < 3; f++)
                    {
                        if (fcols[f] == 0) continue;
                        var c = ws.Cell(r, fcols[f]);
                        var (blank, v, err) = Read(c);
                        string at = c.Address.ToString();
                        if (err != null) { errors.Add(new(at, $"{key} · {WlFields[f]}: {err}")); continue; }
                        if (!blank)
                        {
                            var rv = Math.Round(v, 2, MidpointRounding.AwayFromZero);
                            if (rv != v) rounded++;
                            v = rv;
                            if (v is < 0 or > 9999) { errors.Add(new(at, $"{key} · {WlFields[f]}: จำนวนคนต้องอยู่ระหว่าง 0 - 9,999 ({N(v)})")); continue; }
                        }
                        cells[(mon.Value, key, f)] = (blank, v);
                    }
                }
            }
            TryDelete(path);
            if (cells.Count == 0 && errors.Count == 0 && unknown.Count == 0) throw new InvalidOperationException("ไม่พบแถวข้อมูลในไฟล์");

            var items = new List<PvCell>();
            var changes = new List<WlChange>();
            foreach (var grp in cells.GroupBy(x => x.Key.M))
            {
                var mon = grp.Key;
                var cur = _svc.Heads(mon).ToDictionary(h => h.Row, StringComparer.OrdinalIgnoreCase);
                foreach (var (k, val) in grp)
                {
                    cur.TryGetValue(k.Row, out var h);
                    decimal? old = h == null ? null : k.F == 0 ? h.Direct : k.F == 1 ? h.Ind1 : h.Ind2;
                    decimal v = val.V;
                    string st;
                    if (!val.Blank) st = St(old, v);
                    else if (old != null) continue;
                    else { st = "ZERO"; v = 0; }
                    int ri = Array.FindIndex(rows, x => x.Key == k.Row);
                    items.Add(new PvCell(rows[ri].Name, $"{WlFields[k.F]} · {mon.ToString("MMM yyyy", Inv)}", st, old, v, (mon.Year * 12 + mon.Month) % 1000 * 100 + ri * 3 + k.F));
                    if (st != "SAME") changes.Add(new WlChange(mon, k.Row, k.F, v));
                }
            }
            string id = _uploads.Put("", file.FileName, Uid, "ppwlcur", changes);
            string months = string.Join(", ", cells.Keys.Select(k => k.M).Distinct().OrderBy(x => x).Select(x => x.ToString("MMM yyyy", Inv)));
            return Ok(Summary(id, file.FileName, $"WORKLOAD CURRENT · {months}", items, errors, unknown, rounded));
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("workload/current/import/apply")]
    public IActionResult CurrentApply([FromBody] string id)
    {
        if (Me?.CanEditPpCapacity != true) return Deny("คุณไม่มีสิทธิ์บันทึกคนที่มีจริง (CAPACITY › EDIT)");
        var it = _uploads.Get(id, Uid, "ppwlcur");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var changes = (List<WlChange>)it.State;
        try
        {
            foreach (var g in changes.GroupBy(x => x.Month))
            {
                var cur = _svc.Heads(g.Key).ToDictionary(h => h.Row, StringComparer.OrdinalIgnoreCase);
                var cells = g.GroupBy(x => x.Row).Select(rg =>
                {
                    cur.TryGetValue(rg.Key, out var h);
                    decimal? d = h?.Direct, i1 = h?.Ind1, i2 = h?.Ind2;
                    foreach (var x in rg) { if (x.F == 0) d = x.V; else if (x.F == 1) i1 = x.V; else i2 = x.V; }
                    return new ProductionPlanService.WlCell(rg.Key, d, i1, i2);
                }).ToList();
                _svc.SaveHeads(g.Key, cells, Uid);
            }
            _uploads.Remove(id);
            string detail = string.Join(" | ", changes.Select(x => $"{x.Month:MM/yyyy} {x.Row} {WlFields[x.F]} {N(x.V)}").Take(40));
            LogService.WriteLog(Uid, "PP_WORKLOAD_CURRENT_IMPORT", $"File: {it.FileName} | Cells: {changes.Count} | {detail}", "PP-WL-CURRENT-IMPORT");
            LiveBus.Publish("pp");
            return Ok(new { message = $"นำเข้าคนที่มีจริงแล้ว {changes.Count:N0} ช่อง" });
        }
        catch (InvalidOperationException ex) { return Fail(ex.Message); }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }
}
