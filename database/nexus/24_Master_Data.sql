/* ============================================================================
   CHR-Nexus : 🗂 MASTER DATA - Customer Information / Supplier Information
   ----------------------------------------------------------------------------
   Master.Customers / Master.Suppliers (Schema ของระบบ MASTER DATA) = ข้อมูลกลางของลูกค้า / ผู้ขาย (ทุกระบบใช้ร่วมกัน)
   - Code ห้ามซ้ำ (ตัวพิมพ์ใหญ่) · Name เติมทีหลังได้ · IsActive = 1 อัตโนมัติเมื่อเพิ่ม · UpdatedDate = เวลาที่แก้ล่าสุด
   - ข้อมูลตั้งต้น = รหัสที่มีอยู่แล้วใน Nexus.Parts.Customer / Supplier (ไม่แก้ไขตาราง Parts · CIMS Windows ใช้คอลัมน์เดิมต่อได้)
   - สร้างตารางใหม่อย่างเดียว · รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF SCHEMA_ID(N'Master') IS NULL EXEC (N'CREATE SCHEMA Master AUTHORIZATION dbo');
GO

IF OBJECT_ID(N'Master.Customers', N'U') IS NULL AND OBJECT_ID(N'Nexus.Customers', N'U') IS NULL
    CREATE TABLE Master.Customers
    (
        CustomerID   INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
        CustomerCode NVARCHAR(50)  NOT NULL CONSTRAINT UX_Customers_Code UNIQUE,
        CustomerName NVARCHAR(200) NULL,
        IsActive     BIT           NOT NULL CONSTRAINT DF_Customers_Active DEFAULT (1),
        CreatedBy    NVARCHAR(50)  NULL,
        CreatedDate  DATETIME      NOT NULL CONSTRAINT DF_Customers_Created DEFAULT (GETDATE()),
        UpdatedBy    NVARCHAR(50)  NULL,
        UpdatedDate  DATETIME      NOT NULL CONSTRAINT DF_Customers_Updated DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Master.Suppliers', N'U') IS NULL AND OBJECT_ID(N'Nexus.Suppliers', N'U') IS NULL
    CREATE TABLE Master.Suppliers
    (
        SupplierID   INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Suppliers PRIMARY KEY,
        SupplierCode NVARCHAR(50)  NOT NULL CONSTRAINT UX_Suppliers_Code UNIQUE,
        SupplierName NVARCHAR(200) NULL,
        IsActive     BIT           NOT NULL CONSTRAINT DF_Suppliers_Active DEFAULT (1),
        CreatedBy    NVARCHAR(50)  NULL,
        CreatedDate  DATETIME      NOT NULL CONSTRAINT DF_Suppliers_Created DEFAULT (GETDATE()),
        UpdatedBy    NVARCHAR(50)  NULL,
        UpdatedDate  DATETIME      NOT NULL CONSTRAINT DF_Suppliers_Updated DEFAULT (GETDATE())
    );
GO

-- (ฐานที่รันเวอร์ชันแรก: ตารางอยู่ที่ Nexus.* -> 25_System_Schemas.sql ย้ายไป Master.* ให้)
-- ข้อมูลตั้งต้นจากสินค้าที่ลงทะเบียนไว้แล้ว (เฉพาะรหัสที่ยังไม่มีในตาราง)
IF OBJECT_ID(N'Master.Customers', N'U') IS NOT NULL
INSERT INTO Master.Customers (CustomerCode, CreatedBy, UpdatedBy)
SELECT DISTINCT UPPER(LTRIM(RTRIM(p.Customer))), N'SYSTEM', N'SYSTEM'
FROM Nexus.Parts p
WHERE NULLIF(LTRIM(RTRIM(p.Customer)), N'') IS NOT NULL AND LTRIM(RTRIM(p.Customer)) <> N'-'
  AND LEN(LTRIM(RTRIM(p.Customer))) <= 50
  AND NOT EXISTS (SELECT 1 FROM Master.Customers c WHERE c.CustomerCode = UPPER(LTRIM(RTRIM(p.Customer))));
GO

IF OBJECT_ID(N'Master.Suppliers', N'U') IS NOT NULL
INSERT INTO Master.Suppliers (SupplierCode, CreatedBy, UpdatedBy)
SELECT DISTINCT UPPER(LTRIM(RTRIM(p.Supplier))), N'SYSTEM', N'SYSTEM'
FROM Nexus.Parts p
WHERE NULLIF(LTRIM(RTRIM(p.Supplier)), N'') IS NOT NULL AND LTRIM(RTRIM(p.Supplier)) <> N'-'
  AND LEN(LTRIM(RTRIM(p.Supplier))) <= 50
  AND NOT EXISTS (SELECT 1 FROM Master.Suppliers s WHERE s.SupplierCode = UPPER(LTRIM(RTRIM(p.Supplier))));
GO
