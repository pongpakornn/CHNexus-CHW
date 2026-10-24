/* ============================================================================
   CHR-Nexus : แชทระหว่างผู้ใช้ (หนึ่งต่อหนึ่ง) - เห็นเฉพาะข้อความที่ตัวเองส่ง / ได้รับ
   ----------------------------------------------------------------------------
   Nexus.ChatMessages : FromUserID -> ToUserID · ReadAt = ผู้รับเปิดอ่านแล้ว
   - รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID(N'Nexus.ChatMessages', N'U') IS NULL
    CREATE TABLE Nexus.ChatMessages (
        MessageID  INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ChatMessages PRIMARY KEY,
        FromUserID VARCHAR(20)    NOT NULL,
        ToUserID   VARCHAR(20)    NOT NULL,
        Body       NVARCHAR(2000) NOT NULL,
        CreatedAt  DATETIME2(0)   NOT NULL CONSTRAINT DF_ChatMessages_CreatedAt DEFAULT (SYSDATETIME()),
        ReadAt     DATETIME2(0)   NULL
    );
GO

IF DB_NAME() = N'CHR-Nexus' AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChatMessages_To' AND object_id = OBJECT_ID(N'Nexus.ChatMessages'))
    CREATE INDEX IX_ChatMessages_To ON Nexus.ChatMessages (ToUserID, ReadAt, MessageID);
GO

IF DB_NAME() = N'CHR-Nexus' AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChatMessages_From' AND object_id = OBJECT_ID(N'Nexus.ChatMessages'))
    CREATE INDEX IX_ChatMessages_From ON Nexus.ChatMessages (FromUserID, ToUserID, MessageID);
GO
