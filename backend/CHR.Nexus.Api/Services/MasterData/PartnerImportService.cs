using CHR.Nexus.Api.Controllers;
using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;

namespace Nexus.Services;

// MASTER DATA > Customer / Supplier Excel TEMPLATE / IMPORT / APPLY
//   Rules: blank NAME = keep · new CODE = add as ACTIVE · same CODE twice in file = bottom row wins · never delete · never change STATUS
public sealed class PartnerImportService
{
    // Parsed file row. Key = CODE (unique among rows that count) · "CODE#row" (superseded duplicate) · "ROWn" (invalid)
    public sealed record Src(string Key, int Row, string Code, string Name, string Error, bool Superseded);
    public sealed record State(string Title, List<Src> Rows);
    public sealed record Plan(List<(string Code, string Name)> Inserts, List<(int Id, string Code, string Name)> Updates, int Same, int Skipped);

    private readonly PartnerKind _k;
    public PartnerImportService(PartnerKind kind) => _k = kind;

    // ---------------------------------------------------------------- TEMPLATE
    public XLWorkbook Template(List<PartnerRow> existing)
    {
        var wb = new XLWorkbook();
        var ws = wb.AddWorksheet(_k.Label);
        var heads = new[] { "NO", "CODE", "NAME", "STATUS", "USED BY PARTS" };
        ImportTemplateService.Header(ws, heads, new double[] { 6, 24, 44, 12, 16 });
        int r = 2;
        foreach (var p in existing)
        {
            ws.Cell(r, 1).Value = r - 1;
            ws.Cell(r, 2).Value = p.Code;
            ws.Cell(r, 3).Value = p.Name ?? "";
            ws.Cell(r, 4).Value = p.IsActive ? "ACTIVE" : "INACTIVE";
            ws.Cell(r, 5).Value = p.Parts;
            r++;
        }
        int existingLast = r - 1;
        for (int i = 0; i < 20; i++) { ws.Cell(r, 1).Value = r - 1; r++; }   // blank rows for new codes
        int last = r - 1;
        ImportTemplateService.Body(ws, last, heads.Length);
        ImportTemplateService.LeftAlign(ws, last, 2, 3);
        ws.Range(2, 2, last, 2).Style.NumberFormat.Format = "@";
        ws.Range(2, 3, last, 3).Style.NumberFormat.Format = "@";
        // input = yellow · key of existing rows + read-only info = gray
        ws.Range(2, 3, last, 3).Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
        if (last > existingLast) ws.Range(existingLast + 1, 2, last, 2).Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
        if (existingLast >= 2)
        {
            ws.Range(2, 2, existingLast, 2).Style.Fill.BackgroundColor = XLColor.FromHtml("#EDEDED");
            ws.Range(2, 4, existingLast, 5).Style.Fill.BackgroundColor = XLColor.FromHtml("#EDEDED");
        }
        ws.Range(existingLast + 1, 4, last, 5).Style.Fill.BackgroundColor = XLColor.FromHtml("#EDEDED");
        ws.SheetView.Freeze(1, 2);

        ImportTemplateService.Guide(wb, $"CHR-Nexus - MASTER DATA > {_k.Label} (IMPORT EXCEL)", new[]
        {
            ("CODE", "ห้ามแก้ใน CODE ที่มีอยู่แล้ว (ใช้จับคู่) · CODE ใหม่ = เพิ่มเป็น ACTIVE · ใช้ได้เฉพาะ A-Z 0-9 เว้นวรรค - _ . / & ( ) ยาวไม่เกิน 50 ตัว"),
            ("NAME", "ช่องสีเหลือง · ไม่เกิน 200 ตัวอักษร · ช่องว่าง = คงชื่อเดิม"),
            ("STATUS / USED BY PARTS", "ข้อมูลอ้างอิง (สีเทา) ระบบไม่อ่านค่า · STATUS ไม่เปลี่ยนผ่าน Import (เปลี่ยนที่หน้าเว็บเท่านั้น)"),
            ("ยอดเท่าเดิม", "ไม่แตะ"),
            ("ชื่อต่างจากในระบบ", "อัพเดทเป็นชื่อใหม่ (หน้าพรีวิวแสดงชื่อเดิม → ชื่อใหม่ ก่อนกด IMPORT)"),
            ("CODE ซ้ำในไฟล์", "ใช้แถวล่างสุด แถวบนถูกข้าม (แสดงเป็น DUPLICATE ในพรีวิว)"),
            ("CODE คล้ายของเดิม", "เช่น ต่างแค่ตัวพิมพ์ / ขีด / เว้นวรรค = SIMILAR · เลือกผูกกับ CODE เดิม หรือเพิ่มเป็นรายการใหม่ในหน้าพรีวิว"),
            ("การลบ", "ไม่มีการลบผ่าน Import · แถวที่ไม่อยู่ในไฟล์ = คงเดิม"),
            ("", $"กรอกในชีท {_k.Label} (ชีทแรก) แล้วกด IMPORT ในหน้า MASTER DATA"),
        });
        wb.Worksheet(1).SetTabActive();
        return wb;
    }

    // ---------------------------------------------------------------- PARSE (preview input)
    public (List<Src> Rows, List<ImportErrorDto> Errors) Parse(IXLWorksheet ws)
    {
        int hr = 0, cCode = 0, cName = 0;
        int lastHead = Math.Min(10, ws.LastRowUsed()?.RowNumber() ?? 0);
        for (int r = 1; r <= lastHead && hr == 0; r++)
        {
            int code = 0, name = 0;
            foreach (var c in ws.Row(r).CellsUsed())
            {
                string t = c.GetString().Trim().ToUpperInvariant();
                if (t == "CODE" && code == 0) code = c.Address.ColumnNumber;
                else if (t == "NAME" && name == 0) name = c.Address.ColumnNumber;
            }
            if (code > 0) { hr = r; cCode = code; cName = name; }
        }
        if (hr == 0) throw new InvalidOperationException($"ไม่ใช่ไฟล์ Template {_k.Label} (ไม่พบหัวคอลัมน์ CODE) · ดาวน์โหลด TEMPLATE จากหน้านี้");

        var errors = new List<ImportErrorDto>();
        var raw = new List<Src>();
        int last = ws.LastRowUsed()?.RowNumber() ?? hr;
        for (int r = hr + 1; r <= last; r++)
        {
            string code = ws.Cell(r, cCode).GetString(), name = cName > 0 ? ws.Cell(r, cName).GetString() : "";
            if (string.IsNullOrWhiteSpace(code) && string.IsNullOrWhiteSpace(name)) continue;
            var (c, n, err) = MasterDataController.Clean(_k, new MasterDataController.PartnerRequest(code, name, null));
            if (err != null)
            {
                string cell = ws.Cell(r, err.Contains("NAME") && cName > 0 ? cName : cCode).Address.ToString();
                errors.Add(new(cell, err.Replace("\n", " · ")));
                raw.Add(new($"ROW{r}", r, c, n, err.Replace("\n", " · "), false));
            }
            else raw.Add(new(c, r, c, n, null, false));
        }
        // same CODE twice -> bottom row wins; the others are kept as DUPLICATE (not applied)
        var lastRowOf = raw.Where(x => x.Error == null).GroupBy(x => x.Code).ToDictionary(g => g.Key, g => g.Max(x => x.Row));
        var rows = raw.Select(x => x.Error == null && x.Row != lastRowOf[x.Code] ? x with { Key = x.Code + "#" + x.Row, Superseded = true } : x).ToList();
        if (rows.Count == 0) throw new InvalidOperationException("ไม่พบแถวข้อมูลในไฟล์");
        return (rows, errors);
    }

    // ---------------------------------------------------------------- PREVIEW (nothing written)
    public List<ImportRowDto> Preview(List<Src> src, List<PartnerRow> existing)
    {
        var byCode = existing.ToDictionary(x => x.Code, StringComparer.OrdinalIgnoreCase);
        var dupCodes = src.Where(x => x.Superseded).Select(x => x.Code).ToHashSet();
        var list = new List<ImportRowDto>();
        foreach (var s in src)
        {
            var f = new List<ImportField>();
            if (s.Error != null) { list.Add(new(s.Key, ImportReview.Invalid, s.Code, $"แถว {s.Row}", f, s.Error, null)); continue; }
            if (s.Superseded) { list.Add(new(s.Key, ImportReview.Duplicate, s.Code, $"แถว {s.Row}", f, "CODE ซ้ำในไฟล์ · ใช้แถวล่างสุด แถวนี้ถูกข้าม", null)); continue; }
            string note = dupCodes.Contains(s.Code) ? "CODE ซ้ำในไฟล์ · ใช้แถวล่างสุด (แถวนี้)" : null;
            if (byCode.TryGetValue(s.Code, out var ex))
            {
                string nw = s.Name ?? ex.Name;   // blank = keep
                f.Add(new("NAME", ex.Name, nw, true));
                list.Add(new(s.Key, ImportReview.Status(ex.Name ?? "", nw ?? ""), s.Code, $"แถว {s.Row} · ใช้โดย {ex.Parts:N0} สินค้า", f, note, null));
                continue;
            }
            f.Add(new("NAME", null, s.Name, true));
            var sim = Similar(s, existing);
            list.Add(sim.Count > 0
                ? new(s.Key, ImportReview.Similar, s.Code, $"แถว {s.Row}", f, "ไม่พบ CODE นี้ แต่คล้ายของเดิม · เลือกผูกกับของเดิม หรือเพิ่มเป็นรายการใหม่", sim)
                : new(s.Key, ImportReview.New, s.Code, $"แถว {s.Row}", f, note, null));
        }
        return list;
    }

    // near match by CODE, or by NAME when the file gives one
    private static List<ImportSuggest> Similar(Src s, List<PartnerRow> existing)
    {
        string kc = ImportReview.NormKey(s.Code), kn = ImportReview.NormKey(s.Name);
        return existing.Where(e => ImportReview.NormKey(e.Code) == kc || (kn != "" && ImportReview.NormKey(e.Name) == kn))
                       .Take(5).Select(e => new ImportSuggest(e.Code, string.IsNullOrEmpty(e.Name) ? e.Code : $"{e.Code} · {e.Name}")).ToList();
    }

    // ---------------------------------------------------------------- APPLY: decide what to write (pure, re-validates everything)
    public Plan MakePlan(State st, List<PartnerRow> existing, ImportApplyRequest req)
    {
        var byCode = existing.ToDictionary(x => x.Code, StringComparer.OrdinalIgnoreCase);
        var skip = (req.Exclude ?? new()).ToHashSet();
        var inserts = new List<(string, string)>();
        var updates = new Dictionary<int, (int, string, string)>();
        int same = 0, skipped = 0;
        foreach (var s in st.Rows)
        {
            if (s.Error != null || s.Superseded || skip.Contains(s.Key)) { skipped++; continue; }
            string name = s.Name;
            if (req.Edits != null && req.Edits.TryGetValue(s.Key, out var ed) && ed != null && ed.TryGetValue("NAME", out var en))
            {
                var (_, n, err) = MasterDataController.Clean(_k, new MasterDataController.PartnerRequest(s.Code, en, null));
                if (err != null) throw new InvalidOperationException(err.Replace("\n", " · "));
                name = n;
            }
            // map only binds SIMILAR rows (file CODE not in DB); an exact CODE always wins
            if (!byCode.TryGetValue(s.Code, out var target) && req.Map != null && req.Map.TryGetValue(s.Key, out var mc) && !string.IsNullOrWhiteSpace(mc))
            {
                if (!byCode.TryGetValue(mc.Trim(), out target)) throw new InvalidOperationException($"ไม่พบ {_k.Label} CODE \"{mc}\" ที่เลือกผูก (อาจถูกลบไปแล้ว)");
            }
            if (target == null) { inserts.Add((s.Code, name)); continue; }
            if (name == null || name == (target.Name ?? "")) { same++; continue; }
            updates[target.Id] = (target.Id, target.Code, name);
        }
        return new Plan(inserts, updates.Values.ToList(), same, skipped);
    }

    // one transaction · INSERT = ACTIVE · UPDATE touches NAME only (never STATUS, never CODE)
    public void Execute(Plan p, string uid)
    {
        using var c = new SqlConnection(GlobalConfig.ConnStr);
        c.Open();
        using var tx = c.BeginTransaction();
        foreach (var (code, name) in p.Inserts)
            c.Execute($@"INSERT INTO {_k.Table} ({_k.Code}, {_k.Name}, IsActive, CreatedBy, UpdatedBy) VALUES (@code, @name, 1, @uid, @uid)",
                      new { code, name, uid }, tx);
        foreach (var (id, _, name) in p.Updates)
            c.Execute($"UPDATE {_k.Table} SET {_k.Name} = @name, UpdatedBy = @uid, UpdatedDate = GETDATE() WHERE {_k.Id} = @id", new { id, name, uid }, tx);
        tx.Commit();
    }
}
