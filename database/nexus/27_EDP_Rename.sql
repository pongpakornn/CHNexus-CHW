/* =====================================================================
   🏭 EDP: เปลี่ยนชื่อตารางเป็นชื่อที่บอกว่าเก็บอะไร (แบบ CHR-Nexus) - สำหรับฐานที่รัน 26 รุ่นแรกไปแล้ว
   ข้อมูลไม่หาย (sp_rename) · รันซ้ำได้ · จากนั้นรัน 26_EDP_Planning.sql อีกครั้งเพื่อสร้าง VIEW ชื่อใหม่
   ===================================================================== */
SET NOCOUNT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
GO
IF OBJECT_ID('EDP.vw_TRN_PLAN_D_EFF', 'V') IS NOT NULL DROP VIEW EDP.vw_TRN_PLAN_D_EFF;
IF OBJECT_ID('EDP.MST_PART', 'V') IS NOT NULL DROP VIEW EDP.MST_PART;
IF OBJECT_ID('EDP.MST_ROUND_CONFIG', 'U') IS NOT NULL AND OBJECT_ID('EDP.Rounds') IS NULL EXEC sp_rename 'EDP.MST_ROUND_CONFIG', 'Rounds';
IF OBJECT_ID('EDP.TRN_PLAN_H', 'U') IS NOT NULL AND OBJECT_ID('EDP.PlanHeaders') IS NULL EXEC sp_rename 'EDP.TRN_PLAN_H', 'PlanHeaders';
IF OBJECT_ID('EDP.TRN_PLAN_D', 'U') IS NOT NULL AND OBJECT_ID('EDP.PlanCards') IS NULL EXEC sp_rename 'EDP.TRN_PLAN_D', 'PlanCards';
IF OBJECT_ID('EDP.TRN_PLAN_EDIT_LOG', 'U') IS NOT NULL AND OBJECT_ID('EDP.PlanEditLogs') IS NULL EXEC sp_rename 'EDP.TRN_PLAN_EDIT_LOG', 'PlanEditLogs';
IF OBJECT_ID('EDP.TRN_PLAN_D_TIMEFIX_LOG', 'U') IS NOT NULL AND OBJECT_ID('EDP.PlanTimeFixLogs') IS NULL EXEC sp_rename 'EDP.TRN_PLAN_D_TIMEFIX_LOG', 'PlanTimeFixLogs';
IF OBJECT_ID('EDP.MST_PLAN_TEMPLATE_D', 'U') IS NOT NULL AND OBJECT_ID('EDP.PlanTemplateCards') IS NULL EXEC sp_rename 'EDP.MST_PLAN_TEMPLATE_D', 'PlanTemplateCards';
IF OBJECT_ID('EDP.MST_PLAN_TEMPLATE', 'U') IS NOT NULL AND OBJECT_ID('EDP.PlanTemplates') IS NULL EXEC sp_rename 'EDP.MST_PLAN_TEMPLATE', 'PlanTemplates';
GO
