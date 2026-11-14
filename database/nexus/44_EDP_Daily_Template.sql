-- ============================================================================
-- 44_EDP_Daily_Template.sql  (CHR-Nexus เท่านั้น · schema EDP · ไม่แตะ EDP_SYSTEM)
-- 📅 แม่แบบประจำวัน: เลือกแม่แบบทั้งวัน 6 รอบ 1 ตัว (IS_DAILY = 1)
--    หน้า Plan Setting เปิดวัน / รอบที่ยังไม่มีการ์ด = แสดงช่องของแม่แบบนี้ให้เลย (ร่าง ยังไม่ลงฐานข้อมูลจนกด SAVE ALL)
--    ไม่เลือก = วันที่ยังไม่มีแผนว่างเหมือนเดิม
-- ============================================================================
SET NOCOUNT ON;
IF COL_LENGTH('EDP.PlanTemplates', 'IS_DAILY') IS NULL
    ALTER TABLE EDP.PlanTemplates ADD IS_DAILY BIT NOT NULL CONSTRAINT DF_EDP_TPL_DAILY DEFAULT (0);
GO
SELECT TPL_ID, TPL_NAME, SHIFT, IS_DAILY FROM EDP.PlanTemplates ORDER BY TPL_NAME;
