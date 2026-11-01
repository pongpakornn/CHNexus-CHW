/* ============================================================================
   CHR-Nexus : 📷 Multi-Scanner - ต่อท้าย QR ที่บันทึกตอนสแกนรับเข้า (User Management > PERMISSION > SCAN STOCKS)
   ----------------------------------------------------------------------------
   ตั้งต่อ UserID + คลัง (เหมือน EMP ID / DEPT) เช่น STOCK-CHW:
     QR 5T072-4943-1  20  ->  บันทึกเป็น 5T072-4943-1  20 2610 KUBOTA 0001 (คั่นด้วยตัวคั่นของ QR คลังนั้น - ADMIN > QR CODE)
   - Nexus.UserScanStocks.QrDateFmt  = รูปแบบวันที่ YYMM / YYMMDD / YYYYMM / YYYYMMDD / DDMMYY / MMYY (NULL = ไม่ใส่)
   - Nexus.UserScanStocks.QrRefField = ช่องของสินค้าที่สแกน CUSTOMER / SUPPLIER / CATEGORY / PCODE / PARTA / PARTB / PARTNO / NAME / MODEL / CF<n> (NULL = ไม่ใส่)
   - Nexus.UserScanStocks.QrRunStart = เลขเริ่มของรันนิ่ง เช่น 0001 (จำนวนหลัก = ความยาว) (NULL = ไม่ใส่)
   - Nexus.ScanQrRunning = เลขล่าสุดของแต่ละคลังต่อวัน (วันใหม่ = เริ่มที่เลขเริ่มใหม่)
   - รันซ้ำได้ · เพิ่มคอลัมน์ / ตารางใหม่อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.UserScanStocks', 'QrDateFmt') IS NULL
    ALTER TABLE Nexus.UserScanStocks ADD QrDateFmt VARCHAR(10) NULL;
IF COL_LENGTH('Nexus.UserScanStocks', 'QrRefField') IS NULL
    ALTER TABLE Nexus.UserScanStocks ADD QrRefField VARCHAR(20) NULL;
IF COL_LENGTH('Nexus.UserScanStocks', 'QrRunStart') IS NULL
    ALTER TABLE Nexus.UserScanStocks ADD QrRunStart VARCHAR(10) NULL;
GO

IF OBJECT_ID('Nexus.ScanQrRunning', 'U') IS NULL
    CREATE TABLE Nexus.ScanQrRunning (
        StockID     INT      NOT NULL,
        RunDate     DATE     NOT NULL,
        LastNo      INT      NOT NULL,
        UpdatedDate DATETIME NOT NULL CONSTRAINT DF_ScanQrRunning_UpdatedDate DEFAULT GETDATE(),
        CONSTRAINT PK_ScanQrRunning PRIMARY KEY (StockID, RunDate)
    );
GO

SELECT UserID, StockID, QrDateFmt, QrRefField, QrRunStart FROM Nexus.UserScanStocks ORDER BY UserID, StockID;
