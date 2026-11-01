using Nexus.Core;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Nexus.Services
{
    // 🧩 หน้า Inventory Registration: ตารางของแต่ละคลัง (คอลัมน์ตามลำดับ + จัดกลุ่ม) และรูปแบบ QR ที่ Export
    //    เก็บใน Nexus.ProductControlSettings (Update_20261016c.sql) - StockID 0 = ALL STOCKS / ตั้งได้เฉพาะ Level 1 (ปุ่ม ADMIN)
    public class ProductControlLayout
    {
        public int StockId { get; set; }
        public List<string> Columns { get; set; } = new List<string>();
        public string GroupBy { get; set; } = "CATEGORY";    // CATEGORY / CUSTOMER / SUPPLIER / NONE
        // ▣ QR รูปแบบที่ 2 = สิ่งที่อยู่ใน QR (หน้าแสกนอ่าน) คั่นด้วย | ตามลำดับ - ต้องมี PRODUCT CODE เสมอ
        public List<string> QrFields { get; set; } = new List<string>(QrFormat.DefaultFields);
        // ▣ QR รูปแบบที่ 1 = ข้อความใต้ QR ใน PDF บรรทัดละช่อง (บรรทัดแรกตัวหนา)
        public List<string> QrLabel { get; set; } = new List<string>(QrFormat.DefaultLabel);
        // ▣ ตัวคั่นช่องในรูปแบบที่ 2 (เช่น | ; , เว้นวรรค) - ตั้งเองต่อคลัง / ค่าเดิม = |
        public string QrSep { get; set; } = QrFormat.DefaultSep;
        // ✍️ ช่องกรอกลงทะเบียนสินค้าของคลัง (ADMIN > FORM FIELDS) - แยกจากคอลัมน์ตาราง · Template Excel ของคลังใช้ชุดนี้
        public List<string> FormFields { get; set; } = new List<string>(FormFieldList.Default);
        // ค่าเดิม (แอปเวอร์ชันเก่า): CODE = PRODUCT CODE อย่างเดียว / CODE_NAME = อย่างอื่น
        public string QrContent => QrFields.Count == 1 && QrFields[0] == "CODE" ? "CODE" : "CODE_NAME";

        public ProductControlLayout Clone() =>
            new ProductControlLayout { StockId = StockId, Columns = new List<string>(Columns), GroupBy = GroupBy, QrFields = new List<string>(QrFields), QrLabel = new List<string>(QrLabel), QrSep = QrSep, FormFields = new List<string>(FormFields) };
    }

    // ✍️ ช่องกรอกลงทะเบียนสินค้า: PRODUCT CODE / NAME ต้องมีเสมอ · MOTHER / COILNO / WEIGHT ของคลังที่นับ Coil = ของ Coil
    //    WEIGHT ของคลังอื่น = น้ำหนักสินค้า (Nexus.Parts.WeightKG)
    public static class FormFieldList
    {
        public static readonly (string Key, string Label)[] All =
        {
            ("IMAGE", "IMAGE"), ("SUPPLIER", "SUPPLIER"), ("CUSTOMER", "CUSTOMER"), ("CATEGORY", "CATEGORY"), ("MODEL", "MODEL"),
            ("CODE", "PRODUCT CODE"), ("PARTA", "PART A"), ("PARTB", "PART B"), ("PARTNO", "PART NO"), ("NAME", "PRODUCT NAME"),
            ("PACKSIZE", "PACKSIZE"), ("BIN", "BIN"), ("MOTHER", "MASTER COIL"), ("COILNO", "COIL NO"), ("WEIGHT", "WEIGHT (KG)"),
            ("QRCODE", "QR CODE")
        };
        public static readonly string[] Default = { "IMAGE", "SUPPLIER", "CUSTOMER", "CATEGORY", "MODEL", "CODE", "PARTA", "PARTB", "PARTNO", "NAME", "PACKSIZE", "BIN", "MOTHER", "COILNO", "WEIGHT", "QRCODE" };

        public static List<string> Parse(string csv)
        {
            var list = new List<string>();
            foreach (var k in (csv ?? "").Split(','))
            {
                string key = k.Trim().ToUpperInvariant();
                if (key.Length > 0 && (All.Any(c => c.Key == key) || CustomFields.IsKey(key)) && !list.Contains(key)) list.Add(key);
            }
            return Normalize(list);
        }

        // ต้องมี CODE / NAME เสมอ (ไม่มี = ใส่ไว้หน้าสุด)
        public static List<string> Normalize(List<string> list)
        {
            var l = (list ?? new List<string>()).Where(k => All.Any(c => c.Key == k) || CustomFields.IsKey(k)).Distinct().ToList();
            if (!l.Contains("NAME")) l.Insert(0, "NAME");
            if (!l.Contains("CODE")) l.Insert(0, "CODE");
            return l;
        }
    }

    // ▣ รูปแบบ QR ที่ EXPORT QR SELECT สร้าง (ตั้งต่อคลังที่ปุ่ม ADMIN > QR CODE)
    public static class QrFormat
    {
        public const char Sep = '|';
        public const string DefaultSep = "|";
        public static readonly string[] DefaultFields = { "CODE", "NAME" };
        public static readonly string[] DefaultLabel = { "CODE", "NAME" };

        // ตัวคั่นที่ตั้งได้ (ว่าง / ยาวเกิน = | เดิม) - เว้นวรรค / Tab ใช้ได้
        public static string CleanSep(string sep) =>
            string.IsNullOrEmpty(sep) || sep.Length > 5 || sep.IndexOfAny(new[] { '\r', '\n' }) >= 0 ? DefaultSep : sep;

        // ค่าในช่องมีตัวคั่นอยู่ -> เปลี่ยนเป็น / กันตำแหน่งช่องเลื่อนตอนแสกน (ตัวคั่นเป็นเว้นวรรค = ไม่แตะค่า ชื่อสินค้ามีเว้นวรรคได้)
        private static string Escape(string v, string sep) =>
            string.IsNullOrWhiteSpace(sep) ? v : v.Replace(sep, "/");

        // ช่องที่เลือกได้ = คอลัมน์ของตาราง Inventory Registration (ไม่รวม IMAGE / QR CODE)
        public static IEnumerable<(string Key, string Label)> Fields => ProductControlColumns.All.Where(c => c.Key != "IMAGE" && c.Key != "QRCODE");

        public static List<string> Parse(string csv, string[] fallback)
        {
            var list = ProductControlColumns.Parse(csv).Where(k => k != "IMAGE" && k != "QRCODE").ToList();
            return list.Count > 0 ? list : fallback.ToList();
        }

        // ค่าของช่องจากสินค้า (ไม่มี = ว่าง) - ตัด | ในค่าออก กันตำแหน่งช่องเลื่อนตอนแสกน
        //   coils = Coil ที่อยู่ในคลัง (MASTER COIL / COIL NO) จาก GetCoils - มี = ใช้เลข Coil ทั้งหมดคั่นด้วย ,
        public static string Value(Nexus.Models.ProductControlModel m, string key, IDictionary<int, (List<string> Mothers, List<string> Coils)> coils = null, string sep = DefaultSep)
        {
            if ((key == "MOTHER" || key == "COILNO") && coils != null && coils.TryGetValue(m.PtId, out var cl))
                return Escape(string.Join(",", key == "MOTHER" ? cl.Mothers : cl.Coils), sep);
            string v;
            switch (key)
            {
                case "SUPPLIER": v = m.CustomerCode; break;
                case "CUSTOMER": v = m.Customer; break;
                case "CATEGORY": v = m.Category; break;
                case "PARTA": v = m.PartA; break;
                case "PARTB": v = m.PartB; break;
                case "MODEL": v = m.Model; break;
                case "CODE": v = m.PartCode; break;
                case "PARTNO": v = m.PartNo; break;
                case "NAME": v = m.PartName; break;
                case "PACKSIZE": v = m.PackSize; break;
                case "BIN": v = m.Location; break;
                case "MOTHER": v = m.MotherCoil; break;
                case "COILNO": v = m.CoilNo; break;
                default: v = null; break;
            }
            v = (v ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            return v == "-" ? "" : Escape(v, sep);
        }

        // ข้อความใน QR เช่น CODE,NAME,PACKSIZE -> I2AB-01002|ถุงพลาสติก ...|100 (ช่องเดียว = ค่าอย่างเดียว ไม่มีตัวคั่น)
        //   sep = ตัวคั่นของคลัง (ADMIN > QR CODE) เช่น เว้นวรรค -> I2AB-01002 ถุงพลาสติก ... 100
        public static string Content(Nexus.Models.ProductControlModel m, IList<string> fields, IDictionary<int, (List<string> Mothers, List<string> Coils)> coils = null, string sep = DefaultSep)
        {
            sep = CleanSep(sep);
            IEnumerable<string> f = (fields == null || fields.Count == 0) ? DefaultFields : fields;
            var values = f.Select(k => Value(m, k, coils, sep)).ToList();
            return values.All(v => v.Length == 0) ? (m.PartCode ?? "N/A") : string.Join(sep, values);
        }

        // ตัวอย่างในหน้าตั้งค่า: แสดงชื่อช่องแทนค่า
        public static string Sample(IList<string> fields, string sep = DefaultSep) =>
            string.Join(CleanSep(sep), fields.Select(k => ProductControlColumns.Label(k)));

        // ตำแหน่ง PRODUCT CODE ใน QR (เริ่ม 0) - ไม่มี = 0 (QR เดิม)
        public static int CodeIndex(IList<string> fields)
        {
            int i = fields == null ? -1 : fields.IndexOf("CODE");
            return i < 0 ? 0 : i;
        }
    }

    public static class ProductControlColumns
    {
        // คีย์ -> หัวคอลัมน์ (ช่องติ๊กเลือก / หัวตาราง) - ACTION แสดงท้ายสุดเสมอ ช่องติ๊กเลือกแถวอยู่หน้าสุดเสมอ
        public static readonly (string Key, string Label)[] All =
        {
            ("IMAGE", "IMAGE"), ("SUPPLIER", "SUPPLIER"), ("CUSTOMER", "CUSTOMER"), ("CATEGORY", "CATEGORY"),
            ("PARTA", "PART A"), ("PARTB", "PART B"), ("MODEL", "MODEL"), ("CODE", "PRODUCT CODE"), ("PARTNO", "PART NO"),
            ("NAME", "PRODUCT NAME"), ("PACKSIZE", "PACKSIZE"), ("BIN", "BIN"), ("MOTHER", "MASTER COIL"), ("COILNO", "COIL NO"),
            ("QRCODE", "QR CODE")
        };
        public static readonly string[] Groups = { "CATEGORY", "CUSTOMER", "SUPPLIER", "NONE" };

        // ตารางเดิมของหน้านี้ (ALL STOCKS / คลังที่ยังไม่ได้ตั้ง)
        public static readonly string[] DefaultOrder = { "IMAGE", "SUPPLIER", "CATEGORY", "CODE", "NAME", "PACKSIZE", "BIN", "QRCODE" };

        public static string Label(string key) => All.FirstOrDefault(c => c.Key == key).Label ?? key;

        public static List<string> Parse(string csv)
        {
            var list = new List<string>();
            foreach (var k in (csv ?? "").Split(','))
            {
                string key = k.Trim().ToUpperInvariant();
                if (key.Length > 0 && (All.Any(c => c.Key == key) || CustomFields.IsKey(key)) && !list.Contains(key)) list.Add(key);
            }
            return list;
        }

        public static ProductControlLayout Default(int stockId) =>
            new ProductControlLayout { StockId = stockId, Columns = DefaultOrder.ToList(), GroupBy = "CATEGORY" };
    }

    public class ProductControlLayoutService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        // ทุกคลังที่ตั้งไว้ (ยังไม่รัน Update_20261016c.sql = ว่าง -> ใช้ตารางเดิม)
        public Dictionary<int, ProductControlLayout> GetAll()
        {
            var map = new Dictionary<int, ProductControlLayout>();
            if (!Nexus.Helpers.DbSchema.HasProductControlSettings) return map;
            bool qf = Nexus.Helpers.DbSchema.HasQrFields, ff = Nexus.Helpers.DbSchema.HasFormFields, qs = Nexus.Helpers.DbSchema.HasQrSep;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT StockID, ColumnOrder, GroupBy, QrContent" + (qf ? ", QrFields, QrLabel" : ", NULL, NULL") + (ff ? ", FormFields" : ", NULL") + (qs ? ", QrSep" : ", NULL") + " FROM Nexus.ProductControlSettings", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        int id = Convert.ToInt32(r[0]);
                        var cols = ProductControlColumns.Parse(r[1] == DBNull.Value ? null : r[1].ToString());
                        string grp = r[2] == DBNull.Value ? "" : r[2].ToString().Trim().ToUpperInvariant();
                        string qr = r[3] == DBNull.Value ? "" : r[3].ToString().Trim().ToUpperInvariant();
                        map[id] = new ProductControlLayout
                        {
                            StockId = id,
                            Columns = cols.Count > 0 ? cols : ProductControlColumns.DefaultOrder.ToList(),
                            GroupBy = ProductControlColumns.Groups.Contains(grp) ? grp : "CATEGORY",
                            QrFields = qf && r[4] != DBNull.Value ? QrFormat.Parse(r[4].ToString(), QrFormat.DefaultFields)
                                     : (qr == "CODE" ? new List<string> { "CODE" } : QrFormat.DefaultFields.ToList()),
                            QrLabel = qf && r[5] != DBNull.Value ? QrFormat.Parse(r[5].ToString(), QrFormat.DefaultLabel) : QrFormat.DefaultLabel.ToList(),
                            QrSep = QrFormat.CleanSep(r[7] == DBNull.Value ? null : r[7].ToString()),
                            FormFields = r[6] != DBNull.Value ? FormFieldList.Parse(r[6].ToString()) : FormFieldList.Default.ToList()
                        };
                    }
            }
            return map;
        }

        public ProductControlLayout Get(int stockId)
        {
            try { return GetAll().TryGetValue(stockId, out var l) ? l : ProductControlColumns.Default(stockId); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"ProductControlLayout: {ex.Message}"); return ProductControlColumns.Default(stockId); }
        }

        public void Save(IEnumerable<ProductControlLayout> layouts, string userId)
        {
            if (!Nexus.Helpers.DbSchema.HasProductControlSettings)
                throw new InvalidOperationException("ฐานข้อมูลยังไม่รองรับการตั้งค่านี้ กรุณารัน Database/Update_20261016c.sql");
            bool qf = Nexus.Helpers.DbSchema.HasQrFields, ff = Nexus.Helpers.DbSchema.HasFormFields, qs = Nexus.Helpers.DbSchema.HasQrSep;
            string upd = (qf ? ", QrFields = @qf, QrLabel = @ql" : "") + (ff ? ", FormFields = @ff" : "") + (qs ? ", QrSep = @qs" : ""),
                   insCols = (qf ? ", QrFields, QrLabel" : "") + (ff ? ", FormFields" : "") + (qs ? ", QrSep" : ""),
                   insVals = (qf ? ", @qf, @ql" : "") + (ff ? ", @ff" : "") + (qs ? ", @qs" : "");
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    foreach (var l in layouts)
                        using (var cmd = new SqlCommand($@"
                            UPDATE Nexus.ProductControlSettings SET ColumnOrder = @c, GroupBy = @g, QrContent = @q{upd}, UpdatedBy = @u, UpdatedDate = GETDATE() WHERE StockID = @id;
                            IF @@ROWCOUNT = 0
                                INSERT INTO Nexus.ProductControlSettings (StockID, ColumnOrder, GroupBy, QrContent{insCols}, UpdatedBy) VALUES (@id, @c, @g, @q{insVals}, @u);", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@id", l.StockId);
                            cmd.Parameters.AddWithValue("@c", string.Join(",", l.Columns));
                            cmd.Parameters.AddWithValue("@g", l.GroupBy ?? "CATEGORY");
                            cmd.Parameters.AddWithValue("@q", l.QrContent);
                            if (qf)
                            {
                                cmd.Parameters.AddWithValue("@qf", string.Join(",", l.QrFields));
                                cmd.Parameters.AddWithValue("@ql", string.Join(",", l.QrLabel));
                            }
                            if (ff) cmd.Parameters.AddWithValue("@ff", string.Join(",", FormFieldList.Normalize(l.FormFields)));
                            if (qs)
                            {
                                string sep = QrFormat.CleanSep(l.QrSep);
                                cmd.Parameters.AddWithValue("@qs", sep == QrFormat.DefaultSep ? (object)DBNull.Value : sep);
                            }
                            cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                            cmd.ExecuteNonQuery();
                        }
                    trans.Commit();
                }
            }
        }

        // 🧲 Coil ที่อยู่ในคลัง (Status IN) ต่อสินค้า: Master Coil (ไม่ซ้ำ) / เลข Coil ลูก - stkId null = ทุกคลัง
        public Dictionary<int, (List<string> Mothers, List<string> Coils)> GetCoils(int? stkId, int partId = 0)
        {
            var map = new Dictionary<int, (List<string>, List<string>)>();
            if (!Nexus.Helpers.DbSchema.HasCoilRegister) return map;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand(@"SELECT PartID, MotherCoil, CoilNo FROM Nexus.Coils
                                              WHERE Status = 'IN' AND (@stk IS NULL OR StockID = @stk) AND (@pt = 0 OR PartID = @pt)
                                              ORDER BY PartID, MotherCoil, CoilNo", conn))
            {
                cmd.Parameters.AddWithValue("@stk", (object)stkId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@pt", partId);
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        int pid = Convert.ToInt32(r[0]);
                        if (!map.TryGetValue(pid, out var v)) map[pid] = v = (new List<string>(), new List<string>());
                        string m = r[1] == DBNull.Value ? "" : r[1].ToString().Trim();
                        string c = r[2] == DBNull.Value ? "" : r[2].ToString().Trim();
                        if (m.Length == 0) m = c;   // Master ทั้งม้วน (ไม่มี MotherCoil) = Master Coil คือเลขของตัวเอง
                        if (m.Length > 0 && !v.Item1.Contains(m)) v.Item1.Add(m);
                        if (c.Length > 0) v.Item2.Add(c);
                    }
            }
            return map;
        }

        // ▣ หน้าแสกน: รหัสไหนเป็น PRODUCT CODE ที่มีอยู่จริง (QR ระบบที่คลังตั้งรูปแบบต่างกัน)
        public HashSet<string> ExistingCodes(IEnumerable<string> codes)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var list = codes.Where(c => !string.IsNullOrWhiteSpace(c)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (list.Count == 0) return set;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("", conn))
            {
                var names = new List<string>();
                for (int i = 0; i < list.Count; i++) { names.Add("@c" + i); cmd.Parameters.AddWithValue("@c" + i, list[i]); }
                cmd.CommandText = $"SELECT DISTINCT PartCode FROM Nexus.Parts WHERE PartCode IN ({string.Join(",", names)})";
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) if (r[0] != DBNull.Value) set.Add(r[0].ToString().Trim());
            }
            return set;
        }

        // 🔎 ค่าที่มีในระบบแล้ว สำหรับช่อง SUPPLIER / CUSTOMER / CATEGORY (พิมพ์แล้วขึ้นให้เลือก)
        public (List<string> Suppliers, List<string> Customers, List<string> Categories) GetSuggestions()
        {
            List<string> Read(SqlConnection conn, string sql)
            {
                var list = new List<string>();
                using (var cmd = new SqlCommand(sql, conn))
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) if (r[0] != DBNull.Value && r[0].ToString().Trim().Length > 0) list.Add(r[0].ToString().Trim());
                return list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            }
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                return (Read(conn, "SELECT DISTINCT CAST(Supplier AS NVARCHAR(200)) FROM Nexus.Parts WHERE IsActive = 1 ORDER BY 1"),
                        Read(conn, "SELECT DISTINCT Customer FROM Nexus.Parts WHERE IsActive = 1 ORDER BY 1"),
                        Read(conn, "SELECT DISTINCT Category FROM Nexus.Parts WHERE IsActive = 1 ORDER BY 1"));
            }
        }
    }
}
