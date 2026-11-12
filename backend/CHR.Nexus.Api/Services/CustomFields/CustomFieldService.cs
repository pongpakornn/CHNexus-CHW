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
        // SELECT = DROPDOWN เลือกจากรายการ (Nexus.PartFieldOptions - database/nexus/13_Custom_Field_Unit_Dropdown.sql)
        public static readonly string[] Types = { "TEXT", "NUMBER", "DATE", "SELECT" };
    }

    public sealed class CustomFieldOption
    {
        public int OptionId { get; set; }
        public string Value { get; set; }
        public int SortNo { get; set; }
        public int Uses { get; set; }   // จำนวนสินค้าที่เลือกค่านี้อยู่
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
        public string Unit { get; set; }   // หน่วยของช่อง NUMBER เช่น KG
        public List<CustomFieldOption> Options { get; set; } = new();   // รายการของช่อง DROPDOWN
        public DateTime? CreatedAt { get; set; }   // สร้างเมื่อ (ป้าย NEW 4 สัปดาห์)
        public bool Suggest { get; set; }          // แสดงค่าที่เคยกรอกให้เลือก (14_Custom_Field_Suggest_Auto.sql)
        public string AutoFrom { get; set; }       // ช่องต้นทางที่เติมค่าให้อัตโนมัติ เช่น SUPPLIER / CODE / CF12

        // ค่าที่แสดงในตาราง: ตัวเลข + หน่วย (12 KG)
        public string Display(string value) =>
            string.IsNullOrEmpty(value) ? value : DataType == "NUMBER" && !string.IsNullOrWhiteSpace(Unit) ? $"{value} {Unit}" : value;
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

        // 13_Custom_Field_Unit_Dropdown.sql: หน่วย + DROPDOWN
        private static bool? _v2;
        public static bool HasUnitAndOptions
        {
            get
            {
                if (_v2 == true) return true;
                try
                {
                    using var conn = new SqlConnection(GlobalConfig.ConnStr);
                    using var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.PartFieldDefs','Unit') IS NOT NULL AND OBJECT_ID('Nexus.PartFieldOptions','U') IS NOT NULL THEN 1 ELSE 0 END", conn);
                    conn.Open();
                    _v2 = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
                catch { _v2 = false; }
                return _v2 == true;
            }
        }

        // 14_Custom_Field_Suggest_Auto.sql: ช่วยกรอก (แสดงค่าที่เคยกรอก / เติมอัตโนมัติจากช่องอื่น)
        private static bool? _v3;
        public static bool HasHelpers
        {
            get
            {
                if (_v3 == true) return true;
                try
                {
                    using var conn = new SqlConnection(GlobalConfig.ConnStr);
                    using var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.PartFieldDefs','Suggest') IS NOT NULL AND COL_LENGTH('Nexus.PartFieldDefs','AutoFrom') IS NOT NULL THEN 1 ELSE 0 END", conn);
                    conn.Open();
                    _v3 = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
                catch { _v3 = false; }
                return _v3 == true;
            }
        }

        // ช่องต้นทางของระบบที่ใช้เติมค่าอัตโนมัติ -> คอลัมน์ใน Nexus.Parts
        public static readonly Dictionary<string, string> AutoSources = new(StringComparer.OrdinalIgnoreCase)
        {
            ["SUPPLIER"] = "Supplier", ["CUSTOMER"] = "Customer", ["CATEGORY"] = "Category", ["MODEL"] = "Model", ["CODE"] = "PartCode",
            ["PARTA"] = "PartA", ["PARTB"] = "PartB", ["PARTNO"] = "PartNumber", ["NAME"] = "Description", ["BIN"] = "Bin", ["PACKSIZE"] = "PackSize"
        };

        // ช่องทั้งหมด (stockId = null) หรือเฉพาะคลัง · ช่อง DROPDOWN พร้อมรายการ (เรียงตามลำดับ)
        public List<CustomFieldDef> GetDefs(int? stockId = null)
        {
            var list = new List<CustomFieldDef>();
            if (!Ready) return list;
            bool v2 = HasUnitAndOptions, v3 = HasHelpers;
            using var conn = new SqlConnection(_cs);
            conn.Open();
            using (var cmd = new SqlCommand($@"SELECT d.FieldID, d.StockID, d.Label, d.DataType, d.SortNo,
                                                      (SELECT COUNT(*) FROM Nexus.PartFieldValues v WHERE v.FieldID = d.FieldID), {(v2 ? "d.Unit" : "NULL")},
                                                      d.CreatedAt, {(v3 ? "d.Suggest, d.AutoFrom" : "CAST(0 AS BIT), NULL")}
                                               FROM Nexus.PartFieldDefs d WHERE (@s IS NULL OR d.StockID = @s) ORDER BY d.StockID, d.SortNo, d.FieldID", conn))
            {
                cmd.Parameters.AddWithValue("@s", (object)stockId ?? DBNull.Value);
                using var r = cmd.ExecuteReader();
                while (r.Read())
                    list.Add(new CustomFieldDef { FieldId = r.GetInt32(0), StockId = r.GetInt32(1), Label = r.GetString(2), DataType = r.GetString(3), SortNo = r.GetInt32(4), ValueCount = r.GetInt32(5), Unit = r.IsDBNull(6) ? null : r.GetString(6),
                                                  CreatedAt = r.IsDBNull(7) ? null : r.GetDateTime(7), Suggest = !r.IsDBNull(8) && r.GetBoolean(8), AutoFrom = r.IsDBNull(9) ? null : r.GetString(9) });
            }
            if (v2 && list.Any(d => d.DataType == "SELECT"))
                using (var cmd = new SqlCommand(@"SELECT o.FieldID, o.OptionID, o.Value, o.SortNo,
                                                         (SELECT COUNT(*) FROM Nexus.PartFieldValues v WHERE v.FieldID = o.FieldID AND v.Value = o.Value)
                                                  FROM Nexus.PartFieldOptions o JOIN Nexus.PartFieldDefs d ON d.FieldID = o.FieldID
                                                  WHERE (@s IS NULL OR d.StockID = @s) ORDER BY o.FieldID, o.SortNo, o.OptionID", conn))
                {
                    cmd.Parameters.AddWithValue("@s", (object)stockId ?? DBNull.Value);
                    var byId = list.ToDictionary(d => d.FieldId);
                    using var r = cmd.ExecuteReader();
                    while (r.Read())
                        if (byId.TryGetValue(r.GetInt32(0), out var d))
                            d.Options.Add(new CustomFieldOption { OptionId = r.GetInt32(1), Value = r.GetString(2), SortNo = r.GetInt32(3), Uses = r.GetInt32(4) });
                }
            return list;
        }

        private static string CleanUnit(string type, string unit)
        {
            if (type != "NUMBER") return null;
            unit = Regex.Replace((unit ?? "").Trim(), @"\s+", " ").ToUpperInvariant();
            if (unit.Length > 20) throw new InvalidOperationException("หน่วยยาวได้ไม่เกิน 20 ตัวอักษร");
            return unit.Length == 0 ? null : unit;
        }

        private void RequireV2(string type)
        {
            if (type == "SELECT" && !HasUnitAndOptions) throw new InvalidOperationException("ฐานข้อมูลยังไม่รองรับ DROPDOWN กรุณารัน database/nexus/13_Custom_Field_Unit_Dropdown.sql");
        }

        private static string CleanLabel(string label)
        {
            label = Regex.Replace((label ?? "").Trim(), @"\s+", " ").ToUpperInvariant();
            if (label.Length == 0) throw new InvalidOperationException("กรุณากรอกชื่อช่อง");
            if (label.Length > 60) throw new InvalidOperationException("ชื่อช่องยาวได้ไม่เกิน 60 ตัวอักษร");
            if (label.Contains(',') || label.Contains('|')) throw new InvalidOperationException("ชื่อช่องห้ามมี , หรือ |");
            // ชื่อซ้ำกับช่องของระบบ = สับสนตอน Import Excel
            string[] reserved = { "NO", "IMAGE", "SUPPLIER", "CUSTOMER", "CATEGORY", "MODEL", "PRODUCT CODE", "PD CODE", "PART A", "PART B", "PART NO", "PRODUCT NAME",
                                  "PACKSIZE", "BIN", "MASTER COIL", "NUMBER COIL", "COIL NO", "WEIGHT (KG)", "WEIGHT", "QR CODE", "QTY", "MAX", "MIN", "REMARK", "STOCK" };
            if (reserved.Contains(label)) throw new InvalidOperationException($"ชื่อ \"{label}\" ซ้ำกับช่องของระบบ กรุณาใช้ชื่ออื่น");
            return label;
        }

        private static string CleanType(string t) => CustomFields.Types.Contains((t ?? "").Trim().ToUpperInvariant()) ? t.Trim().ToUpperInvariant() : "TEXT";

        public CustomFieldDef Add(int stockId, string label, string type, string userId, string unit = null)
        {
            label = CleanLabel(label);
            type = CleanType(type);
            RequireV2(type);
            unit = CleanUnit(type, unit);
            bool v2 = HasUnitAndOptions;
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand($@"IF EXISTS (SELECT 1 FROM Nexus.PartFieldDefs WHERE StockID = @s AND Label = @l) THROW 50001, N'dup', 1;
                                             INSERT INTO Nexus.PartFieldDefs (StockID, Label, DataType, SortNo, CreatedBy{(v2 ? ", Unit" : "")})
                                             OUTPUT inserted.FieldID
                                             VALUES (@s, @l, @t, (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM Nexus.PartFieldDefs WHERE StockID = @s), @u{(v2 ? ", @unit" : "")})", conn);
            cmd.Parameters.AddWithValue("@s", stockId);
            cmd.Parameters.AddWithValue("@l", label);
            cmd.Parameters.AddWithValue("@t", type);
            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@unit", (object)unit ?? DBNull.Value);
            conn.Open();
            try
            {
                int id = Convert.ToInt32(cmd.ExecuteScalar());
                return new CustomFieldDef { FieldId = id, StockId = stockId, Label = label, DataType = type, Unit = unit };
            }
            catch (SqlException ex) when (ex.Number == 50001 || ex.Number == 2627) { throw new InvalidOperationException($"มีช่อง \"{label}\" ในคลังนี้แล้ว"); }
        }

        // แก้ชื่อ / ชนิด · คืนค่าเดิม (ไว้ลง Log)
        public (CustomFieldDef Old, CustomFieldDef New) Update(int fieldId, string label, string type, string userId, string unit = null)
        {
            var old = GetDefs().FirstOrDefault(d => d.FieldId == fieldId) ?? throw new InvalidOperationException("ไม่พบช่องนี้ (อาจถูกลบไปแล้ว)");
            label = CleanLabel(label);
            type = CleanType(type);
            RequireV2(type);
            unit = CleanUnit(type, unit);
            bool v2 = HasUnitAndOptions;
            using var conn = new SqlConnection(_cs);
            conn.Open();
            if (type == "NUMBER" && old.DataType != "NUMBER")
                using (var chk = new SqlCommand("SELECT TOP 1 Value FROM Nexus.PartFieldValues WHERE FieldID = @id AND TRY_CONVERT(DECIMAL(18, 4), REPLACE(Value, ',', '')) IS NULL", conn))
                {
                    chk.Parameters.AddWithValue("@id", fieldId);
                    if (chk.ExecuteScalar() is string bad) throw new InvalidOperationException($"เปลี่ยนเป็น NUMBER ไม่ได้ - มีค่าที่ไม่ใช่ตัวเลขอยู่แล้ว (เช่น \"{bad}\")");
                }
            // เปลี่ยนเป็น DROPDOWN: ค่าที่กรอกไว้แล้วกลายเป็นรายการให้เลือก (ไม่ต้องกรอกใหม่)
            if (type == "SELECT" && old.DataType != "SELECT")
                using (var cp = new SqlCommand(@"INSERT INTO Nexus.PartFieldOptions (FieldID, Value, SortNo, CreatedBy)
                                                 SELECT @id, x.Value, ROW_NUMBER() OVER (ORDER BY x.Value), @u
                                                 FROM (SELECT DISTINCT LEFT(Value, 200) AS Value FROM Nexus.PartFieldValues WHERE FieldID = @id) x
                                                 WHERE NOT EXISTS (SELECT 1 FROM Nexus.PartFieldOptions o WHERE o.FieldID = @id AND o.Value = x.Value)", conn))
                {
                    cp.Parameters.AddWithValue("@id", fieldId);
                    cp.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                    cp.ExecuteNonQuery();
                }
            using var cmd = new SqlCommand($@"IF EXISTS (SELECT 1 FROM Nexus.PartFieldDefs WHERE StockID = @s AND Label = @l AND FieldID <> @id) THROW 50001, N'dup', 1;
                                             UPDATE Nexus.PartFieldDefs SET Label = @l, DataType = @t{(v2 ? ", Unit = @unit" : "")}, UpdatedAt = SYSDATETIME(), UpdatedBy = @u WHERE FieldID = @id", conn);
            cmd.Parameters.AddWithValue("@unit", (object)unit ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@s", old.StockId);
            cmd.Parameters.AddWithValue("@l", label);
            cmd.Parameters.AddWithValue("@t", type);
            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@id", fieldId);
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex) when (ex.Number == 50001 || ex.Number == 2627) { throw new InvalidOperationException($"มีช่อง \"{label}\" ในคลังนี้แล้ว"); }
            return (old, new CustomFieldDef { FieldId = fieldId, StockId = old.StockId, Label = label, DataType = type, SortNo = old.SortNo, Unit = unit });
        }

        // ---------------------------------------------------------------- ช่วยกรอก
        // ตั้ง "แสดงค่าที่เคยกรอก" + "เติมอัตโนมัติจากช่อง" (ต้นทาง = ช่องของระบบ หรือช่องเพิ่มเองของคลังเดียวกัน ไม่ใช่ตัวเอง)
        public void SetHelpers(int fieldId, bool suggest, string autoFrom, string userId)
        {
            if (!HasHelpers) throw new InvalidOperationException("ฐานข้อมูลยังไม่รองรับการช่วยกรอก กรุณารัน database/nexus/14_Custom_Field_Suggest_Auto.sql");
            var d = GetDefs().FirstOrDefault(x => x.FieldId == fieldId) ?? throw new InvalidOperationException("ไม่พบช่องนี้ (อาจถูกลบไปแล้ว)");
            autoFrom = string.IsNullOrWhiteSpace(autoFrom) ? null : autoFrom.Trim().ToUpperInvariant();
            if (autoFrom != null && !AutoSources.ContainsKey(autoFrom))
            {
                int src = CustomFields.IdOf(autoFrom);
                if (src == 0 || src == fieldId || !GetDefs(d.StockId).Any(x => x.FieldId == src)) throw new InvalidOperationException("ช่องต้นทางของการเติมอัตโนมัติไม่ถูกต้อง");
            }
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand("UPDATE Nexus.PartFieldDefs SET Suggest = @g, AutoFrom = @a, UpdatedAt = SYSDATETIME(), UpdatedBy = @u WHERE FieldID = @id", conn);
            cmd.Parameters.AddWithValue("@g", suggest);
            cmd.Parameters.AddWithValue("@a", (object)autoFrom ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@id", fieldId);
            conn.Open();
            cmd.ExecuteNonQuery();
        }

        // ใช้ช่องที่มีอยู่แล้วกับคลังอื่น: สร้างช่องชื่อ / ชนิด / หน่วย / การช่วยกรอกเดียวกัน + รายการ DROPDOWN (ค่าของสินค้าแยกตามคลัง)
        public CustomFieldDef CopyTo(int fieldId, int stockId, string userId)
        {
            var src = GetDefs().FirstOrDefault(x => x.FieldId == fieldId) ?? throw new InvalidOperationException("ไม่พบช่องนี้ (อาจถูกลบไปแล้ว)");
            if (src.StockId == stockId) throw new InvalidOperationException("ช่องนี้อยู่ในคลังนี้แล้ว");
            var d = Add(stockId, src.Label, src.DataType, userId, src.Unit);
            if (src.DataType == "SELECT" && src.Options.Count > 0)
            {
                using var conn = new SqlConnection(_cs);
                using var cmd = new SqlCommand(@"INSERT INTO Nexus.PartFieldOptions (FieldID, Value, SortNo, CreatedBy)
                                                 SELECT @to, o.Value, o.SortNo, @u FROM Nexus.PartFieldOptions o WHERE o.FieldID = @from", conn);
                cmd.Parameters.AddWithValue("@to", d.FieldId);
                cmd.Parameters.AddWithValue("@from", fieldId);
                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                conn.Open();
                cmd.ExecuteNonQuery();
            }
            // ต้นทางเป็นช่องของระบบ = ใช้ได้ทุกคลัง · ต้นทางเป็นช่องเพิ่มเองของคลังเดิม = ไม่คัดลอก
            if (HasHelpers && (src.Suggest || (src.AutoFrom != null && AutoSources.ContainsKey(src.AutoFrom))))
                SetHelpers(d.FieldId, src.Suggest, src.AutoFrom != null && AutoSources.ContainsKey(src.AutoFrom) ? src.AutoFrom : null, userId);
            return d;
        }

        // ค่าที่เคยกรอกของช่องชื่อเดียวกันทุกคลัง (ใช้บ่อยก่อน) สูงสุด 200 ค่า
        public List<string> Suggestions(int fieldId)
        {
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand(@"SELECT TOP 200 v.Value FROM Nexus.PartFieldValues v
                                             JOIN Nexus.PartFieldDefs d ON d.FieldID = v.FieldID
                                             WHERE d.Label = (SELECT Label FROM Nexus.PartFieldDefs WHERE FieldID = @id) AND LTRIM(RTRIM(v.Value)) <> ''
                                             GROUP BY v.Value ORDER BY COUNT(*) DESC, v.Value", conn);
            cmd.Parameters.AddWithValue("@id", fieldId);
            conn.Open();
            var list = new List<string>();
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(r.GetString(0));
            return list;
        }

        // เติมอัตโนมัติ: ค่าล่าสุดของช่องนี้ (ชื่อเดียวกันทุกคลัง) จากสินค้าที่ช่องต้นทาง = value · ไม่เจอ = null
        public string AutoValue(int fieldId, string value)
        {
            value = (value ?? "").Trim();
            if (value.Length == 0 || !HasHelpers) return null;
            var d = GetDefs().FirstOrDefault(x => x.FieldId == fieldId);
            if (d?.AutoFrom == null) return null;
            string match;
            int srcField = 0;
            if (AutoSources.TryGetValue(d.AutoFrom, out var col)) match = $"LTRIM(RTRIM(p.[{col}])) = @v";
            else
            {
                srcField = CustomFields.IdOf(d.AutoFrom);
                if (srcField == 0) return null;
                match = @"EXISTS (SELECT 1 FROM Nexus.PartFieldValues s JOIN Nexus.PartFieldDefs sd ON sd.FieldID = s.FieldID
                                  WHERE s.PartID = p.PartID AND sd.Label = (SELECT Label FROM Nexus.PartFieldDefs WHERE FieldID = @src) AND LTRIM(RTRIM(s.Value)) = @v)";
            }
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand($@"SELECT TOP 1 v.Value FROM Nexus.PartFieldValues v
                                             JOIN Nexus.PartFieldDefs d ON d.FieldID = v.FieldID
                                             JOIN Nexus.Parts p ON p.PartID = v.PartID
                                             WHERE d.Label = @l AND LTRIM(RTRIM(v.Value)) <> '' AND {match}
                                             ORDER BY v.UpdatedAt DESC", conn);
            cmd.Parameters.AddWithValue("@l", d.Label);
            cmd.Parameters.AddWithValue("@v", value);
            cmd.Parameters.AddWithValue("@src", srcField);
            conn.Open();
            return cmd.ExecuteScalar() as string;
        }

        // ---------------------------------------------------------------- รายการของ DROPDOWN
        private CustomFieldDef SelectField(int fieldId)
        {
            if (!HasUnitAndOptions) throw new InvalidOperationException("ฐานข้อมูลยังไม่รองรับ DROPDOWN กรุณารัน database/nexus/13_Custom_Field_Unit_Dropdown.sql");
            var d = GetDefs().FirstOrDefault(x => x.FieldId == fieldId) ?? throw new InvalidOperationException("ไม่พบช่องนี้ (อาจถูกลบไปแล้ว)");
            if (d.DataType != "SELECT") throw new InvalidOperationException($"ช่อง {d.Label} ไม่ใช่ DROPDOWN");
            return d;
        }

        private static string CleanOption(string v)
        {
            v = Regex.Replace((v ?? "").Trim(), @"\s+", " ");
            if (v.Length == 0) throw new InvalidOperationException("กรุณากรอกรายการ");
            if (v.Length > 200) throw new InvalidOperationException("รายการยาวได้ไม่เกิน 200 ตัวอักษร");
            return v;
        }

        public (CustomFieldDef Field, string Value) AddOption(int fieldId, string value, string userId)
        {
            var d = SelectField(fieldId);
            value = CleanOption(value);
            if (d.Options.Any(o => string.Equals(o.Value, value, StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException($"มีรายการ \"{value}\" แล้ว");
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand(@"INSERT INTO Nexus.PartFieldOptions (FieldID, Value, SortNo, CreatedBy)
                                             VALUES (@f, @v, (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM Nexus.PartFieldOptions WHERE FieldID = @f), @u)", conn);
            cmd.Parameters.AddWithValue("@f", fieldId);
            cmd.Parameters.AddWithValue("@v", value);
            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
            conn.Open();
            cmd.ExecuteNonQuery();
            return (d, value);
        }

        // แก้ชื่อรายการ: สินค้าที่เลือกค่าเดิมไว้ เปลี่ยนเป็นค่าใหม่ตาม · คืน (ช่อง, ค่าเดิม, จำนวนสินค้าที่เปลี่ยน)
        public (CustomFieldDef Field, string Old, int Changed) RenameOption(int optionId, string value, string userId)
        {
            value = CleanOption(value);
            var (d, o) = FindOption(optionId);
            if (d.Options.Any(x => x.OptionId != optionId && string.Equals(x.Value, value, StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException($"มีรายการ \"{value}\" แล้ว");
            using var conn = new SqlConnection(_cs);
            conn.Open();
            using var tr = conn.BeginTransaction();
            int n;
            using (var cmd = new SqlCommand(@"UPDATE Nexus.PartFieldOptions SET Value = @v WHERE OptionID = @o;
                                              UPDATE Nexus.PartFieldValues SET Value = @v, UpdatedAt = SYSDATETIME(), UpdatedBy = @u WHERE FieldID = @f AND Value = @old;", conn, tr))
            {
                cmd.Parameters.AddWithValue("@v", value);
                cmd.Parameters.AddWithValue("@o", optionId);
                cmd.Parameters.AddWithValue("@f", d.FieldId);
                cmd.Parameters.AddWithValue("@old", o.Value);
                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                n = cmd.ExecuteNonQuery() - 1;
            }
            tr.Commit();
            return (d, o.Value, Math.Max(0, n));
        }

        // ลบรายการ: สินค้าที่เลือกค่านี้ไว้ = ค่าว่าง · คืน (ช่อง, ค่า, จำนวนสินค้าที่ถูกล้างค่า)
        public (CustomFieldDef Field, string Value, int Cleared) DeleteOption(int optionId)
        {
            var (d, o) = FindOption(optionId);
            using var conn = new SqlConnection(_cs);
            conn.Open();
            using var tr = conn.BeginTransaction();
            int n;
            using (var cmd = new SqlCommand("DELETE FROM Nexus.PartFieldValues WHERE FieldID = @f AND Value = @v", conn, tr))
            {
                cmd.Parameters.AddWithValue("@f", d.FieldId);
                cmd.Parameters.AddWithValue("@v", o.Value);
                n = cmd.ExecuteNonQuery();
            }
            using (var cmd = new SqlCommand("DELETE FROM Nexus.PartFieldOptions WHERE OptionID = @o", conn, tr))
            {
                cmd.Parameters.AddWithValue("@o", optionId);
                cmd.ExecuteNonQuery();
            }
            tr.Commit();
            return (d, o.Value, n);
        }

        // เรียงลำดับรายการตาม optionIds
        public CustomFieldDef OrderOptions(int fieldId, List<int> optionIds)
        {
            var d = SelectField(fieldId);
            var ids = (optionIds ?? new()).Where(id => d.Options.Any(o => o.OptionId == id)).Distinct().ToList();
            ids.AddRange(d.Options.Select(o => o.OptionId).Where(id => !ids.Contains(id)));
            using var conn = new SqlConnection(_cs);
            conn.Open();
            using var tr = conn.BeginTransaction();
            for (int i = 0; i < ids.Count; i++)
                using (var cmd = new SqlCommand("UPDATE Nexus.PartFieldOptions SET SortNo = @n WHERE OptionID = @o AND FieldID = @f", conn, tr))
                {
                    cmd.Parameters.AddWithValue("@n", i + 1);
                    cmd.Parameters.AddWithValue("@o", ids[i]);
                    cmd.Parameters.AddWithValue("@f", fieldId);
                    cmd.ExecuteNonQuery();
                }
            tr.Commit();
            return d;
        }

        private (CustomFieldDef, CustomFieldOption) FindOption(int optionId)
        {
            if (!HasUnitAndOptions) throw new InvalidOperationException("ฐานข้อมูลยังไม่รองรับ DROPDOWN");
            foreach (var d in GetDefs().Where(x => x.DataType == "SELECT"))
                if (d.Options.FirstOrDefault(o => o.OptionId == optionId) is { } o) return (d, o);
            throw new InvalidOperationException("ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)");
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
            if (d.DataType == "SELECT")
            {
                var o = d.Options.FirstOrDefault(x => string.Equals(x.Value, value, StringComparison.OrdinalIgnoreCase))
                        ?? throw new InvalidOperationException($"{d.Label}: \"{value}\" ไม่มีในรายการ DROPDOWN (เพิ่มรายการได้ที่ ADMIN > DROPDOWN LISTS)");
                return o.Value;
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
