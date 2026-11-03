using Microsoft.Data.SqlClient;
using Nexus.Core;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Nexus.Services
{
    // 🧩 ตั้งค่าชนิดข้อมูล + หน่วย ของช่องกรอกเพิ่มเอง (database/nexus/15_Custom_Field_Types_Units.sql)
    //   ชนิดสำเร็จรูป = ชนิดพื้นฐาน + หน่วยเริ่มต้น (เลือกตอนเพิ่มช่อง แล้วช่องเก็บเป็นชนิดพื้นฐาน + หน่วย - แก้ / ลบชนิดสำเร็จรูปไม่กระทบช่องเดิม)
    //   หน่วย = รายการให้เลือกของช่อง NUMBER แยกกลุ่ม (ลบหน่วยไม่กระทบช่องที่ใช้หน่วยนั้นอยู่)
    public sealed class FieldPreset
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string BaseType { get; set; }
        public string Unit { get; set; }
        public int SortNo { get; set; }
    }

    public sealed class FieldUnit
    {
        public int Id { get; set; }
        public string Unit { get; set; }
        public string Group { get; set; }
        public int SortNo { get; set; }
    }

    public class FieldPresetService
    {
        private readonly string _cs = GlobalConfig.ConnStr;
        public static readonly string[] Groups = { "WEIGHT", "COUNT", "LENGTH", "VOLUME", "TIME", "OTHER" };

        private static bool? _ready;
        public static bool Ready
        {
            get
            {
                if (_ready == true) return true;
                try
                {
                    using var conn = new SqlConnection(GlobalConfig.ConnStr);
                    using var cmd = new SqlCommand("SELECT CASE WHEN OBJECT_ID('Nexus.PartFieldTypes','U') IS NOT NULL AND OBJECT_ID('Nexus.PartFieldUnits','U') IS NOT NULL THEN 1 ELSE 0 END", conn);
                    conn.Open();
                    _ready = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
                catch { _ready = false; }
                return _ready == true;
            }
        }

        private void Require()
        {
            if (!Ready) throw new InvalidOperationException("ฐานข้อมูลยังไม่รองรับ กรุณารัน database/nexus/15_Custom_Field_Types_Units.sql");
        }

        private static string Clean(string v, int max, string what)
        {
            v = Regex.Replace((v ?? "").Trim(), @"\s+", " ").ToUpperInvariant();
            if (v.Length == 0) throw new InvalidOperationException($"กรุณากรอก{what}");
            if (v.Length > max) throw new InvalidOperationException($"{what}ยาวได้ไม่เกิน {max} ตัวอักษร");
            if (v.Contains(',') || v.Contains('|')) throw new InvalidOperationException($"{what}ห้ามมี , หรือ |");
            return v;
        }

        private static string CleanBase(string t)
        {
            t = (t ?? "").Trim().ToUpperInvariant();
            if (!CustomFields.Types.Contains(t)) throw new InvalidOperationException("ชนิดพื้นฐานไม่ถูกต้อง");
            return t;
        }

        private static string CleanGroup(string g)
        {
            g = (g ?? "").Trim().ToUpperInvariant();
            return Groups.Contains(g) ? g : "OTHER";
        }

        private int Exec(string sql, Action<SqlCommand> bind)
        {
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand(sql, conn);
            bind(cmd);
            conn.Open();
            try { return Convert.ToInt32(cmd.ExecuteScalar() ?? 0); }
            catch (SqlException ex) when (ex.Number == 2627 || ex.Number == 2601) { throw new InvalidOperationException("มีชื่อนี้อยู่แล้ว"); }
        }

        // ---------------------------------------------------------------- ชนิดสำเร็จรูป
        public List<FieldPreset> GetTypes()
        {
            var list = new List<FieldPreset>();
            if (!Ready) return list;
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand("SELECT TypeID, Name, BaseType, Unit, SortNo FROM Nexus.PartFieldTypes ORDER BY SortNo, TypeID", conn);
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(new FieldPreset { Id = r.GetInt32(0), Name = r.GetString(1), BaseType = r.GetString(2), Unit = r.IsDBNull(3) ? null : r.GetString(3), SortNo = r.GetInt32(4) });
            return list;
        }

        public void SaveType(int id, string name, string baseType, string unit, string userId)
        {
            Require();
            name = Clean(name, 40, "ชื่อชนิด");
            baseType = CleanBase(baseType);
            unit = baseType == "NUMBER" && !string.IsNullOrWhiteSpace(unit) ? Clean(unit, 20, "หน่วย") : null;
            Exec(id > 0
                ? "UPDATE Nexus.PartFieldTypes SET Name = @n, BaseType = @b, Unit = @u WHERE TypeID = @id; SELECT @@ROWCOUNT;"
                : "INSERT INTO Nexus.PartFieldTypes (Name, BaseType, Unit, SortNo, CreatedBy) VALUES (@n, @b, @u, (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM Nexus.PartFieldTypes), @by); SELECT SCOPE_IDENTITY();",
                c =>
                {
                    c.Parameters.AddWithValue("@id", id);
                    c.Parameters.AddWithValue("@n", name);
                    c.Parameters.AddWithValue("@b", baseType);
                    c.Parameters.AddWithValue("@u", (object)unit ?? DBNull.Value);
                    c.Parameters.AddWithValue("@by", (object)userId ?? DBNull.Value);
                });
        }

        public void DeleteType(int id)
        {
            Require();
            Exec("DELETE FROM Nexus.PartFieldTypes WHERE TypeID = @id; SELECT @@ROWCOUNT;", c => c.Parameters.AddWithValue("@id", id));
        }

        // ---------------------------------------------------------------- หน่วย
        public List<FieldUnit> GetUnits()
        {
            var list = new List<FieldUnit>();
            if (!Ready) return list;
            using var conn = new SqlConnection(_cs);
            using var cmd = new SqlCommand("SELECT UnitID, Unit, GroupName, SortNo FROM Nexus.PartFieldUnits ORDER BY SortNo, UnitID", conn);
            conn.Open();
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(new FieldUnit { Id = r.GetInt32(0), Unit = r.GetString(1), Group = r.GetString(2), SortNo = r.GetInt32(3) });
            return list;
        }

        public void SaveUnit(int id, string unit, string group, string userId)
        {
            Require();
            unit = Clean(unit, 20, "หน่วย");
            group = CleanGroup(group);
            Exec(id > 0
                ? "UPDATE Nexus.PartFieldUnits SET Unit = @n, GroupName = @g WHERE UnitID = @id; SELECT @@ROWCOUNT;"
                : "INSERT INTO Nexus.PartFieldUnits (Unit, GroupName, SortNo, CreatedBy) VALUES (@n, @g, (SELECT ISNULL(MAX(SortNo), 0) + 1 FROM Nexus.PartFieldUnits), @by); SELECT SCOPE_IDENTITY();",
                c =>
                {
                    c.Parameters.AddWithValue("@id", id);
                    c.Parameters.AddWithValue("@n", unit);
                    c.Parameters.AddWithValue("@g", group);
                    c.Parameters.AddWithValue("@by", (object)userId ?? DBNull.Value);
                });
        }

        public void DeleteUnit(int id)
        {
            Require();
            Exec("DELETE FROM Nexus.PartFieldUnits WHERE UnitID = @id; SELECT @@ROWCOUNT;", c => c.Parameters.AddWithValue("@id", id));
        }
    }
}
