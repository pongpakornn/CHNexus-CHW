-- =====================================================================
-- 41_Production_Plan_Workload_Excel.sql : 👥 WORKLOAD เปรียบเทียบกับไฟล์ Excel "Work load"
--   ProductionPlan.WorkloadRef   = ยอด PDT / Direct / Production ของแต่ละหน่วยงาน × เดือน จากชีท "9. ManPower" ของไฟล์ Work load
--                                  (CASE 1 ตาม EXCEL · Import ที่หน้า CAPACITY › WORKLOAD › IMPORT WORK LOAD EXCEL)
--   ProductionPlan.WorkloadNotes = เหตุผลที่ยอดตรง / ไม่ตรง ของหน่วยงาน × เดือน (แก้ได้ที่หน้า Workload)
--   เพิ่มตารางใหม่อย่างเดียว (ไม่แก้ / ไม่ลบของเดิม) · รันซ้ำได้ · ฐาน CHR-Nexus เท่านั้น
-- =====================================================================
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO
IF OBJECT_ID('ProductionPlan.WorkloadRef', 'U') IS NULL
BEGIN
    CREATE TABLE ProductionPlan.WorkloadRef (
        MonthStart  DATE           NOT NULL,
        RowKey      VARCHAR(20)    NOT NULL,                -- TPS / DELIVERY / QA / QC / PRESS1 / PRESS2 / ASSEMBLY / DIE / PIPEPART / PIPEASSY / PAINTPART
        Pdt         DECIMAL(18, 4) NULL,
        Direct      DECIMAL(18, 6) NULL,
        Production  DECIMAL(18, 4) NULL,                    -- Actual Production (เดือนที่ผ่านมา)
        FileName    NVARCHAR(260)  NULL,
        FileMonth   DATE           NULL,                    -- เดือน N ของไฟล์ที่ Import
        UpdatedBy   VARCHAR(20)    NULL,
        UpdatedAt   DATETIME       NOT NULL CONSTRAINT DF_PP_WorkloadRef_At DEFAULT (GETDATE()),
        CONSTRAINT PK_PP_WorkloadRef PRIMARY KEY (MonthStart, RowKey)
    );
END
GO
IF OBJECT_ID('ProductionPlan.WorkloadNotes', 'U') IS NULL
BEGIN
    CREATE TABLE ProductionPlan.WorkloadNotes (
        MonthStart  DATE           NOT NULL,
        RowKey      VARCHAR(20)    NOT NULL,
        Note        NVARCHAR(MAX)  NOT NULL,
        UpdatedBy   VARCHAR(20)    NULL,
        UpdatedAt   DATETIME       NOT NULL CONSTRAINT DF_PP_WorkloadNotes_At DEFAULT (GETDATE()),
        CONSTRAINT PK_PP_WorkloadNotes PRIMARY KEY (MonthStart, RowKey)
    );
END
GO
