/* ============================================================================
   CHR-Nexus : 📍 LAYOUT SETUP - ตำแหน่งจัดเก็บ + QR ตำแหน่ง + สแกนตำแหน่งก่อนรับเข้า (Multi-Scanner)
   ----------------------------------------------------------------------------
   - Nexus.LayoutTypes     = ประเภทตำแหน่ง เช่น RACK1 / ZONE-A (เมนู Sidebar > Layout Setup)
   - Nexus.LayoutLocations = ชื่อตำแหน่งในประเภทนั้น เช่น 3A / 3B / 3C (กดเพิ่ม = บันทึกทันที)
   - Nexus.LayoutSettings  = รูปแบบข้อมูลใน QR ตำแหน่ง (ทั้งระบบ แถวเดียว Id = 1)
       QrFields = TYPE,NAME / NAME / TYPE (ลำดับตามที่เลือก) · QrSep = ตัวคั่น เช่น | หรือเว้นวรรค
       สแกนแล้วหน้า Multi-Scanner แสดงค่าตามรูปแบบนี้ เช่น "RACK1 3A" หรือ "3A" · ใต้ QR พิมพ์ "RACK1 : 3A" เสมอ
   - Nexus.UserScanStocks.AskLayout = สิทธิ์ปุ่ม LAYOUT ต่อ UserID + คลัง (User Management > PERMISSION > SCAN STOCKS)
       เปิด = หน้า Multi-Scanner แสดงช่อง LAYOUT (เติมเองเมื่อสแกน QR ตำแหน่ง) และต้องสแกนตำแหน่งก่อนสแกนรับเข้า
   - Nexus.ScanTransactions.Layout = ตำแหน่งที่จัดเก็บ ณ ตอนสแกน (ประวัติ / ตารางรายการสแกน)
   - รันซ้ำได้ · สร้างตาราง / เพิ่มคอลัมน์อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.LayoutTypes', 'U') IS NULL
    CREATE TABLE Nexus.LayoutTypes
    (
        TypeID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_LayoutTypes PRIMARY KEY,
        TypeName  NVARCHAR(50)  NOT NULL CONSTRAINT UQ_LayoutTypes_Name UNIQUE,
        SortNo    INT           NOT NULL CONSTRAINT DF_LayoutTypes_Sort DEFAULT (0),
        CreatedBy NVARCHAR(50)  NULL,
        CreatedAt DATETIME      NOT NULL CONSTRAINT DF_LayoutTypes_Created DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID('Nexus.LayoutLocations', 'U') IS NULL
    CREATE TABLE Nexus.LayoutLocations
    (
        LocID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_LayoutLocations PRIMARY KEY,
        TypeID    INT           NOT NULL CONSTRAINT FK_LayoutLocations_Type REFERENCES Nexus.LayoutTypes (TypeID) ON DELETE CASCADE,
        LocName   NVARCHAR(50)  NOT NULL,
        SortNo    INT           NOT NULL CONSTRAINT DF_LayoutLocations_Sort DEFAULT (0),
        CreatedBy NVARCHAR(50)  NULL,
        CreatedAt DATETIME      NOT NULL CONSTRAINT DF_LayoutLocations_Created DEFAULT (GETDATE()),
        CONSTRAINT UQ_LayoutLocations_Name UNIQUE (TypeID, LocName)
    );
GO

IF OBJECT_ID('Nexus.LayoutSettings', 'U') IS NULL
    CREATE TABLE Nexus.LayoutSettings
    (
        Id          INT          NOT NULL CONSTRAINT PK_LayoutSettings PRIMARY KEY CONSTRAINT CK_LayoutSettings_One CHECK (Id = 1),
        QrFields    VARCHAR(20)  NOT NULL CONSTRAINT DF_LayoutSettings_Fields DEFAULT ('TYPE,NAME'),
        QrSep       NVARCHAR(5)  NOT NULL CONSTRAINT DF_LayoutSettings_Sep DEFAULT (N' '),
        UpdatedBy   NVARCHAR(50) NULL,
        UpdatedDate DATETIME     NOT NULL CONSTRAINT DF_LayoutSettings_Updated DEFAULT (GETDATE())
    );
GO
IF NOT EXISTS (SELECT 1 FROM Nexus.LayoutSettings WHERE Id = 1)
    INSERT INTO Nexus.LayoutSettings (Id, QrFields, QrSep, UpdatedBy) VALUES (1, 'TYPE,NAME', N' ', N'SYSTEM');
GO

IF COL_LENGTH('Nexus.UserScanStocks', 'AskLayout') IS NULL
    ALTER TABLE Nexus.UserScanStocks ADD AskLayout BIT NOT NULL CONSTRAINT DF_UserScanStocks_AskLayout DEFAULT (0);
GO

IF COL_LENGTH('Nexus.ScanTransactions', 'Layout') IS NULL
    ALTER TABLE Nexus.ScanTransactions ADD Layout NVARCHAR(120) NULL;
GO

SELECT (SELECT COUNT(*) FROM Nexus.LayoutTypes) AS Types, (SELECT COUNT(*) FROM Nexus.LayoutLocations) AS Locations,
       (SELECT QrFields + ' / [' + QrSep + ']' FROM Nexus.LayoutSettings WHERE Id = 1) AS QrFormat,
       COL_LENGTH('Nexus.UserScanStocks', 'AskLayout') AS AskLayoutCol, COL_LENGTH('Nexus.ScanTransactions', 'Layout') AS LayoutCol;
