-- =====================================================================
-- 40_EDP_Alert_Sound_Users.sql : 🔊 EDP ALERT เสียงแจ้งเตือน + ผู้รับแจ้งเตือนราย UserID
--   EDP.AlertSettings (29_EDP_Alert.sql) เพิ่มคอลัมน์:
--     AlertUsers  = UserID ที่รับแจ้งเตือน คั่นด้วย , (ว่าง = ทุกคนที่ MARK SUCCESS ได้ แบบเดิม)
--     SoundOn / SoundId (เสียงเตือน 1-18 · 15 = ประกาศ 3 โน้ต สนามบิน) / LeadRepeat (เสียงนำกี่รอบ) / EndChime (เสียงปิดท้าย)
--     GapSeconds (เว้นกี่วินาทีแล้ววนซ้ำ) / AlarmVolume / VoiceVolume / VoiceRate
--     MsgTh / MsgMy = ประโยคไทย แล้วต่อด้วยภาษาพม่า
--   EDP.AlertVoices = ไฟล์เสียง (.mp3) ที่อัพโหลดเองต่อประโยค (ไม่มี = ไฟล์เสียงในระบบของประโยคสำเร็จรูป / เสียงอ่านของเบราว์เซอร์)
--   เพิ่มอย่างเดียว (ไม่แก้ / ไม่ลบของเดิม) · รันซ้ำได้ · ฐาน CHR-Nexus เท่านั้น
-- =====================================================================
IF OBJECT_ID('EDP.AlertSettings', 'U') IS NULL
    THROW 50000, 'Run 29_EDP_Alert.sql first', 1;
GO
IF COL_LENGTH('EDP.AlertSettings', 'AlertUsers') IS NULL  ALTER TABLE EDP.AlertSettings ADD AlertUsers  NVARCHAR(MAX) NULL;
IF COL_LENGTH('EDP.AlertSettings', 'SoundOn') IS NULL     ALTER TABLE EDP.AlertSettings ADD SoundOn     BIT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_SoundOn DEFAULT (1);
IF COL_LENGTH('EDP.AlertSettings', 'SoundId') IS NULL     ALTER TABLE EDP.AlertSettings ADD SoundId     INT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_SoundId DEFAULT (15);
IF COL_LENGTH('EDP.AlertSettings', 'LeadRepeat') IS NULL  ALTER TABLE EDP.AlertSettings ADD LeadRepeat  INT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_Lead DEFAULT (1);
IF COL_LENGTH('EDP.AlertSettings', 'EndChime') IS NULL    ALTER TABLE EDP.AlertSettings ADD EndChime    BIT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_End DEFAULT (1);
IF COL_LENGTH('EDP.AlertSettings', 'GapSeconds') IS NULL  ALTER TABLE EDP.AlertSettings ADD GapSeconds  INT          NOT NULL CONSTRAINT DF_EDP_AlertSettings_Gap DEFAULT (30);
IF COL_LENGTH('EDP.AlertSettings', 'AlarmVolume') IS NULL ALTER TABLE EDP.AlertSettings ADD AlarmVolume DECIMAL(4, 2) NOT NULL CONSTRAINT DF_EDP_AlertSettings_AVol DEFAULT (1);
IF COL_LENGTH('EDP.AlertSettings', 'VoiceVolume') IS NULL ALTER TABLE EDP.AlertSettings ADD VoiceVolume DECIMAL(4, 2) NOT NULL CONSTRAINT DF_EDP_AlertSettings_VVol DEFAULT (1);
IF COL_LENGTH('EDP.AlertSettings', 'VoiceRate') IS NULL   ALTER TABLE EDP.AlertSettings ADD VoiceRate   DECIMAL(4, 2) NOT NULL CONSTRAINT DF_EDP_AlertSettings_Rate DEFAULT (0.9);
IF COL_LENGTH('EDP.AlertSettings', 'MsgTh') IS NULL       ALTER TABLE EDP.AlertSettings ADD MsgTh       NVARCHAR(1000) NULL;
IF COL_LENGTH('EDP.AlertSettings', 'MsgMy') IS NULL       ALTER TABLE EDP.AlertSettings ADD MsgMy       NVARCHAR(1000) NULL;
GO
-- ประโยคเริ่มต้น = "ตามที่นนท์กำหนด" (เสียงผู้หญิง ลงท้าย ค่ะ) · ต้องตรงกับ PRESETS ใน frontend/src/lib/alertSound.ts (มีไฟล์เสียงในระบบ)
UPDATE EDP.AlertSettings
SET MsgTh = N'ขณะนี้มีแผนงานที่ยังไม่ได้อัพเดท ตามเวลาที่ได้กำหนดที่แผนงาน กรุณาอัพเดทแผนงานด้วยค่ะ ขอบคุณค่ะ',
    MsgMy = N'ယခုအချိန်တွင် အလုပ်အစီအစဉ်၌ သတ်မှတ်ထားသောအချိန်အတွင်း အပ်ဒိတ်မလုပ်ရသေးသော အလုပ်အစီအစဉ် ရှိနေပါသည်။ ကျေးဇူးပြု၍ အပ်ဒိတ်လုပ်ပေးပါ။ ကျေးဇူးတင်ပါသည်။'
WHERE Id = 1 AND MsgTh IS NULL AND MsgMy IS NULL;
GO
IF OBJECT_ID('EDP.AlertVoices', 'U') IS NULL
BEGIN
    CREATE TABLE EDP.AlertVoices (
        Lang        VARCHAR(5)     NOT NULL,                 -- th / my
        TextKey     CHAR(64)       NOT NULL,                 -- SHA-256 (hex) ของประโยค
        [Text]      NVARCHAR(1000) NOT NULL,
        Audio       VARBINARY(MAX) NOT NULL,
        ContentType VARCHAR(50)    NOT NULL,
        UpdatedBy   VARCHAR(20)    NULL,
        UpdatedDate DATETIME       NOT NULL CONSTRAINT DF_EDP_AlertVoices_Date DEFAULT (GETDATE()),
        CONSTRAINT PK_EDP_AlertVoices PRIMARY KEY (Lang, TextKey)
    );
END
GO
