/* ============================================================================
   CHR-Nexus : 📋 MIN REPORT (ต่อ) - รูปแบบการแสดงสินค้าต่อคลัง + FLOW ลายเซ็น Prepared / Checked / Checked / Approved
   ----------------------------------------------------------------------------
   MinReportDisplay = ต่อคลัง: บรรทัดที่ 1 (ตัวหนา) / บรรทัดที่ 2 แสดงช่องไหนบ้าง เรียงตามลำดับ (คอลัมน์ของตาราง Store Max-Min)
                      เช่น STORE-PC : Line1 = PARTA · Line2 = PARTNO,NAME   (ไม่มีแถว = PRODUCT CODE / PRODUCT NAME เหมือนเดิม)
   MinReportFlow    = ต่อคลัง ช่องละ 1 แถว (Slot 1 Prepared · 2 Checked · 3 Checked · 4 Approved)
                      Mode OFF = ไม่ใช้ช่องนี้ · ANY = ผู้ใช้ในรายชื่อลงได้ทุกคน (คนใดคนหนึ่ง) · ONE = รายบุคคล (คนเดียว)
   MinReportSigns   = ลายเซ็นที่ลงแล้วของแต่ละรายงาน (ใคร · ช่องไหน · เมื่อไร) - รูปลายเซ็นเก็บเป็นไฟล์ <UserID>-Signature.png
   MinReports (+)   = ReasonType (หมายเหตุที่เลือก) · FlowStatus (SIGNING / DONE) · NextSlot (ช่องที่รอเซ็น) · DoneAt
   - รันซ้ำได้ · เพิ่มตาราง / คอลัมน์ที่เป็น NULL ได้อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.MinReportDisplay', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinReportDisplay (
        StockID     INT            NOT NULL CONSTRAINT PK_MinReportDisplay PRIMARY KEY,
        Line1       NVARCHAR(300)  NOT NULL CONSTRAINT DF_MinReportDisplay_L1 DEFAULT (N'CODE'),
        Line2       NVARCHAR(300)  NOT NULL CONSTRAINT DF_MinReportDisplay_L2 DEFAULT (N'NAME'),
        UpdatedBy   NVARCHAR(50)   NULL,
        UpdatedDate DATETIME       NOT NULL CONSTRAINT DF_MinReportDisplay_Date DEFAULT (GETDATE())
    );
END;

IF OBJECT_ID('Nexus.MinReportFlow', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinReportFlow (
        StockID     INT             NOT NULL,
        Slot        TINYINT         NOT NULL CONSTRAINT CK_MinReportFlow_Slot CHECK (Slot BETWEEN 1 AND 4),
        Mode        VARCHAR(10)     NOT NULL CONSTRAINT DF_MinReportFlow_Mode DEFAULT ('OFF') CONSTRAINT CK_MinReportFlow_Mode CHECK (Mode IN ('OFF', 'ANY', 'ONE')),
        Users       NVARCHAR(2000)  NULL,              -- UserID คั่นด้วย ,
        UpdatedBy   NVARCHAR(50)    NULL,
        UpdatedDate DATETIME        NOT NULL CONSTRAINT DF_MinReportFlow_Date DEFAULT (GETDATE()),
        CONSTRAINT PK_MinReportFlow PRIMARY KEY (StockID, Slot)
    );
END;

IF OBJECT_ID('Nexus.MinReportSigns', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.MinReportSigns (
        ReportID INT            NOT NULL,
        Slot     TINYINT        NOT NULL,
        UserID   NVARCHAR(50)   NOT NULL,
        UserName NVARCHAR(200)  NULL,
        SignedAt DATETIME       NOT NULL CONSTRAINT DF_MinReportSigns_Date DEFAULT (GETDATE()),
        CONSTRAINT PK_MinReportSigns PRIMARY KEY (ReportID, Slot)
    );
END;

IF COL_LENGTH('Nexus.MinReports', 'ReasonType') IS NULL ALTER TABLE Nexus.MinReports ADD ReasonType NVARCHAR(60) NULL;
IF COL_LENGTH('Nexus.MinReports', 'FlowStatus') IS NULL ALTER TABLE Nexus.MinReports ADD FlowStatus VARCHAR(12) NULL;
IF COL_LENGTH('Nexus.MinReports', 'NextSlot')   IS NULL ALTER TABLE Nexus.MinReports ADD NextSlot TINYINT NULL;
IF COL_LENGTH('Nexus.MinReports', 'DoneAt')     IS NULL ALTER TABLE Nexus.MinReports ADD DoneAt DATETIME NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MinReports_Flow' AND object_id = OBJECT_ID('Nexus.MinReports'))
    CREATE INDEX IX_MinReports_Flow ON Nexus.MinReports (FlowStatus, NextSlot) INCLUDE (StockID);
GO
