/* ============================================================================
   CHR-Nexus : แนบไฟล์ / รูปในแชท + กดอีโมจิตอบข้อความ
   ----------------------------------------------------------------------------
   Nexus.ChatMessages / Nexus.SupportMessages
     + AttachName (ชื่อไฟล์เดิม) / AttachPath (ที่เก็บ ใต้โฟลเดอร์ Chat Files / Chat Images) / AttachSize / AttachKind (IMAGE / FILE)
   Nexus.ChatReactions : อีโมจิที่กดตอบข้อความ (คนละ 1 อีโมจิต่อข้อความ · Kind = DM / SUPPORT)
   - รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH(N'Nexus.ChatMessages', N'AttachName') IS NULL
    ALTER TABLE Nexus.ChatMessages ADD
        AttachName NVARCHAR(260) NULL,
        AttachPath NVARCHAR(400) NULL,
        AttachSize BIGINT NULL,
        AttachKind NVARCHAR(10) NULL;
GO

IF DB_NAME() = N'CHR-Nexus' AND COL_LENGTH(N'Nexus.SupportMessages', N'AttachName') IS NULL
    ALTER TABLE Nexus.SupportMessages ADD
        AttachName NVARCHAR(260) NULL,
        AttachPath NVARCHAR(400) NULL,
        AttachSize BIGINT NULL,
        AttachKind NVARCHAR(10) NULL;
GO

IF DB_NAME() = N'CHR-Nexus' AND OBJECT_ID(N'Nexus.ChatReactions', N'U') IS NULL
    CREATE TABLE Nexus.ChatReactions (
        Kind      NVARCHAR(10) NOT NULL,
        MessageID INT          NOT NULL,
        UserID    VARCHAR(20)  NOT NULL,
        Emoji     NVARCHAR(16) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_ChatReactions_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_ChatReactions PRIMARY KEY (Kind, MessageID, UserID)
    );
GO
