using System.Globalization;
using System.Text.RegularExpressions;
using CHR.Nexus.Api.Web;
using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;
using Nexus.Services;

namespace CHR.Nexus.Api.Controllers;

// 📂 FORECAST FILE (MASTER DATA › Forecast / Order › FORECAST FILE): เลือกไฟล์ FORECAST ของฝ่ายขายทั้งไฟล์ -> กรองในหน้าเว็บ -> IMPORT ได้เลย
//   แทนการกรองด้วย Forecast_Order_Filter.html แล้วทำไฟล์ Excel ไป Import · เงื่อนไข Import เดิมทุกข้อ (ตรวจด้วย PART A · ยอดเดิมตรงกัน = ข้าม · ยอดเปลี่ยน = ใช้ยอดใหม่)
//   read     = อ่านไฟล์ (เก็บไฟล์ไว้ 30 นาที ใช้อัพเดทกราฟ DIFF (2) / (3) ตอน IMPORT)
//   preview  = แยก ใหม่ / ยอดเปลี่ยน (เดิม -> ใหม่) / ยอดเดิมตรงกัน / ไม่มีในระบบ (+ PART A ที่ใกล้เคียง เช่น เว้นวรรคเกิน)
//   check    = ตรวจ Product ที่จะเพิ่มใหม่อีกครั้งก่อน IMPORT (มีคนเพิ่มไปแล้ว = ไม่สร้างซ้ำ)
//   apply    = บันทึกยอด (Product ใหม่เพิ่มผ่าน POST /api/products ก่อนเรียกตัวนี้ = สิทธิ์ / Log ของ Product Control เดิม)
//   export   = Excel ตามที่กรอง (คอลัมน์แบบ Template FORECAST ORDER)
[Route("api/forecast/file")]
public sealed class ForecastFileController : AppController
{
    private readonly UploadCache _uploads;
    public ForecastFileController(UploadCache uploads) => _uploads = uploads;
    private const string Kind = "fcfile";

    public sealed class FileRow
    {
        public string Sheet { get; set; }
        public string Customer { get; set; }
        public string PartA { get; set; }
        public string PartNo { get; set; }
        public string Name { get; set; }
        public int Month { get; set; }
        public decimal? F { get; set; }
        public decimal? O { get; set; }
        public decimal? D { get; set; }
    }
    public sealed class PreviewReq { public int Year { get; set; } public List<FileRow> Rows { get; set; } }
    public sealed class ApplyReq { public int Year { get; set; } public bool WithCalc { get; set; } public List<FileRow> Rows { get; set; } public string FileId { get; set; } public bool Summary { get; set; } }

    // กลุ่มของรายการที่หาไม่ได้: PART A (ตัวพิมพ์ใหญ่) · ไม่มี PART A = ชีท + PART NO (ตรงกับ keyOf ในหน้าเว็บ)
    private static string KeyOf(FileRow r)
    {
        string a = (r.PartA ?? "").Trim();
        return a.Length > 0 ? a.ToUpperInvariant() : "#" + (r.Sheet ?? "") + "|" + (r.PartNo ?? "").Trim();
    }

    private static string Norm(string s) => Regex.Replace(s ?? "", @"\s+", "").ToUpperInvariant();
    private static string Alnum(string s) => Regex.Replace(s ?? "", @"[^A-Za-z0-9ก-๙]", "").ToUpperInvariant();

    // แถวจากหน้าเว็บ -> แถว Import เดิม (ช่องว่าง = 0 เหมือน Import Excel)
    private static List<CalcImportRow> Build(int year, List<FileRow> rows)
    {
        var list = new List<CalcImportRow>();
        int n = 0;
        foreach (var r in rows ?? new())
        {
            n++;
            string pa = (r.PartA ?? "").Trim();
            var it = new CalcImportRow { RowNumber = n, Customer = (r.Customer ?? "").Trim(), PartA = pa, Part = pa, PartName = (r.Name ?? "").Trim() };
            if (pa.Length == 0) it.Error = "ไม่มี PART A";
            else if (r.Month < 1 || r.Month > 12) it.Error = "เดือนไม่ถูกต้อง";
            else
            {
                it.Month = new DateTime(year, r.Month, 1);
                it.Forecast = r.F ?? 0; it.Order = r.O ?? 0; it.Delivery = r.D ?? 0;
                if (it.Forecast < 0 || it.Order < 0 || it.Delivery < 0) it.Error = "จำนวนติดลบ";
            }
            list.Add(it);
        }
        return list;
    }

    private sealed record Prod(int PartID, string PartCode, string PartA, string PartB, string PartNumber, string Description, string Customer, string Category);
    private static List<Prod> Products()
    {
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        return c.Query<Prod>(@"SELECT PartID, LTRIM(RTRIM(ISNULL(PartCode, ''))) AS PartCode, LTRIM(RTRIM(PartA)) AS PartA, LTRIM(RTRIM(ISNULL(PartB, ''))) AS PartB,
                                      LTRIM(RTRIM(ISNULL(PartNumber, ''))) AS PartNumber, LTRIM(RTRIM(ISNULL(Description, ''))) AS Description,
                                      LTRIM(RTRIM(ISNULL(Customer, ''))) AS Customer, LTRIM(RTRIM(ISNULL(Category, ''))) AS Category
                               FROM Nexus.Parts WHERE ISNULL(LTRIM(RTRIM(PartA)), '') <> ''").ToList();
    }
    private static object ProdDto(Prod p) => new { ptId = p.PartID, partCode = p.PartCode, partA = p.PartA, partB = p.PartB, partNo = p.PartNumber, name = p.Description, customer = p.Customer };

    private bool Can => Me?.CanImportForecastOrder == true;

    [HttpPost("read")]
    [RequestSizeLimit(60_000_000)]
    public async Task<IActionResult> Read(IFormFile file)
    {
        if (!Can) return Deny();
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex); }
        try
        {
            var r = new ForecastFileService().Read(path);
            string id = _uploads.Put(path, file.FileName, Uid, Kind, r.Year);
            return Ok(new
            {
                id, fileName = file.FileName, r.Year, r.Skipped,
                sheets = r.Sheets.Select(s => new { s.Name, s.Customer, s.Months, parts = s.Parts }),
                @ref = r.Ref
            });
        }
        catch (InvalidOperationException ex) { TryDelete(path); return Fail(ex.Message); }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ FORECAST ไม่สำเร็จ"); }
    }

    [HttpPost("preview")]
    public IActionResult Preview([FromBody] PreviewReq req)
    {
        if (!Can) return Deny();
        if (req == null || req.Year < 2000 || req.Year > 2100) return Fail("ปีไม่ถูกต้อง");
        if (req.Rows == null || req.Rows.Count == 0) return Fail("ยังไม่มีรายการที่จะนำเข้า (เลือกลูกค้า / เดือน)");
        if (req.Rows.Count > 100_000) return Fail("รายการมากเกินไป (เกิน 100,000 แถว) ลองเลือกเดือนให้น้อยลง");
        try
        {
            var rows = Build(req.Year, req.Rows);
            var calc = new MaxMinCalcService();
            calc.MatchForecastRows(rows);
            var detail = calc.ForecastDetail(rows);
            var prods = Products();
            var byA = prods.GroupBy(p => p.PartA, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
            string Mon(DateTime m) => m.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            var items = detail.Select(d =>
            {
                byA.TryGetValue(d.PartA ?? "", out var p);
                return new { status = d.Status, customer = d.Customer, partA = d.PartA, partB = p?.PartB ?? "", partNo = p?.PartNumber ?? "", name = p?.Description ?? "", month = Mon(d.Month), f = d.F, o = d.O, d = d.D, oldF = d.OldF, oldO = d.OldO, oldD = d.OldD };
            }).OrderBy(x => x.status == "CHANGED" ? 0 : x.status == "NEW" ? 1 : 2).ThenBy(x => x.customer).ThenBy(x => x.partA).ThenBy(x => x.month).ToList();

            // ❗ ไม่มีในระบบ / หาไม่ได้: รวมตาม PART A ในไฟล์ + PART A ในระบบที่ใกล้เคียง (เว้นวรรค / ตัวพิมพ์ / ขีด / PART NO ตรงกัน)
            var bad = req.Rows.Select((r, i) => (r, it: rows[i])).Where(x => !x.it.IsValid).ToList();
            var missing = bad.GroupBy(x => KeyOf(x.r)).Select(g =>
            {
                var f = g.First();
                string err = f.it.Error ?? "";
                string kind = err.StartsWith("ไม่พบ PART A") ? "NOT_FOUND" : err.Contains("ไม่มี CUSTOMER") ? "NO_CUSTOMER" : err.Contains("หลายสินค้า") ? "MULTI" : err == "ไม่มี PART A" ? "NO_PART_A" : "INVALID";
                string a = (f.r.PartA ?? "").Trim(), na = Norm(a), aa = Alnum(a), pn = Alnum(f.r.PartNo);
                var sug = (kind == "NOT_FOUND" && a.Length > 0) || (kind == "NO_PART_A" && pn.Length >= 4)
                    ? prods.Where(p => Norm(p.PartA) == na || Alnum(p.PartA) == aa || (pn.Length >= 4 && Alnum(p.PartNumber) == pn))
                           .OrderBy(p => Norm(p.PartA) == na ? 0 : Alnum(p.PartA) == aa ? 1 : 2).Take(6).Select(ProdDto).ToList()
                    : kind == "MULTI" || kind == "NO_CUSTOMER" ? prods.Where(p => string.Equals(p.PartA, a, StringComparison.OrdinalIgnoreCase)).Take(6).Select(ProdDto).ToList() : new List<object>();
                return new
                {
                    key = g.Key, partA = a, kind, reason = err, sheet = f.r.Sheet ?? "", customer = (f.r.Customer ?? "").Trim(), partNo = (f.r.PartNo ?? "").Trim(), name = (f.r.Name ?? "").Trim(),
                    months = g.Where(x => x.r.Month is >= 1 and <= 12).Select(x => x.r.Month).Distinct().OrderBy(x => x).ToList(),
                    rows = g.Count(), f = g.Sum(x => x.r.F ?? 0), o = g.Sum(x => x.r.O ?? 0), d = g.Sum(x => x.r.D ?? 0), suggest = sug
                };
            }).OrderBy(x => x.kind == "NOT_FOUND" ? 0 : 1).ThenBy(x => x.customer).ThenBy(x => x.partA).ToList();

            // ค่าเริ่มต้นตอนเพิ่ม Product ใหม่ = CATEGORY ที่ใช้มากที่สุดของสินค้าที่มี PART A
            string cat = prods.Where(p => p.Category.Length > 0).GroupBy(p => p.Category).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault() ?? "";
            return Ok(new
            {
                year = req.Year,
                counts = new { @new = items.Count(x => x.status == "NEW"), changed = items.Count(x => x.status == "CHANGED"), same = items.Count(x => x.status == "SAME"), missing = missing.Count, missingRows = bad.Count },
                items, missing, defaults = new { category = cat }
            });
        }
        catch (Exception ex) { return Fail(ex, "ตรวจรายการไม่สำเร็จ"); }
    }

    // ตรวจ PART A ที่จะเพิ่มใหม่อีกครั้ง (ตรงทั้งคำ ไม่สนตัวพิมพ์ / เว้นวรรคหัวท้าย)
    [HttpPost("check")]
    public IActionResult Check([FromBody] List<string> partAs)
    {
        if (!Can) return Deny();
        var want = (partAs ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var hit = Products().Where(p => want.Contains(p.PartA)).GroupBy(p => p.PartA, StringComparer.OrdinalIgnoreCase).Select(g => ProdDto(g.First())).ToList();
        return Ok(new { exists = hit });
    }

    [HttpPost("apply")]
    public IActionResult Apply([FromBody] ApplyReq req)
    {
        if (!Can) return Deny();
        if (req == null || req.Year < 2000 || req.Year > 2100) return Fail("ปีไม่ถูกต้อง");
        var rows = Build(req.Year, req.Rows);
        try
        {
            var calc = new MaxMinCalcService();
            calc.MatchForecastRows(rows);
            var valid = rows.Where(r => r.IsValid).ToList();
            int skipped = rows.Count - valid.Count;
            var it = string.IsNullOrEmpty(req.FileId) ? null : _uploads.Get(req.FileId, Uid, Kind);
            string file = it?.FileName ?? "-";
            string months = string.Join(", ", valid.Select(v => v.Month).Distinct().OrderBy(m => m).Select(m => m.ToString("MMM yyyy", CultureInfo.InvariantCulture)));
            string msg;
            if (valid.Count == 0) msg = "ไม่มีรายการที่นำเข้าได้";
            else
            {
                var m = calc.ApplyForecastMerge(valid, Uid);
                msg = $"นำเข้าแล้ว: ใหม่ {m.New:N0} • ยอดเปลี่ยน {m.Changed:N0} • ตรงกันเดิม (ข้าม) {m.Same:N0}" + (skipped > 0 ? $"\nข้ามรายการที่ไม่มีในระบบ {skipped:N0} แถว" : "");
                LogService.WriteLog(Uid, "FORECAST_IMPORT", $"File: {file} (FORECAST FILE · filtered in web) | New: {m.New} | Changed: {m.Changed} | Unchanged (skipped): {m.Same} | Rows written: {m.Rows} | Months: {months} | Not in system (skipped): {skipped}" +
                                                          (req.WithCalc ? "" : " | Import only (no MAX / MIN calculate)"), "");
                if (req.WithCalc && m.New + m.Changed > 0)
                {
                    var r = calc.Calculate(null, null, Uid);
                    if (r.Stocks > 0)
                    {
                        LogService.WriteLog(Uid, "MAXMIN_CALCULATE", $"Auto calculate after forecast import | Stocks: {r.Stocks} | Updated: {r.Updated} | Skipped (no order): {r.Skipped}", "");
                        msg += $"\nคำนวณ MAX / MIN อัตโนมัติ {r.Updated:N0} รายการ";
                    }
                }
                else msg += req.WithCalc ? "\nไม่มียอดเปลี่ยน - ไม่ต้องคำนวณ MAX / MIN ใหม่" : "\n(ไม่คำนวณ MAX / MIN)";
            }
            // 📊 กราฟ DIFF (2) / DIFF (3) จากไฟล์เดียวกัน
            if (req.Summary && DbSchema.HasForecastSummary)
            {
                if (it == null || !System.IO.File.Exists(it.Path)) msg += "\n⚠ ไฟล์หมดเวลาแล้ว - ไม่ได้อัพเดทกราฟ DIFF (2) / (3) (เลือกไฟล์ใหม่ถ้าต้องการ)";
                else
                    try
                    {
                        var svc = new ForecastSummaryService();
                        var p = svc.Read(it.Path, req.Year);
                        int n = svc.Save(p, Uid);
                        LogService.WriteLog(Uid, "FORECAST_SUMMARY_IMPORT", $"File: {file} (FORECAST FILE) | Year: {p.Year} | Rows: {n} | DIFF (3) Order: {p.Cells.Where(c => c.Key == "DIFF3").Sum(c => c.O):N0} | DIFF (2) Order: {p.Cells.Where(c => c.Key == "DIFF2").Sum(c => c.O):N0}", "");
                        msg += $"\nอัพเดทกราฟ DIFF (2) / DIFF (3) ปี {p.Year} แล้ว";
                    }
                    catch (Exception ex) { msg += "\n⚠ อัพเดทกราฟ DIFF (2) / (3) ไม่สำเร็จ: " + SafeMessage(ex); }
            }
            LiveBus.Publish("forecast");
            var last = valid.Count > 0 ? valid.Max(v => v.Month) : (DateTime?)null;
            return Ok(new { message = msg, month = last?.ToString("yyyy-MM", CultureInfo.InvariantCulture) });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ (ยกเลิกทั้งชุด)"); }
    }

    public sealed class ExportReq
    {
        public string FileName { get; set; }
        public bool Customer { get; set; }
        public bool F { get; set; } = true;
        public bool O { get; set; } = true;
        public bool D { get; set; } = true;
        public bool X { get; set; }
        public List<ExportRow> Rows { get; set; }
    }
    public sealed class ExportRow
    {
        public string Code { get; set; }
        public string CustName { get; set; }
        public string PartA { get; set; }
        public string PartNo { get; set; }
        public string Name { get; set; }
        public int Month { get; set; }
        public decimal? F { get; set; }
        public decimal? O { get; set; }
        public decimal? D { get; set; }
        public decimal? X { get; set; }
    }

    // 📤 Excel ตามที่กรอง: หัวตารางกรมท่า ตัวขาวหนา เส้นบางทุกช่อง (แบบ Template FORECAST ORDER) · CUSTOMER CODE / NAME เลือกได้
    [HttpPost("export")]
    public IActionResult Export([FromBody] ExportReq req)
    {
        if (!Can) return Deny();
        if (req?.Rows == null || req.Rows.Count == 0) return Fail("ยังไม่มีข้อมูลให้ส่งออก");
        if (req.Rows.Count > 200_000) return Fail("รายการมากเกินไป");
        var cols = new List<(string H, double W, Func<ExportRow, int, object> V, bool Text)> { ("NO", 6, (_, i) => i + 1, false) };
        if (req.Customer) { cols.Add(("CUSTOMER CODE", 16, (r, _) => r.Code, true)); cols.Add(("CUSTOMER NAME", 40, (r, _) => r.CustName, true)); }
        cols.Add(("PART A", 16, (r, _) => r.PartA, true));
        cols.Add(("PART NO", 24, (r, _) => r.PartNo, true));
        cols.Add(("PRODUCT NAME", 44, (r, _) => r.Name, true));
        cols.Add(("MONTH", 10, (r, _) => r.Month is >= 1 and <= 12 ? CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(r.Month) : "", false));
        if (req.F) cols.Add(("FORECAST", 12, (r, _) => r.F, false));
        if (req.O) cols.Add(("ORDER", 12, (r, _) => r.O, false));
        if (req.D) cols.Add(("DELIVERY", 12, (r, _) => r.D, false));
        if (req.X) cols.Add(("DIFF", 10, (r, _) => r.X.HasValue ? Math.Round(r.X.Value, 2) : null, false));
        cols.Add(("WORK DAYS", 12, (_, _) => null, false));
        try
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("FORECAST ORDER");
            for (int c = 0; c < cols.Count; c++)
            {
                var h = ws.Cell(1, c + 1);
                h.Value = cols[c].H;
                h.Style.Font.Bold = true; h.Style.Font.FontColor = XLColor.White; h.Style.Fill.BackgroundColor = XLColor.FromHtml("#002060");
                h.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; h.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center; h.Style.Alignment.WrapText = true;
            }
            for (int i = 0; i < req.Rows.Count; i++)
                for (int c = 0; c < cols.Count; c++)
                {
                    var v = cols[c].V(req.Rows[i], i);
                    var cell = ws.Cell(i + 2, c + 1);
                    cell.Value = v switch { null => Blank.Value, string s => s, int n => n, decimal d => d, _ => v.ToString() };
                    cell.Style.Alignment.Horizontal = cols[c].Text ? XLAlignmentHorizontalValues.Left : XLAlignmentHorizontalValues.Center;
                }
            var all = ws.Range(1, 1, req.Rows.Count + 1, cols.Count);
            all.Style.Font.FontName = "Calibri"; all.Style.Font.FontSize = 11;
            all.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; all.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            all.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(1).Height = 33;
            for (int c = 0; c < cols.Count; c++) ws.Column(c + 1).Width = cols[c].W;
            all.SetAutoFilter();
            ws.SheetView.FreezeRows(1);
            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            string name = Regex.Replace(string.IsNullOrWhiteSpace(req.FileName) ? "Forecast_Order" : req.FileName, @"[\\/:*?""<>|\s]+", "_");
            if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) name += ".xlsx";
            LogService.WriteLog(Uid, "FORECAST_FILE_EXPORT", $"File: {name} | Rows: {req.Rows.Count}", "");
            return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
        }
        catch (Exception ex) { return Fail(ex, "ส่งออกไม่สำเร็จ"); }
    }
}
