using Microsoft.Data.SqlClient;
using Nexus.Core;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace Nexus.Services
{
    // ➕ ช่องกรอกข้อมูลเพิ่มเอง ต่อคลัง (database/nexus/12_Custom_Fields.sql)
    //   Admin (Level 1) เพิ่ม / แก้ชื่อ / ลบ ช่องที่ ADMIN > CUSTOM FIELDS ของ Inventory Registration
    //   คีย์ "CF{FieldID}" ใช้ได้ทุกที่ที่เลือกช่อง: FORM FIELDS / TABLE COLUMNS (Inventory Registration) / ADD-EDIT STOCK (Store) / Template + Import Excel
    public static class CustomFields
    {
        private static readonly Regex KeyRx = new(@"^CF(\d{1,9})$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        public static bool IsKey(string key) => KeyRx.IsMatch((key ?? "").Trim());
        public static int IdOf(string key) { var m = KeyRx.Match((key ?? "").Trim()); return m.Success ? int.Parse(m.Groups[1].Value) : 0; }
        public static string KeyOf(int id) => "CF" + id;
        public static readonly string[] Types = { "TEXT", "NUMBER", "DATE" };
    }

    public sealed class CustomFieldDef
    {
        public int FieldId { get; set; }
        public int StockId { get; set; }
        public string Label { get; set; }
        public string DataType { get; set; }
        public int SortNo { get; set; }
        public string Key => CustomFields.KeyOf(FieldId);
        public int ValueCount { get; set; }
    }

    public class CustomFieldService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        private static bool? _ready;
        public static bool Ready
        {
            get
            {
                if (_ready == true) return true;
                try
                {
                    using var conn = new SqlConnection(GlobalConfig.ConnStr);
                    using var cmd = new SqlCommand("SELECT CASE WHEN OBJECT_ID('Nexus.PartFieldDefs','U') IS NOT NULL AND OBJECT_ID('Nexus.PartFieldValues','U') IS NOT NULL THEN 1 ELSE 0 END", conn);
                    conn.Open();
                    _ready = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
                catch { _ready = false; }
                return _ready == true;
            }
        }

        // ช่องทั้งหมด (stockId = null) หรือเฉพาะคลัง
        public List<CustomFieldDef> GetDefs(int? stockId = null)
        {
            var list = new List<CustomFieldDef>();
            if (!Ready) return list;
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand(@"SELECT d.FieldID, d.StockID, d.Label, d.DataType, d.SortNo,
                                                    (SELECT COUNT(*) FROM Nexus.PartFieldValues v WHERE v.FieldID = d.FieldID)
                                             FROM Nexus.PartFieldDefs d WHERE (@s IS NULL OR d.StockID = @s) ORDER BY d.StockID, d.SortNo, d.FieldID", conn);
            cmd.Parameters.AddWithValue("@s", (object)stockId ?? DBNull.Value);
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new CustomFieldDef { FieldId = r.GetInt32(0), StockId = r.GetInt32(1), Label = r.GetString(2), DataType = r.GetString(3), SortNo = r.GetInt32(4), ValueCount = r.GetInt32(5) });
            return list;
        }

        private static string CleanLabel(string label)
        {
            label = Regex.Replace((label ?? "").Trim(), @"\s+", " ").ToUpperInvariant();
            if (label.Length == 0) throw new InvalidOperationException("กรุณากรอกชื่อช่อง");
            if (label.Length > 60) throw new InvalidOperationException("ชื่อช่องยาวได้ไม่เกิน 60 ตัวอักษร");
            if (label.Contains(',') || label.Contains('|')) throw new InvalidOperationException("ชื่อช่องห้ามมี , หรือ |");
            // ชื่อซ้ำกับช่องของระบบ = สับสนตอน Import Excel
            string[] reserved = { "NO", "IMAGE", "SUPPLIER", "CUSTOMER", "CATEGORY", "MODEL", "PRODUCT CODE", "PD CODE", "PART A", "PART B", "PART NO", "PRODUCT NAME",
                                  "PACKSIZE", "BIN", "MASTER COIL", "COIL NO", "WEIGHT (KG)", "WEIGHT", "QR CODE", "QTY", "MAX", "MIN", "REMARK", "STOCK" };
            if (reserved.Contains(label)) throw new InvalidOperationException($"ชื่อ \"{label}\" ซ้ำกับช่องของระบบ กรุณาใช้ชื่ออื่น");
            return label;
        }

        private static string CleanType(string t) => CustomFields.Types.Contains((t ?? "").Trim().ToUpperInvariant()) ? t.Trim().ToUpperInvariant() : "TEXT";

        public CustomFieldDef Add(int stockId, string label, string type, string userId)
        {
            label = CleanLabel(label);
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand(@"IF EXISTS (SELECT 1 FROM Nexus.PartFieldDefs WHERE StockID = @s AND Label = @l) THROW 50001, N'dup', 1;
                                             INSERT INTO Nexus.PartFieldDefs (StockID, Label, DataType, SortNo, CreatedBy)
                                             OUTPUT inserted.FieldID
                                             VALUES (@s, @l, @t, (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM Nexus.PartFieldDefs WHERE StockID = @s), @u)", conn);
            cmd.Parameters.AddWithValue("@s", stockId);
            cmd.Parameters.AddWithValue("@l", label);
            cmd.Parameters.AddWithValue("@t", CleanType(type));
            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
            conn.Open();
            try
            {
                int id = Convert.ToInt32(cmd.ExecuteScalar());
                return new CustomFieldDef { FieldId = id, StockId = stockId, Label = label, DataType = CleanType(type) };
            }
            catch (SqlException ex) when (ex.Number == 50001 || ex.Number == 2627) { throw new InvalidOperationException($"มีช่อง \"{label}\" ในคลังนี้แล้ว"); }
        }

        // แก้ชื่อ / ชนิด · คืนค่าเดิม (ไว้ลง Log)
        public (CustomFieldDef Old, CustomFieldDef New) Update(int fieldId, string label, string type, string userId)
        {
            var old = GetDefs().FirstOrDefault(d => d.FieldId == fieldId) ?? throw new InvalidOperationException("ไม่พบช่องนี้ (อาจถูกลบไปแล้ว)");
            label = CleanLabel(label);
            type = CleanType(type);
            using var conn = new SqlConnection(_cs);
            conn.Open();
            if (type == "NUMBER" && old.DataType != "NUMBER")
                using (var chk = new SqlCommand("SELECT TOP 1 Value FROM Nexus.PartFieldValues WHERE FieldID = @id AND TRY_CONVERT(DECIMAL(18, 4), REPLACE(Value, ',', '')) IS NULL", conn))
                {
                    chk.Parameters.AddWithValue("@id", fieldId);
                    if (chk.ExecuteScalar() is string bad) throw new InvalidOperationException($"เปลี่ยนเป็น NUMBER ไม่ได้ - มีค่าที่ไม่ใช่ตัวเลขอยู่แล้ว (เช่น \"{bad}\")");
                }
            using var cmd = new SqlCommand(@"IF EXISTS (SELECT 1 FROM Nexus.PartFieldDefs WHERE StockID = @s AND Label = @l AND FieldID <> @id) THROW 50001, N'dup', 1;
                                             UPDATE Nexus.PartFieldDefs SET Label = @l, DataType = @t, UpdatedAt = SYSDATETIME(), UpdatedBy = @u WHERE FieldID = @id", conn);
            cmd.Parameters.AddWithValue("@s", old.StockId);
            cmd.Parameters.AddWithValue("@l", label);
            cmd.Parameters.AddWithValue("@t", type);
            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@id", fieldId);
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex) when (ex.Number == 50001 || ex.Number == 2627) { throw new InvalidOperationException($"มีช่อง \"{label}\" ในคลังนี้แล้ว"); }
            return (old, new CustomFieldDef { FieldId = fieldId, StockId = old.StockId, Label = label, DataType = type, SortNo = old.SortNo });
        }

        // ลบช่อง + ค่าทั้งหมดของช่องนั้น (CASCADE) · เอาคีย์ออกจากการตั้งค่าที่อ้างถึง (ช่องกรอก / คอลัมน์ / คอลัมน์ Store)
        public CustomFieldDef Delete(int fieldId)
        {
            var old = GetDefs().FirstOrDefault(d => d.FieldId == fieldId) ?? throw new InvalidOperationException("ไม่พบช่องนี้ (อาจถูกลบไปแล้ว)");
            string key = CustomFields.KeyOf(fieldId);
            using var conn = new SqlConnection(_cs);
            conn.Open();
            using var tr = conn.BeginTransaction();
            using (var cmd = new SqlCommand("DELETE FROM Nexus.PartFieldDefs WHERE FieldID = @id", conn, tr))
            {
                cmd.Parameters.AddWithValue("@id", fieldId);
                cmd.ExecuteNonQuery();
            }
            // คีย์ในรายการคั่นด้วย , -> ตัดออก (",CF12," -> ",")
            string strip(string col) => $"{col} = SUBSTRING(REPLACE(',' + ISNULL({col}, '') + ',', ',{key},', ','), 2, LEN(REPLACE(',' + ISNULL({col}, '') + ',', ',{key},', ',')) - 2)";
            var sets = new List<string> { $"UPDATE Nexus.ProductControlSettings SET {strip("ColumnOrder")} WHERE ',' + ISNULL(ColumnOrder, '') + ',' LIKE '%,{key},%'" };
            if (Nexus.Helpers.DbSchema.HasFormFields)
                sets.Add($"UPDATE Nexus.ProductControlSettings SET {strip("FormFields")} WHERE ',' + ISNULL(FormFields, '') + ',' LIKE '%,{key},%'");
            if (Nexus.Helpers.DbSchema.HasColumnOrder)
                sets.Add($"UPDATE Nexus.Stocks SET {strip("ColumnOrder")} WHERE ',' + ISNULL(ColumnOrder, '') + ',' LIKE '%,{key},%'");
            foreach (var sql in sets)
                using (var cmd = new SqlCommand(sql, conn, tr)) cmd.ExecuteNonQuery();
            tr.Commit();
            return old;
        }

        // ค่าของสินค้า: PartID -> (FieldID -> ค่า) · fieldIds ว่าง = ทุกช่อง
        public Dictionary<int, Dictionary<int, string>> GetValues(IEnumerable<int> partIds, IEnumerable<int> fieldIds = null)
        {
            var map = new Dictionary<int, Dictionary<int, string>>();
            if (!Ready) return map;
            var ids = partIds.Distinct().ToList();
            var fids = fieldIds?.Distinct().ToList();
            if (ids.Count == 0 || fids is { Count: 0 }) return map;
            using var conn = new SqlConnection(_cs);
            conn.Open();
            foreach (var chunk in ids.Chunk(1500))
            {
                using var cmd = new SqlCommand($@"SELECT v.PartID, v.FieldID, v.Value FROM Nexus.PartFieldValues v
                                                  WHERE v.PartID IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
                                                  {(fids == null ? "" : "AND v.FieldID IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@f, ','))")}", conn);
                cmd.Parameters.AddWithValue("@ids", string.Join(",", chunk));
                if (fids != null) cmd.Parameters.AddWithValue("@f", string.Join(",", fids));
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    int p = r.GetInt32(0);
                    if (!map.TryGetValue(p, out var d)) map[p] = d = new Dictionary<int, string>();
                    d[r.GetInt32(1)] = r.GetString(2);
                }
            }
            return map;
        }

        // สินค้าในทะเบียนของคลัง: PART A -> PartID / PD CODE -> PartID (ใช้จับคู่แถวของคลัง Live View)
        public (Dictionary<string, int> ByPartA, Dictionary<string, int> ByCode) PartKeysInStock(int stockId, bool isMain)
        {
            var a = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var c = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand(isMain
                ? "SELECT PartID, PartA, PartCode FROM Nexus.Parts WHERE IsActive = 1 AND IsShowInMaster = 1"
                : "SELECT p.PartID, p.PartA, p.PartCode FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID WHERE ps.StockID = @s AND p.IsActive = 1", conn);
            cmd.Parameters.AddWithValue("@s", stockId);
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                int id = r.GetInt32(0);
                string pa = r.IsDBNull(1) ? "" : r.GetString(1).Trim(), pc = r.IsDBNull(2) ? "" : r.GetString(2).Trim();
                if (pa.Length > 0 && pa != "-") a.TryAdd(pa, id);
                if (pc.Length > 0 && pc != "-") c.TryAdd(pc, id);
            }
            return (a, c);
        }

        // ตรวจ / จัดรูปค่าตามชนิดช่อง · ผิด = InvalidOperationException
        public static string Normalize(CustomFieldDef d, string value)
        {
            value = (value ?? "").Trim();
            if (value.Length == 0) return "";
            if (value.Length > 400) throw new InvalidOperationException($"{d.Label}: ยาวได้ไม่เกิน 400 ตัวอักษร");
            if (d.DataType == "NUMBER")
            {
                if (!decimal.TryParse(value.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var n)) throw new InvalidOperationException($"{d.Label}: ต้องเป็นตัวเลข");
                return n.ToString("0.####", CultureInfo.InvariantCulture);
            }
            if (d.DataType == "DATE")
            {
                string[] f = { "yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "yyyy/MM/dd" };
                if (!DateTime.TryParseExact(value, f, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) &&
                    !DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out dt)) throw new InvalidOperationException($"{d.Label}: วันที่ไม่ถูกต้อง (เช่น 2026-10-28)");
                if (dt.Year > 2500) dt = dt.AddYears(-543);   // ปี พ.ศ.
                return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }
            return value;
        }

        // บันทึกค่าของสินค้า 1 ตัว (เฉพาะช่องที่ส่งมา): ว่าง = ลบค่า · คืนรายการที่เปลี่ยน "ชื่อช่อง: เดิม->ใหม่"
        public List<string> SaveValues(int partId, IDictionary<int, string> values, string userId, SqlConnection conn = null, SqlTransaction tr = null)
        {
            var changed = new List<string>();
            if (!Ready || values == null || values.Count == 0 || partId <= 0) return changed;
            var defs = GetDefs().ToDictionary(d => d.FieldId);
            var clean = new Dictionary<int, string>();
            foreach (var kv in values)
                if (defs.TryGetValue(kv.Key, out var d)) clean[kv.Key] = Normalize(d, kv.Value);
            if (clean.Count == 0) return changed;
            var old = GetValues(new[] { partId }, clean.Keys).TryGetValue(partId, out var o) ? o : new Dictionary<int, string>();
            bool own = conn == null;
            conn ??= new SqlConnection(_cs);
            try
            {
                if (own) conn.Open();
                foreach (var kv in clean)
                {
                    string was = old.TryGetValue(kv.Key, out var w) ? w : "";
                    if (was == kv.Value) continue;
                    using var cmd = new SqlCommand(kv.Value.Length == 0
                        ? "DELETE FROM Nexus.PartFieldValues WHERE FieldID = @f AND PartID = @p"
                        : @"UPDATE Nexus.PartFieldValues SET Value = @v, UpdatedAt = SYSDATETIME(), UpdatedBy = @u WHERE FieldID = @f AND PartID = @p;
                            IF @@ROWCOUNT = 0 INSERT INTO Nexus.PartFieldValues (FieldID, PartID, Value, UpdatedBy) VALUES (@f, @p, @v, @u);", conn, tr);
                    cmd.Parameters.AddWithValue("@f", kv.Key);
                    cmd.Parameters.AddWithValue("@p", partId);
                    cmd.Parameters.AddWithValue("@v", kv.Value);
                    cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                    cmd.ExecuteNonQuery();
                    changed.Add($"{defs[kv.Key].Label}: {(was.Length == 0 ? "-" : was)}->{(kv.Value.Length == 0 ? "-" : kv.Value)}");
                }
            }
            finally { if (own) conn.Dispose(); }
            return changed;
        }
    }
}
