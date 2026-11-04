/* ============================================================================
   CHR-Nexus : 🧲 MANAGE STOCK ของคลังที่นับ Coil (Store > คลัง > ปุ่ม MANAGE STOCK)
   ----------------------------------------------------------------------------
   ประวัติการจัดการ Coil โดยผู้มีสิทธิ์ (APPROVE ของคลังนั้น + EDIT) - ปุ่ม HISTORY ในหน้าคลัง
     ADD      = เพิ่ม Master Coil / Coil No ที่บรรทัด PD CODE
     EDIT     = แก้ Master Coil / Coil No / น้ำหนัก / REMARK (ส่วนต่างน้ำหนักคืน / ตัดคลังต้นทาง เช่น STOCK-PANTA)
     TRANSFER = โอนย้ายออก (บันทึกเป็นสแกนออกที่ Multi-Scanner)
     ADJUST   = ปรับปรุงยอด: คืนยอดคลังต้นทาง / ลบออกจากคลัง (เหลือ Master Coil) + หมายเหตุ
   - รันซ้ำได้ · เพิ่มตารางใหม่อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   - ทุกรายการลง Activity Log (Nexus.SystemLogs) ด้วยเหมือนเดิม
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.CoilManageLog', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.CoilManageLog (
        LogID        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CoilManageLog PRIMARY KEY,
        LogDate      DATETIME       NOT NULL CONSTRAINT DF_CoilManageLog_Date DEFAULT (GETDATE()),
        StockID      INT            NOT NULL,
        StockCode    VARCHAR(50)    NULL,
        PartID       INT            NULL,
        PartCode     NVARCHAR(100)  NULL,
        CoilID       INT            NULL,
        CoilNo       NVARCHAR(100)  NULL,
        MotherCoil   NVARCHAR(100)  NULL,
        Action       VARCHAR(20)    NOT NULL,     -- ADD / EDIT / TRANSFER / ADJUST
        Mode         VARCHAR(20)    NULL,         -- ADJUST: RETURN / REMOVE · ADD: DEDUCT / MATCH / PLAIN
        WeightBefore DECIMAL(18,3)  NULL,
        WeightAfter  DECIMAL(18,3)  NULL,
        SourceCode   VARCHAR(50)    NULL,         -- คลังต้นทางที่คืน / ตัดยอด (เช่น STOCK-PANTA)
        SourceQty    DECIMAL(18,3)  NULL,         -- + = คืนให้คลังต้นทาง · - = ตัดจากคลังต้นทางเพิ่ม
        Detail       NVARCHAR(1000) NULL,         -- ค่าเดิม -> ค่าใหม่
        Reason       NVARCHAR(500)  NULL,
        UserID       VARCHAR(20)    NULL
    );
    CREATE INDEX IX_CoilManageLog_Stock_Date ON Nexus.CoilManageLog (StockID, LogDate DESC) INCLUDE (Action);
END
GO

SELECT TOP 20 * FROM Nexus.CoilManageLog ORDER BY LogID DESC;
