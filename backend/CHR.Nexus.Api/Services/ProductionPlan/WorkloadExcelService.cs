using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// 👥 WORKLOAD › เปรียบเทียบกับไฟล์ Excel "Work load" (41_Production_Plan_Workload_Excel.sql)
//   CASE 1 ตาม EXCEL: ยอด PDT / Direct / Production ต่อหน่วยงาน × เดือน จากชีท "9. ManPower …" (ค่าที่คำนวณไว้แล้วในไฟล์ ไม่คำนวณสูตรใหม่)
//     หัวเดือน (แถว 5) = "November 2026 (N)" / "October 2026 (N-1)" … · หัวคอลัมน์ (แถว 7) = PDT / Direct / Production
//     แถวหน่วยงาน 8-18 เรียงแบบเดียวกับตาราง Workload (จับคู่ด้วยชื่อ ถ้าไม่ได้ใช้ลำดับ)
//   หมายเหตุ (เหตุผลที่ตรง / ไม่ตรง) ต่อหน่วยงาน × เดือน
public sealed class WorkloadExcelService
{
    private static SqlConnection Conn() => new(GlobalConfig.ConnStr);

    public sealed record RefRow(DateTime Month, string Row, decimal? Pdt, decimal? Direct, decimal? Production);
    public sealed record Parsed(string Sheet, DateTime? FileMonth, List<RefRow> Rows);

    // ชื่อแถวใน Excel -> RowKey (ตามลำดับของ ProductionPlanService.WlRows)
    private static readonly (string Key, Regex Name)[] RowNames =
    {
        ("TPS", new Regex("TPS|วางแผน", RegexOptions.IgnoreCase)),
        ("DELIVERY", new Regex("จัดส่ง|ส่งมอบ")),
        ("QA", new Regex("ประกันคุณภาพ")),
        ("QC", new Regex("ควบคุมคุณภาพ")),
        ("PRESS1", new Regex(@"ป[ั]?[้๊]?ม\s*1|PRESS\s*1", RegexOptions.IgnoreCase)),
        ("PRESS2", new Regex(@"ป[ั]?[้๊]?ม\s*2|PRESS\s*2", RegexOptions.IgnoreCase)),
        ("ASSEMBLY", new Regex(@"^\s*ประกอบ\s*$|ASSEMBLY", RegexOptions.IgnoreCase)),
        ("DIE", new Regex("แม่พิมพ์")),
        ("PIPEPART", new Regex("ชิ้นส่วนท่อ")),
        ("PIPEASSY", new Regex("ประกอบท่อ")),
        ("PAINTPART", new Regex("ชิ้นส่วนสี")),
    };

    private static XLCellValue Val(IXLCell c)
    {
        try { return c.HasFormula ? c.CachedValue : c.Value; } catch { return Blank.Value; }
    }
    private static string Txt(IXLCell c)
    {
        var v = Val(c);
        try { return v.IsText ? v.GetText().Trim() : v.IsBlank ? "" : v.ToString().Trim(); } catch { return ""; }
    }
    private static decimal? Num(IXLCell c)
    {
        var v = Val(c);
        try { return v.IsNumber ? (decimal)v.GetNumber() : (decimal?)null; } catch { return null; }
    }

    public Parsed Read(string path)
    {
        using var wb = new XLWorkbook(path);
        var ws = wb.Worksheets.Where(w => w.Visibility == XLWorksheetVisibility.Visible).FirstOrDefault(w => Regex.IsMatch(w.Name, @"^\s*9\.\s*ManPower", RegexOptions.IgnoreCase))
                 ?? wb.Worksheets.FirstOrDefault(w => Regex.IsMatch(w.Name, "ManPower", RegexOptions.IgnoreCase))
                 ?? throw new InvalidOperationException("ไม่พบชีท \"9. ManPower …\" ในไฟล์ (ต้องเป็นไฟล์ Work load)");
        int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
        // หัวเดือน
        int hr = 0;
        var blocks = new List<(int Col, DateTime Month, string Tag)>();
        for (int r = 1; r <= 12 && blocks.Count == 0; r++)
            for (int c = 1; c <= lastCol; c++)
            {
                var m = Regex.Match(Txt(ws.Cell(r, c)), @"^([A-Za-z]+)\s+(\d{4})\s*\((N(?:\s*[+-]\s*\d)?)\)", RegexOptions.IgnoreCase);
                if (!m.Success) continue;
                if (!DateTime.TryParseExact($"{m.Groups[1].Value.Substring(0, 3)} {m.Groups[2].Value}", "MMM yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var mon)) continue;
                blocks.Add((c, mon, Regex.Replace(m.Groups[3].Value, @"\s+", "").ToUpperInvariant()));
                hr = r;
            }
        if (blocks.Count == 0) throw new InvalidOperationException("ไม่พบหัวเดือน เช่น \"November 2026 (N)\" ในชีท " + ws.Name);
        blocks = blocks.OrderBy(b => b.Col).ToList();
        // แถวหัวคอลัมน์ PDT / Direct / Production
        int lr = 0;
        for (int r = hr + 1; r <= hr + 4 && lr == 0; r++)
            for (int c = 1; c <= lastCol; c++)
                if (Txt(ws.Cell(r, c)).Equals("PDT", StringComparison.OrdinalIgnoreCase)) { lr = r; break; }
        if (lr == 0) throw new InvalidOperationException("ไม่พบหัวคอลัมน์ PDT ในชีท " + ws.Name);
        // แถวหน่วยงาน: ใต้หัวคอลัมน์ จนถึงแถว Total
        var rows = new List<(int R, string Key)>();
        int idx = 0;
        for (int r = lr + 1; r <= lr + 30; r++)
        {
            string a = Txt(ws.Cell(r, 1)), b = Txt(ws.Cell(r, 2));
            if (a.Equals("Total", StringComparison.OrdinalIgnoreCase)) break;
            if (b.Length == 0) continue;
            var hit = RowNames.FirstOrDefault(x => x.Name.IsMatch(b));
            string key = hit.Key ?? (idx < RowNames.Length ? RowNames[idx].Key : null);
            if (key == null) continue;
            if (key == "ASSEMBLY" && Regex.IsMatch(b, "ท่อ")) key = "PIPEASSY";
            rows.Add((r, key));
            idx++;
        }
        if (rows.Count == 0) throw new InvalidOperationException("ไม่พบแถวหน่วยงานในชีท " + ws.Name);

        var list = new List<RefRow>();
        DateTime? fileMonth = null;
        for (int i = 0; i < blocks.Count; i++)
        {
            var bk = blocks[i];
            int end = i + 1 < blocks.Count ? blocks[i + 1].Col - 1 : lastCol;
            if (bk.Tag == "N") fileMonth = bk.Month;
            int pdt = 0, dir = 0, prod = 0;
            for (int c = bk.Col; c <= end; c++)
            {
                string t = Txt(ws.Cell(lr, c));
                if (pdt == 0 && t.Equals("PDT", StringComparison.OrdinalIgnoreCase)) pdt = c;
                else if (pdt > 0 && dir == 0 && t.Equals("Direct", StringComparison.OrdinalIgnoreCase)) dir = c;
                else if (prod == 0 && t.Equals("Production", StringComparison.OrdinalIgnoreCase)) prod = c;
            }
            if (pdt == 0) continue;
            foreach (var (r, key) in rows)
                list.Add(new RefRow(bk.Month, key, Num(ws.Cell(r, pdt)) ?? 0, dir > 0 ? Num(ws.Cell(r, dir)) ?? 0 : null, prod > 0 ? Num(ws.Cell(r, prod)) : null));
        }
        return new Parsed(ws.Name, fileMonth, list);
    }

    // แทนที่ยอดของเดือน / หน่วยงานที่มีในไฟล์ (เดือนอื่นคงเดิม)
    public int Save(Parsed p, string fileName, string uid)
    {
        using var c = Conn();
        c.Open();
        using var t = c.BeginTransaction();
        foreach (var r in p.Rows)
            c.Execute(@"UPDATE ProductionPlan.WorkloadRef SET Pdt = @Pdt, Direct = @Direct, Production = @Production, FileName = @fileName, FileMonth = @fm, UpdatedBy = @uid, UpdatedAt = GETDATE()
                        WHERE MonthStart = @Month AND RowKey = @Row;
                        IF @@ROWCOUNT = 0 INSERT INTO ProductionPlan.WorkloadRef (MonthStart, RowKey, Pdt, Direct, Production, FileName, FileMonth, UpdatedBy)
                                          VALUES (@Month, @Row, @Pdt, @Direct, @Production, @fileName, @fm, @uid);",
                      new { r.Month, r.Row, r.Pdt, r.Direct, r.Production, fileName, fm = p.FileMonth, uid }, t);
        t.Commit();
        return p.Rows.Count;
    }

    public object Refs(DateTime from, DateTime to)
    {
        using var c = Conn();
        return c.Query(@"SELECT CONVERT(char(7), MonthStart, 126) AS month, RowKey AS row, Pdt AS pdt, Direct AS direct, Production AS production, FileName AS fileName,
                                CONVERT(char(7), FileMonth, 126) AS fileMonth, UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
                         FROM ProductionPlan.WorkloadRef WHERE MonthStart >= @from AND MonthStart <= @to", new { from, to }).ToList();
    }

    public object Notes(DateTime from, DateTime to)
    {
        using var c = Conn();
        return c.Query(@"SELECT CONVERT(char(7), MonthStart, 126) AS month, RowKey AS row, Note AS note, UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
                         FROM ProductionPlan.WorkloadNotes WHERE MonthStart >= @from AND MonthStart <= @to", new { from, to }).ToList();
    }

    // ว่าง = ลบหมายเหตุ
    public void SaveNote(DateTime month, string row, string note, string uid)
    {
        using var c = Conn();
        if (string.IsNullOrWhiteSpace(note)) { c.Execute("DELETE FROM ProductionPlan.WorkloadNotes WHERE MonthStart = @month AND RowKey = @row", new { month, row }); return; }
        c.Execute(@"UPDATE ProductionPlan.WorkloadNotes SET Note = @note, UpdatedBy = @uid, UpdatedAt = GETDATE() WHERE MonthStart = @month AND RowKey = @row;
                    IF @@ROWCOUNT = 0 INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES (@month, @row, @note, @uid);",
                  new { month, row, note = note.Trim(), uid });
    }
}
