using Nexus.Core;
using Microsoft.Data.SqlClient;
using System;
using System.Linq;
using System.Text.RegularExpressions;

namespace Nexus.Services
{
    // 📷 ต่อท้าย QR ที่บันทึกตอนสแกนรับเข้า (ตั้งต่อ UserID + คลัง ที่ User Management > PERMISSION > SCAN STOCKS)
    //   เช่น STOCK-CHW: 5T072-4943-1  20 -> 5T072-4943-1  20 2610 KUBOTA 0001 (คั่นด้วยตัวคั่นของ QR คลังนั้น)
    //   DATE    = วันที่ตอนสแกนตามรูปแบบ (YYMM = 2610 / YYMMDD = 261101 ...) - เปลี่ยนเองตามวันจริง
    //   REF     = ค่าของสินค้าที่สแกน ตามช่องที่เลือก (CUSTOMER = KUBOTA / PART A / PART NO / ช่องเพิ่มเอง ...)
    //   RUNNING = เลขรันของคลังต่อวัน เริ่มที่เลขที่ตั้ง (0001) จำนวนหลักตามที่กรอก - วันใหม่เริ่มใหม่ (Nexus.ScanQrRunning)
    public sealed class QrSuffix
    {
        public string DateFmt { get; set; }
        public string RefField { get; set; }
        public string RunStart { get; set; }

        public static readonly (string Key, string Sample)[] DateFormats =
        {
            ("YYMM", "2610"), ("YYMMDD", "261101"), ("YYYYMM", "202610"), ("YYYYMMDD", "20261101"), ("DDMMYY", "011026"), ("MMYY", "1026")
        };

        public static readonly (string Key, string Label)[] RefFields =
        {
            ("CUSTOMER", "CUSTOMER"), ("SUPPLIER", "SUPPLIER"), ("CATEGORY", "CATEGORY"), ("PCODE", "PRODUCT CODE"), ("PARTA", "PART A"),
            ("PARTB", "PART B"), ("PARTNO", "PART NO"), ("NAME", "PRODUCT NAME"), ("MODEL", "MODEL")
        };

        private static readonly Regex CustomKeyRx = new Regex(@"^CF\d{1,9}$", RegexOptions.IgnoreCase);

        // ค่าที่บันทึกได้ - ไม่รู้จัก = ไม่ใส่ · ทั้ง 3 ช่องว่าง = null (ไม่ต่อท้าย)
        public static QrSuffix Clean(string dateFmt, string refField, string runStart)
        {
            string df = (dateFmt ?? "").Trim().ToUpperInvariant();
            string rf = (refField ?? "").Trim().ToUpperInvariant();
            string rs = (runStart ?? "").Trim();
            var q = new QrSuffix
            {
                DateFmt = DateFormats.Any(f => f.Key == df) ? df : null,
                RefField = RefFields.Any(f => f.Key == rf) || CustomKeyRx.IsMatch(rf) ? rf : null,
                RunStart = Regex.IsMatch(rs, @"^\d{1,9}$") ? rs : null
            };
            return q.DateFmt == null && q.RefField == null && q.RunStart == null ? null : q;
        }

        public string DateText(DateTime d)
        {
            switch (DateFmt)
            {
                case "YYMM": return d.ToString("yyMM");
                case "YYMMDD": return d.ToString("yyMMdd");
                case "YYYYMM": return d.ToString("yyyyMM");
                case "YYYYMMDD": return d.ToString("yyyyMMdd");
                case "DDMMYY": return d.ToString("ddMMyy");
                case "MMYY": return d.ToString("MMyy");
                default: return null;
            }
        }

        // ตัวอย่างที่หน้าตั้งค่า
        public string Sample(string sep, string refSample = "KUBOTA")
        {
            var parts = new[] { DateText(DateTime.Today), RefField == null ? null : refSample, RunStart }.Where(x => !string.IsNullOrEmpty(x));
            return string.Join(sep, parts);
        }

        // ค่าของสินค้าตามช่องที่เลือก (ว่าง = ข้ามช่องนี้)
        public static string RefValue(int partId, string field)
        {
            if (partId <= 0 || string.IsNullOrEmpty(field)) return null;
            string sql;
            switch (field)
            {
                case "CUSTOMER": sql = "SELECT Customer FROM Nexus.Parts WHERE PartID = @p"; break;
                case "SUPPLIER": sql = "SELECT Supplier FROM Nexus.Parts WHERE PartID = @p"; break;
                case "CATEGORY": sql = "SELECT Category FROM Nexus.Parts WHERE PartID = @p"; break;
                case "PCODE": sql = "SELECT PartCode FROM Nexus.Parts WHERE PartID = @p"; break;
                case "PARTA": sql = "SELECT PartA FROM Nexus.Parts WHERE PartID = @p"; break;
                case "PARTB": if (!Nexus.Helpers.DbSchema.HasPartB) return null; sql = "SELECT PartB FROM Nexus.Parts WHERE PartID = @p"; break;
                case "PARTNO": sql = "SELECT PartNumber FROM Nexus.Parts WHERE PartID = @p"; break;
                case "NAME": sql = "SELECT Description FROM Nexus.Parts WHERE PartID = @p"; break;
                case "MODEL": sql = "SELECT Model FROM Nexus.Parts WHERE PartID = @p"; break;
                default:
                    int fid = CustomFields.IdOf(field);
                    if (fid <= 0 || !CustomFieldService.Ready) return null;
                    sql = $"SELECT TOP 1 Value FROM Nexus.PartFieldValues WHERE FieldID = {fid} AND PartID = @p";
                    break;
            }
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("@p", partId);
                conn.Open();
                var v = cmd.ExecuteScalar();
                string s = v == null || v == DBNull.Value ? "" : v.ToString().Trim();
                return s.Length == 0 || s == "-" ? null : s;
            }
        }

        // เลขรันถัดไปของคลังวันนี้ (จองเลขทันที - หลายเครื่องสแกนพร้อมกันไม่ได้เลขซ้ำ) · ตั้งเลขเริ่มสูงกว่าเลขล่าสุด = กระโดดไปเลขเริ่ม
        public string NextRunning(int stockId, DateTime today)
        {
            if (RunStart == null) return null;
            int start = int.Parse(RunStart);
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand(@"
                        DECLARE @o TABLE (n INT);
                        UPDATE Nexus.ScanQrRunning WITH (UPDLOCK, HOLDLOCK)
                           SET LastNo = CASE WHEN LastNo + 1 < @start THEN @start ELSE LastNo + 1 END, UpdatedDate = GETDATE()
                        OUTPUT inserted.LastNo INTO @o
                         WHERE StockID = @s AND RunDate = @d;
                        IF NOT EXISTS (SELECT 1 FROM @o)
                        BEGIN
                            INSERT INTO Nexus.ScanQrRunning (StockID, RunDate, LastNo) VALUES (@s, @d, @start);
                            INSERT INTO @o VALUES (@start);
                        END
                        SELECT TOP 1 n FROM @o;", conn))
                    {
                        cmd.Parameters.AddWithValue("@s", stockId);
                        cmd.Parameters.Add("@d", System.Data.SqlDbType.Date).Value = today.Date;
                        cmd.Parameters.AddWithValue("@start", start);
                        conn.Open();
                        int n = Convert.ToInt32(cmd.ExecuteScalar());
                        return n.ToString().PadLeft(RunStart.Length, '0');
                    }
                }
                catch (SqlException ex) when (ex.Number == 2627 && attempt < 3) { /* อีกเครื่องเพิ่งเริ่มวันนี้พร้อมกัน -> ลองใหม่ (ได้เลขถัดไป) */ }
            }
        }
    }
}
