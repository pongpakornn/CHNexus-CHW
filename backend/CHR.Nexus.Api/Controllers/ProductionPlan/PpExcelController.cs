using System.Globalization;
using CHR.Nexus.Api.Web;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Nexus.Helpers;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 📄 PRODUCTION PLAN › TEMPLATE / IMPORT (Excel)
//   CAPACITY: PCS ของเดือน ทุกแถว Product ของหน่วยงาน -> กรอก PCS ตามไฟล์ Capacity ของหน่วยงาน -> IMPORT = ตั้ง PCS เดือนนั้น (ป้าย M)
//     ช่อง PCS ว่าง / เท่ากับยอด AUTO (Order / Forecast) = ใช้ยอด AUTO (ไม่ต้องกำหนดเอง) · เขียนผ่าน SetPcs เดิม (สิทธิ์แก้ STD · Log)
//   WORKLOAD: ชีท "9. ManPower" (หัวเดือน N-1 … N+3 · PDT / Direct / Production) -> IMPORT WORK LOAD EXCEL ตัวเดิมอ่านได้ทันที
[Route("api/pp")]
public sealed class PpExcelController : AppController
{
    private readonly ProductionPlanService _svc = new();
    private readonly UploadCache _uploads;
    public PpExcelController(UploadCache uploads) => _uploads = uploads;
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private static DateTime Mon(string m) =>
        DateTime.TryParseExact((m ?? "") + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

    private static void Head(IXLRange r, string hex)
    {
        r.Style.Font.Bold = true; r.Style.Font.FontColor = XLColor.White; r.Style.Fill.BackgroundColor = XLColor.FromHtml(hex);
        r.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center; r.Style.Alignment.WrapText = true;
    }
    private static byte[] Bytes(XLWorkbook wb)
    {
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ---------------------------------------------------------------- CAPACITY › PCS
    [HttpGet("pcs/template")]
    public IActionResult PcsTemplate(string dept, string month)
    {
        if (Me?.CanViewPpCapacity != true) return Deny();
        if (!DbSchema.HasProductionPlan) return Fail("ฐานข้อมูลยังไม่มี Production Plan");
        string d = ProductionPlanService.Dept(dept);
        var m = Mon(month);
        try
        {
            var rows = _svc.DeptParts(d, m);
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("PCS");
            ws.Cell(1, 1).Value = $"PCS TEMPLATE • {d} • {m.ToString("MMMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant()}";
            ws.Cell(1, 1).Style.Font.Bold = true; ws.Cell(1, 1).Style.Font.FontSize = 14;
            ws.Cell(2, 1).Value = "DEPT"; ws.Cell(2, 2).Value = d;
            ws.Cell(2, 3).Value = "MONTH"; ws.Cell(2, 4).Value = m.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            ws.Cell(2, 6).Value = "กรอก PCS ของเดือนในคอลัมน์ PCS (ใช้จริง) ตามไฟล์ Capacity ของหน่วยงาน · ว่าง = ใช้ยอด AUTO (Order / Forecast) · ห้ามแก้ ITEM ID / DEPT / MONTH";
            ws.Range(2, 1, 2, 4).Style.Font.Bold = true;
            ws.Cell(2, 6).Style.Font.FontColor = XLColor.FromHtml("#b45309");
            string[] h = { "ITEM ID", "MACHINE", "PART A", "PART B", "PD CODE", "CUSTOMER", "PRODUCT NAME", "TOTAL PROCESS", "PCS / STROKE", "PCS (AUTO)", "ที่มา", "PCS (ใช้จริง)" };
            for (int c = 0; c < h.Length; c++) ws.Cell(4, c + 1).Value = h[c];
            Head(ws.Range(4, 1, 4, h.Length), "#3f3f46");
            ws.Cell(4, 12).Style.Fill.BackgroundColor = XLColor.FromHtml("#b45309");
            int r = 5;
            foreach (var (mc, p) in rows)
            {
                ws.Cell(r, 1).Value = p.Id;
                ws.Cell(r, 2).Value = mc.Code;
                ws.Cell(r, 3).Value = p.PartA ?? "";
                ws.Cell(r, 4).Value = p.PartB ?? "";
                ws.Cell(r, 5).Value = p.PdCode ?? "";
                ws.Cell(r, 6).Value = p.Customer ?? "";
                ws.Cell(r, 7).Value = p.Name ?? "";
                ws.Cell(r, 8).Value = p.Tp;
                ws.Cell(r, 9).Value = p.Col;
                ws.Cell(r, 10).Value = p.PcsFrom == "MANUAL" ? p.PcsAuto ?? 0 : p.Pcs;
                ws.Cell(r, 11).Value = p.PcsFrom == "MANUAL" ? "กำหนดเอง (M)" : p.PcsFrom == "" ? "ไม่มียอด" : p.PcsFrom;
                ws.Cell(r, 12).Value = p.Pcs;
                r++;
            }
            if (r > 5)
            {
                var all = ws.Range(4, 1, r - 1, h.Length);
                all.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; all.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                ws.Range(5, 1, r - 1, 1).Style.Font.FontColor = XLColor.FromHtml("#6b6680");
                ws.Range(5, 12, r - 1, 12).Style.Fill.BackgroundColor = XLColor.FromHtml("#fef3c7");
                ws.Range(5, 8, r - 1, 12).Style.NumberFormat.Format = "#,##0.##";
                all.SetAutoFilter();
            }
            ws.SheetView.FreezeRows(4);
            double[] w = { 9, 26, 14, 14, 10, 12, 40, 10, 10, 12, 14, 14 };
            for (int c = 0; c < w.Length; c++) ws.Column(c + 1).Width = w[c];
            LogService.WriteLog(Uid, "PP_PCS_TEMPLATE", $"{d} | {m:MM/yyyy} | Rows: {rows.Count}", "");
            return File(Bytes(wb), XlsxType, $"PCS_{d}_{m:yyyy-MM}.xlsx");
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }

    public sealed record PcsChange(int ItemId, string Label, decimal? Pcs);

    [HttpPost("pcs/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> PcsImport(IFormFile file)
    {
        if (Me?.CanEditPpSetup != true) return Deny("คุณไม่มีสิทธิ์แก้ PCS (Production Plan STD › EDIT)");
        if (!DbSchema.HasPpPcsOverride) return Fail("ฐานข้อมูลยังไม่มีตาราง PCS (database/nexus/39_Production_Plan_Pcs_Override_Forecast_Summary.sql)");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        try
        {
            string d;
            DateTime m;
            var want = new Dictionary<int, decimal?>();
            using (var wb = new XLWorkbook(path))
            {
                var ws = wb.Worksheets.First();
                d = ws.Cell(2, 2).GetString().Trim().ToUpperInvariant();
                string ms = ws.Cell(2, 4).GetString().Trim();
                if (d.Length == 0 || !DateTime.TryParseExact(ms + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out m))
                    throw new InvalidOperationException("ไม่ใช่ไฟล์ Template PCS (ไม่พบ DEPT / MONTH ที่แถว 2) · ดาวน์โหลด TEMPLATE จากหน้า Capacity");
                if (!ws.Cell(4, 1).GetString().Trim().Equals("ITEM ID", StringComparison.OrdinalIgnoreCase) || !ws.Cell(4, 12).GetString().Contains("PCS"))
                    throw new InvalidOperationException("ไม่ใช่ไฟล์ Template PCS (หัวตารางแถว 4 ไม่ตรง)");
                int last = ws.LastRowUsed()?.RowNumber() ?? 4;
                for (int r = 5; r <= last; r++)
                {
                    var idc = ws.Cell(r, 1);
                    if (idc.IsEmpty() || !int.TryParse(idc.GetString().Trim(), out int id)) continue;
                    var pc = ws.Cell(r, 12);
                    decimal? v = null;
                    if (!pc.IsEmpty())
                    {
                        var cv = pc.HasFormula ? pc.CachedValue : pc.Value;
                        if (cv.IsNumber) v = (decimal)cv.GetNumber();
                        else if (decimal.TryParse(pc.GetString().Replace(",", "").Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var t)) v = t;
                        else throw new InvalidOperationException($"แถว {r}: PCS ไม่ใช่ตัวเลข ({pc.GetString()})");
                        if (v < 0 || v > 99_999_999) throw new InvalidOperationException($"แถว {r}: PCS ต้องอยู่ระหว่าง 0 - 99,999,999");
                    }
                    want[id] = v;
                }
            }
            TryDelete(path);
            var cur = _svc.DeptParts(d, m).ToDictionary(x => x.Part.Id);
            var changes = new List<PcsChange>();
            int same = 0, unknown = 0, toAuto = 0, toSet = 0;
            foreach (var (id, v) in want)
            {
                if (!cur.TryGetValue(id, out var x)) { unknown++; continue; }
                var p = x.Part;
                decimal auto = p.PcsFrom == "MANUAL" ? p.PcsAuto ?? 0 : p.Pcs;
                bool manual = p.PcsFrom == "MANUAL";
                // ว่าง / เท่ากับยอด AUTO = ใช้ยอด AUTO (ไม่ต้องกำหนดเอง)
                decimal? target = v == null || v.Value == auto ? null : v;
                string label = $"{x.Machine.Code} | {p.PartA}";
                if (target == null) { if (manual) { changes.Add(new PcsChange(id, label, null)); toAuto++; } else same++; }
                else if (manual && p.Pcs == target.Value) same++;
                else { changes.Add(new PcsChange(id, label, target)); toSet++; }
            }
            if (want.Count == 0) throw new InvalidOperationException("ไม่พบแถวที่มี ITEM ID ในไฟล์");
            string list = string.Join("\n", changes.Take(10).Select(c => $"• {c.Label}: {(c.Pcs == null ? "AUTO" : c.Pcs.Value.ToString("#,##0.##"))}")) + (changes.Count > 10 ? $"\n• … และอีก {changes.Count - 10:N0} แถว" : "");
            string summary = $"ไฟล์: {file.FileName}\n{d} · {m:MMMM yyyy}\n\n" +
                             $"✏ ตั้ง PCS (M) {toSet:N0} แถว · ↺ กลับไปใช้ยอด AUTO {toAuto:N0} แถว · ✔ เท่าเดิม {same:N0} แถว" +
                             (unknown > 0 ? $"\n⚠ ITEM ID ที่ไม่มีในหน่วยงานนี้แล้ว {unknown:N0} แถว (ข้าม)" : "") +
                             (changes.Count > 0 ? "\n\n" + list : "\n\nไม่มี PCS ที่ต้องเปลี่ยน") + "\n\nยืนยันการนำเข้าหรือไม่?";
            return Ok(new { id = _uploads.Put("", file.FileName, Uid, "pppcs", (d, m, changes)), summary, count = changes.Count });
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ไม่สำเร็จ"); }
    }

    [HttpPost("pcs/import/apply")]
    public IActionResult PcsImportApply([FromBody] string id)
    {
        if (Me?.CanEditPpSetup != true) return Deny("คุณไม่มีสิทธิ์แก้ PCS (Production Plan STD › EDIT)");
        var it = _uploads.Get(id, Uid, "pppcs");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var (d, m, changes) = ((string, DateTime, List<PcsChange>))it.State;
        try
        {
            foreach (var c in changes) _svc.SetPcs(m, c.ItemId, c.Pcs, Uid);
            _uploads.Remove(id);
            int set = changes.Count(c => c.Pcs != null), auto = changes.Count - set;
            LogService.WriteLog(Uid, "PP_PCS_IMPORT", $"File: {it.FileName} | {d} | {m:MM/yyyy} | Set: {set} | Back to AUTO: {auto}", $"PP-PCS-{d}-{m:yyyyMM}");
            LiveBus.Publish("pp");
            return Ok(new { message = $"นำเข้า PCS {d} {m:MMM yyyy} แล้ว\nตั้ง PCS (M) {set:N0} แถว · กลับไปใช้ AUTO {auto:N0} แถว" });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- WORKLOAD
    internal static readonly (string Key, string Grp, string Name)[] WlRows =
    {
        ("TPS", "แผนกบริหารการผลิตและโลจิสติกส์", "วางแผนการผลิตและTPS"),
        ("DELIVERY", "", "จัดส่งและส่งมอบ"),
        ("QA", "แผนกบริหารคุณภาพ", "ประกันคุณภาพและมาตรฐาน"),
        ("QC", "", "ควบคุมคุณภาพ"),
        ("PRESS1", "แผนกผลิต 1", "ปั๊ม 1"),
        ("PRESS2", "", "ปั๊ม 2"),
        ("ASSEMBLY", "", "ประกอบ"),
        ("DIE", "", "บำรุงรักษาแม่พิมพ์"),
        ("PIPEPART", "แผนกผลิต 2", "ชิ้นส่วนท่อ"),
        ("PIPEASSY", "", "ประกอบท่อ"),
        ("PAINTPART", "", "ชิ้นส่วนสี"),
    };

    // ชีท "9. ManPower" แบบไฟล์ Work load: แถว 5 = หัวเดือน · แถว 7 = PDT / Direct (/ Production เดือน N-1) · แถว 8-18 = หน่วยงาน · ใส่ยอดที่ Import ไว้แล้วให้
    [HttpGet("workload/template")]
    public IActionResult WorkloadTemplate(string month)
    {
        if (Me?.CanViewPpCapacity != true) return Deny();
        if (!DbSchema.HasPpWorkloadRef) return Fail("ฐานข้อมูลยังไม่มีตาราง ProductionPlan.WorkloadRef (database/nexus/41_Production_Plan_Workload_Excel.sql)");
        var n = Mon(month);
        try
        {
            var refs = ((IEnumerable<dynamic>)new WorkloadExcelService().Refs(n.AddMonths(-1), n.AddMonths(3)))
                       .ToDictionary(x => $"{(string)x.month}|{(string)x.row}", x => x);
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add($"9. ManPower {n.ToString("MMM yyyy", CultureInfo.InvariantCulture)}");
            ws.Cell(1, 1).Value = $"WORK LOAD TEMPLATE • {n.ToString("MMMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant()} (N)";
            ws.Cell(1, 1).Style.Font.Bold = true; ws.Cell(1, 1).Style.Font.FontSize = 14;
            ws.Cell(2, 1).Value = "กรอก PDT / Direct (และ Production ของเดือน N-1) ตามไฟล์ Work load แล้ว IMPORT WORK LOAD EXCEL · แถวที่ว่างทั้งแถว = ไม่แตะยอดเดิม";
            ws.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#b45309");
            ws.Cell(5, 1).Value = n.Year.ToString(CultureInfo.InvariantCulture);
            ws.Cell(7, 1).Value = "แผนก"; ws.Cell(7, 2).Value = "หน่วยงาน";
            int col = 3;
            for (int i = -1; i <= 3; i++)
            {
                var m = n.AddMonths(i);
                string tag = i < 0 ? "N-1" : i == 0 ? "N" : $"N+{i}";
                var fields = i < 0 ? new[] { "PDT", "Direct", "Production" } : new[] { "PDT", "Direct" };
                ws.Cell(5, col).Value = $"{m.ToString("MMMM yyyy", CultureInfo.InvariantCulture)} ({tag})";
                ws.Range(5, col, 5, col + fields.Length - 1).Merge();
                Head(ws.Range(5, col, 5, col + fields.Length - 1), i == 0 ? "#4c1d95" : "#3f3f46");
                ws.Cell(6, col).Value = "Plan";
                ws.Range(6, col, 6, col + fields.Length - 1).Merge();
                for (int f = 0; f < fields.Length; f++)
                {
                    ws.Cell(7, col + f).Value = fields[f];
                    string mk = m.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                    for (int r = 0; r < WlRows.Length; r++)
                    {
                        if (!refs.TryGetValue($"{mk}|{WlRows[r].Key}", out var x)) continue;
                        decimal? v = fields[f] == "PDT" ? (decimal?)x.pdt : fields[f] == "Direct" ? (decimal?)x.direct : (decimal?)x.production;
                        if (v != null) ws.Cell(8 + r, col + f).Value = v.Value;
                    }
                }
                col += fields.Length;
            }
            Head(ws.Range(6, 3, 7, col - 1), "#52525b");
            Head(ws.Range(7, 1, 7, 2), "#52525b");
            for (int r = 0; r < WlRows.Length; r++)
            {
                ws.Cell(8 + r, 1).Value = WlRows[r].Grp;
                ws.Cell(8 + r, 2).Value = WlRows[r].Name;
            }
            ws.Cell(8 + WlRows.Length, 1).Value = "Total";
            for (int c = 3; c < col; c++)
                ws.Cell(8 + WlRows.Length, c).FormulaA1 = $"SUM({ws.Cell(8, c).Address}:{ws.Cell(7 + WlRows.Length, c).Address})";
            var body = ws.Range(5, 1, 8 + WlRows.Length, col - 1);
            body.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; body.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            ws.Range(8, 3, 8 + WlRows.Length, col - 1).Style.NumberFormat.Format = "#,##0.##";
            ws.Range(8 + WlRows.Length, 1, 8 + WlRows.Length, col - 1).Style.Font.Bold = true;
            ws.Column(1).Width = 30; ws.Column(2).Width = 24;
            for (int c = 3; c < col; c++) ws.Column(c).Width = 13;
            ws.SheetView.FreezeColumns(2);
            LogService.WriteLog(Uid, "PP_WORKLOAD_TEMPLATE", $"{n:MM/yyyy}", "");
            return File(Bytes(wb), XlsxType, $"Workload_Template_{n:yyyy-MM}.xlsx");
        }
        catch (Exception ex) { return Fail(ex, "สร้าง Template ไม่สำเร็จ"); }
    }
}
