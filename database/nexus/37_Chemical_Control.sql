/* =====================================================================
   🧪 CHEMICAL CONTROL (schema ChemControl) · ระบบควบคุมคุณภาพน้ำยาเคมี (สายการผลิต ED Paint)
   แทน Excel "ใบตรวจสอบค่าน้ำยา" (FM-PD-04-03/1 · 1 ชีท = 1 รายการต่อกะ)
   ---------------------------------------------------------------------
   ChemControl.Parameters  พารามิเตอร์ควบคุม (Control Parameter): ชื่อ · บ่อ / กระบวนการ · หน่วย
                           Spec Min / Max (ขีดจำกัดข้อกำหนด) · LCL / UCL (ขีดจำกัดควบคุม) · Target (ค่าเป้าหมาย)
                           ความถี่ (กะ + เวลาตรวจวัด) · เลขที่แบบฟอร์ม · ผู้ใช้เพิ่มรายการใหม่เองได้ (MASTER ของระบบ)
   ChemControl.Readings    ผลการตรวจวัด (Inspection Record) ต่อ วันที่ · กะ (D / N) · ครั้งที่ (Slot)
   ChemControl.Actions     บันทึกการแก้ไขและปรับค่าน้ำยา (Corrective Action): ค่าก่อน / หลังแก้ไข · น้ำยาที่เติม · ผู้รับผิดชอบ
   ChemControl.Sheets      ใบบันทึกประจำเดือนต่อพารามิเตอร์ (สถานะอนุมัติ DRAFT / SIGNING / APPROVED)
   ChemControl.SignFlow    FLOW ลายเซ็น (Prepared / Checked / Reviewed / Approved) ต่อพารามิเตอร์ · ParamID 0 = ค่าเริ่มต้นทุกรายการ
                           ตั้งที่ User Management › SETUP › SIGN FLOW (หน้าเดียวกับ MIN REPORT)
   ChemControl.Signs       ลายเซ็นที่ลงแล้วของใบบันทึก (รูปลายเซ็น = โปรไฟล์ › ลายเซ็นของฉัน)
   - เพิ่มอย่างเดียว · รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
GO
IF SCHEMA_ID('ChemControl') IS NULL EXEC('CREATE SCHEMA ChemControl AUTHORIZATION dbo');
GO

IF OBJECT_ID('ChemControl.Parameters', 'U') IS NULL
CREATE TABLE ChemControl.Parameters
(
    ParamID    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chem_Parameters PRIMARY KEY,
    Code       NVARCHAR(30)  NOT NULL,                 -- เช่น ZP-TA
    Name       NVARCHAR(150) NOT NULL,                 -- ชื่อทางการ (EN)
    NameTh     NVARCHAR(200) NULL,                     -- ชื่อภาษาไทย
    Line       NVARCHAR(60)  NOT NULL CONSTRAINT DF_Chem_P_Line DEFAULT (N'ED PAINT LINE'),
    Process    NVARCHAR(80)  NULL,                     -- บ่อ / กระบวนการ (Pre-Degreasing, Zinc Phosphate …)
    Category   NVARCHAR(30)  NOT NULL CONSTRAINT DF_Chem_P_Category DEFAULT (N'CHEMICAL'),   -- CHEMICAL / WATER / PAINT / TEMPERATURE
    Unit       NVARCHAR(20)  NULL,
    SpecMin    DECIMAL(18,4) NULL,                     -- ขีดจำกัดข้อกำหนดล่าง (LSL)
    SpecMax    DECIMAL(18,4) NULL,                     -- ขีดจำกัดข้อกำหนดบน (USL)
    LCL        DECIMAL(18,4) NULL,                     -- ขีดจำกัดควบคุมล่าง
    UCL        DECIMAL(18,4) NULL,                     -- ขีดจำกัดควบคุมบน
    Target     DECIMAL(18,4) NULL,                     -- ค่าเป้าหมาย (Center Line)
    Decimals   TINYINT       NOT NULL CONSTRAINT DF_Chem_P_Dec DEFAULT (2),
    Shifts     VARCHAR(4)    NOT NULL CONSTRAINT DF_Chem_P_Shift DEFAULT ('DN'),        -- DN = กลางวัน + กลางคืน · D = กลางวัน
    DayTimes   NVARCHAR(100) NULL,                     -- เวลาตรวจวัดกะกลางวัน เช่น 08:30,13:30
    NightTimes NVARCHAR(100) NULL,                     -- เวลาตรวจวัดกะกลางคืน เช่น 20:00,01:00
    Method     NVARCHAR(300) NULL,                     -- วิธีตรวจวัด / หมายเหตุมาตรฐาน
    FormNo     NVARCHAR(30)  NULL,
    SortNo     INT           NOT NULL CONSTRAINT DF_Chem_P_Sort DEFAULT (0),
    IsActive   BIT           NOT NULL CONSTRAINT DF_Chem_P_Active DEFAULT (1),
    CreatedBy  NVARCHAR(20)  NULL,
    CreatedAt  DATETIME      NOT NULL CONSTRAINT DF_Chem_P_CAt DEFAULT (GETDATE()),
    UpdatedBy  NVARCHAR(20)  NULL,
    UpdatedAt  DATETIME      NOT NULL CONSTRAINT DF_Chem_P_UAt DEFAULT (GETDATE())
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Chem_Parameters_Code' AND object_id = OBJECT_ID('ChemControl.Parameters'))
    CREATE UNIQUE INDEX UX_Chem_Parameters_Code ON ChemControl.Parameters (Code);

IF OBJECT_ID('ChemControl.Readings', 'U') IS NULL
CREATE TABLE ChemControl.Readings
(
    ReadingID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chem_Readings PRIMARY KEY,
    ParamID       INT           NOT NULL CONSTRAINT FK_Chem_Readings_Param REFERENCES ChemControl.Parameters (ParamID),
    ReadDate      DATE          NOT NULL,
    Shift         CHAR(1)       NOT NULL CONSTRAINT CK_Chem_Readings_Shift CHECK (Shift IN ('D', 'N')),
    Slot          TINYINT       NOT NULL,
    ReadTime      VARCHAR(5)    NULL,
    Value         DECIMAL(18,4) NOT NULL,
    InspectorID   NVARCHAR(20)  NULL,
    InspectorName NVARCHAR(200) NULL,
    Remark        NVARCHAR(300) NULL,
    CreatedAt     DATETIME      NOT NULL CONSTRAINT DF_Chem_R_CAt DEFAULT (GETDATE()),
    UpdatedBy     NVARCHAR(20)  NULL,
    UpdatedAt     DATETIME      NOT NULL CONSTRAINT DF_Chem_R_UAt DEFAULT (GETDATE())
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Chem_Readings_Slot' AND object_id = OBJECT_ID('ChemControl.Readings'))
    CREATE UNIQUE INDEX UX_Chem_Readings_Slot ON ChemControl.Readings (ParamID, ReadDate, Shift, Slot) INCLUDE (Value, ReadTime);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Chem_Readings_Date' AND object_id = OBJECT_ID('ChemControl.Readings'))
    CREATE INDEX IX_Chem_Readings_Date ON ChemControl.Readings (ReadDate) INCLUDE (ParamID, Shift, Slot, Value);

IF OBJECT_ID('ChemControl.Actions', 'U') IS NULL
CREATE TABLE ChemControl.Actions
(
    ActionID    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chem_Actions PRIMARY KEY,
    ParamID     INT           NOT NULL CONSTRAINT FK_Chem_Actions_Param REFERENCES ChemControl.Parameters (ParamID),
    ActDate     DATE          NOT NULL,
    CheckTime   VARCHAR(5)    NULL,               -- เวลาที่ตรวจพบ
    Problem     NVARCHAR(500) NULL,               -- ปัญหาที่พบ
    ValueBefore DECIMAL(18,4) NULL,               -- ค่าที่วัดได้ก่อนการแก้ไข
    ValueAfter  DECIMAL(18,4) NULL,               -- ค่าที่วัดได้หลังการแก้ไข
    Correction  NVARCHAR(500) NULL,               -- วิธีการแก้ไข (จำนวนน้ำยาที่เติม)
    AdjustTime  VARCHAR(5)    NULL,               -- เวลาที่ปรับค่าน้ำยา
    Responsible NVARCHAR(200) NULL,
    CreatedBy   NVARCHAR(20)  NULL,
    CreatedAt   DATETIME      NOT NULL CONSTRAINT DF_Chem_A_CAt DEFAULT (GETDATE()),
    UpdatedBy   NVARCHAR(20)  NULL,
    UpdatedAt   DATETIME      NOT NULL CONSTRAINT DF_Chem_A_UAt DEFAULT (GETDATE())
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Chem_Actions_Param' AND object_id = OBJECT_ID('ChemControl.Actions'))
    CREATE INDEX IX_Chem_Actions_Param ON ChemControl.Actions (ParamID, ActDate);

IF OBJECT_ID('ChemControl.Sheets', 'U') IS NULL
CREATE TABLE ChemControl.Sheets
(
    SheetID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chem_Sheets PRIMARY KEY,
    ParamID     INT          NOT NULL CONSTRAINT FK_Chem_Sheets_Param REFERENCES ChemControl.Parameters (ParamID),
    PeriodYear  SMALLINT     NOT NULL,
    PeriodMonth TINYINT      NOT NULL,
    Status      VARCHAR(12)  NOT NULL CONSTRAINT DF_Chem_S_Status DEFAULT ('DRAFT'),   -- DRAFT / SIGNING / APPROVED
    NextSlot    TINYINT      NULL,
    SubmittedBy NVARCHAR(20) NULL,
    SubmittedAt DATETIME     NULL,
    DoneAt      DATETIME     NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Chem_Sheets_Period' AND object_id = OBJECT_ID('ChemControl.Sheets'))
    CREATE UNIQUE INDEX UX_Chem_Sheets_Period ON ChemControl.Sheets (ParamID, PeriodYear, PeriodMonth);

IF OBJECT_ID('ChemControl.SignFlow', 'U') IS NULL
CREATE TABLE ChemControl.SignFlow
(
    ParamID     INT            NOT NULL,          -- 0 = ค่าเริ่มต้นของทุกพารามิเตอร์
    Slot        TINYINT        NOT NULL CONSTRAINT CK_Chem_Flow_Slot CHECK (Slot BETWEEN 1 AND 4),
    Mode        VARCHAR(10)    NOT NULL CONSTRAINT DF_Chem_Flow_Mode DEFAULT ('OFF') CONSTRAINT CK_Chem_Flow_Mode CHECK (Mode IN ('OFF', 'ANY', 'ONE')),
    Users       NVARCHAR(2000) NULL,
    UpdatedBy   NVARCHAR(50)   NULL,
    UpdatedDate DATETIME       NOT NULL CONSTRAINT DF_Chem_Flow_Date DEFAULT (GETDATE()),
    CONSTRAINT PK_Chem_SignFlow PRIMARY KEY (ParamID, Slot)
);

IF OBJECT_ID('ChemControl.Signs', 'U') IS NULL
CREATE TABLE ChemControl.Signs
(
    SheetID  INT           NOT NULL CONSTRAINT FK_Chem_Signs_Sheet REFERENCES ChemControl.Sheets (SheetID),
    Slot     TINYINT       NOT NULL,
    UserID   NVARCHAR(50)  NOT NULL,
    UserName NVARCHAR(200) NULL,
    SignedAt DATETIME      NOT NULL CONSTRAINT DF_Chem_Signs_Date DEFAULT (GETDATE()),
    CONSTRAINT PK_Chem_Signs PRIMARY KEY (SheetID, Slot)
);
GO

/* ---------------------------------------------------------------- พารามิเตอร์ตั้งต้น 22 รายการ (จาก Excel FM-PD-04-03/1)
   Spec Min / Max = มาตรฐานในหัวเอกสาร · LCL / UCL / Target = แถว UCL / LCL / Avg ของกราฟ (ค่าที่ขัดกับมาตรฐานในไฟล์ = เว้นว่าง) */
IF NOT EXISTS (SELECT 1 FROM ChemControl.Parameters)
INSERT INTO ChemControl.Parameters (Code, Name, NameTh, Process, Category, Unit, SpecMin, SpecMax, LCL, UCL, Target, Decimals, Shifts, DayTimes, NightTimes, Method, FormNo, SortNo, CreatedBy, UpdatedBy) VALUES
 (N'PD-FAL',  N'Pre-Degreasing · Free Alkali (FAL)',        N'น้ำยาล้างไขมันขั้นต้น · ค่า Free Alkali',        N'Pre-Degreasing',            N'CHEMICAL',    N'ml',    15,   25,   17.5, 24.5, 20,   1, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Free Alkali · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 1,  N'SYSTEM', N'SYSTEM'),
 (N'DG1-FAL', N'Degreasing No.1 · Free Alkali (FAL)',       N'น้ำยาล้างไขมัน บ่อ 1 · ค่า Free Alkali',          N'Degreasing No.1',           N'CHEMICAL',    N'ml',    20,   25,   20.5, 24.5, 22,   1, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Free Alkali · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 2,  N'SYSTEM', N'SYSTEM'),
 (N'DG2-FAL', N'Degreasing No.2 · Free Alkali (FAL)',       N'น้ำยาล้างไขมัน บ่อ 2 · ค่า Free Alkali',          N'Degreasing No.2',           N'CHEMICAL',    N'ml',    20,   25,   20.5, 24.5, 22,   1, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Free Alkali · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 3,  N'SYSTEM', N'SYSTEM'),
 (N'WR1-FAL', N'Water Rinse No.1 · Free Alkali (FAL)',      N'น้ำล้าง บ่อ 1 · ค่า Free Alkali',                N'Water Rinse No.1',          N'WATER',       N'ml',    NULL, 2.5,  NULL, 2,    NULL, 2, 'DN', N'08:30',       N'20:00',       N'ค่าไม่เกินมาตรฐาน · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 4,  N'SYSTEM', N'SYSTEM'),
 (N'WR2-FAL', N'Water Rinse No.2 · Free Alkali (FAL)',      N'น้ำล้าง บ่อ 2 · ค่า Free Alkali',                N'Water Rinse No.2',          N'WATER',       N'ml',    NULL, 0.25, NULL, 0.2,  NULL, 2, 'DN', N'08:30',       N'20:00',       N'ค่าไม่เกินมาตรฐาน · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 5,  N'SYSTEM', N'SYSTEM'),
 (N'SC-TAL',  N'Surface Conditioner · Total Alkali (TAL)',  N'น้ำยาปรับสภาพผิว · ค่า Total Alkali',            N'Surface Conditioner',       N'CHEMICAL',    N'ml',    2,    5,    2.2,  4.5,  3.5,  1, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Total Alkali · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 6,  N'SYSTEM', N'SYSTEM'),
 (N'SC-PH',   N'Surface Conditioner · pH',                  N'น้ำยาปรับสภาพผิว · ค่า pH',                      N'Surface Conditioner',       N'CHEMICAL',    N'pH',    8.5,  10.5, 8.7,  10.3, 9.5,  2, 'DN', N'08:30',       N'20:00',       N'pH Meter · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 7,  N'SYSTEM', N'SYSTEM'),
 (N'ZP-TA',   N'Zinc Phosphate · Total Acid (TA)',          N'น้ำยาฟอสเฟต · ค่า Total Acid',                   N'Zinc Phosphate',            N'CHEMICAL',    N'ml',    18,   26,   18.5, 25.5, 22,   1, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Total Acid · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 8,  N'SYSTEM', N'SYSTEM'),
 (N'ZP-FA',   N'Zinc Phosphate · Free Acid (FA)',           N'น้ำยาฟอสเฟต · ค่า Free Acid',                    N'Zinc Phosphate',            N'CHEMICAL',    N'ml',    0.3,  0.7,  0.35, 0.65, 0.5,  2, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Free Acid · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 9,  N'SYSTEM', N'SYSTEM'),
 (N'ZP-TV',   N'Zinc Phosphate · Toner Value (TV)',         N'น้ำยาฟอสเฟต · ค่า Toner Value',                  N'Zinc Phosphate',            N'CHEMICAL',    N'ml',    2,    4,    2.2,  3.8,  3,    1, 'DN', N'08:30,13:30', N'20:00,01:00', N'ไตเตรต Toner · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 10, N'SYSTEM', N'SYSTEM'),
 (N'WR3-TA',  N'Water Rinse No.3 · Total Acid (TA)',        N'น้ำล้าง บ่อ 3 · ค่า Total Acid',                 N'Water Rinse No.3',          N'WATER',       N'ml',    NULL, 2,    NULL, 1.5,  NULL, 2, 'DN', N'08:30',       N'20:00',       N'ค่าไม่เกินมาตรฐาน · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 11, N'SYSTEM', N'SYSTEM'),
 (N'WR4-TA',  N'Water Rinse No.4 · Total Acid (TA)',        N'น้ำล้าง บ่อ 4 · ค่า Total Acid',                 N'Water Rinse No.4',          N'WATER',       N'ml',    NULL, 0.2,  NULL, 0.15, NULL, 2, 'DN', N'08:30',       N'20:00',       N'ค่าไม่เกินมาตรฐาน · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 12, N'SYSTEM', N'SYSTEM'),
 (N'DIR-PH',  N'DI Water Rinse · pH',                       N'น้ำ DI ล้าง · ค่า pH',                           N'DI Water Rinse',            N'WATER',       N'pH',    5,    7,    5.5,  6.5,  6,    2, 'DN', N'08:30',       N'20:00',       N'pH Meter · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 13, N'SYSTEM', N'SYSTEM'),
 (N'DIR-CON', N'DI Water Rinse · Conductivity',             N'น้ำ DI ล้าง · ค่าการนำไฟฟ้า',                    N'DI Water Rinse',            N'WATER',       N'µS/cm', NULL, 20,   NULL, 18,   NULL, 1, 'DN', N'08:30',       N'20:00',       N'Conductivity Meter · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 14, N'SYSTEM', N'SYSTEM'),
 (N'ED-NV',   N'ED Paint · Non-Volatile (%NV)',             N'สีอิเล็กโทรดีโพสิชัน · ค่าเนื้อสี % NV',          N'ED Paint Bath',             N'PAINT',       N'%',     19,   21,   19.2, 20.8, 20,   2, 'DN', N'08:30,13:30', N'20:00,01:00', N'อบระเหย % NV · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 15, N'SYSTEM', N'SYSTEM'),
 (N'UF1-NV',  N'Ultrafiltrate No.1 · Non-Volatile (%NV)',   N'น้ำ UF 1 · ค่าเนื้อสี % NV',                     N'Ultrafiltrate No.1',        N'PAINT',       N'%',     NULL, 2,    NULL, 1.9,  NULL, 2, 'DN', N'08:30',       N'20:00',       N'อบระเหย % NV · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 16, N'SYSTEM', N'SYSTEM'),
 (N'UF2-NV',  N'Ultrafiltrate No.2 · Non-Volatile (%NV)',   N'น้ำ UF 2 · ค่าเนื้อสี % NV',                     N'Ultrafiltrate No.2',        N'PAINT',       N'%',     NULL, 1,    NULL, 0.9,  NULL, 2, 'DN', N'08:30',       N'20:00',       N'อบระเหย % NV · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 17, N'SYSTEM', N'SYSTEM'),
 (N'DIS-CON', N'DI Water Spray · Conductivity',             N'น้ำ DI สเปรย์ · ค่าการนำไฟฟ้า',                  N'DI Water Spray',            N'WATER',       N'µS/cm', NULL, 20,   NULL, 18,   NULL, 1, 'DN', N'08:30',       N'20:00',       N'Conductivity Meter · 1 ครั้ง / กะ', N'FM-PD-04-03/1', 18, N'SYSTEM', N'SYSTEM'),
 (N'OV-TEMP', N'ED Curing Oven · Temperature',              N'เตาอบสี · อุณหภูมิ',                             N'Curing Oven',               N'TEMPERATURE', N'°C',    160,  170,  162,  168,  165,  0, 'DN', N'08:30,13:30', N'20:00,01:00', N'Thermometer · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 19, N'SYSTEM', N'SYSTEM'),
 (N'DG1-TEMP',N'Degreasing No.1 · Temperature',             N'น้ำยาล้างไขมัน บ่อ 1 · อุณหภูมิ',                N'Degreasing No.1',           N'TEMPERATURE', N'°C',    50,   60,   NULL, NULL, 55,   0, 'DN', N'08:30,13:30', N'20:00,01:00', N'Thermometer · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 20, N'SYSTEM', N'SYSTEM'),
 (N'DG2-TEMP',N'Degreasing No.2 · Temperature',             N'น้ำยาล้างไขมัน บ่อ 2 · อุณหภูมิ',                N'Degreasing No.2',           N'TEMPERATURE', N'°C',    50,   60,   NULL, NULL, 55,   0, 'DN', N'08:30,13:30', N'20:00,01:00', N'Thermometer · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 21, N'SYSTEM', N'SYSTEM'),
 (N'ED-TEMP', N'ED Paint Bath · Temperature',               N'บ่อสีอิเล็กโทรดีโพสิชัน · อุณหภูมิ',             N'ED Paint Bath',             N'TEMPERATURE', N'°C',    29,   31,   NULL, NULL, 30,   1, 'DN', N'08:30,13:30', N'20:00,01:00', N'Thermometer · 2 ครั้ง / กะ', N'FM-PD-04-03/1', 22, N'SYSTEM', N'SYSTEM');
GO
