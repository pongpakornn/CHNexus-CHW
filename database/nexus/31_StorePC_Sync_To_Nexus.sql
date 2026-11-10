/* =====================================================================
   🔄 STORE-PC: ปรับข้อมูลที่เก็บไว้ใน CHR-Nexus ให้ตรงกับโปรแกรม StorePC ปัจจุบัน (เตรียมย้ายระบบ)
   - ฐาน StorePC อ่านอย่างเดียว (SELECT) · เขียนเฉพาะ Nexus.PartStocks (คลัง STORE-PC) + Nexus.Parts.PackSize
   - ไม่แตะการแสดงผลสด: STORE-PC ยังเป็น Live (Nexus.Stocks.LiveSource = 'StorePC') หน้าจอยังอ่านจาก StorePC เหมือนเดิม
   - จับคู่สินค้า: PRODUCT CODE + PART A (แบบเดียวกับ Nexus.vw_StorePcLive)
   - ที่ปรับ: STOCK (PCS) · STOCK (BOX) · MAX · MIN · REMARK · SHOW/HIDE · PACK SIZE
   - ที่ไม่ทับ: ชื่อสินค้า (StorePC มีตัวอักษรเสียต่อท้ายบางรายการ) · BIN (StorePC ว่างทุกตัว) · CATEGORY ที่ StorePC ว่าง
     รูป (ปรับแล้วแยกต่างหาก: StorePC ก่อน แล้วค่อย EDP) · สินค้าที่มีเฉพาะใน CHR-Nexus (เพิ่มจาก EDP) ไม่ลบ
   รันซ้ำได้ (ไม่มีอะไรต่าง = ไม่แก้อะไร)
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> 'CHR-Nexus' THROW 50000, N'ต้องรันบนฐาน CHR-Nexus', 1;
IF DB_ID('StorePC') IS NULL THROW 50001, N'ไม่พบฐาน StorePC', 1;

DECLARE @stk INT = (SELECT StockID FROM Nexus.Stocks WHERE StockCode = 'STORE-PC');
IF @stk IS NULL THROW 50002, N'ไม่พบคลัง STORE-PC', 1;

DECLARE @m TABLE (PartID INT PRIMARY KEY, Pcs DECIMAL(18,3), Box INT, QMax DECIMAL(18,3), QMin DECIMAL(18,3), Rmk NVARCHAR(MAX), Show BIT, Pack INT);
INSERT INTO @m
SELECT p.PartID, ISNULL(s.QTY_STK, 0), ISNULL(s.QTY_STKB, 0), s.QTY_MAX, s.QTY_MIN, s.PT_REMARK, CAST(ISNULL(s.IS_SHOW_MST, 1) AS BIT), s.PT_PSZ
FROM Nexus.PartStocks ps
JOIN Nexus.Parts p ON p.PartID = ps.PartID
CROSS APPLY (SELECT TOP 1 m.* FROM StorePC.dbo.MST_PART m
             WHERE ISNULL(NULLIF(LTRIM(RTRIM(m.PT_CODE)), ''), '-') COLLATE DATABASE_DEFAULT = p.PartCode
               AND ISNULL(LTRIM(RTRIM(m.PT_ACODE)), '') COLLATE DATABASE_DEFAULT = ISNULL(p.PartA, '')
             ORDER BY m.IS_ACTIVE DESC, m.PT_ID) s
WHERE ps.StockID = @stk;

BEGIN TRAN;
UPDATE ps SET ps.Quantity = m.Pcs, ps.BoxQuantity = m.Box, ps.MaxQuantity = m.QMax, ps.MinQuantity = m.QMin,
              ps.REMARK = m.Rmk, ps.IsShow = m.Show, ps.UpdatedDate = GETDATE()
FROM Nexus.PartStocks ps JOIN @m m ON m.PartID = ps.PartID
WHERE ps.StockID = @stk
  AND EXISTS (SELECT ps.Quantity, ps.BoxQuantity, ps.MaxQuantity, ps.MinQuantity, CAST(ps.REMARK AS NVARCHAR(MAX)), ps.IsShow
              EXCEPT SELECT m.Pcs, m.Box, m.QMax, m.QMin, m.Rmk, m.Show);
DECLARE @stock INT = @@ROWCOUNT;

UPDATE p SET p.PackSize = m.Pack
FROM Nexus.Parts p JOIN @m m ON m.PartID = p.PartID
WHERE m.Pack IS NOT NULL AND ISNULL(p.PackSize, -1) <> m.Pack;
DECLARE @pack INT = @@ROWCOUNT;
COMMIT;

SELECT (SELECT COUNT(*) FROM @m) AS Matched, @stock AS StockRowsUpdated, @pack AS PackSizeUpdated,
       (SELECT COUNT(*) FROM StorePC.dbo.MST_PART s WHERE NOT EXISTS (
            SELECT 1 FROM Nexus.PartStocks ps JOIN Nexus.Parts p ON p.PartID = ps.PartID
            WHERE ps.StockID = @stk AND p.PartCode = ISNULL(NULLIF(LTRIM(RTRIM(s.PT_CODE)), ''), '-') COLLATE DATABASE_DEFAULT
              AND ISNULL(p.PartA, '') = ISNULL(LTRIM(RTRIM(s.PT_ACODE)), '') COLLATE DATABASE_DEFAULT)) AS StorePcNotInNexus;
GO
