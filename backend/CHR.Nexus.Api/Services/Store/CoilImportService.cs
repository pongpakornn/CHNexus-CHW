// 📥 Import COIL LIST: ลงทะเบียน Coil ลูก / Master Coil / น้ำหนัก ของคลังที่นับ Coil (เช่น STOCK-PANTA ตั้งต้น)
//    - เก็บตามไฟล์ตรง ๆ (ไม่เติม Master Coilให้เอง) / Coil ที่มีอยู่แล้วในคลังนี้ = อัพเดทน้ำหนัก + Master Coil
//    - STOCK (COIL) ของสินค้าที่อยู่ในไฟล์ = นับใหม่จากทะเบียน / ยอด KG ไม่เปลี่ยน
using ClosedXML.Excel;
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Nexus.Services
{
    public class CoilImportRow
    {
        public int RowNumber { get; set; }
        public string PartCode { get; set; }
        public string MotherCoil { get; set; }
        public string CoilNo { get; set; }
        public decimal WeightKG { get; set; }
        public string LabelDate { get; set; }
        public int PartId { get; set; }
        public bool IsUpdate { get; set; }   // Coil นี้มีอยู่แล้วในคลังนี้
        public string Error { get; set; }
        public bool IsValid => string.IsNullOrEmpty(Error);
    }

    public class CoilImportService
    {
        public static readonly string[] Heads = { "NO", "PRODUCT CODE", "MASTER COIL", "NUMBER COIL", "WEIGHT (KG.)", "LABEL DATE" };

        private static readonly Dictionary<string, string[]> Headers = new Dictionary<string, string[]>
        {
            ["CODE"] = new[] { "PRODUCTCODE", "PDCODE", "PARTCODE", "CODE" },
            ["MOTHER"] = new[] { "MASTERCOIL", "MASTER", "COILMASTER", "MOTHERCOIL", "MOTHER", "COILMOTHER", "BIN" },
            ["COIL"] = new[] { "COILNO", "COILNUMBER", "NUMBERCOIL", "NOCOIL", "COIL" },
            ["WEIGHT"] = new[] { "WEIGHTKG", "WEIGHT", "KG", "QTYKG", "STOCKKG" },
            ["DATE"] = new[] { "LABELDATE", "DATE" }
        };

        private static string Norm(string h) =>
            new string((h ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

        private static XLWorkbook Open(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("ไม่พบไฟล์ที่เลือก", path);
            var ms = new MemoryStream();
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) fs.CopyTo(ms);
            ms.Position = 0;
            return new XLWorkbook(ms);
        }

        private static int FindHeader(IXLWorksheet ws, out Dictionary<string, int> cols)
        {
            cols = new Dictionary<string, int>();
            foreach (var row in ws.RowsUsed().Take(10))
            {
                cols.Clear();
                foreach (var cell in row.CellsUsed())
                {
                    string h = Norm(cell.GetString());
                    foreach (var kv in Headers)
                        if (!cols.ContainsKey(kv.Key) && kv.Value.Contains(h)) { cols[kv.Key] = cell.Address.ColumnNumber; break; }
                }
                if (cols.ContainsKey("CODE") && cols.ContainsKey("COIL") && cols.ContainsKey("WEIGHT")) return row.RowNumber();
            }
            return 0;
        }

        // ไฟล์ COIL LIST = มีหัว PRODUCT CODE + NUMBER COIL + WEIGHT (KG.)
        public static bool IsCoilFile(string path)
        {
            using (var wb = Open(path)) return FindHeader(wb.Worksheet(1), out _) > 0;
        }

        public List<CoilImportRow> Read(string path, StockModel stock)
        {
            var rows = new List<CoilImportRow>();
            using (var wb = Open(path))
            {
                var ws = wb.Worksheet(1);
                int header = FindHeader(ws, out var cols);
                if (header == 0) throw new Exception("ไม่พบหัวคอลัมน์ PRODUCT CODE / NUMBER COIL / WEIGHT (KG.)");
                int last = ws.LastRowUsed()?.RowNumber() ?? header;

                string Get(int r, string key) => cols.TryGetValue(key, out int c) ? ws.Cell(r, c).GetFormattedString().Trim() : "";

                for (int r = header + 1; r <= last; r++)
                {
                    string code = Get(r, "CODE"), coil = Get(r, "COIL"), weight = Get(r, "WEIGHT"), mother = Get(r, "MOTHER");
                    // แถวว่าง / มีแค่เลข NO -> ข้าม
                    if (code == "" && coil == "" && weight == "" && mother == "") continue;

                    var row = new CoilImportRow
                    {
                        RowNumber = r,
                        PartCode = code,
                        CoilNo = coil.ToUpperInvariant(),
                        MotherCoil = mother == "" || mother == "-" ? null : mother.ToUpperInvariant(),
                        LabelDate = Get(r, "DATE") is string d && d != "" && d != "-" ? d : null
                    };
                    if (code == "") row.Error = "ไม่มี PRODUCT CODE";
                    else if (coil == "" || coil == "-") row.Error = "ไม่มี NUMBER COIL";
                    else if (!Qty.TryParse(weight, out decimal w) || w <= 0) row.Error = $"WEIGHT (KG.) ไม่ถูกต้อง ({(weight == "" ? "ว่าง" : weight)})";
                    else row.WeightKG = w;
                    rows.Add(row);
                }
            }

            // Coil ซ้ำกันในไฟล์
            foreach (var g in rows.Where(r => r.IsValid).GroupBy(r => r.CoilNo).Where(g => g.Count() > 1))
                foreach (var dup in g.Skip(1)) dup.Error = $"NUMBER COIL {dup.CoilNo} ซ้ำกับแถว {g.First().RowNumber}";

            Validate(rows, stock);
            return rows;
        }

        // ตรวจกับฐานข้อมูล: สินค้าต้องอยู่ในคลังนี้ / Coil ที่อยู่คลังอื่น (IN) ห้ามทับ
        private static void Validate(List<CoilImportRow> rows, StockModel stock)
        {
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            {
                conn.Open();
                var parts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                string partSql = stock.IsMain
                    ? "SELECT PartID, PartCode FROM Nexus.Parts"
                    : "SELECT p.PartID, p.PartCode FROM Nexus.PartStocks ps JOIN Nexus.Parts p ON p.PartID = ps.PartID WHERE ps.StockID = @stk";
                using (var cmd = new SqlCommand(partSql, conn))
                {
                    cmd.Parameters.AddWithValue("@stk", stock.StkId);
                    using (var r = cmd.ExecuteReader())
                        while (r.Read()) parts[r.GetString(1).Trim()] = r.GetInt32(0);
                }

                var coils = new Dictionary<string, (int Stock, string StockCode, string Status)>(StringComparer.OrdinalIgnoreCase);
                using (var cmd = new SqlCommand("SELECT c.CoilNo, c.StockID, s.StockCode, c.Status FROM Nexus.Coils c JOIN Nexus.Stocks s ON s.StockID = c.StockID", conn))
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) coils[r.GetString(0)] = (r.GetInt32(1), r.GetString(2), r.GetString(3));

                foreach (var row in rows.Where(x => x.IsValid))
                {
                    if (!parts.TryGetValue(row.PartCode, out int pt)) { row.Error = $"ไม่พบสินค้า {row.PartCode} ในคลัง {stock.Code}"; continue; }
                    row.PartId = pt;
                    if (coils.TryGetValue(row.CoilNo, out var c))
                    {
                        if (c.Status == "IN" && c.Stock != stock.StkId) row.Error = $"COIL {row.CoilNo} อยู่ในคลัง {c.StockCode} แล้ว";
                        else row.IsUpdate = c.Status == "IN";
                    }
                }
            }
        }

        // Coil ทั้งหมดในทะเบียน (ใช้ตรวจไฟล์ Import: Coil ที่อยู่คลังอื่นห้ามทับ)
        internal static Dictionary<string, (int Stock, string StockCode, string Status, int Part)> LoadCoils(SqlConnection conn)
        {
            var map = new Dictionary<string, (int, string, string, int)>(StringComparer.OrdinalIgnoreCase);
            if (!DbSchema.HasCoilRegister) return map;
            using (var cmd = new SqlCommand("SELECT c.CoilNo, c.StockID, s.StockCode, c.Status, c.PartID FROM Nexus.Coils c JOIN Nexus.Stocks s ON s.StockID = c.StockID", conn))
            using (var r = cmd.ExecuteReader())
                while (r.Read()) map[r.GetString(0)] = (r.GetInt32(1), r.GetString(2), r.GetString(3), r.GetInt32(4));
            return map;
        }

        // ลงทะเบียน Coil ของสินค้า 1 ตัวในคลัง 1 คลัง (เก็บ Master Coilตามไฟล์) แล้วนับ STOCK (COIL) ใหม่จากทะเบียน
        internal static void RegisterCoils(SqlConnection conn, SqlTransaction trans, IEnumerable<(string CoilNo, string Mother, decimal Weight)> coils,
                                           int ptId, int stkId, bool isMain, string userId, bool setKg = false)
        {
            foreach (var c in coils)
            {
                ScanService.CoilReceive(conn, trans, new ScanService.CoilLabel { CoilNo = c.CoilNo, MotherCoil = c.Mother }, ptId, stkId, c.Weight, null, userId, "IMPORT");
                using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET MotherCoil = @m WHERE CoilNo = @c", conn, trans))
                {
                    cmd.Parameters.AddWithValue("@c", c.CoilNo);
                    cmd.Parameters.AddWithValue("@m", (object)c.Mother ?? DBNull.Value);
                    cmd.ExecuteNonQuery();
                }
            }
            RecountCoils(conn, trans, ptId, stkId, isMain);
            // Import หน้า Product Control / Store แบบแถว Coil: STOCK (UNIT) = น้ำหนักรวมของ Coil ในทะเบียน (ตรงกับ Coil ที่เห็นเมื่อกด PD CODE)
            if (setKg)
            {
                string sql = isMain
                    ? "UPDATE Nexus.Parts SET StockQuantity = (SELECT ISNULL(SUM(WeightKG), 0) FROM Nexus.Coils WHERE StockID = @stk AND PartID = @pt AND Status = 'IN') WHERE PartID = @pt"
                    : "UPDATE Nexus.PartStocks SET Quantity = (SELECT ISNULL(SUM(WeightKG), 0) FROM Nexus.Coils WHERE StockID = @stk AND PartID = @pt AND Status = 'IN') WHERE StockID = @stk AND PartID = @pt";
                using (var cmd = new SqlCommand(sql, conn, trans))
                {
                    cmd.Parameters.AddWithValue("@stk", stkId);
                    cmd.Parameters.AddWithValue("@pt", ptId);
                    cmd.ExecuteNonQuery();
                }
            }
        }

        // 🧲 ยอดของสินค้าในคลังนับ Coil ตามทะเบียน Coil (ทะเบียน = ความจริง):
        //   STOCK (COIL) = จำนวน Coil ที่อยู่ (IN) · STOCK (KG.) = น้ำหนักรวมของ Coil ที่อยู่ (เฉพาะสินค้าที่มี Coil ในทะเบียนของคลังนั้นแล้ว)
        //   สินค้าที่ยังไม่เคยมี Coil ในทะเบียน = คงยอด KG เดิม (ยอดที่สแกนรับก่อนมีทะเบียน) · คลังหลัก / คลังอื่น ดูจาก Nexus.Stocks เอง (ไม่เชื่อค่า isMain ที่ส่งมา)
        //   เดิมยอด KG บวก / ลบตามป้ายที่สแกน -> ป้ายที่ไม่มีในทะเบียน / แก้น้ำหนัก Coil ภายหลัง ทำให้ KG ไม่ตรงกับ Coil (ตัดสต็อกไม่ได้)
        internal static void RecountCoils(SqlConnection conn, SqlTransaction trans, int ptId, int stkId, bool isMain)
        {
            const string sql = @"
                DECLARE @main BIT = @isMain, @cc BIT = 0;
                SELECT @main = IsMain, @cc = CountCoil FROM Nexus.Stocks WHERE StockID = @stk;
                DECLARE @n INT, @kg DECIMAL(18, 3), @any INT;
                SELECT @n = COUNT(CASE WHEN Status = 'IN' THEN 1 END), @kg = ISNULL(SUM(CASE WHEN Status = 'IN' THEN WeightKG END), 0), @any = COUNT(*)
                FROM Nexus.Coils WHERE StockID = @stk AND PartID = @pt;
                DECLARE @setKg BIT = CASE WHEN @cc = 1 AND @any > 0 THEN 1 ELSE 0 END;
                IF @main = 1
                    UPDATE Nexus.Parts SET CoilQuantity = @n, StockQuantity = CASE WHEN @setKg = 1 THEN @kg ELSE StockQuantity END WHERE PartID = @pt;
                ELSE
                    UPDATE Nexus.PartStocks SET BoxQuantity = @n, Quantity = CASE WHEN @setKg = 1 THEN @kg ELSE Quantity END WHERE StockID = @stk AND PartID = @pt;";
            using (var cmd = new SqlCommand(sql, conn, trans))
            {
                cmd.Parameters.AddWithValue("@stk", stkId);
                cmd.Parameters.AddWithValue("@pt", ptId);
                cmd.Parameters.AddWithValue("@isMain", isMain);
                cmd.ExecuteNonQuery();
            }
        }

        public class ApplyResult { public int Added; public int Updated; public int Parts; }

        public ApplyResult Apply(StockModel stock, List<CoilImportRow> rows, string userId)
        {
            var valid = rows.Where(r => r.IsValid).ToList();
            var result = new ApplyResult();
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    foreach (var r in valid)
                    {
                        var label = new ScanService.CoilLabel { CoilNo = r.CoilNo, MotherCoil = r.MotherCoil };
                        ScanService.CoilReceive(conn, trans, label, r.PartId, stock.StkId, r.WeightKG, null, userId, "IMPORT");
                        // เก็บตามไฟล์: Master Coil / วันที่บนป้าย (ว่าง = ว่าง)
                        using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET MotherCoil = @m, LabelDate = @d WHERE CoilNo = @c", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@c", r.CoilNo);
                            cmd.Parameters.AddWithValue("@m", (object)r.MotherCoil ?? DBNull.Value);
                            cmd.Parameters.AddWithValue("@d", (object)r.LabelDate ?? DBNull.Value);
                            cmd.ExecuteNonQuery();
                        }
                        if (r.IsUpdate) result.Updated++; else result.Added++;
                    }

                    // STOCK (COIL) = จำนวน Coil ในทะเบียนของสินค้านั้น
                    foreach (int pt in valid.Select(r => r.PartId).Distinct())
                    {
                        RecountCoils(conn, trans, pt, stock.StkId, stock.IsMain);
                        result.Parts++;
                    }
                    trans.Commit();
                }
            }
            return result;
        }

        // 📄 Template COIL LIST (แบบเดียวกับ Template ทั้งระบบ: แผ่นข้อมูล -> HOW TO + ตัวอย่าง -> PRODUCT CODES)
        // products = สินค้าที่แสดงในหน้า Store (Max-Min) ของคลังนี้ (ชีท PRODUCT CODE) · ไม่ส่ง = อ่านจากฐานข้อมูล
        public string WriteTemplate(StockModel stock, IEnumerable<StoreProductModel> products = null)
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Store, $"{stock.Code}_Template_Coil");

            var parts = products?.Select(p => (Code: p.PartCode, Name: p.PartName ?? "")).ToList() ?? new List<(string Code, string Name)>();
            if (products == null)
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(stock.IsMain
                ? "SELECT PartCode, ISNULL(Description, N'') FROM Nexus.Parts ORDER BY PartCode"
                : "SELECT p.PartCode, ISNULL(p.Description, N'') FROM Nexus.PartStocks ps JOIN Nexus.Parts p ON p.PartID = ps.PartID WHERE ps.StockID = @stk ORDER BY p.PartCode", conn))
            {
                cmd.Parameters.AddWithValue("@stk", stock.StkId);
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) parts.Add((r.GetString(0), r.GetString(1)));
            }

            using (var wb = new XLWorkbook())
            {
                var ws = wb.AddWorksheet("COIL LIST");
                ImportTemplateService.Header(ws, Heads, new double[] { 6.4, 22, 20, 22, 15, 15 });
                int last = 101;
                for (int r = 2; r <= last; r++) ws.Cell(r, 1).Value = r - 1;
                ImportTemplateService.Body(ws, last, Heads.Length);
                ws.Cell(1, 1).Style.Font.Bold = true;
                ws.Range(2, 1, last, 1).Style.Font.Bold = true;
                ws.Range(2, 2, last, 4).Style.NumberFormat.Format = "@";
                ws.Range(2, 5, last, 5).Style.NumberFormat.Format = "#,##0.###";

                ImportTemplateService.Guide(wb, $"COIL LIST -> {stock.Code}", new[]
                {
                    ("PRODUCT CODE", $"รหัสสินค้าที่อยู่ในคลัง {stock.Code} (ดูชีท PRODUCT CODE) - ต้องกรอก"),
                    ("MASTER COIL", "เลข Master Coil เช่น CWE0885B (ว่างได้ = ไม่ระบุ)"),
                    ("NUMBER COIL", "เลข Coil ลูก เช่น CWE0885B-006 - ต้องกรอก / ห้ามซ้ำ / Coil ที่มีอยู่แล้วในคลังนี้ = อัพเดทน้ำหนัก + Master Coil"),
                    ("WEIGHT (KG.)", "น้ำหนักของ Coil ลูกนั้น (กก.) - ต้องมากกว่า 0"),
                    ("LABEL DATE", "วันที่บนป้าย (ว่างได้)"),
                    ("ผลการ Import", "STOCK (COIL) = จำนวน Coil ในทะเบียน · STOCK (KG.) = น้ำหนักรวมของ Coil ที่อยู่ในคลัง (ระบบคำนวณให้ทั้งคู่)"),
                    ("IMPORT", $"กด IMPORT (MAX-MIN / COIL) ในหน้า Store (Max-Min) ของ {stock.Code} · ระบบแสดงสรุปให้ยืนยันก่อนบันทึก"),
                });
                var g = wb.Worksheet("HOW TO");
                int ex = 13;
                g.Cell(ex - 1, 1).Value = "ตัวอย่าง (กรอกในแผ่น COIL LIST)";
                g.Cell(ex - 1, 1).Style.Font.Bold = true;
                for (int i = 0; i < Heads.Length; i++) g.Cell(ex, i + 1).Value = Heads[i];
                var eh = g.Range(ex, 1, ex, Heads.Length);
                eh.Style.Fill.BackgroundColor = XLColor.FromHtml("#002060"); eh.Style.Font.FontColor = XLColor.White; eh.Style.Font.Bold = true;
                string code = parts.Count > 0 ? parts[0].Code : "PRODUCT-001";
                object[][] samples =
                {
                    new object[] { 1, code, "CWE0885B", "CWE0885B-006", 1250.5, "" },
                    new object[] { 2, code, "CWE0885B", "CWE0885B-007", 1198, "" },
                    new object[] { 3, code, "", "CWE0901A-001", 980, "" },
                };
                for (int s = 0; s < samples.Length; s++)
                    for (int c = 0; c < samples[s].Length; c++)
                        g.Cell(ex + 1 + s, c + 1).Value = XLCellValue.FromObject(samples[s][c]);
                g.Range(ex, 1, ex + samples.Length, Heads.Length).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                g.Range(ex, 1, ex + samples.Length, Heads.Length).Style.Border.InsideBorder = XLBorderStyleValues.Thin;

                var pc = wb.AddWorksheet("PRODUCT CODE");
                ImportTemplateService.Header(pc, new[] { "PRODUCT CODE", "PRODUCT NAME" }, new double[] { 24, 60 });
                for (int i = 0; i < parts.Count; i++) { pc.Cell(i + 2, 1).Value = parts[i].Code; pc.Cell(i + 2, 2).Value = parts[i].Name; }
                ImportTemplateService.Body(pc, parts.Count + 1, 2);
                ImportTemplateService.LeftAlign(pc, parts.Count + 1, 2);

                ws.SetTabActive();
                wb.SaveAs(path);
            }
            return path;
        }
    }
}
