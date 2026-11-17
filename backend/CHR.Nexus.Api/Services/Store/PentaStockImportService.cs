using System.Globalization;
using ClosedXML.Excel;
using Dapper;
using Microsoft.Data.SqlClient;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;

namespace Nexus.Services;

// STORE > EXCEL > IMPORT PENTA STOCK (stocks with Nexus.Stocks.InSupplierImport = 1)
//   Supplier file "PentaOnlineStock_*.xlsx": 1 row = 1 coil, columns read by header name (order may change).
//   Preview -> review (ImportReview) -> apply: CHANGED = coil weight updated · SAME = untouched · NEW = coil added to the PD CODE typed in
//   (MC = Master Coil COIL_NO · FG = Number Coil MAT_NO under COIL_NO) · excluded rows skipped · stock recounted from the coil register.
//   Match: MAT_NO = Number Coil > COIL_NO = coil > COIL_NO = Master Coil (this stock first).
public sealed class PentaStockImportService
{
    public sealed record Src(string Key, int Row, string CoilNo, string MatNo, string MatType, string Spec, string Desc,
                             string Qty, decimal? Wt, string Status, string Zone, string RcvDate, string Error, bool Superseded);
    public sealed record Coil(string CoilNo, string MotherCoil, int StockId, string StockCode, string Status, string PartCode, decimal WeightKG, int CoilId = 0, int PartId = 0);
    public sealed record State(int StkId, string File, List<Src> Rows);
    public sealed record ApplyResult(int Updated, int Added, int Same, int Skipped, List<string> Errors);
    public const string FWeight = "WEIGHT (KG)", FPd = "PD CODE";

    private static readonly string[] Required = { "COIL_NO", "MAT_NO", "REMAIN_WT" };

    public static bool IsPentaFile(IXLWorksheet ws)
    {
        var heads = Heads(ws);
        return Required.All(heads.ContainsKey);
    }

    private static Dictionary<string, int> Heads(IXLWorksheet ws)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var row = ws.FirstRowUsed();
        if (row == null) return map;
        foreach (var c in row.CellsUsed())
        {
            string h = c.GetString().Trim().ToUpperInvariant();
            if (h.Length > 0 && !map.ContainsKey(h)) map[h] = c.Address.ColumnNumber;
        }
        return map;
    }

    // ---------------------------------------------------------------- PARSE
    public static List<Src> Parse(IXLWorksheet ws)
    {
        var h = Heads(ws);
        var missing = Required.Where(x => !h.ContainsKey(x)).ToList();
        if (missing.Count > 0) throw new InvalidOperationException("ไม่ใช่ไฟล์ Penta Online Stock · ไม่พบคอลัมน์: " + string.Join(", ", missing));
        string Get(IXLRow r, string col)
        {
            if (!h.TryGetValue(col, out int i)) return null;
            var c = r.Cell(i);
            if (c.IsEmpty()) return null;
            if (c.DataType == XLDataType.DateTime) return c.GetDateTime().ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
            if (c.DataType == XLDataType.Number) return c.GetDouble().ToString(CultureInfo.InvariantCulture);   // raw value, not the display format
            string s = c.GetFormattedString().Trim();
            return s.Length == 0 ? null : s;
        }

        var raw = new List<Src>();
        int last = ws.LastRowUsed()?.RowNumber() ?? 1;
        for (int n = 2; n <= last; n++)
        {
            var r = ws.Row(n);
            string coil = Get(r, "COIL_NO"), mat = Get(r, "MAT_NO"), wtText = Get(r, "REMAIN_WT");
            if (coil == null && mat == null && wtText == null) continue;   // blank line
            decimal? wt = decimal.TryParse(wtText, NumberStyles.Any, CultureInfo.InvariantCulture, out var w) ? w : null;
            string err = coil == null && mat == null ? "ไม่มี COIL_NO / MAT_NO"
                       : wtText != null && wt == null ? $"REMAIN_WT ไม่ใช่ตัวเลข ({wtText})"
                       : wt < 0 ? "REMAIN_WT ติดลบ" : null;
            string key = err != null ? $"ROW{n}" : (mat ?? coil).ToUpperInvariant();
            raw.Add(new(key, n, coil, mat, Get(r, "MAT_TYPE"), Get(r, "MAT_SPEC"), Get(r, "DESCRIPTION"), Get(r, "REMAIN_QTY"), wt,
                        Get(r, "STATUS_CODE_DESC"), Get(r, "ZONE"), Get(r, "RCV_DATE"), err, false));
        }
        if (raw.Count == 0) throw new InvalidOperationException("ไม่พบแถวข้อมูลในไฟล์");
        // same MAT_NO twice: bottom row wins, earlier rows become DUPLICATE
        var lastOf = raw.Where(x => x.Error == null).GroupBy(x => x.Key).ToDictionary(g => g.Key, g => g.Max(x => x.Row));
        return raw.Select(x => x.Error == null && x.Row != lastOf[x.Key] ? x with { Key = x.Key + "#" + x.Row, Superseded = true } : x).ToList();
    }

    // ---------------------------------------------------------------- MATCH
    public static List<Coil> LoadCoils()
    {
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        return conn.Query<Coil>(@"SELECT k.CoilNo, ISNULL(k.MotherCoil, '') AS MotherCoil, k.StockID AS StockId, s.StockCode, k.Status, p.PartCode, k.WeightKG, k.CoilID AS CoilId, k.PartID AS PartId
                                  FROM Nexus.Coils k JOIN Nexus.Stocks s ON s.StockID = k.StockID JOIN Nexus.Parts p ON p.PartID = k.PartID").ToList();
    }

    public static (Coil Coil, string How) Match(Src s, int stkId, Dictionary<string, Coil> byNo, ILookup<string, Coil> byMother)
    {
        string U(string v) => (v ?? "").Trim().ToUpperInvariant();
        if (s.MatNo != null && byNo.TryGetValue(U(s.MatNo), out var a)) return (a, "MAT_NO = NUMBER COIL");
        if (s.CoilNo != null && byNo.TryGetValue(U(s.CoilNo), out var b)) return (b, "COIL_NO = COIL");
        var m = s.CoilNo == null ? null : byMother[U(s.CoilNo)].OrderBy(x => x.StockId == stkId ? 0 : 1).ThenBy(x => x.Status == "IN" ? 0 : 1).FirstOrDefault();
        return m != null ? (m, "COIL_NO = MASTER COIL") : (null, null);
    }

    // ---------------------------------------------------------------- PREVIEW (read only)
    public static List<ImportRowDto> Preview(List<Src> rows, int stkId, List<Coil> coils)
    {
        var byNo = coils.GroupBy(c => c.CoilNo.Trim().ToUpperInvariant()).ToDictionary(g => g.Key, g => g.First());
        var byMother = coils.Where(c => c.MotherCoil != "").ToLookup(c => c.MotherCoil.Trim().ToUpperInvariant());
        string Kg(decimal? v) => v?.ToString("0.###", CultureInfo.InvariantCulture);
        var list = new List<ImportRowDto>();
        foreach (var s in rows)
        {
            string sub = $"แถว {s.Row} · {s.MatType ?? "-"} · COIL_NO {s.CoilNo ?? "-"}";
            var f = new List<ImportField>
            {
                new("COIL_NO", null, s.CoilNo), new("MAT_NO", null, s.MatNo), new("MAT_TYPE", null, s.MatType),
                new("MAT_SPEC", null, s.Spec), new("DESCRIPTION", null, s.Desc), new("REMAIN_QTY", null, s.Qty),
                new("STATUS", null, s.Status), new("ZONE", null, s.Zone), new("RCV_DATE", null, s.RcvDate),
            };
            if (s.Error != null) { list.Add(new(s.Key, ImportReview.Invalid, s.MatNo ?? s.CoilNo ?? $"แถว {s.Row}", sub, f, s.Error, null)); continue; }
            if (s.Superseded) { list.Add(new(s.Key, ImportReview.Duplicate, s.MatNo ?? s.CoilNo, sub, f, "MAT_NO ซ้ำในไฟล์ · ใช้แถวล่างสุด แถวนี้ถูกข้าม", null)); continue; }

            var (c, how) = Match(s, stkId, byNo, byMother);
            if (c == null)
            {
                f.Insert(0, new(FWeight, null, Kg(s.Wt), true));
                f.Insert(1, new(FPd, null, null, true));
                list.Add(new(s.Key, ImportReview.New, s.MatNo ?? s.CoilNo, sub, f,
                             $"ไม่มีใน CHR-Nexus · ใส่ PD CODE ของคลังนี้ แล้วระบบเพิ่ม{(s.MatType == "FG" ? $" NUMBER COIL {s.MatNo} (MASTER {s.CoilNo})" : $" MASTER COIL {s.CoilNo}")} · ไม่ใส่ = ข้าม", null));
                continue;
            }
            f.Insert(0, new(FWeight, Kg(c.WeightKG), Kg(s.Wt) ?? Kg(c.WeightKG), true));
            f.Insert(1, new("PD CODE", c.PartCode, c.PartCode));
            f.Insert(2, new("NEXUS COIL", c.CoilNo, c.CoilNo));
            f.Insert(3, new("NEXUS STOCK", c.StockCode, c.StockCode));
            var notes = new List<string> { "จับคู่: " + how };
            if (c.StockId != stkId) notes.Add($"อยู่คลัง {c.StockCode}");
            if (c.Status != "IN") notes.Add($"สถานะใน CHR-Nexus: {c.Status}");
            if (how == "COIL_NO = MASTER COIL" || (how == "COIL_NO = COIL" && s.MatType == "FG")) notes.Add("น้ำหนักเทียบกับม้วนแม่ (ไฟล์เป็นม้วนสลิท)");
            string why = Why(s, c, how, stkId);
            if (why != null) { list.Add(new(s.Key, ImportReview.Invalid, s.MatNo ?? s.CoilNo, sub, f, string.Join(" · ", notes) + " · " + why, null)); continue; }
            bool same = s.Wt == null || Math.Abs(s.Wt.Value - c.WeightKG) < 0.5m;
            list.Add(new(s.Key, same ? ImportReview.Same : ImportReview.Changed, s.MatNo ?? s.CoilNo, sub, f, string.Join(" · ", notes), null));
        }
        return list;
    }

    // a matched coil is only updated when it is this row's own coil, IN this stock (null = ok)
    public static string Why(Src s, Coil c, string how, int stkId) =>
        c.StockId != stkId ? "ไม่อัพเดท (Coil อยู่คนละคลัง)"
        : c.Status != "IN" ? "ไม่อัพเดท (Coil ไม่ได้อยู่ในคลังแล้ว)"
        : how == "COIL_NO = MASTER COIL" || (how == "COIL_NO = COIL" && s.MatType == "FG") ? "ไม่อัพเดท (FG ม้วนสลิท อ้างถึงม้วนแม่ · ยังไม่กำหนดกติกา FG)"
        : null;

    // ---------------------------------------------------------------- APPLY (re-matches against the current register)
    public static ApplyResult Apply(State st, StockModel stock, ImportApplyRequest req, string uid)
    {
        var coils = LoadCoils();
        var byNo = coils.GroupBy(c => c.CoilNo.Trim().ToUpperInvariant()).ToDictionary(g => g.Key, g => g.First());
        var byMother = coils.Where(c => c.MotherCoil != "").ToLookup(c => c.MotherCoil.Trim().ToUpperInvariant());
        var skip = new HashSet<string>(req?.Exclude ?? new(), StringComparer.Ordinal);
        string Ed(string key, string field) => req?.Edits != null && req.Edits.TryGetValue(key, out var e) && e.TryGetValue(field, out var v) ? v?.Trim() : null;
        int upd = 0, add = 0, same = 0, skipped = 0; var errors = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);   // a coil touched once per apply (same coil twice in the file = later row skipped)

        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        conn.Open();
        foreach (var s in st.Rows)
        {
            if (s.Error != null || s.Superseded || skip.Contains(s.Key)) { skipped++; continue; }
            string wText = Ed(s.Key, FWeight);
            decimal? wt = wText != null && decimal.TryParse(wText, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var w) ? w : s.Wt;
            var (c, how) = Match(s, st.StkId, byNo, byMother);
            try
            {
                if (c != null)
                {
                    if (Why(s, c, how, st.StkId) != null || !seen.Add(c.CoilNo)) { skipped++; continue; }
                    if (wt == null || wt <= 0 || Math.Abs(wt.Value - c.WeightKG) < 0.5m) { same++; continue; }
                    var kg = Qty.Round(wt.Value, stock.AllowDecimal);
                    using var tr = conn.BeginTransaction();
                    if (conn.Execute("UPDATE Nexus.Coils SET WeightKG = @kg, UpdatedDate = GETDATE() WHERE CoilID = @id AND Status = 'IN' AND StockID = @stk", new { kg, id = c.CoilId, stk = st.StkId }, tr) != 1)
                    { errors.Add($"{c.CoilNo}: Coil เปลี่ยนไปแล้วระหว่างตรวจไฟล์ (ไม่ได้อัพเดท)"); continue; }
                    Log(conn, tr, stock, c.PartId, c.PartCode, c.CoilId, c.CoilNo, c.MotherCoil, "EDIT", c.WeightKG, kg, st.File, uid);
                    CoilImportService.RecountCoils(conn, tr, c.PartId, st.StkId, stock.IsMain);
                    tr.Commit(); upd++;
                }
                else
                {
                    string pd = Ed(s.Key, FPd);
                    if (string.IsNullOrEmpty(pd) || wt == null || wt <= 0) { skipped++; continue; }
                    bool fg = s.MatType == "FG" && s.MatNo != null;
                    string coilNo = (fg ? s.MatNo : s.CoilNo).Trim(), mother = (s.CoilNo ?? coilNo).Trim();
                    if (!seen.Add(coilNo)) { skipped++; continue; }
                    using var tr = conn.BeginTransaction();
                    if (conn.ExecuteScalar<int>("SELECT COUNT(*) FROM Nexus.Coils WHERE CoilNo = @coilNo", new { coilNo }, tr) > 0)
                    { errors.Add($"{coilNo}: มี Coil เลขนี้ในระบบแล้ว (ไม่เพิ่มซ้ำ)"); continue; }
                    var parts = conn.Query<int>(stock.IsMain
                        ? "SELECT PartID FROM Nexus.Parts WHERE PartCode = @pd AND ISNULL(IsActive, 1) = 1"
                        : "SELECT p.PartID FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID AND ps.StockID = @stk WHERE p.PartCode = @pd", new { pd, stk = st.StkId }, tr).ToList();
                    if (parts.Count != 1) { errors.Add($"{s.MatNo ?? s.CoilNo}: {(parts.Count == 0 ? "ไม่พบ" : "มีหลายตัว")} PD CODE {pd} ในคลัง {stock.Code}"); continue; }
                    int partId = parts[0];
                    var kg = Qty.Round(wt.Value, stock.AllowDecimal);
                    CoilImportService.RegisterCoils(conn, tr, new[] { (coilNo, mother, kg) }, partId, st.StkId, stock.IsMain, uid);
                    int id = conn.ExecuteScalar<int>("SELECT CoilID FROM Nexus.Coils WHERE CoilNo = @coilNo", new { coilNo }, tr);
                    Log(conn, tr, stock, partId, pd, id, coilNo, mother, "ADD", 0, kg, st.File, uid);
                    tr.Commit(); add++;
                }
            }
            catch (Exception ex) { errors.Add($"{s.MatNo ?? s.CoilNo}: {ex.Message}"); }
        }
        return new(upd, add, same, skipped, errors);
    }

    private static void Log(SqlConnection conn, SqlTransaction tr, StockModel stock, int partId, string partCode, int coilId, string coilNo, string mother,
                            string action, decimal before, decimal after, string file, string uid) =>
        conn.Execute(@"INSERT INTO Nexus.CoilManageLog (StockID, StockCode, PartID, PartCode, CoilID, CoilNo, MotherCoil, Action, Mode, WeightBefore, WeightAfter, Detail, Reason, UserID)
                       VALUES (@stk, @code, @partId, @partCode, @coilId, @coilNo, @mother, @action, 'IMPORT', @before, @after, @detail, @file, @uid)",
                     new { stk = stock.StkId, code = stock.Code, partId, partCode, coilId, coilNo, mother = string.IsNullOrEmpty(mother) ? null : mother, action, before, after,
                           detail = $"PENTA STOCK import: {before:0.###} -> {after:0.###} KG", file = file?.Length > 500 ? file[..500] : file, uid }, tr);
}
