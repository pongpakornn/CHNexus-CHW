// ทะเบียน Coil (Nexus.Coils) - Coil ลูก / Master Coil / น้ำหนัก KG ของแต่ละสินค้าในคลังที่นับ Coil
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Nexus.Services
{
    public class CoilService
    {
        // Coil ที่อยู่ในคลัง (Status = IN) ของสินค้า 1 ตัว -> เรียงตาม Master Coil แล้วเลข Coil ลูก
        // คืนเป็นแถวพร้อมแสดง: หัวกลุ่ม Master Coil (IsMother) ตามด้วย Coil ลูกในกลุ่มนั้น
        public List<CoilRowModel> GetCoilRows(int stockId, int partId)
        {
            var coils = GetCoils(stockId, partId);
            var rows = new List<CoilRowModel>();
            // Master ทั้งม้วน (ไม่มี MotherCoil) = กลุ่มของเลขตัวเอง (Coil ลูกที่ตัดจากม้วนนี้อยู่กลุ่มเดียวกัน)
            foreach (var g in coils.GroupBy(c => string.IsNullOrWhiteSpace(c.MotherCoil) ? c.CoilNo : c.MotherCoil))
            {
                var list = g.ToList();
                rows.Add(new CoilRowModel
                {
                    IsMother = true,
                    MotherCoil = g.Key,
                    CoilNo = $"{list.Count} COIL",
                    WeightKG = list.Sum(c => c.WeightKG)
                });
                int no = 1;
                foreach (var c in list) { c.No = no++; rows.Add(c); }
            }
            return rows;
        }

        // partId = 0 -> ทุกสินค้าในคลัง (ใช้ตอน Export)
        public List<CoilRowModel> GetCoils(int stockId, int partId)
        {
            var list = new List<CoilRowModel>();
            if (!DbSchema.HasCoilRegister || stockId <= 0 || partId < 0) return list;

            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand($@"
                SELECT CoilID, PartID, CoilNo, MotherCoil, WeightKG, LabelDate, ReceivedDate, {(DbSchema.HasCoilRemark ? "Remark" : "CAST(NULL AS NVARCHAR(500)) AS Remark")}
                FROM Nexus.Coils
                WHERE StockID = @stk AND (@pt = 0 OR PartID = @pt) AND Status = 'IN'
                ORDER BY PartID, ISNULL(MotherCoil, N''), CoilNo", conn))
            {
                cmd.Parameters.AddWithValue("@stk", stockId);
                cmd.Parameters.AddWithValue("@pt", partId);
                conn.Open();
                using (var rdr = cmd.ExecuteReader())
                {
                    while (rdr.Read())
                    {
                        list.Add(new CoilRowModel
                        {
                            CoilId = Convert.ToInt32(rdr["CoilID"]),
                            PartId = Convert.ToInt32(rdr["PartID"]),
                            CoilNo = rdr["CoilNo"].ToString(),
                            MotherCoil = rdr["MotherCoil"] == DBNull.Value ? null : rdr["MotherCoil"].ToString(),
                            WeightKG = rdr["WeightKG"] == DBNull.Value ? 0 : Convert.ToDecimal(rdr["WeightKG"]),
                            LabelDate = rdr["LabelDate"] == DBNull.Value ? null : rdr["LabelDate"].ToString(),
                            ReceivedDate = rdr["ReceivedDate"] == DBNull.Value ? (DateTime?)null : Convert.ToDateTime(rdr["ReceivedDate"]),
                            Remark = rdr["Remark"] == DBNull.Value ? null : rdr["Remark"].ToString()
                        });
                    }
                }
            }
            return list;
        }

        // ✏️ แก้ / 🗑 ลบ Coil ที่ลงทะเบียนผิด (หน้า Inventory Registration)
        //   - แก้: COIL NO (ห้ามซ้ำ) / MASTER COIL / น้ำหนัก -> ยอดคลังของสินค้าปรับตามส่วนต่างน้ำหนัก + CoilMoves "EDIT"
        //   - ลบ: เฉพาะ Coil ที่ยังอยู่ในคลังและไม่เคยถูกสแกน (มีแค่ REGISTER / IMPORT / EDIT) -> ยอดคลังลดตามน้ำหนัก
        //   คืนข้อความไว้ลง Log (ค่าเดิม -> ค่าใหม่) · ผิดเงื่อนไข = InvalidOperationException (ข้อความภาษาไทยแสดงผู้ใช้)
        private static readonly string[] ManualMoves = { "REGISTER", "IMPORT", "EDIT" };

        private sealed class CoilRec { public int Id, StockId, PartId; public string CoilNo, Mother, Status; public decimal Kg; }

        private static CoilRec Lock(SqlConnection conn, SqlTransaction trans, int coilId)
        {
            using (var cmd = new SqlCommand("SELECT CoilID, StockID, PartID, CoilNo, MotherCoil, Status, WeightKG FROM Nexus.Coils WITH (UPDLOCK, HOLDLOCK) WHERE CoilID = @id", conn, trans))
            {
                cmd.Parameters.AddWithValue("@id", coilId);
                using (var r = cmd.ExecuteReader())
                    return r.Read()
                        ? new CoilRec { Id = r.GetInt32(0), StockId = r.GetInt32(1), PartId = r.GetInt32(2), CoilNo = r.GetString(3), Mother = r.IsDBNull(4) ? null : r.GetString(4), Status = r.GetString(5), Kg = r.GetDecimal(6) }
                        : null;
            }
        }

        private static void AddStockQty(SqlConnection conn, SqlTransaction trans, StockModel stock, int ptId, decimal delta)
        {
            if (delta == 0) return;
            using (var cmd = new SqlCommand(stock.IsMain
                ? "UPDATE Nexus.Parts SET StockQuantity = ISNULL(StockQuantity, 0) + @q WHERE PartID = @p"
                : "UPDATE Nexus.PartStocks SET Quantity = ISNULL(Quantity, 0) + @q, UpdatedDate = GETDATE() WHERE StockID = @s AND PartID = @p", conn, trans))
            {
                cmd.Parameters.Add(QtyParam.Of("@q", delta));
                cmd.Parameters.AddWithValue("@s", stock.StkId);
                cmd.Parameters.AddWithValue("@p", ptId);
                cmd.ExecuteNonQuery();
            }
        }

        public string EditCoil(int coilId, string coilNo, string master, decimal kg, IList<StockModel> stocks, string userId)
        {
            if (!DbSchema.HasCoilRegister) throw new InvalidOperationException("ฐานข้อมูลยังไม่มีทะเบียน Coil");
            coilNo = (coilNo ?? "").Trim();
            master = string.IsNullOrWhiteSpace(master) ? null : master.Trim();
            if (coilNo.Length == 0) throw new InvalidOperationException("กรุณากรอก COIL NO");
            if (kg <= 0) throw new InvalidOperationException("น้ำหนัก (KG) ต้องมากกว่า 0");
            if (master != null && string.Equals(master, coilNo, StringComparison.OrdinalIgnoreCase)) master = null; // Master ทั้งม้วน = ไม่อ้างถึงตัวเอง
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    var c = Lock(conn, trans, coilId) ?? throw new InvalidOperationException("ไม่พบ Coil นี้ (อาจถูกลบไปแล้ว)");
                    if (c.Status != "IN") throw new InvalidOperationException($"Coil {c.CoilNo} ไม่ได้อยู่ในคลังแล้ว (ถูกสแกนออก / ใช้ไปแล้ว) - แก้ไขไม่ได้");
                    var stock = stocks.FirstOrDefault(s => s.StkId == c.StockId) ?? throw new InvalidOperationException("ไม่พบคลังของ Coil นี้");
                    if (!string.Equals(coilNo, c.CoilNo, StringComparison.OrdinalIgnoreCase))
                        using (var cmd = new SqlCommand("SELECT COUNT(*) FROM Nexus.Coils WHERE CoilNo = @c AND CoilID <> @id", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@c", coilNo);
                            cmd.Parameters.AddWithValue("@id", coilId);
                            if (Convert.ToInt32(cmd.ExecuteScalar()) > 0) throw new InvalidOperationException($"COIL NO {coilNo} มีในทะเบียนแล้ว - ใช้เลขซ้ำไม่ได้");
                        }
                    using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET CoilNo = @c, MotherCoil = @m, WeightKG = @w, UpdatedDate = GETDATE() WHERE CoilID = @id", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@c", coilNo);
                        cmd.Parameters.AddWithValue("@m", (object)master ?? DBNull.Value);
                        cmd.Parameters.Add(QtyParam.Of("@w", kg));
                        cmd.Parameters.AddWithValue("@id", coilId);
                        cmd.ExecuteNonQuery();
                    }
                    AddStockQty(conn, trans, stock, c.PartId, kg - c.Kg);
                    using (var cmd = new SqlCommand(@"INSERT INTO Nexus.CoilMoves (CoilID, Action, FromStockID, FromPartID, FromStatus, FromWeightKG, ToStockID, ToPartID, ToStatus, WeightKG, UserID)
                                                      VALUES (@id, 'EDIT', @s, @p, 'IN', @fw, @s, @p, 'IN', @w, @u)", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@id", coilId);
                        cmd.Parameters.AddWithValue("@s", c.StockId);
                        cmd.Parameters.AddWithValue("@p", c.PartId);
                        cmd.Parameters.Add(QtyParam.Of("@fw", c.Kg));
                        cmd.Parameters.Add(QtyParam.Of("@w", kg));
                        cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                        cmd.ExecuteNonQuery();
                    }
                    CoilImportService.RecountCoils(conn, trans, c.PartId, c.StockId, stock.IsMain);
                    trans.Commit();
                    var d = new List<string>();
                    if (!string.Equals(c.CoilNo, coilNo, StringComparison.Ordinal)) d.Add($"COIL NO: {c.CoilNo}->{coilNo}");
                    if ((c.Mother ?? "") != (master ?? "")) d.Add($"MASTER: {c.Mother ?? "-"}->{master ?? "-"}");
                    if (c.Kg != kg) d.Add($"KG: {Qty.Plain(c.Kg)}->{Qty.Plain(kg)}");
                    return $"{stock.Code} | Coil {coilNo} | {(d.Count > 0 ? string.Join("  |  ", d) : "No changes")}";
                }
            }
        }

        public string DeleteCoil(int coilId, IList<StockModel> stocks)
        {
            if (!DbSchema.HasCoilRegister) throw new InvalidOperationException("ฐานข้อมูลยังไม่มีทะเบียน Coil");
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    var c = Lock(conn, trans, coilId) ?? throw new InvalidOperationException("ไม่พบ Coil นี้ (อาจถูกลบไปแล้ว)");
                    if (c.Status != "IN") throw new InvalidOperationException($"Coil {c.CoilNo} ไม่ได้อยู่ในคลังแล้ว - ลบไม่ได้");
                    using (var cmd = new SqlCommand($"SELECT COUNT(*) FROM Nexus.CoilMoves WHERE CoilID = @id AND Action NOT IN ({string.Join(",", ManualMoves.Select(a => $"'{a}'"))})", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@id", coilId);
                        if (Convert.ToInt32(cmd.ExecuteScalar()) > 0)
                            throw new InvalidOperationException($"Coil {c.CoilNo} มีประวัติสแกนแล้ว - ลบไม่ได้ (แก้ไขได้)\nถ้าไม่ได้ใช้แล้วให้สแกนออก / ตัดยอดตามขั้นตอนปกติ");
                    }
                    var stock = stocks.FirstOrDefault(s => s.StkId == c.StockId) ?? throw new InvalidOperationException("ไม่พบคลังของ Coil นี้");
                    using (var cmd = new SqlCommand("DELETE FROM Nexus.CoilMoves WHERE CoilID = @id; DELETE FROM Nexus.Coils WHERE CoilID = @id;", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@id", coilId);
                        cmd.ExecuteNonQuery();
                    }
                    AddStockQty(conn, trans, stock, c.PartId, -c.Kg);
                    CoilImportService.RecountCoils(conn, trans, c.PartId, c.StockId, stock.IsMain);
                    trans.Commit();
                    return $"{stock.Code} | Coil {c.CoilNo} | Master {c.Mother ?? "-"} | {Qty.Plain(c.Kg)} KG";
                }
            }
        }

        // เปลี่ยนชื่อ Master Coil ของสินค้าในคลัง: Coil ลูกทุกม้วนที่อ้างชื่อเดิม (+ ตัว Master ทั้งม้วนที่ใช้เลขเดิม) เปลี่ยนตาม · เลข Coil ลูกไม่เปลี่ยน
        public (int Count, string Stock) RenameMaster(int stockId, int ptId, string from, string to, IList<StockModel> stocks)
        {
            if (!DbSchema.HasCoilRegister) throw new InvalidOperationException("ฐานข้อมูลยังไม่มีทะเบียน Coil");
            from = (from ?? "").Trim();
            to = (to ?? "").Trim();
            if (from.Length == 0 || to.Length == 0) throw new InvalidOperationException("กรุณากรอกชื่อ MASTER COIL");
            var stock = stocks.FirstOrDefault(s => s.StkId == stockId) ?? throw new InvalidOperationException("ไม่พบคลัง");
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    int n;
                    using (var cmd = new SqlCommand(@"UPDATE Nexus.Coils SET MotherCoil = @to, UpdatedDate = GETDATE()
                                                      WHERE StockID = @s AND PartID = @p AND Status = 'IN' AND MotherCoil = @from", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@to", to);
                        cmd.Parameters.AddWithValue("@from", from);
                        cmd.Parameters.AddWithValue("@s", stockId);
                        cmd.Parameters.AddWithValue("@p", ptId);
                        n = cmd.ExecuteNonQuery();
                    }
                    // Master ทั้งม้วน (เลข Coil = ชื่อ Master เดิม) -> เปลี่ยนเลขด้วย (ห้ามซ้ำกับ Coil อื่น)
                    using (var cmd = new SqlCommand(@"IF EXISTS (SELECT 1 FROM Nexus.Coils WHERE CoilNo = @to AND NOT (StockID = @s AND PartID = @p AND CoilNo = @from))
                                                          AND EXISTS (SELECT 1 FROM Nexus.Coils WHERE StockID = @s AND PartID = @p AND Status = 'IN' AND MotherCoil IS NULL AND CoilNo = @from)
                                                          THROW 50001, N'dup', 1;
                                                      UPDATE Nexus.Coils SET CoilNo = @to, UpdatedDate = GETDATE()
                                                      WHERE StockID = @s AND PartID = @p AND Status = 'IN' AND MotherCoil IS NULL AND CoilNo = @from", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@to", to);
                        cmd.Parameters.AddWithValue("@from", from);
                        cmd.Parameters.AddWithValue("@s", stockId);
                        cmd.Parameters.AddWithValue("@p", ptId);
                        try { n += cmd.ExecuteNonQuery(); }
                        catch (SqlException ex) when (ex.Number == 50001) { throw new InvalidOperationException($"COIL NO {to} มีในทะเบียนแล้ว - ใช้ชื่อซ้ำไม่ได้"); }
                    }
                    if (n == 0) throw new InvalidOperationException($"ไม่พบ Coil ของ MASTER {from} ในคลัง {stock.Code}");
                    trans.Commit();
                    return (n, stock.Code);
                }
            }
        }

        // 💬 หมายเหตุของ Coil ลูก 1 ม้วน (เฉพาะ Coil ที่อยู่ในคลังนั้น) -> คืน CoilNo / หมายเหตุเดิม ไว้ลง Log · ไม่พบ = null
        public (string CoilNo, string Old)? UpdateRemark(int stockId, int coilId, string remark)
        {
            if (!DbSchema.HasCoilRemark) return null;
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(@"
                UPDATE Nexus.Coils SET Remark = @r, UpdatedDate = GETDATE()
                OUTPUT inserted.CoilNo, deleted.Remark
                WHERE CoilID = @id AND StockID = @stk", conn))
            {
                cmd.Parameters.AddWithValue("@r", string.IsNullOrWhiteSpace(remark) ? (object)DBNull.Value : remark.Trim());
                cmd.Parameters.AddWithValue("@id", coilId);
                cmd.Parameters.AddWithValue("@stk", stockId);
                conn.Open();
                using (var rdr = cmd.ExecuteReader())
                    return rdr.Read() ? (rdr.GetString(0), rdr.IsDBNull(1) ? "" : rdr.GetString(1)) : null;
            }
        }

        // จำนวน Coil ที่ลงทะเบียนไว้ต่อสินค้า (ใช้บอกว่าแถวไหนกดดู Coil ได้)
        public Dictionary<int, int> CountByPart(int stockId)
        {
            var map = new Dictionary<int, int>();
            if (!DbSchema.HasCoilRegister || stockId <= 0) return map;

            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand("SELECT PartID, COUNT(*) FROM Nexus.Coils WHERE StockID = @stk AND Status = 'IN' GROUP BY PartID", conn))
            {
                cmd.Parameters.AddWithValue("@stk", stockId);
                conn.Open();
                using (var rdr = cmd.ExecuteReader())
                    while (rdr.Read()) map[rdr.GetInt32(0)] = rdr.GetInt32(1);
            }
            return map;
        }

        // 🧲 ยอด Coil ในคลัง (Status IN): MASTER COIL = ม้วนที่ไม่ได้ตัดมาจาก Coil อื่น (MASTER COIL ว่าง / เท่ากับตัวเอง)
        //    COIL NO = ม้วนลูกที่ตัดมาจาก Master Coil - คืนทุกคลังที่มี Coil (StockID -> ยอด)
        public class CoilSummary
        {
            public int MasterCount { get; set; }
            public decimal MasterKg { get; set; }
            public int ChildCount { get; set; }
            public decimal ChildKg { get; set; }
            public int TotalCount => MasterCount + ChildCount;
            public decimal TotalKg => MasterKg + ChildKg;
        }

        public Dictionary<int, CoilSummary> GetSummary(int? stockId = null)
        {
            var map = new Dictionary<int, CoilSummary>();
            if (!DbSchema.HasCoilRegister) return map;
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(@"
                SELECT StockID,
                       SUM(CASE WHEN m = 1 THEN 1 ELSE 0 END), ISNULL(SUM(CASE WHEN m = 1 THEN WeightKG END), 0),
                       SUM(CASE WHEN m = 0 THEN 1 ELSE 0 END), ISNULL(SUM(CASE WHEN m = 0 THEN WeightKG END), 0)
                FROM (SELECT StockID, WeightKG,
                             CASE WHEN ISNULL(LTRIM(RTRIM(MotherCoil)), '') IN ('', '-') OR MotherCoil = CoilNo THEN 1 ELSE 0 END AS m
                      FROM Nexus.Coils WHERE Status = 'IN' AND (@stk IS NULL OR StockID = @stk)) x
                GROUP BY StockID", conn))
            {
                cmd.Parameters.AddWithValue("@stk", (object)stockId ?? DBNull.Value);
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                        map[r.GetInt32(0)] = new CoilSummary
                        {
                            MasterCount = r.GetInt32(1), MasterKg = r.GetDecimal(2),
                            ChildCount = r.GetInt32(3), ChildKg = r.GetDecimal(4)
                        };
            }
            return map;
        }
    }
}
