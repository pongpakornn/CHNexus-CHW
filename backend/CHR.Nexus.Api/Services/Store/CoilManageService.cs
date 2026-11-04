// 🧲 MANAGE STOCK ของคลังที่นับ Coil (หน้า Store > คลัง > ปุ่ม MANAGE STOCK) - สิทธิ์ EDIT + APPROVE ของคลังนั้น
//   ADD      = เพิ่ม Master Coil / Coil No ที่บรรทัด PD CODE (ป้ายค้าง NOT DEDUCTED เลขเดียวกัน = รับเข้า + ตัดต้นทางแทน ไม่ซ้ำ)
//   EDIT     = แก้ Master Coil / Coil No / น้ำหนัก / REMARK · ยอดสินค้าปรับตามส่วนต่าง · ส่วนต่างคืน / ตัดคลังต้นทาง (STOCK-PANTA)
//              ที่ Coil นี้ถูกตัดมาตอนสแกน · RECEIVED = เวลาที่แก้
//   TRANSFER = โอนย้ายออก = สแกนออกจากคลังนี้ (บันทึกที่ Multi-Scanner)
//   ADJUST   = ปรับปรุงยอด: RETURN คืนยอดคลังต้นทาง / REMOVE ลบออกจากคลัง (Master Coil ต้นทางคงเดิม) + หมายเหตุ
//   หลังทุกรายการ: ป้าย NOT DEDUCTED ที่ตอนนี้ตัด Master Coil ได้ครบ = APPROVE ให้เอง · ลง Activity Log + ประวัติ (Nexus.CoilManageLog)
//   ใช้ทะเบียน Nexus.Coils ตัวเดียวกับหน้า Inventory Registration (Product Control) -> หน้านั้นเห็นการเปลี่ยนแปลงทันที
using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.Linq;

namespace Nexus.Services
{
    public class CoilManageService
    {
        private readonly string _cs = GlobalConfig.ConnStr;
        private readonly IList<StockModel> _stocks;
        private readonly IList<BarcodeFormatModel> _formats;

        public CoilManageService(IList<StockModel> stocks, IList<BarcodeFormatModel> formats)
        {
            _stocks = stocks;
            _formats = formats;
        }

        public sealed class Result
        {
            public string Message { get; set; }
            public string Log { get; set; }
            public int Synced { get; set; }
            public List<int> Stocks { get; } = new List<int>();   // คลังที่ยอดเปลี่ยน (แจ้งหน้าจอเรียลไทม์)
        }

        public sealed class Entry
        {
            public StockModel Stock; public int? PartId; public string PartCode; public int? CoilId; public string CoilNo, Mother;
            public string Action, Mode, SourceCode, Detail, Reason, UserId;
            public decimal? Before, After, SourceQty;
        }

        private static string Clean(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        private static string Kg(decimal v) => Qty.Plain(v);

        // คลังต้นทางที่ตัดยอดเมื่อคลังนี้รับป้าย (รูปแบบป้ายที่ตั้ง "ตัดยอดจากคลัง" + คลังนี้เปิดรับ Supplier) เช่น STOCK-MAT -> STOCK-PANTA
        public StockModel DeductSource(StockModel stock)
        {
            if (stock == null || !stock.InSupplier) return null;
            var f = (_formats ?? new List<BarcodeFormatModel>())
                .Where(x => x.IsActive && x.SourceStkId.HasValue && x.SourceStkId.Value != stock.StkId
                            && (stock.FormatIds == null || stock.FormatIds.Count == 0 || stock.FormatIds.Contains(x.FmtId)))
                .OrderBy(x => x.FmtId).FirstOrDefault();
            return f == null ? null : _stocks.FirstOrDefault(s => s.StkId == f.SourceStkId.Value);
        }

        private StockModel StockOf(int stkId) => _stocks.FirstOrDefault(s => s.StkId == stkId) ?? throw new InvalidOperationException("ไม่พบคลัง");

        private static string PartCode(SqlConnection conn, SqlTransaction trans, int partId)
        {
            using (var cmd = new SqlCommand("SELECT PartCode FROM Nexus.Parts WHERE PartID = @p", conn, trans))
            {
                cmd.Parameters.AddWithValue("@p", partId);
                return cmd.ExecuteScalar()?.ToString();
            }
        }

        private static string Remark(SqlConnection conn, SqlTransaction trans, int coilId)
        {
            if (!DbSchema.HasCoilRemark) return null;
            using (var cmd = new SqlCommand("SELECT Remark FROM Nexus.Coils WHERE CoilID = @id", conn, trans))
            {
                cmd.Parameters.AddWithValue("@id", coilId);
                var v = cmd.ExecuteScalar();
                return v == null || v == DBNull.Value ? null : v.ToString();
            }
        }

        private static void Move(SqlConnection conn, SqlTransaction trans, int coilId, string action, int? fromStock, int? fromPart, string fromStatus, decimal? fromKg,
                                 int toStock, int toPart, string toStatus, decimal kg, string userId)
        {
            using (var cmd = new SqlCommand(@"INSERT INTO Nexus.CoilMoves (CoilID, Action, FromStockID, FromPartID, FromStatus, FromWeightKG, ToStockID, ToPartID, ToStatus, WeightKG, UserID)
                                              VALUES (@c, @a, @fs, @fp, @fst, @fw, @ts, @tp, @tst, @w, @u)", conn, trans))
            {
                cmd.Parameters.AddWithValue("@c", coilId);
                cmd.Parameters.AddWithValue("@a", action);
                cmd.Parameters.AddWithValue("@fs", (object)fromStock ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@fp", (object)fromPart ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@fst", (object)fromStatus ?? DBNull.Value);
                cmd.Parameters.Add(QtyParam.Of("@fw", fromKg));
                cmd.Parameters.AddWithValue("@ts", toStock);
                cmd.Parameters.AddWithValue("@tp", toPart);
                cmd.Parameters.AddWithValue("@tst", toStatus);
                cmd.Parameters.Add(QtyParam.Of("@w", kg));
                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                cmd.ExecuteNonQuery();
            }
        }

        // ---------------------------------------------------------------- คลังต้นทางที่ Coil นี้ถูกตัดมา
        //   Linked = สแกนรับเข้าแล้วตัดคลังต้นทาง (Nexus.StockTransfers SCAN ผูกรายการสแกนที่สร้าง / ย้าย Coil นี้เข้ามา)
        //   ByName = ไม่มีประวัติตัด (เพิ่มเอง / Import) -> Master Coil ชื่อเดียวกันในคลังต้นทางของคลังนี้ (ใช้ตอนคืนยอดเท่านั้น)
        private sealed class Source
        {
            public StockModel Stock; public int PartId; public int? TransferId; public int? MasterId; public bool CoilMovedIn; public bool Linked;
        }

        private Source FindSource(SqlConnection conn, SqlTransaction trans, CoilService.CoilRec c, bool allowByName)
        {
            if (DbSchema.HasTransferScanTx)
            {
                string srcPart = DbSchema.HasCountCoil ? "ISNULL(st.SourcePartID, st.PartID)" : "st.PartID";
                using (var cmd = new SqlCommand($@"
                    SELECT TOP 1 st.FromStockID, {srcPart} AS SrcPart, st.TransferID, mo.CoilID AS MasterID, m.Action
                    FROM Nexus.CoilMoves m
                    JOIN Nexus.StockTransfers st ON st.ScanTransactionID = m.ScanTransactionID AND st.TransferMode = 'SCAN'
                    OUTER APPLY (SELECT TOP 1 x.CoilID FROM Nexus.CoilMoves x WHERE x.ScanTransactionID = m.ScanTransactionID AND x.Action = 'CONSUME' ORDER BY x.MoveID) mo
                    WHERE m.CoilID = @id AND m.Action IN ('CREATE', 'MOVE') AND m.ScanTransactionID IS NOT NULL AND st.ToStockID = @s
                    ORDER BY m.MoveID DESC", conn, trans))
                {
                    cmd.Parameters.AddWithValue("@id", c.Id);
                    cmd.Parameters.AddWithValue("@s", c.StockId);
                    using (var r = cmd.ExecuteReader())
                        if (r.Read())
                        {
                            var stk = _stocks.FirstOrDefault(s => s.StkId == r.GetInt32(0));
                            if (stk != null)
                                return new Source
                                {
                                    Stock = stk, PartId = Convert.ToInt32(r[1]), TransferId = r.GetInt32(2),
                                    MasterId = r.IsDBNull(3) ? (int?)null : r.GetInt32(3), CoilMovedIn = r.GetString(4) == "MOVE", Linked = true
                                };
                        }
                }
            }
            if (!allowByName || string.IsNullOrWhiteSpace(c.Mother)) return null;
            var src = DeductSource(StockOf(c.StockId));
            if (src == null) return null;
            using (var cmd = new SqlCommand(@"SELECT TOP 1 CoilID, PartID FROM Nexus.Coils WHERE CoilNo = @m AND StockID = @s
                                              ORDER BY CASE WHEN Status = 'IN' THEN 0 ELSE 1 END, CoilID DESC", conn, trans))
            {
                cmd.Parameters.AddWithValue("@m", c.Mother);
                cmd.Parameters.AddWithValue("@s", src.StkId);
                using (var r = cmd.ExecuteReader())
                    if (r.Read()) return new Source { Stock = src, PartId = r.GetInt32(1), MasterId = r.GetInt32(0) };
            }
            return null;
        }

        // คืน (+) / ตัดเพิ่ม (-) ที่คลังต้นทาง: ยอดสินค้าต้นทาง + น้ำหนัก Master Coil (หมด = OUT / มีน้ำหนัก = IN) + ยอดตัดในรายการ DEDUCTED
        private static void ApplySource(SqlConnection conn, SqlTransaction trans, Source src, decimal delta, string userId)
        {
            if (src == null || delta == 0) return;
            CoilService.AddStockQty(conn, trans, src.Stock, src.PartId, delta);
            if (src.MasterId.HasValue)
            {
                decimal w = 0; string st = "IN"; int stk = 0, part = 0;
                using (var cmd = new SqlCommand("SELECT WeightKG, Status, StockID, PartID FROM Nexus.Coils WITH (UPDLOCK, HOLDLOCK) WHERE CoilID = @id", conn, trans))
                {
                    cmd.Parameters.AddWithValue("@id", src.MasterId.Value);
                    using (var r = cmd.ExecuteReader())
                        if (r.Read()) { w = r.GetDecimal(0); st = r.GetString(1); stk = r.GetInt32(2); part = r.GetInt32(3); }
                }
                if (stk > 0)
                {
                    decimal now = Math.Max(0, w + delta);
                    string ns = now > 0 ? "IN" : "OUT";
                    using (var cmd = new SqlCommand(@"UPDATE Nexus.Coils SET WeightKG = @w, Status = @st,
                                                             OutDate = CASE WHEN @st = 'OUT' THEN ISNULL(OutDate, GETDATE()) ELSE NULL END, UpdatedDate = GETDATE()
                                                      WHERE CoilID = @id", conn, trans))
                    {
                        cmd.Parameters.Add(QtyParam.Of("@w", now));
                        cmd.Parameters.AddWithValue("@st", ns);
                        cmd.Parameters.AddWithValue("@id", src.MasterId.Value);
                        cmd.ExecuteNonQuery();
                    }
                    Move(conn, trans, src.MasterId.Value, delta > 0 ? "MANAGE_RETURN" : "MANAGE_CUT", stk, part, st, w, stk, part, ns, now, userId);
                }
            }
            if (src.TransferId.HasValue)
                using (var cmd = new SqlCommand("UPDATE Nexus.StockTransfers SET Quantity = CASE WHEN Quantity - @d < 0 THEN 0 ELSE Quantity - @d END WHERE TransferID = @t", conn, trans))
                {
                    cmd.Parameters.Add(QtyParam.Of("@d", delta));
                    cmd.Parameters.AddWithValue("@t", src.TransferId.Value);
                    cmd.ExecuteNonQuery();
                }
            if (src.Stock.CountCoil) CoilImportService.RecountCoils(conn, trans, src.PartId, src.Stock.StkId, src.Stock.IsMain);
        }

        private CoilService.CoilRec LockIn(SqlConnection conn, SqlTransaction trans, StockModel stock, int coilId)
        {
            var c = CoilService.Lock(conn, trans, coilId) ?? throw new InvalidOperationException("ไม่พบ Coil นี้ (อาจถูกลบ / ย้ายไปแล้ว)");
            if (c.StockId != stock.StkId) throw new InvalidOperationException($"Coil {c.CoilNo} ไม่ได้อยู่ในคลัง {stock.Code} แล้ว");
            if (c.Status != "IN") throw new InvalidOperationException($"Coil {c.CoilNo} ไม่ได้อยู่ในคลังแล้ว (ถูกสแกนออก / ใช้ไปแล้ว)");
            return c;
        }

        // ================================================================ ➕ ADD (บรรทัด PD CODE)
        //   COIL NO ว่าง = Master Coil ทั้งม้วน (เลข Coil = Master Coil) เช่นเพิ่ม Master Coil ที่ STOCK-PANTA
        //   deduct = ตัด Master Coil ของคลังต้นทาง (เหมือนสแกนรับป้าย: บันทึกสแกนเข้า + DEDUCTED / ตัดไม่ได้ = NOT DEDUCTED แบบรับเข้าแล้ว)
        public Result Add(int stkId, int partId, string master, string coilNo, decimal kg, string remark, bool deduct, string userId)
        {
            if (!DbSchema.HasCoilRegister) throw new InvalidOperationException("ฐานข้อมูลยังไม่มีทะเบียน Coil");
            var stock = StockOf(stkId);
            master = Clean(master); coilNo = Clean(coilNo); remark = Clean(remark);
            if (master == null && coilNo == null) throw new InvalidOperationException("กรุณากรอก MASTER COIL หรือ COIL NO");
            if (kg <= 0) throw new InvalidOperationException("น้ำหนัก (KG) ต้องมากกว่า 0");
            if (coilNo == null) { coilNo = master; master = null; }
            if (master != null && string.Equals(master, coilNo, StringComparison.OrdinalIgnoreCase)) master = null;
            if (remark != null && remark.Length > 500) throw new InvalidOperationException("REMARK ยาวเกิน 500 ตัวอักษร");
            kg = Qty.Round(kg, stock.AllowDecimal);

            string partCode;
            var res = new Result();
            res.Stocks.Add(stkId);
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                partCode = PartCode(conn, null, partId) ?? throw new InvalidOperationException("ไม่พบสินค้านี้");
                if (!stock.IsMain)
                    using (var cmd = new SqlCommand("SELECT COUNT(*) FROM Nexus.PartStocks WHERE StockID = @s AND PartID = @p", conn))
                    {
                        cmd.Parameters.AddWithValue("@s", stkId);
                        cmd.Parameters.AddWithValue("@p", partId);
                        if (Convert.ToInt32(cmd.ExecuteScalar()) == 0) throw new InvalidOperationException($"สินค้า {partCode} ไม่ได้อยู่ในคลัง {stock.Code}");
                    }
                using (var cmd = new SqlCommand("SELECT TOP 1 s.StockCode FROM Nexus.Coils c JOIN Nexus.Stocks s ON s.StockID = c.StockID WHERE c.CoilNo = @c AND c.Status = 'IN'", conn))
                {
                    cmd.Parameters.AddWithValue("@c", coilNo);
                    var at = cmd.ExecuteScalar();
                    if (at != null) throw new InvalidOperationException($"COIL NO {coilNo} อยู่ในคลัง {at} แล้ว - ใช้เลขซ้ำไม่ได้ (แก้ไขที่รายการเดิมแทน)");
                }
            }

            string mode, detail; Source src = null; decimal cut = 0; int coilId = 0;
            // 1) ป้ายเลขเดียวกันค้างอยู่ใน NOT DEDUCTED ของคลังนี้ = รับเข้า + ตัด Master Coil แทน (ไม่สร้างซ้ำ)
            var miss = DbSchema.HasMissStatus
                ? new DeductMissService().GetRows(coilNo, new DateTime(2000, 1, 1), DateTime.Today, new[] { stkId })
                      .FirstOrDefault(r => r.IsPending && r.StockId == stkId && string.Equals(r.CoilNo, coilNo, StringComparison.OrdinalIgnoreCase))
                : null;
            var srcStock = DeductSource(stock);
            if (miss != null)
            {
                if (master != null) miss.MotherCoil = master;
                var a = new DeductMissService().Receive(miss, partId, kg, userId, "APPROVED");
                if (!a.Ok) throw new InvalidOperationException(a.Message ?? "รับเข้าไม่สำเร็จ");
                mode = "MATCH"; cut = a.Deduct?.Deducted ?? 0;
                detail = $"NOT DEDUCTED → received {Kg(kg)} KG · cut {a.Deduct?.SourceCode} {Kg(cut)} KG";
                res.Stocks.Add(miss.SourceStockId);
                res.Synced = 1;
            }
            // 2) ตัด Master Coil ของคลังต้นทาง (เหมือนสแกนป้าย)
            else if (deduct && master != null && srcStock != null)
            {
                var d = new ScanService().UpdateStockWithDeduct(partId, partCode, partCode, kg, userId, $"MANAGE ADD {coilNo}", stock, srcStock.StkId,
                                                                coil: new ScanService.CoilLabel { CoilNo = coilNo, MotherCoil = master });
                if (!d.Saved) throw new InvalidOperationException("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
                mode = "DEDUCT"; cut = d.Deducted;
                detail = $"received {Kg(kg)} KG · cut {d.SourceCode} {Kg(cut)} KG" + (cut < kg ? " (ตัดไม่ครบ → NOT DEDUCTED)" : "");
                res.Stocks.Add(srcStock.StkId);
            }
            // 3) เพิ่มเข้าทะเบียนอย่างเดียว (ไม่ตัดคลังอื่น)
            else
            {
                mode = "PLAIN"; detail = $"added {Kg(kg)} KG";
                using (var conn = new SqlConnection(_cs))
                {
                    conn.Open();
                    using (var trans = conn.BeginTransaction())
                    {
                        int oldId = 0; int? oldStock = null, oldPart = null; decimal? oldKg = null;
                        using (var cmd = new SqlCommand("SELECT CoilID, StockID, PartID, WeightKG FROM Nexus.Coils WITH (UPDLOCK, HOLDLOCK) WHERE CoilNo = @c", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@c", coilNo);
                            using (var r = cmd.ExecuteReader())
                                if (r.Read()) { oldId = r.GetInt32(0); oldStock = r.GetInt32(1); oldPart = r.GetInt32(2); oldKg = r.GetDecimal(3); }
                        }
                        if (oldId > 0)   // เลขนี้เคยมี (ออกไปแล้ว) -> กลับเข้าคลังนี้
                        {
                            using (var cmd = new SqlCommand(@"UPDATE Nexus.Coils SET StockID = @s, PartID = @p, MotherCoil = @m, WeightKG = @w, Status = 'IN', OutDate = NULL,
                                                                     ReceivedDate = GETDATE(), ReceivedBy = @u, UpdatedDate = GETDATE() WHERE CoilID = @id", conn, trans))
                            {
                                cmd.Parameters.AddWithValue("@s", stkId);
                                cmd.Parameters.AddWithValue("@p", partId);
                                cmd.Parameters.AddWithValue("@m", (object)master ?? DBNull.Value);
                                cmd.Parameters.Add(QtyParam.Of("@w", kg));
                                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                                cmd.Parameters.AddWithValue("@id", oldId);
                                cmd.ExecuteNonQuery();
                            }
                            coilId = oldId;
                            Move(conn, trans, coilId, "MANAGE_ADD", oldStock, oldPart, "OUT", oldKg, stkId, partId, "IN", kg, userId);
                        }
                        else
                        {
                            using (var cmd = new SqlCommand(@"INSERT INTO Nexus.Coils (CoilNo, MotherCoil, PartID, StockID, WeightKG, Status, ReceivedBy)
                                                              VALUES (@c, @m, @p, @s, @w, 'IN', @u); SELECT CAST(SCOPE_IDENTITY() AS INT);", conn, trans))
                            {
                                cmd.Parameters.AddWithValue("@c", coilNo);
                                cmd.Parameters.AddWithValue("@m", (object)master ?? DBNull.Value);
                                cmd.Parameters.AddWithValue("@p", partId);
                                cmd.Parameters.AddWithValue("@s", stkId);
                                cmd.Parameters.Add(QtyParam.Of("@w", kg));
                                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                                coilId = Convert.ToInt32(cmd.ExecuteScalar());
                            }
                            Move(conn, trans, coilId, "MANAGE_ADD", null, null, null, null, stkId, partId, "IN", kg, userId);
                        }
                        CoilService.AddStockQty(conn, trans, stock, partId, kg);
                        CoilImportService.RecountCoils(conn, trans, partId, stkId, stock.IsMain);
                        trans.Commit();
                    }
                }
            }

            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                if (coilId == 0)
                    using (var cmd = new SqlCommand("SELECT CoilID FROM Nexus.Coils WHERE CoilNo = @c", conn))
                    {
                        cmd.Parameters.AddWithValue("@c", coilNo);
                        coilId = Convert.ToInt32(cmd.ExecuteScalar() ?? 0);
                    }
                if (remark != null && coilId > 0 && DbSchema.HasCoilRemark)
                    using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET Remark = @r WHERE CoilID = @id", conn))
                    {
                        cmd.Parameters.AddWithValue("@r", remark);
                        cmd.Parameters.AddWithValue("@id", coilId);
                        cmd.ExecuteNonQuery();
                    }
            }

            string what = master == null ? $"Master Coil {coilNo}" : $"Coil {coilNo} (Master {master})";
            res.Log = $"{stock.Code} | {partCode} | ADD {what} | {Kg(kg)} KG | {mode} | {detail}" + (remark != null ? $" | Remark: {remark}" : "");
            res.Message = mode == "MATCH"
                ? $"เพิ่ม {what} แล้ว\nพบป้ายค้างใน NOT DEDUCTED → รับเข้า + ตัด Master Coil {Kg(cut)} KG ให้แล้ว"
                : mode == "DEDUCT"
                    ? $"เพิ่ม {what} แล้ว\nตัด {srcStock.Code} {Kg(cut)} KG" + (cut < kg ? $"\n⚠ ตัดได้ไม่ครบ ({Kg(kg - cut)} KG) - ค้างไว้ที่ NOT DEDUCTED" : "")
                    : $"เพิ่ม {what} แล้ว ({Kg(kg)} KG)";
            Record(new Entry
            {
                Stock = stock, PartId = partId, PartCode = partCode, CoilId = coilId, CoilNo = coilNo, Mother = master, Action = "ADD", Mode = mode,
                After = kg, SourceCode = mode == "PLAIN" ? null : (miss != null ? _stocks.FirstOrDefault(s => s.StkId == miss.SourceStockId)?.Code : srcStock?.Code),
                SourceQty = cut > 0 ? -cut : (decimal?)null, Detail = detail + (remark != null ? $" · Remark: {remark}" : ""), UserId = userId
            });
            res.Synced += Sync(stock, userId, res);
            return res;
        }

        // ================================================================ ✏️ EDIT
        public Result Edit(int stkId, int coilId, string master, string coilNo, decimal kg, string remark, string userId)
        {
            if (!DbSchema.HasCoilRegister) throw new InvalidOperationException("ฐานข้อมูลยังไม่มีทะเบียน Coil");
            var stock = StockOf(stkId);
            master = Clean(master); coilNo = Clean(coilNo); remark = Clean(remark);
            if (coilNo == null) throw new InvalidOperationException("กรุณากรอก COIL NO");
            if (kg <= 0) throw new InvalidOperationException("น้ำหนัก (KG) ต้องมากกว่า 0");
            if (master != null && string.Equals(master, coilNo, StringComparison.OrdinalIgnoreCase)) master = null;
            if (remark != null && remark.Length > 500) throw new InvalidOperationException("REMARK ยาวเกิน 500 ตัวอักษร");
            kg = Qty.Round(kg, stock.AllowDecimal);
            var res = new Result();
            res.Stocks.Add(stkId);
            CoilService.CoilRec c; string partCode, oldRemark; Source src = null; decimal delta;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    c = LockIn(conn, trans, stock, coilId);
                    if (!string.Equals(coilNo, c.CoilNo, StringComparison.OrdinalIgnoreCase))
                        using (var cmd = new SqlCommand("SELECT COUNT(*) FROM Nexus.Coils WHERE CoilNo = @c AND CoilID <> @id", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@c", coilNo);
                            cmd.Parameters.AddWithValue("@id", coilId);
                            if (Convert.ToInt32(cmd.ExecuteScalar()) > 0) throw new InvalidOperationException($"COIL NO {coilNo} มีในทะเบียนแล้ว - ใช้เลขซ้ำไม่ได้");
                        }
                    partCode = PartCode(conn, trans, c.PartId);
                    oldRemark = Remark(conn, trans, coilId);
                    delta = kg - c.Kg;
                    using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET CoilNo = @c, MotherCoil = @m, WeightKG = @w, ReceivedDate = GETDATE(), UpdatedDate = GETDATE()"
                                                    + (DbSchema.HasCoilRemark ? ", Remark = @r" : "") + " WHERE CoilID = @id", conn, trans))
                    {
                        cmd.Parameters.AddWithValue("@c", coilNo);
                        cmd.Parameters.AddWithValue("@m", (object)master ?? DBNull.Value);
                        cmd.Parameters.Add(QtyParam.Of("@w", kg));
                        cmd.Parameters.AddWithValue("@r", (object)remark ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("@id", coilId);
                        cmd.ExecuteNonQuery();
                    }
                    CoilService.AddStockQty(conn, trans, stock, c.PartId, delta);
                    // ส่วนต่างน้ำหนัก -> คืน (ลดลง) / ตัดเพิ่ม (เพิ่มขึ้น) ที่คลังต้นทางที่ตัด Coil นี้มาตอนสแกน
                    if (delta != 0)
                    {
                        src = FindSource(conn, trans, c, allowByName: false);
                        ApplySource(conn, trans, src, -delta, userId);
                        if (src != null) res.Stocks.Add(src.Stock.StkId);
                    }
                    Move(conn, trans, coilId, "EDIT", c.StockId, c.PartId, "IN", c.Kg, c.StockId, c.PartId, "IN", kg, userId);
                    CoilImportService.RecountCoils(conn, trans, c.PartId, c.StockId, stock.IsMain);
                    trans.Commit();
                }
            }
            var d = new List<string>();
            if (!string.Equals(c.CoilNo, coilNo, StringComparison.Ordinal)) d.Add($"COIL NO: {c.CoilNo} → {coilNo}");
            if ((c.Mother ?? "") != (master ?? "")) d.Add($"MASTER: {c.Mother ?? "-"} → {master ?? "-"}");
            if (delta != 0) d.Add($"KG: {Kg(c.Kg)} → {Kg(kg)} (TON {Kg(c.Kg / 1000m)} → {Kg(kg / 1000m)})");
            if ((oldRemark ?? "") != (remark ?? "")) d.Add($"REMARK: {oldRemark ?? "-"} → {remark ?? "-"}");
            string srcText = delta == 0 ? "" : src != null ? $"{src.Stock.Code} {(delta < 0 ? "+" : "-")}{Kg(Math.Abs(delta))} KG" : "no source cut (not deducted)";
            string detail = (d.Count > 0 ? string.Join(" · ", d) : "No changes") + (srcText.Length > 0 ? $" · {srcText}" : "");
            res.Log = $"{stock.Code} | {partCode} | EDIT Coil {coilNo} | {detail}";
            res.Message = "แก้ไข Coil แล้ว" + (delta == 0 ? "" : src != null
                ? $"\n{(delta < 0 ? $"คืนยอด {src.Stock.Code} +{Kg(-delta)} KG" : $"ตัด {src.Stock.Code} เพิ่ม {Kg(delta)} KG")} (Master Coil ต้นทางปรับตาม)"
                : "\nCoil นี้ไม่ได้ตัดมาจากคลังต้นทาง - ปรับเฉพาะยอดคลังนี้");
            Record(new Entry
            {
                Stock = stock, PartId = c.PartId, PartCode = partCode, CoilId = coilId, CoilNo = coilNo, Mother = master, Action = "EDIT",
                Before = c.Kg, After = kg, SourceCode = src?.Stock.Code, SourceQty = src != null && delta != 0 ? -delta : (decimal?)null, Detail = detail, UserId = userId
            });
            res.Synced = Sync(stock, userId, res);
            return res;
        }

        // ================================================================ 🚚 TRANSFER = สแกนออกจากคลังนี้ (Multi-Scanner)
        public Result Transfer(int stkId, int coilId, string userId)
        {
            var stock = StockOf(stkId);
            CoilService.CoilRec c; string partCode;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    c = LockIn(conn, trans, stock, coilId);
                    partCode = PartCode(conn, trans, c.PartId);
                    trans.Commit();
                }
            }
            bool ok = new ScanService().UpdateStockOut(c.PartId, partCode, partCode, c.Kg, userId, $"TRANSFER {c.CoilNo}", stock,
                                                       coil: new ScanService.CoilLabel { CoilNo = c.CoilNo, MotherCoil = c.Mother });
            if (!ok) throw new InvalidOperationException($"โอนย้ายไม่สำเร็จ\nยอด {stock.Code} ของ {partCode} น้อยกว่าน้ำหนัก Coil ({Kg(c.Kg)} KG)\nแก้ไขยอด / น้ำหนักให้ตรงก่อน แล้วลองใหม่");
            var res = new Result();
            res.Stocks.Add(stkId);
            string detail = $"scan OUT {Kg(c.Kg)} KG from {stock.Code} (Multi-Scanner)";
            res.Log = $"{stock.Code} | {partCode} | TRANSFER Coil {c.CoilNo} | Master {c.Mother ?? "-"} | {detail}";
            res.Message = $"โอนย้าย Coil {c.CoilNo} ออกแล้ว ({Kg(c.Kg)} KG)\nบันทึกเป็นสแกนออกที่ Multi-Scanner";
            Record(new Entry { Stock = stock, PartId = c.PartId, PartCode = partCode, CoilId = coilId, CoilNo = c.CoilNo, Mother = c.Mother, Action = "TRANSFER", Before = c.Kg, After = 0, Detail = detail, UserId = userId });
            res.Synced = Sync(stock, userId, res);
            return res;
        }

        // ================================================================ ⚖ ADJUST: RETURN (คืนยอดคลังต้นทาง) / REMOVE (ลบออกจากคลัง เหลือ Master Coil)
        public Result Adjust(int stkId, int coilId, string mode, string reason, string userId)
        {
            var stock = StockOf(stkId);
            mode = (mode ?? "").Trim().ToUpperInvariant();
            if (mode != "RETURN" && mode != "REMOVE") throw new InvalidOperationException("กรุณาเลือก คืนยอด หรือ ลบออกจากระบบ");
            reason = Clean(reason);
            if (reason == null) throw new InvalidOperationException("กรุณาระบุหมายเหตุ (เหตุผลที่ปรับปรุงยอด)");
            if (reason.Length > 500) throw new InvalidOperationException("หมายเหตุยาวเกิน 500 ตัวอักษร");
            var res = new Result();
            res.Stocks.Add(stkId);
            CoilService.CoilRec c; string partCode; Source src = null;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var trans = conn.BeginTransaction())
                {
                    c = LockIn(conn, trans, stock, coilId);
                    partCode = PartCode(conn, trans, c.PartId);
                    if (mode == "RETURN")
                    {
                        src = FindSource(conn, trans, c, allowByName: true)
                              ?? throw new InvalidOperationException($"ไม่พบคลังต้นทางของ Coil {c.CoilNo}\n(ไม่ได้ตัดมาจากคลังอื่น และไม่มี Master Coil {c.Mother ?? "-"} ในคลังต้นทาง)\nเลือก \"ลบออกจากระบบ\" แทน");
                        res.Stocks.Add(src.Stock.StkId);
                    }
                    CoilService.AddStockQty(conn, trans, stock, c.PartId, -c.Kg);
                    if (src != null && src.CoilMovedIn && !src.MasterId.HasValue)
                    {
                        // Coil ลูกย้ายมาจากคลังต้นทางทั้งลูก -> ย้ายกลับไปเป็น Coil ของคลังต้นทาง
                        using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET StockID = @s, PartID = @p, Status = 'IN', OutDate = NULL, UpdatedDate = GETDATE() WHERE CoilID = @id", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@s", src.Stock.StkId);
                            cmd.Parameters.AddWithValue("@p", src.PartId);
                            cmd.Parameters.AddWithValue("@id", coilId);
                            cmd.ExecuteNonQuery();
                        }
                        Move(conn, trans, coilId, "MANAGE_RETURN", c.StockId, c.PartId, "IN", c.Kg, src.Stock.StkId, src.PartId, "IN", c.Kg, userId);
                        var noMaster = new Source { Stock = src.Stock, PartId = src.PartId, TransferId = src.TransferId };
                        ApplySource(conn, trans, noMaster, c.Kg, userId);
                    }
                    else
                    {
                        using (var cmd = new SqlCommand("UPDATE Nexus.Coils SET Status = 'OUT', OutDate = GETDATE(), UpdatedDate = GETDATE() WHERE CoilID = @id", conn, trans))
                        {
                            cmd.Parameters.AddWithValue("@id", coilId);
                            cmd.ExecuteNonQuery();
                        }
                        Move(conn, trans, coilId, mode == "RETURN" ? "MANAGE_RETURN" : "MANAGE_REMOVE", c.StockId, c.PartId, "IN", c.Kg, c.StockId, c.PartId, "OUT", c.Kg, userId);
                        if (src != null) ApplySource(conn, trans, src, c.Kg, userId);
                    }
                    CoilImportService.RecountCoils(conn, trans, c.PartId, c.StockId, stock.IsMain);
                    trans.Commit();
                }
            }
            string detail = mode == "RETURN"
                ? $"RETURN {Kg(c.Kg)} KG → {src.Stock.Code}" + (src.MasterId.HasValue ? $" (Master Coil {c.Mother ?? "-"})" : src.CoilMovedIn ? " (coil moved back)" : "")
                : $"REMOVE {Kg(c.Kg)} KG from {stock.Code} (master coil unchanged)";
            res.Log = $"{stock.Code} | {partCode} | ADJUST Coil {c.CoilNo} | Master {c.Mother ?? "-"} | {detail} | Reason: {reason}";
            res.Message = mode == "RETURN"
                ? $"คืนยอด Coil {c.CoilNo} ให้ {src.Stock.Code} แล้ว (+{Kg(c.Kg)} KG)"
                : $"ลบ Coil {c.CoilNo} ออกจาก {stock.Code} แล้ว (-{Kg(c.Kg)} KG)\nMaster Coil ยังอยู่เหมือนเดิม";
            Record(new Entry
            {
                Stock = stock, PartId = c.PartId, PartCode = partCode, CoilId = coilId, CoilNo = c.CoilNo, Mother = c.Mother, Action = "ADJUST", Mode = mode,
                Before = c.Kg, After = 0, SourceCode = src?.Stock.Code, SourceQty = src != null ? c.Kg : (decimal?)null, Detail = detail, Reason = reason, UserId = userId
            });
            res.Synced = Sync(stock, userId, res);
            return res;
        }

        // ป้าย NOT DEDUCTED ที่ตัด Master Coil ได้ครบแล้วตอนนี้ (ของคลังนี้ / คลังต้นทาง-ปลายทางที่เกี่ยว) -> APPROVE ให้เอง
        private int Sync(StockModel stock, string userId, Result res)
        {
            if (!DbSchema.HasDeductMisses) return 0;
            try
            {
                var ids = new HashSet<int>(res.Stocks) { stock.StkId };
                var r = new DeductMissService().ApproveReady(ids, null, userId);
                if (r.Done > 0)
                {
                    res.Message += $"\n\n✔ NOT DEDUCTED: APPROVE ให้อัตโนมัติ {r.Done} ป้าย (ตัด Master Coil {Kg(r.Kg)} KG)";
                    LogService.WriteLog(userId, "COIL_MANAGE_SYNC", $"{stock.Code} | auto approve NOT DEDUCTED {r.Done} label(s) | cut {Kg(r.Kg)} KG", stock.Code);
                }
                return r.Done;
            }
            catch (Exception ex)
            {
                LogService.WriteLog(userId, "COIL_MANAGE_SYNC_ERROR", $"{stock.Code} | {ex.Message}", stock.Code);
                return 0;
            }
        }

        // ================================================================ 🕘 ประวัติ
        private static void Record(Entry e)
        {
            if (!DbSchema.HasCoilManageLog) return;
            try
            {
                using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                using (var cmd = new SqlCommand(@"INSERT INTO Nexus.CoilManageLog (StockID, StockCode, PartID, PartCode, CoilID, CoilNo, MotherCoil, Action, Mode,
                                                         WeightBefore, WeightAfter, SourceCode, SourceQty, Detail, Reason, UserID)
                                                  VALUES (@s, @sc, @p, @pc, @c, @cn, @m, @a, @mo, @wb, @wa, @src, @sq, @d, @r, @u)", conn))
                {
                    string Cut(string v, int n) => v == null ? null : v.Length > n ? v.Substring(0, n) : v;
                    cmd.Parameters.AddWithValue("@s", e.Stock.StkId);
                    cmd.Parameters.AddWithValue("@sc", (object)Cut(e.Stock.Code, 50) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@p", (object)e.PartId ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@pc", (object)Cut(e.PartCode, 100) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@c", (object)e.CoilId ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@cn", (object)Cut(e.CoilNo, 100) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@m", (object)Cut(e.Mother, 100) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@a", e.Action);
                    cmd.Parameters.AddWithValue("@mo", (object)e.Mode ?? DBNull.Value);
                    cmd.Parameters.Add(QtyParam.Of("@wb", e.Before));
                    cmd.Parameters.Add(QtyParam.Of("@wa", e.After));
                    cmd.Parameters.AddWithValue("@src", (object)Cut(e.SourceCode, 50) ?? DBNull.Value);
                    cmd.Parameters.Add(QtyParam.Of("@sq", e.SourceQty));
                    cmd.Parameters.AddWithValue("@d", (object)Cut(e.Detail, 1000) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@r", (object)Cut(e.Reason, 500) ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@u", (object)Cut(e.UserId, 20) ?? DBNull.Value);
                    conn.Open();
                    cmd.ExecuteNonQuery();
                }
            }
            catch (Exception ex) { LogService.WriteLog(e.UserId, "COIL_MANAGE_LOG_ERROR", ex.Message, e.CoilNo ?? ""); }
        }

        public sealed class HistoryRow
        {
            public int LogId { get; set; }
            public string Date { get; set; }
            public string Action { get; set; }
            public string Mode { get; set; }
            public string PartCode { get; set; }
            public string CoilNo { get; set; }
            public string MotherCoil { get; set; }
            public decimal? Before { get; set; }
            public decimal? After { get; set; }
            public string SourceCode { get; set; }
            public decimal? SourceQty { get; set; }
            public string Detail { get; set; }
            public string Reason { get; set; }
            public string UserId { get; set; }
            public string UserName { get; set; }
        }

        public static List<HistoryRow> History(int stkId, DateTime from, DateTime to, string key)
        {
            var list = new List<HistoryRow>();
            if (!DbSchema.HasCoilManageLog) return list;
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(@"
                SELECT TOP 5000 l.LogID, l.LogDate, l.Action, l.Mode, l.PartCode, l.CoilNo, l.MotherCoil, l.WeightBefore, l.WeightAfter,
                       l.SourceCode, l.SourceQty, l.Detail, l.Reason, l.UserID, u.FullName
                FROM Nexus.CoilManageLog l LEFT JOIN Nexus.Users u ON u.UserID = l.UserID
                WHERE l.StockID = @s AND l.LogDate >= @from AND l.LogDate < @to
                  AND (@k = '' OR l.CoilNo LIKE '%' + @k + '%' OR l.MotherCoil LIKE '%' + @k + '%' OR l.PartCode LIKE '%' + @k + '%'
                       OR l.UserID LIKE '%' + @k + '%' OR u.FullName LIKE '%' + @k + '%' OR l.Detail LIKE '%' + @k + '%' OR l.Reason LIKE '%' + @k + '%')
                ORDER BY l.LogID DESC", conn))
            {
                cmd.Parameters.AddWithValue("@s", stkId);
                cmd.Parameters.Add("@from", SqlDbType.DateTime).Value = from.Date;
                cmd.Parameters.Add("@to", SqlDbType.DateTime).Value = to.Date.AddDays(1);
                cmd.Parameters.Add("@k", SqlDbType.NVarChar, 200).Value = (key ?? "").Trim();
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        decimal? D(int i) => r.IsDBNull(i) ? (decimal?)null : r.GetDecimal(i);
                        string S(int i) => r.IsDBNull(i) ? "" : r[i].ToString();
                        list.Add(new HistoryRow
                        {
                            LogId = r.GetInt32(0), Date = r.GetDateTime(1).ToString("dd/MM/yyyy HH:mm:ss", CultureInfo.InvariantCulture),
                            Action = S(2), Mode = S(3), PartCode = S(4), CoilNo = S(5), MotherCoil = S(6), Before = D(7), After = D(8),
                            SourceCode = S(9), SourceQty = D(10), Detail = S(11), Reason = S(12), UserId = S(13), UserName = S(14)
                        });
                    }
            }
            return list;
        }
    }
}
