/* ============================================================================
   CHR-Nexus : ▣ QR ระบบ - ตัวคั่นช่องใน QR ตั้งเองได้ต่อคลัง (ADMIN > QR CODE)
   ----------------------------------------------------------------------------
   - Nexus.ProductControlSettings.QrSep = ตัวคั่นช่องในรูปแบบที่ 2 (ข้อมูลใน QR) เช่น | ; , หรือเว้นวรรค
     NULL = | (ค่าเดิม) -> QR ที่พิมพ์ไปแล้วสแกนได้เหมือนเดิม
   - รันซ้ำได้ · เพิ่มคอลัมน์อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.ProductControlSettings', 'QrSep') IS NULL
    ALTER TABLE Nexus.ProductControlSettings ADD QrSep NVARCHAR(5) NULL;
GO

SELECT StockID, QrFields, QrSep FROM Nexus.ProductControlSettings ORDER BY StockID;
