/* =====================================================================
   🏭 EDP: เก็บค่าเดิมทุกครั้งที่ลากสลับการ์ด (ย้อนกลับได้ด้วยปุ่ม UNDO SWAP)
   เพิ่มคอลัมน์ใน EDP.PlanTimeFixLogs (nullable · รันซ้ำได้)
   ===================================================================== */
SET NOCOUNT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
IF COL_LENGTH('EDP.PlanTimeFixLogs', 'OLD_TIME_END') IS NULL ALTER TABLE EDP.PlanTimeFixLogs ADD OLD_TIME_END NVARCHAR(50) NULL;
IF COL_LENGTH('EDP.PlanTimeFixLogs', 'NEW_TIME_END') IS NULL ALTER TABLE EDP.PlanTimeFixLogs ADD NEW_TIME_END NVARCHAR(50) NULL;
IF COL_LENGTH('EDP.PlanTimeFixLogs', 'BATCH_ID') IS NULL ALTER TABLE EDP.PlanTimeFixLogs ADD BATCH_ID UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('EDP.PlanTimeFixLogs', 'FIX_BY') IS NULL ALTER TABLE EDP.PlanTimeFixLogs ADD FIX_BY NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EDP_TIMEFIX_BATCH' AND object_id = OBJECT_ID('EDP.PlanTimeFixLogs'))
    CREATE INDEX IX_EDP_TIMEFIX_BATCH ON EDP.PlanTimeFixLogs (BATCH_ID);
GO
