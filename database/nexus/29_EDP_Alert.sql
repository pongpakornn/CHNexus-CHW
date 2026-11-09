-- =====================================================================
-- 29_EDP_Alert.sql : ⏰ EDP ALERT (แจ้งเตือนการ์ดเลยเวลาที่ยังไม่ MARK SUCCESS)
--   ตั้งค่าทั้งระบบ 1 แถว (Id = 1) · ตั้งที่ USER MANAGEMENT › SETUP › EDP ALERT (Admin Level 1)
--   CANCEL ของผู้ใช้แต่ละคน = เก็บใน Nexus.UserSettings (SettingKey = EDP_ALERT_SNOOZE) ไม่ต้องมีตารางเพิ่ม
--   เพิ่มตารางใหม่อย่างเดียว (ไม่แก้ / ไม่ลบของเดิม) · รันซ้ำได้
-- =====================================================================
IF OBJECT_ID('EDP.AlertSettings', 'U') IS NULL
BEGIN
    CREATE TABLE EDP.AlertSettings (
        Id            INT          NOT NULL CONSTRAINT PK_EDP_AlertSettings PRIMARY KEY CONSTRAINT CK_EDP_AlertSettings_One CHECK (Id = 1),
        Enabled       BIT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_Enabled DEFAULT (1),
        GraceMinutes  INT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_Grace DEFAULT (0),    -- เลยเวลา START (ปลาย) กี่นาทีจึงแจ้งเตือน
        RemindMinutes INT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_Remind DEFAULT (10),  -- กด CANCEL แล้วแจ้งซ้ำทุกกี่นาที
        OnlyStarted   BIT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_Started DEFAULT (1),  -- แจ้งเฉพาะแผนที่กด START แล้ว
        UpdatedBy     VARCHAR(20)  NULL,
        UpdatedDate   DATETIME     NOT NULL CONSTRAINT DF_EDP_AlertSettings_Date DEFAULT (GETDATE())
    );
    INSERT INTO EDP.AlertSettings (Id) VALUES (1);
END
GO
