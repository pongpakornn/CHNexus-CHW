-- ============================================================================
-- 46_EDP_Daily_Skip.sql  (CHR-Nexus เท่านั้น · schema EDP · ไม่แตะ EDP_SYSTEM)
-- 📅 แม่แบบประจำวัน: รอบที่ผู้วางแผนตั้งใจให้ว่าง (SAVE ALL ตอนไม่มีการ์ด / CLEAR จนรอบว่าง)
--    = ไม่แสดงร่างจากแม่แบบประจำวันซ้ำในรอบนั้น (ลบการ์ดแล้วหายจริง) · บันทึกการ์ดลงรอบนั้นอีกครั้ง = ลบเครื่องหมายออกเอง
-- ============================================================================
SET NOCOUNT ON;
IF OBJECT_ID('EDP.PlanDailySkips') IS NULL
    CREATE TABLE EDP.PlanDailySkips (
        PLH_DATE  DATE         NOT NULL,
        SHIFT     VARCHAR(10)  NOT NULL,
        ROUND_ID  INT          NOT NULL,
        CREATE_BY NVARCHAR(50) NULL,
        CREATE_AT DATETIME     NOT NULL CONSTRAINT DF_EDP_DSKIP_AT DEFAULT (GETDATE()),
        CONSTRAINT PK_EDP_PlanDailySkips PRIMARY KEY (PLH_DATE, SHIFT, ROUND_ID)
    );
GO
SELECT COUNT(*) AS Skips FROM EDP.PlanDailySkips;
