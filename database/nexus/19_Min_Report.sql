/* ============================================================================
   CHR-Nexus : 📋 MIN REPORT - แจ้งเตือนสินค้าที่ค้างอยู่ที่ค่า MIN นานเกินกำหนด (Store > คลัง > ปุ่ม MIN REPORT)
   ----------------------------------------------------------------------------
   MinReportSettings = ตั้งค่าของทั้งระบบ (User Management > SETUP > MIN REPORT · Admin)
                       StuckDays = ค้างกี่วันจึงแจ้งเตือน · RemindMinutes = กด CANCEL แล้วแจ้งซ้ำทุกกี่นาที
   MinReportStocks   = คลังที่ใช้การแจ้งเตือนนี้ (ไม่ใช่รายบุคคล)
   MinWatch          = ประวัติช่วงที่สินค้าอยู่ใต้ MIN (เริ่มเมื่อไร · กลับมาปกติเมื่อไร) - ระบบบันทึกเองทุก 5 นาที
   MinReports        = รายงานสาเหตุที่ผู้ใช้กรอก (ใคร · เมื่อไร · สินค้าไหน · ค้างกี่วัน · เพราะอะไร)
   - รันซ้ำได้ · เพิ่มตารางใหม่อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   - อ่านสถานะจาก Nexus.vw_StockMonitoring (คลัง STORE-PC อ่านจาก StorePC แบบอ่านอย่างเดียวเหมือนเดิม)
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;   -- ดัชนีแบบมีเงื่อนไข (filtered index) ต้องเปิดค่านี้
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.MinReportSettings', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinReportSettings (
        Id            INT           NOT NULL CONSTRAINT PK_MinReportSettings PRIMARY KEY CONSTRAINT CK_MinReportSettings_One CHECK (Id = 1),
        Enabled       BIT           NOT NULL CONSTRAINT DF_MinReportSettings_On DEFAULT (1),
        StuckDays     INT           NOT NULL CONSTRAINT DF_MinReportSettings_Days DEFAULT (3),
        RemindMinutes INT           NOT NULL CONSTRAINT DF_MinReportSettings_Remind DEFAULT (60),
        UpdatedBy     NVARCHAR(50)  NULL,
        UpdatedDate   DATETIME      NOT NULL CONSTRAINT DF_MinReportSettings_Date DEFAULT (GETDATE())
    );
END;
IF NOT EXISTS (SELECT 1 FROM Nexus.MinReportSettings WHERE Id = 1)
    INSERT INTO Nexus.MinReportSettings (Id, Enabled, StuckDays, RemindMinutes, UpdatedBy) VALUES (1, 1, 3, 60, N'SYSTEM');

IF OBJECT_ID('Nexus.MinReportStocks', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinReportStocks (
        StockID     INT           NOT NULL CONSTRAINT PK_MinReportStocks PRIMARY KEY,
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_MinReportStocks_Date DEFAULT (GETDATE())
    );
END;

IF OBJECT_ID('Nexus.MinWatch', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinWatch (
        WatchID    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MinWatch PRIMARY KEY,
        StockID    INT            NOT NULL,
        PartID     INT            NOT NULL,
        PartCode   NVARCHAR(100)  NULL,
        PartName   NVARCHAR(300)  NULL,
        BelowSince DATETIME       NOT NULL,           -- เริ่มอยู่ใต้ MIN
        LastSeen   DATETIME       NOT NULL,           -- รอบล่าสุดที่ยังอยู่ใต้ MIN
        ResolvedAt DATETIME       NULL,               -- กลับมาพ้น MIN (NULL = ยังค้างอยู่)
        Qty        DECIMAL(18,3)  NULL,
        StockBox   NVARCHAR(50)   NULL,
        MinQty     DECIMAL(18,3)  NULL,
        MaxQty     DECIMAL(18,3)  NULL,
        ReportID   INT            NULL,               -- รายงานสาเหตุแล้ว = ไม่แจ้งเตือนช่วงนี้อีก
        Source     VARCHAR(10)    NOT NULL CONSTRAINT DF_MinWatch_Source DEFAULT ('AUTO')   -- AUTO / TEST
    );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MinWatch_Open' AND object_id = OBJECT_ID('Nexus.MinWatch'))
    CREATE UNIQUE INDEX UX_MinWatch_Open ON Nexus.MinWatch (StockID, PartID) WHERE ResolvedAt IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MinWatch_Stock' AND object_id = OBJECT_ID('Nexus.MinWatch'))
    CREATE INDEX IX_MinWatch_Stock ON Nexus.MinWatch (StockID, BelowSince);

IF OBJECT_ID('Nexus.MinReports', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinReports (
        ReportID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MinReports PRIMARY KEY,
        WatchID      INT            NOT NULL,
        StockID      INT            NOT NULL,
        StockCode    VARCHAR(50)    NULL,
        PartID       INT            NOT NULL,
        PartCode     NVARCHAR(100)  NULL,
        PartName     NVARCHAR(300)  NULL,
        Qty          DECIMAL(18,3)  NULL,
        StockBox     NVARCHAR(50)   NULL,
        MinQty       DECIMAL(18,3)  NULL,
        MaxQty       DECIMAL(18,3)  NULL,
        BelowSince   DATETIME       NOT NULL,
        DaysStuck    DECIMAL(9,2)   NOT NULL,
        Reason       NVARCHAR(1000) NOT NULL,
        ReportedBy   NVARCHAR(50)   NOT NULL,
        ReporterName NVARCHAR(200)  NULL,
        ReportedAt   DATETIME       NOT NULL CONSTRAINT DF_MinReports_Date DEFAULT (GETDATE())
    );
    CREATE INDEX IX_MinReports_Stock ON Nexus.MinReports (StockID, ReportedAt);
END;
GO
