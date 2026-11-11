/* =====================================================================
   📈 PRODUCTION PLAN › WORKLOAD (สรุปอัตรากำลังคน แผน, ผล ประจำเดือน · Monthly man-power Plan & Actual)
   ---------------------------------------------------------------------
   แทน Excel "Work load" ชีท 9. ManPower (N-1 · Current · N · N+1 · N+2 · N+3)
     PDT / Direct ของแผน = Total P1 / Total P9 จาก Capacity ของแต่ละหน่วยงาน (คำนวณที่หน้าเว็บ ไม่เก็บซ้ำ)
     Production (N-1)    = Total A1 ของเดือนก่อน
     ProductionPlan.WorkloadHeads = คนที่มีจริง (Current) ต่อเดือน ต่อแถว : Direct · Ind1 · Ind2
       - แถว = RowKey คงที่ (TPS / DELIVERY / QA / QC / PRESS1 / PRESS2 / ASSEMBLY / DIE / PIPEPART / PIPEASSY / PAINTPART)
       - เดือน N-1 = ใช้เป็น "Actual" ของเดือนก่อน · เดือน N = "Current" (Ind1 / Ind2 ใช้ต่อใน N…N+3)
   - เพิ่มอย่างเดียว · รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น (ไม่แตะ ERP / StorePC / CIMS)
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
GO
IF SCHEMA_ID('ProductionPlan') IS NULL THROW 50000, N'ยังไม่มี schema ProductionPlan (รัน 33_Production_Plan.sql ก่อน)', 1;
GO

IF OBJECT_ID('ProductionPlan.WorkloadHeads', 'U') IS NULL
CREATE TABLE ProductionPlan.WorkloadHeads
(
    MonthStart DATE         NOT NULL,                 -- วันที่ 1 ของเดือน
    RowKey     NVARCHAR(20) NOT NULL,                 -- แถวของตาราง (ดู lib/pp.ts › WL_ROWS)
    Direct     DECIMAL(9,2) NULL,
    Ind1       DECIMAL(9,2) NULL,
    Ind2       DECIMAL(9,2) NULL,
    UpdatedBy  NVARCHAR(20) NULL,
    UpdatedAt  DATETIME     NOT NULL CONSTRAINT DF_PP_WLHeads_UAt DEFAULT (GETDATE()),
    CONSTRAINT PK_PP_WorkloadHeads PRIMARY KEY (MonthStart, RowKey)
);
GO

/* ---------------------------------------------------------------- ค่าตั้งต้นจาก Excel (Work load November 26) · ใส่เฉพาะที่ยังไม่มี */
DECLARE @seed TABLE (M DATE, K NVARCHAR(20), D DECIMAL(9,2), I1 DECIMAL(9,2), I2 DECIMAL(9,2));
INSERT INTO @seed VALUES
 -- October 2026 (Actual)
 ('2026-10-01', N'TPS', 0, 0, 10), ('2026-10-01', N'DELIVERY', 0, 2, 14), ('2026-10-01', N'QA', 0, 0, 6), ('2026-10-01', N'QC', 0, 3, 9),
 ('2026-10-01', N'PRESS1', 32, 1, 8), ('2026-10-01', N'PRESS2', 34, 4, 8), ('2026-10-01', N'ASSEMBLY', 9, 0, 2), ('2026-10-01', N'DIE', 0, 0, 5),
 ('2026-10-01', N'PIPEPART', 23, 0, 4), ('2026-10-01', N'PIPEASSY', 37, 3, 3), ('2026-10-01', N'PAINTPART', 20, 1, 3),
 -- November 2026 (Current · Update 02/11/26)
 ('2026-11-01', N'TPS', 0, 0, 10), ('2026-11-01', N'DELIVERY', 0, 2, 14), ('2026-11-01', N'QA', 0, 0, 6), ('2026-11-01', N'QC', 0, 3, 9),
 ('2026-11-01', N'PRESS1', 32, 1, 8), ('2026-11-01', N'PRESS2', 34, 4, 8), ('2026-11-01', N'ASSEMBLY', 9, 0, 2), ('2026-11-01', N'DIE', 0, 0, 5),
 ('2026-11-01', N'PIPEPART', 23, 0, 4), ('2026-11-01', N'PIPEASSY', 37, 3, 3), ('2026-11-01', N'PAINTPART', 19, 1, 3);
INSERT INTO ProductionPlan.WorkloadHeads (MonthStart, RowKey, Direct, Ind1, Ind2, UpdatedBy, UpdatedAt)
SELECT s.M, s.K, s.D, s.I1, s.I2, N'EXCEL', CASE WHEN s.M = '2026-11-01' THEN '2026-11-02' ELSE '2026-10-31' END
FROM @seed s
WHERE NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadHeads h WHERE h.MonthStart = s.M AND h.RowKey = s.K);
GO
