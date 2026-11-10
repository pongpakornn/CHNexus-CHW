/* =====================================================================
   📈 PRODUCTION PLAN (schema ProductionPlan) · Capacity Planning ต่อหน่วยงาน (เริ่ม PRESS 1)
   ---------------------------------------------------------------------
   แทน Excel "PRESS 1 CAPACITY PLANNING" (1 ชีท = 1 เครื่องจักร + ชีท Press 1 table)
     ProductionPlan.Machines      เครื่องจักร + ค่า STD (C2 Q'ty Line · C4 Target Eff · P7 STD Man/Line · SPH 100% กำหนดเอง)
     ProductionPlan.ShiftHours    Plan SPH ต่อกะ (C5-C9: 7.75 / 10.75 / 15.50 / 18.50 / 21.50 ชม.)
     ProductionPlan.Settings      ค่ากลางของสูตร (P8 ตัวคูณ 1.023 · P9 ชั่วโมง/คน/วัน 11)
     ProductionPlan.MachineParts  ตาราง Product ของเครื่อง: PART A (STORE-PC) · PART B (STORE-SUB) · Process Code
                                  Total Process · Pcs./Stroke · MC CT · STD MAN  (PCS / SPH / Stroke / MC Hr = คำนวณเอง)
     ProductionPlan.DailyActuals  M/C Actual รายวันที่หน้างานบันทึก: Working hour · Stroke · Man
   - PCS = ยอด Order ของเดือน (มี Order) ไม่มี Order = Forecast (Nexus.ForecastOrderImports ตาม PART A) · ไม่ได้เก็บซ้ำ
   - C1 Working Day/Month = MASTER DATA › Company Workdays (Nexus.CustomerWorkdays #COMPANY)
   - เพิ่มอย่างเดียว · รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น (ไม่แตะ ERP / StorePC / CIMS)
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
GO
IF SCHEMA_ID('ProductionPlan') IS NULL EXEC('CREATE SCHEMA ProductionPlan AUTHORIZATION dbo');
GO

IF OBJECT_ID('ProductionPlan.Machines', 'U') IS NULL
CREATE TABLE ProductionPlan.Machines
(
    MachineID   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PP_Machines PRIMARY KEY,
    Dept        NVARCHAR(20)  NOT NULL CONSTRAINT DF_PP_Machines_Dept DEFAULT (N'PRESS1'),
    MachineCode NVARCHAR(50)  NOT NULL,                  -- ชื่อเครื่อง (เช่น PROG 200-19)
    GroupName   NVARCHAR(30)  NOT NULL,                  -- GROUP 1 … (คอลัมน์รวมของกลุ่มใน Press 1 table)
    SubGroup    NVARCHAR(30)  NULL,                      -- Group 1.1 …
    SortNo      INT           NOT NULL CONSTRAINT DF_PP_Machines_Sort DEFAULT (0),
    QtyLine     DECIMAL(9,2)  NOT NULL CONSTRAINT DF_PP_Machines_Qty DEFAULT (1),     -- C2
    TargetEff   DECIMAL(6,4)  NOT NULL CONSTRAINT DF_PP_Machines_Eff DEFAULT (0.85),  -- C4
    ManPower    DECIMAL(9,2)  NOT NULL CONSTRAINT DF_PP_Machines_Man DEFAULT (1),     -- P7 STD Man Power / Line
    -- StrokeByPcs (เพิ่มด้านล่าง): 1 = Stroke = PCS ÷ Pcs./Stroke (เครื่อง Transfer ไม่คูณ Total Process)
    SphOverride DECIMAL(12,4) NULL,                      -- C3 SPH 100% กำหนดเอง (ว่าง = ΣStroke ÷ ΣMC Hr)
    IsActive    BIT           NOT NULL CONSTRAINT DF_PP_Machines_Active DEFAULT (1),
    CreatedBy   NVARCHAR(20)  NULL,
    CreatedAt   DATETIME      NOT NULL CONSTRAINT DF_PP_Machines_CAt DEFAULT (GETDATE()),
    UpdatedBy   NVARCHAR(20)  NULL,
    UpdatedAt   DATETIME      NOT NULL CONSTRAINT DF_PP_Machines_UAt DEFAULT (GETDATE())
);
-- Stroke = PCS ÷ Pcs./Stroke (ไม่คูณ Total Process) สำหรับเครื่อง Transfer (TRBS / NBT) ตามชีท Excel
IF COL_LENGTH('ProductionPlan.Machines', 'StrokeByPcs') IS NULL
    ALTER TABLE ProductionPlan.Machines ADD StrokeByPcs BIT NOT NULL CONSTRAINT DF_PP_Machines_ByPcs DEFAULT (0);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PP_Machines_Code' AND object_id = OBJECT_ID('ProductionPlan.Machines'))
    CREATE UNIQUE INDEX UX_PP_Machines_Code ON ProductionPlan.Machines (Dept, MachineCode);

IF OBJECT_ID('ProductionPlan.ShiftHours', 'U') IS NULL
CREATE TABLE ProductionPlan.ShiftHours
(
    ShiftID   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PP_ShiftHours PRIMARY KEY,
    ShiftName NVARCHAR(80) NOT NULL,
    Hours     DECIMAL(6,2) NOT NULL,
    SortNo    INT          NOT NULL CONSTRAINT DF_PP_Shift_Sort DEFAULT (0),
    UpdatedBy NVARCHAR(20) NULL,
    UpdatedAt DATETIME     NOT NULL CONSTRAINT DF_PP_Shift_UAt DEFAULT (GETDATE())
);

IF OBJECT_ID('ProductionPlan.Settings', 'U') IS NULL
CREATE TABLE ProductionPlan.Settings
(
    SettingKey   NVARCHAR(50)  NOT NULL CONSTRAINT PK_PP_Settings PRIMARY KEY,
    SettingValue DECIMAL(18,6) NOT NULL,
    Note         NVARCHAR(200) NULL,
    UpdatedBy    NVARCHAR(20)  NULL,
    UpdatedAt    DATETIME      NOT NULL CONSTRAINT DF_PP_Settings_UAt DEFAULT (GETDATE())
);

IF OBJECT_ID('ProductionPlan.MachineParts', 'U') IS NULL
CREATE TABLE ProductionPlan.MachineParts
(
    ItemID       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PP_MachineParts PRIMARY KEY,
    MachineID    INT           NOT NULL CONSTRAINT FK_PP_MachineParts_Machine REFERENCES ProductionPlan.Machines (MachineID),
    SortNo       INT           NOT NULL CONSTRAINT DF_PP_MP_Sort DEFAULT (0),
    PartAID      INT           NOT NULL,             -- Nexus.Parts.PartID (STORE-PC · PART A = Product Code ของ Forecast)
    PartBID      INT           NULL,                 -- Nexus.Parts.PartID (STORE-SUB · PART B) / ชิ้นเดียวกับ PART A
    ProcessCode  NVARCHAR(200) NULL,                 -- เช่น PI#1^CU#1^CU#2^BN#1^ST&BN#2^RT^PI&CPI^SR 1/1
    TotalProcess DECIMAL(9,3)  NOT NULL CONSTRAINT DF_PP_MP_Proc DEFAULT (1),
    PcsPerStroke DECIMAL(9,3)  NOT NULL CONSTRAINT DF_PP_MP_Col DEFAULT (1),   -- Col.(Pcs./Stroke)
    CycleTime    DECIMAL(9,3)  NOT NULL CONSTRAINT DF_PP_MP_CT DEFAULT (3),    -- MC CT (วินาที) -> SPH = 3600 / CT
    StdMan       DECIMAL(9,2)  NULL,
    IsActive     BIT           NOT NULL CONSTRAINT DF_PP_MP_Active DEFAULT (1),
    CreatedBy    NVARCHAR(20)  NULL,
    CreatedAt    DATETIME      NOT NULL CONSTRAINT DF_PP_MP_CAt DEFAULT (GETDATE()),
    UpdatedBy    NVARCHAR(20)  NULL,
    UpdatedAt    DATETIME      NOT NULL CONSTRAINT DF_PP_MP_UAt DEFAULT (GETDATE())
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PP_MachineParts_Machine' AND object_id = OBJECT_ID('ProductionPlan.MachineParts'))
    CREATE INDEX IX_PP_MachineParts_Machine ON ProductionPlan.MachineParts (MachineID, SortNo) INCLUDE (PartAID, PartBID, IsActive);

IF OBJECT_ID('ProductionPlan.DailyActuals', 'U') IS NULL
CREATE TABLE ProductionPlan.DailyActuals
(
    MachineID INT           NOT NULL CONSTRAINT FK_PP_Daily_Machine REFERENCES ProductionPlan.Machines (MachineID),
    WorkDate  DATE          NOT NULL,
    WorkHours DECIMAL(6,2)  NULL,        -- Working hour
    Stroke    DECIMAL(12,2) NULL,        -- Stroke
    Man       DECIMAL(6,2)  NULL,        -- Man
    UpdatedBy NVARCHAR(20)  NULL,
    UpdatedAt DATETIME      NOT NULL CONSTRAINT DF_PP_Daily_UAt DEFAULT (GETDATE()),
    CONSTRAINT PK_PP_DailyActuals PRIMARY KEY (MachineID, WorkDate)
);
GO

/* ---------------------------------------------------------------- ค่าตั้งต้น (ตาม Excel) */
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.ShiftHours)
    INSERT INTO ProductionPlan.ShiftHours (ShiftName, Hours, SortNo) VALUES
        (N'Plan SPH 1 Shift', 7.75, 1),
        (N'Plan SPH 1 Shift + OT (3 Hrs.)', 10.75, 2),
        (N'Plan SPH 2 Shift', 15.50, 3),
        (N'Plan SPH 2 Shift + OT (3 Hrs.)', 18.50, 4),
        (N'Plan SPH 2 Shift + OT (6 Hrs.)', 21.50, 5);

IF NOT EXISTS (SELECT 1 FROM ProductionPlan.Settings WHERE SettingKey = N'ManHourFactor')
    INSERT INTO ProductionPlan.Settings (SettingKey, SettingValue, Note) VALUES (N'ManHourFactor', 1.023, N'P8 Total Man Hour/Day = P6 × P7 × C2 × ค่านี้');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.Settings WHERE SettingKey = N'ManHourPerDay')
    INSERT INTO ProductionPlan.Settings (SettingKey, SettingValue, Note) VALUES (N'ManHourPerDay', 11, N'P9 = P8 ÷ ค่านี้');
GO
