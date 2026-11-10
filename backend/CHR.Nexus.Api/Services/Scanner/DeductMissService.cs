using Nexus.Core;
using Nexus.Helpers;
using Nexus.Models;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Linq;
using System.Runtime.CompilerServices;

namespace Nexus.Services
{
    // 📋 NOT DEDUCTED: ป้ายของรูปแบบที่ "ตัดยอดจากคลัง" (เช่น Panta -> STOCK-PANTA) ที่ตัดคลังต้นทางไม่ได้ / สินค้ายังไม่ลงทะเบียน
    //    PENDING  = ยังไม่รับเข้าคลัง รอผู้มีสิทธิ์ APPROVE ของ Multi-Scanner (Update_20261016b.sql)
    //    RECEIVED = รายการเดิม (ก่อนอัพเดทนี้) รับเข้าคลังไปแล้ว ยังไม่ได้ตัดคลังต้นทาง
    //    APPROVED / REGISTERED = ดำเนินการแล้ว -> แสดงที่ DEDUCTED
    // ✔ DEDUCTED: ป้ายที่รับเข้าแล้ว + ตัดคลังต้นทาง (Nexus.StockTransfers SCAN) / APPROVE แล้วแต่ยังไม่มี Master Coilให้ตัด
    public class DeductMissRow : INotifyPropertyChanged
    {
        public int MissId { get; set; }
        public int? TxId { get; set; }
        public DateTime ScanDate { get; set; }
        public string CoilNo { get; set; }
        public string MotherCoil { get; set; }
        public int? PartId { get; set; }
        public string PartCode { get; set; }
        public string PartName { get; set; }
        public int StockId { get; set; }
        public int SourceStockId { get; set; }
        public string StockCode { get; set; }
        public string SourceCode { get; set; }
        public decimal LabelQty { get; set; }
        public decimal Deducted { get; set; }
        public string Reason { get; set; }
        public string Status { get; set; }
        public int? FormatId { get; set; }
        public string UserId { get; set; }
        public string Barcode { get; set; }
        public decimal? MotherNow { get; set; }   // Master Coilในคลังต้นทางตอนนี้ (IN) - null = ยังไม่มี

        // รายการ DEDUCTED (ตัดคลังต้นทางได้แล้ว)
        public string SourcePartCode { get; set; }
        public string SourcePartName { get; set; }
        public decimal? SourceAfter { get; set; }
        public string How { get; set; }             // MASTER COIL / COIL / PRODUCT / NONE (APPROVE แล้วยังไม่มีให้ตัด)
        public decimal? MotherBefore { get; set; }  // น้ำหนัก Master Coilก่อนตัดครั้งนั้น
        public decimal? MotherAfter { get; set; }   // น้ำหนัก Master Coilหลังตัดครั้งนั้น

        public bool HasProduct => PartId.HasValue && PartId.Value > 0;
        public bool IsPending => Status == "PENDING";
        public string PartCodeText => HasProduct ? PartCode : "— NO PD CODE —";
        public string PartNameText => HasProduct ? PartName : "ยังไม่มีสินค้าในระบบ";
        public string DateText => ScanDate.ToString("dd/MM/yyyy HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
        public string LabelQtyText => Qty.Plain(LabelQty);
        public string DeductedText => Qty.Plain(Deducted);
        public string SourceAfterText => SourceAfter.HasValue ? Qty.Plain(SourceAfter.Value) : "-";
        public string MotherBeforeText => MotherBefore.HasValue ? $"{Qty.Plain(MotherBefore.Value)} KG" : "-";
        public string MotherNowText => MotherNow.HasValue ? $"IN {Qty.Plain(MotherNow.Value)} KG" : "NOT IN " + SourceCode;
        public string StockText => $"{StockCode} ← {SourceCode}";

        // สถานะ (NOT DEDUCTED): รอดำเนินการ + สาเหตุ
        public string StatusText => Status == "RECEIVED"
            ? $"รับเข้า {StockCode} แล้ว (รายการเดิม) • ยังไม่ตัด {SourceCode}"
            : $"⏸ รอดำเนินการ • ยังไม่รับเข้า {StockCode}";
        public string ReasonText =>
            !HasProduct ? "ไม่มี PD CODE นี้ในระบบ" :
            // Master Coil อยู่ในคลังต้นทางตอนนี้ (เพิ่มเข้ามาทีหลัง / ป้ายพิมพ์เลข Master ขาด) = พร้อมตัด หรือเหลือไม่พอ
            MotherNow.HasValue && MotherNow.Value >= LabelQty ? $"✔ พร้อมตัด • Master Coil {MotherCoil} ใน {SourceCode} มี {Qty.Plain(MotherNow.Value)} KG (กด APPROVE)" :
            MotherNow.HasValue ? $"Master Coil {MotherCoil} ใน {SourceCode} เหลือ {Qty.Plain(MotherNow.Value)} KG ไม่พอตามป้าย" :
            Reason == "SHORT" ? $"Master Coil {MotherCoil} ใน {SourceCode} เหลือไม่พอ (ตัดได้ {Qty.Plain(Deducted)} KG)" :
            $"ไม่มี Master Coil {MotherCoil} ใน {SourceCode}";

        private bool _isSelected;
        public bool IsSelected { get => _isSelected; set { _isSelected = value; OnPropertyChanged(); } }
        public event PropertyChangedEventHandler PropertyChanged;
        private void OnPropertyChanged([CallerMemberName] string n = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(n));
    }

    public class DeductMissService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        // รายการที่ยังค้างอยู่ใน NOT DEDUCTED (สแกนที่ถูกยกเลิกแล้วไม่แสดง)
        private static string Visible => DbSchema.HasMissStatus
            ? "ISNULL(t.IsCancelled, 0) = 0 AND m.Status IN ('PENDING', 'RECEIVED')"
            : "ISNULL(t.IsCancelled, 0) = 0";

        // เฉพาะคลังที่ผู้ใช้เห็นปุ่ม DEDUCTED / NOT DEDUCTED (null = ทุกคลัง) - รายการที่คลังรับเข้าหรือคลังต้นทางอยู่ในชุดนี้
        private static string StockFilter(IEnumerable<int> stockIds, string toCol, string fromCol)
        {
            if (stockIds == null) return "";
            var ids = stockIds.Distinct().ToList();
            if (ids.Count == 0) return " AND 1 = 0";
            string list = string.Join(",", ids.Select(i => i.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            return $" AND ({toCol} IN ({list}) OR {fromCol} IN ({list}))";
        }

        // 🔗 ป้าย NO PD CODE ที่ตอนนี้มีสินค้าในระบบแล้ว (เพิ่มทีหลังจาก PRODUCT CONTROL / STORE / ＋ PRODUCT) -> ผูก PD CODE ให้เอง
        //    ค้นสินค้าแบบเดียวกับตอนสแกน (รูปแบบป้ายของรายการ + ชื่อ / รหัสบนป้าย) · เจอรายการเดียวเท่านั้นถึงผูก (กันผูกผิดสินค้า)
        //    force = false: ไม่เกิน 1 ครั้ง / 15 วินาที (เปิดหน้าต่าง NOT DEDUCTED พร้อมกันหลายเครื่องไม่หนักฐาน)
        private static DateTime _lastRelink = DateTime.MinValue;
        private static readonly object _relinkLock = new object();

        public int Relink(bool force = false)
        {
            if (!DbSchema.HasMissStatus) return 0;
            lock (_relinkLock)
            {
                if (!force && (DateTime.UtcNow - _lastRelink).TotalSeconds < 15) return 0;
                _lastRelink = DateTime.UtcNow;
            }
            var rows = new List<(int Id, int Stock, int Src, int? Fmt, string Bc)>();
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var cmd = new SqlCommand("SELECT MissID, StockID, SourceStockID, FormatID, Barcode FROM Nexus.DeductMisses WHERE Status = 'PENDING' AND PartID IS NULL", conn))
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                        rows.Add((r.GetInt32(0), r.GetInt32(1), r.GetInt32(2), r.IsDBNull(3) ? (int?)null : r.GetInt32(3), r.IsDBNull(4) ? "" : r.GetString(4)));
                if (rows.Count == 0) return 0;
                var formats = new StockService().GetFormats(activeOnly: true);
                var scan = new ScanService();
                var cache = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                int n = 0;
                foreach (var row in rows)
                {
                    var fmts = formats.Where(f => row.Fmt.HasValue ? f.FmtId == row.Fmt.Value : f.SourceStkId == row.Src);
                    foreach (var f in fmts)
                    {
                        if (!f.TryParse(row.Bc, out var codes, out _)) continue;
                        string key = f.FmtId + "|" + row.Stock + "|" + string.Join("|", codes);
                        if (!cache.TryGetValue(key, out int pid))
                            cache[key] = pid = scan.FindPart(f, codes, out _, new List<int> { row.Stock })?.PartId ?? 0;
                        if (pid > 0)
                            using (var up = new SqlCommand(@"UPDATE Nexus.DeductMisses SET PartID = @p, Reason = CASE WHEN Reason = 'NO_PRODUCT' THEN 'NOT_FOUND' ELSE Reason END
                                                             WHERE MissID = @id AND PartID IS NULL AND Status = 'PENDING'", conn))
                            {
                                up.Parameters.AddWithValue("@p", pid);
                                up.Parameters.AddWithValue("@id", row.Id);
                                n += up.ExecuteNonQuery();
                            }
                        break;
                    }
                }
                if (n > 0) LogService.WriteLog("SYSTEM", "NOT_DEDUCTED_RELINK", $"Linked {n} NO PD CODE label(s) to products registered later", "NOT_DEDUCTED");
                return n;
            }
        }

        // 📋 ป้ายที่ค้างของสินค้านี้ (หลังเพิ่ม / ลงทะเบียนสินค้า): ทั้งหมด + ที่ตัด Master Coil ได้ครบตอนนี้ (ไล่ตามลำดับสแกน หักน้ำหนักทีละใบ)
        public sealed class PendingInfo { public int Count; public List<int> Ready = new List<int>(); public decimal ReadyKg; public string Source; public string Target; }

        public PendingInfo PendingFor(int partId, IEnumerable<int> stockIds = null)
        {
            var info = new PendingInfo();
            if (!DbSchema.HasMissStatus || partId <= 0) return info;
            var rows = GetRows("", new DateTime(2000, 1, 1), DateTime.Today, stockIds).Where(r => r.IsPending && r.PartId == partId)
                          .OrderBy(r => r.ScanDate).ThenBy(r => r.MissId).ToList();
            info.Count = rows.Count;
            var left = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in rows.Where(r => r.MotherNow.HasValue))
            {
                string key = r.SourceStockId + "|" + r.MotherCoil;
                decimal have = left.TryGetValue(key, out var v) ? v : r.MotherNow.Value;
                if (have < r.LabelQty) continue;
                left[key] = have - r.LabelQty;
                info.Ready.Add(r.MissId);
                info.ReadyKg += r.LabelQty;
            }
            info.Source = rows.FirstOrDefault()?.SourceCode;
            info.Target = rows.FirstOrDefault()?.StockCode;
            return info;
        }

        // จำนวนรายการทั้งหมด (ปุ่ม NOT DEDUCTED (n) หน้า Multi-Scanner)
        public int Count(IEnumerable<int> stockIds = null)
        {
            if (!DbSchema.HasDeductMisses) return 0;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand($"SELECT COUNT(*) FROM Nexus.DeductMisses m LEFT JOIN Nexus.ScanTransactions t ON t.TransactionID = m.TransactionID WHERE {Visible}" + StockFilter(stockIds, "m.StockID", "m.SourceStockID"), conn))
            {
                conn.Open();
                return Convert.ToInt32(cmd.ExecuteScalar());
            }
        }

        public List<DeductMissRow> GetRows(string keyword, DateTime from, DateTime to, IEnumerable<int> stockIds = null)
        {
            var list = new List<DeductMissRow>();
            bool st = DbSchema.HasMissStatus;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand($@"
                SELECT m.MissID, m.TransactionID, m.ScanDate, m.CoilNo, m.MotherCoil, m.LabelQty, m.Deducted, m.Reason, m.UserID, m.Barcode,
                       m.PartID, m.StockID, m.SourceStockID, {(st ? "m.Status, m.FormatID" : "'RECEIVED' AS Status, CAST(NULL AS int) AS FormatID")},
                       p.PartCode, p.Description, s.StockCode, src.StockCode AS SourceCode,
                       MotherNow = mo.WeightKG, ISNULL(mo.CoilNo, m.MotherCoil) AS MotherUse
                FROM Nexus.DeductMisses m
                LEFT JOIN Nexus.ScanTransactions t ON t.TransactionID = m.TransactionID
                LEFT JOIN Nexus.Parts p ON p.PartID = m.PartID
                LEFT JOIN Nexus.Stocks s ON s.StockID = m.StockID
                LEFT JOIN Nexus.Stocks src ON src.StockID = m.SourceStockID
                -- Master Coil ในคลังต้นทาง: เลขบนป้ายก่อน · ไม่มี = เลขจาก COIL NO ตัดท้าย -ตัวเลข (ป้ายพิมพ์ขาด เช่น 2635 -> 26355026302)
                OUTER APPLY (SELECT CASE WHEN CHARINDEX('-', REVERSE(m.CoilNo)) > 1 AND RIGHT(m.CoilNo, CHARINDEX('-', REVERSE(m.CoilNo)) - 1) NOT LIKE '%[^0-9]%'
                                         THEN LEFT(m.CoilNo, LEN(m.CoilNo) - CHARINDEX('-', REVERSE(m.CoilNo))) END AS FromNo) d
                OUTER APPLY (SELECT TOP 1 c.CoilNo, c.WeightKG FROM Nexus.Coils c
                             WHERE c.StockID = m.SourceStockID AND c.Status = 'IN' AND (c.CoilNo = m.MotherCoil OR c.CoilNo = d.FromNo)
                             ORDER BY CASE WHEN c.CoilNo = m.MotherCoil THEN 0 ELSE 1 END) mo
                WHERE {Visible} AND m.ScanDate >= @from AND m.ScanDate < @to
                  AND (@k = '' OR m.CoilNo LIKE '%' + @k + '%' OR m.MotherCoil LIKE '%' + @k + '%' OR p.PartCode LIKE '%' + @k + '%'
                       OR p.Description LIKE '%' + @k + '%' OR m.UserID LIKE '%' + @k + '%' OR m.Barcode LIKE '%' + @k + '%')
                  {StockFilter(stockIds, "m.StockID", "m.SourceStockID")}
                ORDER BY m.ScanDate DESC, m.MissID DESC", conn))
            {
                cmd.Parameters.Add("@from", SqlDbType.DateTime).Value = from.Date;
                cmd.Parameters.Add("@to", SqlDbType.DateTime).Value = to.Date.AddDays(1);
                cmd.Parameters.Add("@k", SqlDbType.NVarChar, 200).Value = (keyword ?? "").Trim();
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                        list.Add(new DeductMissRow
                        {
                            MissId = Convert.ToInt32(r["MissID"]),
                            TxId = r["TransactionID"] == DBNull.Value ? (int?)null : Convert.ToInt32(r["TransactionID"]),
                            ScanDate = Convert.ToDateTime(r["ScanDate"]),
                            CoilNo = r["CoilNo"]?.ToString() ?? "",
                            MotherCoil = r["MotherUse"]?.ToString() ?? "",
                            LabelQty = Qty.Read(r["LabelQty"]),
                            Deducted = Qty.Read(r["Deducted"]),
                            Reason = r["Reason"].ToString(),
                            Status = r["Status"].ToString(),
                            FormatId = r["FormatID"] == DBNull.Value ? (int?)null : Convert.ToInt32(r["FormatID"]),
                            UserId = r["UserID"]?.ToString() ?? "",
                            Barcode = r["Barcode"]?.ToString() ?? "",
                            PartId = r["PartID"] == DBNull.Value ? (int?)null : Convert.ToInt32(r["PartID"]),
                            StockId = Convert.ToInt32(r["StockID"]),
                            SourceStockId = Convert.ToInt32(r["SourceStockID"]),
                            PartCode = r["PartCode"]?.ToString() ?? "",
                            PartName = r["Description"]?.ToString() ?? "",
                            StockCode = r["StockCode"]?.ToString() ?? "",
                            SourceCode = r["SourceCode"]?.ToString() ?? "",
                            MotherNow = r["MotherNow"] == DBNull.Value ? (decimal?)null : Qty.Read(r["MotherNow"])
                        });
            }
            return list;
        }

        // ✔ DEDUCTED: จำนวนรายการ "วันนี้" (ปุ่ม DEDUCTED (n))
        public int CountDeductedToday(IEnumerable<int> stockIds = null)
        {
            if (!DbSchema.HasTransferScanTx) return 0;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand(@"SELECT (SELECT COUNT(*) FROM Nexus.StockTransfers st JOIN Nexus.ScanTransactions t ON t.TransactionID = st.ScanTransactionID
                                              WHERE st.TransferMode = 'SCAN' AND ISNULL(t.IsCancelled, 0) = 0 AND st.TransferDate >= CAST(GETDATE() AS date)"
                                              + StockFilter(stockIds, "st.ToStockID", "st.FromStockID") + ")"
                                              + (DbSchema.HasMissStatus ? @" + (SELECT COUNT(*) FROM Nexus.DeductMisses m JOIN Nexus.ScanTransactions t ON t.TransactionID = m.TransactionID
                                              WHERE m.Status IN ('APPROVED', 'REGISTERED') AND ISNULL(t.IsCancelled, 0) = 0 AND m.ActionDate >= CAST(GETDATE() AS date)
                                                AND NOT EXISTS (SELECT 1 FROM Nexus.StockTransfers x WHERE x.ScanTransactionID = m.TransactionID)"
                                              + StockFilter(stockIds, "m.StockID", "m.SourceStockID") + ")" : ""), conn))
            {
                conn.Open();
                return Convert.ToInt32(cmd.ExecuteScalar());
            }
        }

        // ✔ DEDUCTED: เพิ่มอะไรเข้ามา (PD CODE / Coil) แล้วตัดอะไรจากคลังต้นทาง (สินค้าต้นทาง / Master Coilก่อนตัด / ยอดต้นทางหลังตัด)
        //    + รายการ NOT DEDUCTED ที่ APPROVE / ลงทะเบียนแล้วแต่ยังไม่มี Master Coilให้ตัด (CUT = 0) / รายการที่ถูกยกเลิกไม่แสดง
        public List<DeductMissRow> GetDeducted(string keyword, DateTime from, DateTime to, IEnumerable<int> stockIds = null)
        {
            var list = new List<DeductMissRow>();
            if (!DbSchema.HasTransferScanTx) return list;
            string approvedNoCut = DbSchema.HasMissStatus ? $@"
                UNION ALL
                SELECT -m.MissID, t.TransactionID, ISNULL(m.ActionDate, t.TransactionDate), t.Quantity, CAST(0 AS decimal(18,3)), NULL, m.UserID, t.ReferenceNo,
                       s.StockCode, src.StockCode, p.PartCode, p.Description, NULL, NULL,
                       m.CoilNo, m.MotherCoil, NULL, NULL, NULL, NULL, 'NONE'
                FROM Nexus.DeductMisses m
                JOIN Nexus.ScanTransactions t ON t.TransactionID = m.TransactionID
                LEFT JOIN Nexus.Parts p ON p.PartID = m.PartID
                LEFT JOIN Nexus.Stocks s ON s.StockID = m.StockID
                LEFT JOIN Nexus.Stocks src ON src.StockID = m.SourceStockID
                WHERE m.Status IN ('APPROVED', 'REGISTERED') AND ISNULL(t.IsCancelled, 0) = 0
                  AND NOT EXISTS (SELECT 1 FROM Nexus.StockTransfers x WHERE x.ScanTransactionID = m.TransactionID)
                  AND ISNULL(m.ActionDate, t.TransactionDate) >= @from AND ISNULL(m.ActionDate, t.TransactionDate) < @to
                  {StockFilter(stockIds, "m.StockID", "m.SourceStockID")}" : "";
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand($@"
                SELECT * FROM (
                SELECT st.TransferID AS RowID, t.TransactionID, st.TransferDate AS RowDate, t.Quantity AS LabelQty, st.Quantity AS Cut, st.FromBalanceAfter, t.UserID, t.ReferenceNo,
                       st.ToStockCode, st.FromStockCode, p.PartCode, p.Description, sp.PartCode AS SourcePartCode, sp.Description AS SourcePartName,
                       ch.CoilNo, ch.MotherCoil, mo.CoilNo AS MotherNo, mo.FromWeightKG AS MotherBefore, mo.MoveWeight AS MotherAfter, mo.NowWeight AS MotherNow,
                       CASE WHEN mo.CoilNo IS NOT NULL THEN 'MASTER COIL' WHEN ch.Action = 'MOVE' THEN 'COIL' ELSE 'PRODUCT' END AS How
                FROM Nexus.StockTransfers st
                JOIN Nexus.ScanTransactions t ON t.TransactionID = st.ScanTransactionID
                LEFT JOIN Nexus.Parts p ON p.PartID = st.PartID
                LEFT JOIN Nexus.Parts sp ON sp.PartID = ISNULL(st.SourcePartID, st.PartID)
                OUTER APPLY (SELECT TOP 1 c.CoilNo, c.MotherCoil, m.Action FROM Nexus.CoilMoves m JOIN Nexus.Coils c ON c.CoilID = m.CoilID
                             WHERE m.ScanTransactionID = t.TransactionID AND m.Action IN ('CREATE', 'MOVE') ORDER BY m.MoveID) ch
                OUTER APPLY (SELECT TOP 1 c.CoilNo, m.FromWeightKG, m.WeightKG AS MoveWeight, CASE WHEN c.Status = 'IN' THEN c.WeightKG END AS NowWeight
                             FROM Nexus.CoilMoves m JOIN Nexus.Coils c ON c.CoilID = m.CoilID
                             WHERE m.ScanTransactionID = t.TransactionID AND m.Action = 'CONSUME' ORDER BY m.MoveID) mo
                WHERE st.TransferMode = 'SCAN' AND ISNULL(t.IsCancelled, 0) = 0 AND st.TransferDate >= @from AND st.TransferDate < @to
                  {StockFilter(stockIds, "st.ToStockID", "st.FromStockID")}
                {approvedNoCut}
                ) x
                WHERE (@k = '' OR x.CoilNo LIKE '%' + @k + '%' OR x.MotherCoil LIKE '%' + @k + '%' OR x.MotherNo LIKE '%' + @k + '%' OR x.PartCode LIKE '%' + @k + '%'
                       OR x.SourcePartCode LIKE '%' + @k + '%' OR x.Description LIKE '%' + @k + '%' OR x.SourcePartName LIKE '%' + @k + '%'
                       OR x.UserID LIKE '%' + @k + '%' OR x.ReferenceNo LIKE '%' + @k + '%')
                ORDER BY x.RowDate DESC, x.RowID DESC", conn))
            {
                cmd.Parameters.Add("@from", SqlDbType.DateTime).Value = from.Date;
                cmd.Parameters.Add("@to", SqlDbType.DateTime).Value = to.Date.AddDays(1);
                cmd.Parameters.Add("@k", SqlDbType.NVarChar, 200).Value = (keyword ?? "").Trim();
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        string mother = r["MotherNo"] != DBNull.Value ? r["MotherNo"].ToString() : r["MotherCoil"]?.ToString() ?? "";
                        list.Add(new DeductMissRow
                        {
                            MissId = Convert.ToInt32(r["RowID"]),
                            TxId = Convert.ToInt32(r["TransactionID"]),
                            ScanDate = Convert.ToDateTime(r["RowDate"]),
                            CoilNo = r["CoilNo"]?.ToString() ?? "",
                            MotherCoil = mother,
                            LabelQty = Qty.Read(r["LabelQty"]),
                            Deducted = Qty.Read(r["Cut"]),
                            SourceAfter = r["FromBalanceAfter"] == DBNull.Value ? (decimal?)null : Qty.Read(r["FromBalanceAfter"]),
                            UserId = r["UserID"]?.ToString() ?? "",
                            Barcode = r["ReferenceNo"]?.ToString() ?? "",
                            PartId = 1,
                            PartCode = r["PartCode"]?.ToString() ?? "",
                            PartName = r["Description"]?.ToString() ?? "",
                            SourcePartCode = r["SourcePartCode"]?.ToString() ?? "",
                            SourcePartName = r["SourcePartName"]?.ToString() ?? "",
                            StockCode = r["ToStockCode"]?.ToString() ?? "",
                            SourceCode = r["FromStockCode"]?.ToString() ?? "",
                            How = r["How"].ToString(),
                            MotherBefore = r["MotherBefore"] == DBNull.Value ? (decimal?)null : Qty.Read(r["MotherBefore"]),
                            MotherAfter = r["MotherAfter"] == DBNull.Value ? (decimal?)null : Qty.Read(r["MotherAfter"]),
                            MotherNow = r["MotherNow"] == DBNull.Value ? (decimal?)null : Qty.Read(r["MotherNow"]),
                            Reason = "DONE"
                        });
                    }
            }
            return list;
        }

        // ===== ACTION (สิทธิ์ APPROVE ของ Multi-Scanner) =====

        public class ActionResult
        {
            public bool Ok { get; set; }
            public string Message { get; set; }
            public ScanService.DeductResult Deduct { get; set; }
        }

        // ✔ APPROVE: รอดำเนินการ = รับเข้าคลังตามป้าย + ตัดคลังต้นทางเท่าที่ตัดได้ตอนนี้ / รายการเดิมที่รับไปแล้ว = ตัดคลังต้นทางอย่างเดียว
        //    status = APPROVED (กด APPROVE) / REGISTERED (ลงทะเบียนสินค้าจาก PRODUCT CONTROL แล้วรับเข้า) - แล้วไปแสดงที่ DEDUCTED
        public ActionResult Receive(DeductMissRow row, int partId, decimal qty, string userId, string status = "APPROVED")
        {
            var scan = new ScanService();
            var stock = new StockService().GetStocks().FirstOrDefault(s => s.StkId == row.StockId);
            if (stock == null) return new ActionResult { Message = $"ไม่พบคลัง {row.StockCode}" };
            string partCode, partA;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT PartCode FROM Nexus.Parts WHERE PartID = @p", conn))
            {
                cmd.Parameters.AddWithValue("@p", partId);
                conn.Open();
                using (var r = cmd.ExecuteReader())
                {
                    if (!r.Read()) return new ActionResult { Message = "ไม่พบสินค้าในระบบ" };
                    // Nexus.Parts ไม่มี PartACode แล้ว - PartCode เป็นตัวระบุหลักตัวเดียว (เหมือน ScanService)
                    partCode = r.GetString(0); partA = partCode;
                }
            }
            var coil = new ScanService.CoilLabel { CoilNo = string.IsNullOrWhiteSpace(row.CoilNo) ? null : row.CoilNo, MotherCoil = string.IsNullOrWhiteSpace(row.MotherCoil) ? null : row.MotherCoil };
            bool received = row.Status == "RECEIVED" && row.TxId.HasValue;
            var res = scan.UpdateStockWithDeduct(partId, partCode, partA, received ? row.LabelQty : qty, userId, row.Barcode, stock, row.SourceStockId,
                                                 coil: coil, approveMissId: row.MissId, approveStatus: status,
                                                 existingTxId: received ? row.TxId : null, formatId: row.FormatId);
            if (!res.Saved) return new ActionResult { Message = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", Deduct = res };
            LogService.WriteLog(userId, status == "REGISTERED" ? "NOT_DEDUCTED_REGISTER" : "NOT_DEDUCTED_APPROVE",
                $"{row.StockCode} <- {row.SourceCode} | {partCode} | Coil {row.CoilNo} | Master {row.MotherCoil} | " +
                (received ? "already received, " : $"received {Qty.Plain(qty)}, ") + $"cut {res.SourceCode} {Qty.Plain(res.Deducted)}" +
                (res.Deducted > 0 ? $" ({res.SourcePartCode} {Qty.Plain(res.SourceBefore)} -> {Qty.Plain(res.SourceAfter)})" : " (nothing to cut yet)"), partCode);
            return new ActionResult { Ok = true, Deduct = res };
        }

        // ⚡ APPROVE READY: ป้ายที่มี PD CODE + Master Coil ในคลังต้นทางเหลือพอตัดครบ (ไล่ตามลำดับสแกน หักน้ำหนักทีละใบ)
        //    ใช้ทั้งปุ่ม APPROVE READY (Multi-Scanner) และหลัง MANAGE STOCK ของคลัง Coil (เพิ่ม / แก้ Master Coil แล้วเคลียร์ป้ายที่ค้างให้เอง)
        //    ids = เฉพาะรายการเหล่านี้ (null = ทุกรายการในคลังที่กำหนด)
        public sealed class ReadyResult { public int Done; public int Skipped; public decimal Kg; public List<string> Errors = new List<string>(); }

        public ReadyResult ApproveReady(IEnumerable<int> stockIds, ICollection<int> ids, string userId)
        {
            var res = new ReadyResult();
            try { Relink(force: true); } catch { /* ผูก PD CODE ไม่ได้ = ใช้ข้อมูลเดิม */ }
            var rows = GetRows("", new DateTime(2000, 1, 1), DateTime.Today, stockIds)
                          .Where(r => r.HasProduct && r.MotherNow.HasValue && (ids == null || ids.Contains(r.MissId)))
                          .OrderBy(r => r.ScanDate).ThenBy(r => r.MissId).ToList();
            var left = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in rows)
            {
                string key = r.SourceStockId + "|" + r.MotherCoil;
                decimal have = left.TryGetValue(key, out var v) ? v : r.MotherNow.Value;
                if (have < r.LabelQty) { res.Skipped++; continue; }
                var a = Receive(r, r.PartId.Value, r.LabelQty, userId, "APPROVED");
                if (!a.Ok) { res.Errors.Add($"{r.CoilNo}: {a.Message}"); continue; }
                decimal cut = a.Deduct?.Deducted ?? 0;
                left[key] = have - cut;
                res.Kg += cut;
                res.Done++;
            }
            return res;
        }

        // + PRODUCT: เปลี่ยนคลังที่รับเข้าของป้าย (ก่อนรับเข้า)
        public void MoveTarget(int missId, int stockId)
        {
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("UPDATE Nexus.DeductMisses SET StockID = @s WHERE MissID = @m", conn))
            {
                cmd.Parameters.AddWithValue("@s", stockId);
                cmd.Parameters.AddWithValue("@m", missId);
                conn.Open();
                cmd.ExecuteNonQuery();
            }
        }

        public sealed class PartPick { public int PartId; public string Note; public string Error; }

        // + PRODUCT ด้วย PRODUCT CODE + NAME: รหัสตรงกับสินค้าที่มี = ใช้สินค้านั้น (ชื่อที่กรอกต่างจากเดิม = แก้ชื่อ) / ไม่มี = ลงทะเบียนใหม่
        //   แล้วให้สินค้าอยู่ในคลังที่รับเข้า (คลังอื่นที่ไม่ใช่คลังหลัก = เพิ่มแถว PartStocks ยอด 0) - ลง Activity Log ทุกครั้ง
        public PartPick FindOrCreatePart(string code, string name, string packSize, int stockId, string userId)
        {
            code = (code ?? "").Trim();
            name = (name ?? "").Trim();
            if (code.Length == 0) return new PartPick { Error = "กรุณากรอก PRODUCT CODE" };
            string ps = (packSize ?? "").Trim();
            if (ps.Length > 0 && !ps.All(char.IsDigit)) return new PartPick { Error = "PACKSIZE ต้องเป็นตัวเลข" };
            var stock = new StockService().GetStocks().FirstOrDefault(s => s.StkId == stockId);
            if (stock == null) return new PartPick { Error = "ไม่พบคลังที่รับเข้า" };
            int id = 0; string oldName = null;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var cmd = new SqlCommand("SELECT TOP 1 PartID, Description FROM Nexus.Parts WHERE PartCode = @c AND IsActive = 1 ORDER BY PartID", conn))
                {
                    cmd.Parameters.AddWithValue("@c", code);
                    using (var r = cmd.ExecuteReader())
                        if (r.Read()) { id = r.GetInt32(0); oldName = r.IsDBNull(1) ? "" : r.GetString(1); }
                }
                string note;
                if (id > 0)
                {
                    note = $"ใช้สินค้าเดิม {code}";
                    if (name.Length > 0 && !string.Equals(name, oldName, StringComparison.Ordinal))
                    {
                        using (var cmd = new SqlCommand("UPDATE Nexus.Parts SET Description = @n WHERE PartID = @p", conn))
                        {
                            cmd.Parameters.AddWithValue("@n", name);
                            cmd.Parameters.AddWithValue("@p", id);
                            cmd.ExecuteNonQuery();
                        }
                        LogService.WriteLog(userId, "EDIT_PART", $" | Edited Details : PTNAME: {oldName}->{name} (NOT DEDUCTED + PRODUCT)", code);
                        note += $" (แก้ชื่อเป็น {name})";
                    }
                }
                else
                {
                    if (name.Length == 0) return new PartPick { Error = $"ไม่มี PRODUCT CODE {code} ในระบบ - กรอก PRODUCT NAME เพื่อลงทะเบียนใหม่" };
                    int psz = int.TryParse(ps, out int p) ? p : 0;
                    id = new ProductControlService().InsertNewPartAsync(code, name, psz, "", 0, 0, "GENERAL", null, null, "N/A").GetAwaiter().GetResult();
                    if (id <= 0) return new PartPick { Error = "ลงทะเบียนสินค้าใหม่ไม่สำเร็จ" };
                    LogService.WriteLog(userId, "REGISTER_PART", $"Registered New Part: PDCODE : {code}  | PDNAME: {name}  | PZ : {psz} (NOT DEDUCTED + PRODUCT -> {stock.Code})", code);
                    note = $"ลงทะเบียนสินค้าใหม่ {code} แล้ว";
                }
                // สินค้าต้องอยู่ในคลังที่รับเข้า
                if (!stock.IsMain)
                    using (var cmd = new SqlCommand(@"IF NOT EXISTS (SELECT 1 FROM Nexus.PartStocks WHERE StockID = @s AND PartID = @p)
                                                          INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity) VALUES (@s, @p, 0)", conn))
                    {
                        cmd.Parameters.AddWithValue("@s", stock.StkId);
                        cmd.Parameters.AddWithValue("@p", id);
                        cmd.ExecuteNonQuery();
                    }
                return new PartPick { PartId = id, Note = note };
            }
        }

        // MAX / MIN / Coil เพิ่ม (STOCK COIL มากกว่า 1 ม้วนของป้าย) ของสินค้าในคลังที่รับ (คลังหลัก = Nexus.Parts / คลังอื่น = Nexus.PartStocks)
        public void ApplyStockSetting(int stockId, int partId, decimal? max, decimal? min, int? extraCoils, string userId)
        {
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                bool isMain;
                using (var cmd = new SqlCommand("SELECT ISNULL(IsMain, 0) FROM Nexus.Stocks WHERE StockID = @s", conn))
                {
                    cmd.Parameters.AddWithValue("@s", stockId);
                    isMain = Convert.ToBoolean(cmd.ExecuteScalar() ?? false);
                }
                string coilCol = isMain ? (DbSchema.HasCountCoil ? "CoilQuantity" : null) : "BoxQuantity";
                string sql = isMain
                    ? "UPDATE Nexus.Parts SET MaxQuantity = ISNULL(@max, MaxQuantity), MinQuantity = ISNULL(@min, MinQuantity)" +
                      (coilCol != null ? ", CoilQuantity = ISNULL(CoilQuantity, 0) + @coil" : "") + " WHERE PartID = @p"
                    : "UPDATE Nexus.PartStocks SET MaxQuantity = ISNULL(@max, MaxQuantity), MinQuantity = ISNULL(@min, MinQuantity), BoxQuantity = ISNULL(BoxQuantity, 0) + @coil, UpdatedDate = GETDATE() WHERE PartID = @p AND StockID = @s";
                using (var cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.Add(QtyParam.Of("@max", max));
                    cmd.Parameters.Add(QtyParam.Of("@min", min));
                    cmd.Parameters.AddWithValue("@coil", extraCoils ?? 0);
                    cmd.Parameters.AddWithValue("@p", partId);
                    cmd.Parameters.AddWithValue("@s", stockId);
                    cmd.ExecuteNonQuery();
                }
            }
            LogService.WriteLog(userId, "NOT_DEDUCTED_STOCK_SETTING",
                $"Stock {stockId} part {partId} | MAX {(max.HasValue ? Qty.Plain(max.Value) : "-")} | MIN {(min.HasValue ? Qty.Plain(min.Value) : "-")} | extra coil {extraCoils ?? 0}", partId.ToString());
        }

        // 🗑 ลบ: รอดำเนินการ = ลบรายการ (ไม่มีอะไรเข้าคลัง) / รายการเดิมที่รับเข้าไปแล้ว = ยกเลิกรายการสแกนนั้น (คืนยอดคลัง) แล้วลบ - เก็บ Log
        public ActionResult Delete(DeductMissRow row, string userId)
        {
            if (row.Status == "RECEIVED" && row.TxId.HasValue)
            {
                try { new ScanAdjustService().CancelScan(row.TxId.Value, $"NOT DEDUCTED deleted (Coil {row.CoilNo})", userId); }
                catch (Exception ex) { return new ActionResult { Message = "ยกเลิกรายการสแกนไม่สำเร็จ\n" + ex.Message }; }
            }
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("DELETE FROM Nexus.DeductMisses WHERE MissID = @id", conn))
            {
                cmd.Parameters.AddWithValue("@id", row.MissId);
                conn.Open();
                cmd.ExecuteNonQuery();
            }
            LogService.WriteLog(userId, "NOT_DEDUCTED_DELETE",
                $"Deleted {row.Status} | {row.StockCode} <- {row.SourceCode} | {row.PartCodeText} | Coil {row.CoilNo} | Master {row.MotherCoil} | Label {row.LabelQtyText}" +
                (row.Status == "RECEIVED" ? $" | scan {row.TxId} cancelled (stock returned)" : "") + $" | {row.Barcode}", row.PartCode ?? "");
            return new ActionResult { Ok = true };
        }

        // 🗑 ลบหลายรายการ (แบบเดิม: เอาออกจากรายการเฉยๆ ไม่กระทบยอด) - ฐานที่ยังไม่รัน Update_20261016b.sql
        public int Delete(IEnumerable<int> ids)
        {
            var idList = ids.Distinct().ToList();
            if (idList.Count == 0) return 0;
            int n = 0;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    foreach (var chunk in idList.Select((id, i) => (id, i)).GroupBy(x => x.i / 500, x => x.id))
                        using (var cmd = new SqlCommand("DELETE FROM Nexus.DeductMisses WHERE MissID IN (" + string.Join(",", chunk.Select(i => i.ToString())) + ")", conn, tr))
                            n += cmd.ExecuteNonQuery();
                    tr.Commit();
                }
            }
            return n;
        }

        // ===== Export (รูปแบบเดียวกับไฟล์ Export ทั้งระบบ) =====

        public string ExportDeducted(IList<DeductMissRow> rows)
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Scanner, "DEDUCTED");
            using (var wb = new ClosedXML.Excel.XLWorkbook())
            {
                var ws = wb.Worksheets.Add("DEDUCTED");
                string[] heads = { "NO", "SCAN DATE", "PD CODE", "PRODUCT NAME", "MASTER COIL", "COIL NO", "CUT FROM SOURCE (KG)", "SOURCE PD CODE", "SOURCE PRODUCT NAME", "MASTER COIL BEFORE (KG)", "SOURCE BALANCE", "USER", "STOCK", "BARCODE" };
                ImportTemplateService.Header(ws, heads, new double[] { 6.4, 19, 18, 34, 15, 18, 16, 18, 34, 18, 16, 10, 26, 70 });
                int row = 2;
                foreach (var x in rows)
                {
                    ws.Cell(row, 1).Value = row - 1;
                    ws.Cell(row, 2).Value = x.ScanDate;
                    ws.Cell(row, 2).Style.DateFormat.Format = "dd/MM/yyyy HH:mm:ss";
                    ws.Cell(row, 3).Value = x.PartCode;
                    ws.Cell(row, 4).Value = x.PartName;
                    ws.Cell(row, 5).Value = x.MotherCoil;
                    ws.Cell(row, 6).Value = x.CoilNo;
                    ws.Cell(row, 7).Value = x.Deducted;
                    ws.Cell(row, 8).Value = x.SourcePartCode;
                    ws.Cell(row, 9).Value = x.SourcePartName;
                    if (x.MotherBefore.HasValue) ws.Cell(row, 10).Value = x.MotherBefore.Value;
                    if (x.SourceAfter.HasValue) ws.Cell(row, 11).Value = x.SourceAfter.Value;
                    ws.Cell(row, 12).Value = x.UserId;
                    ws.Cell(row, 13).Value = x.StockText;
                    ws.Cell(row, 14).Value = x.Barcode;
                    row++;
                }
                ImportTemplateService.Body(ws, row - 1, heads.Length);
                ImportTemplateService.LeftAlign(ws, row - 1, 4, 4);
                ImportTemplateService.LeftAlign(ws, row - 1, 9, 9);
                ImportTemplateService.LeftAlign(ws, row - 1, 14, 14);
                if (row > 2) { ws.Range(2, 7, row - 1, 7).Style.NumberFormat.Format = "#,##0.00#"; ws.Range(2, 10, row - 1, 11).Style.NumberFormat.Format = "#,##0.00#"; }
                wb.SaveAs(path);
            }
            return path;
        }

        public string Export(IList<DeductMissRow> rows)
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Scanner, "NOT_DEDUCTED");
            using (var wb = new ClosedXML.Excel.XLWorkbook())
            {
                var ws = wb.Worksheets.Add("NOT DEDUCTED");
                string[] heads = { "NO", "SCAN DATE", "PD CODE", "PRODUCT NAME", "MASTER COIL", "COIL NO", "SCANNED QTY (KG)", "STATUS", "REASON", "MASTER COIL NOW", "USER", "STOCK", "BARCODE" };
                ImportTemplateService.Header(ws, heads, new double[] { 6.4, 19, 18, 34, 15, 18, 16, 34, 38, 20, 10, 26, 70 });
                int row = 2;
                foreach (var x in rows)
                {
                    ws.Cell(row, 1).Value = row - 1;
                    ws.Cell(row, 2).Value = x.ScanDate;
                    ws.Cell(row, 2).Style.DateFormat.Format = "dd/MM/yyyy HH:mm:ss";
                    ws.Cell(row, 3).Value = x.PartCodeText;
                    ws.Cell(row, 4).Value = x.PartNameText;
                    ws.Cell(row, 5).Value = x.MotherCoil;
                    ws.Cell(row, 6).Value = x.CoilNo;
                    ws.Cell(row, 7).Value = x.LabelQty;
                    ws.Cell(row, 8).Value = x.StatusText;
                    ws.Cell(row, 9).Value = x.ReasonText;
                    ws.Cell(row, 10).Value = x.MotherNowText;
                    ws.Cell(row, 11).Value = x.UserId;
                    ws.Cell(row, 12).Value = x.StockText;
                    ws.Cell(row, 13).Value = x.Barcode;
                    row++;
                }
                ImportTemplateService.Body(ws, row - 1, heads.Length);
                ImportTemplateService.LeftAlign(ws, row - 1, 4, 4);
                ImportTemplateService.LeftAlign(ws, row - 1, 8, 9);
                ImportTemplateService.LeftAlign(ws, row - 1, 13, 13);
                if (row > 2) ws.Range(2, 7, row - 1, 7).Style.NumberFormat.Format = "#,##0.00#";
                wb.SaveAs(path);
            }
            return path;
        }
    }
}
