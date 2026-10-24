/* ============================================================================
   CHR-Nexus : แชทแจ้ง Admin (ปุ่มหูฟังมุมขวาบน / เมนูวงกลมโปรไฟล์)
   ----------------------------------------------------------------------------
   Nexus.SupportThreads  = หนึ่งเรื่องที่ผู้ใช้แจ้ง (หัวข้อ + สถานะ + เวลาอ่านล่าสุดของแต่ละฝั่ง)
     Topic  : PROBLEM (รายงานปัญหาการใช้งานระบบ) / UPDATE (แจ้งอัพเดทระบบ) / PERMISSION (ขอสิทธิ์การใช้งานระบบ)
     Status : OPEN / CLOSED
   Nexus.SupportMessages = ข้อความในเรื่องนั้น (IsAdmin = 1 คือ Admin ตอบ)
   - รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID(N'Nexus.SupportThreads', N'U') IS NULL
    CREATE TABLE Nexus.SupportThreads (
        ThreadID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_SupportThreads PRIMARY KEY,
        UserID       NVARCHAR(50)  NOT NULL,
        Topic        NVARCHAR(20)  NOT NULL,
        Status       NVARCHAR(10)  NOT NULL CONSTRAINT DF_SupportThreads_Status DEFAULT (N'OPEN'),
        LastSender   NVARCHAR(10)  NOT NULL CONSTRAINT DF_SupportThreads_LastSender DEFAULT (N'USER'),
        CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_SupportThreads_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_SupportThreads_UpdatedAt DEFAULT (SYSDATETIME()),
        UserReadAt   DATETIME2(0)  NULL,
        AdminReadAt  DATETIME2(0)  NULL,
        ClosedBy     NVARCHAR(50)  NULL,
        ClosedAt     DATETIME2(0)  NULL
    );
GO

IF DB_NAME() = N'CHR-Nexus' AND OBJECT_ID(N'Nexus.SupportMessages', N'U') IS NULL
    CREATE TABLE Nexus.SupportMessages (
        MessageID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_SupportMessages PRIMARY KEY,
        ThreadID     INT            NOT NULL CONSTRAINT FK_SupportMessages_Thread REFERENCES Nexus.SupportThreads (ThreadID) ON DELETE CASCADE,
        SenderUserID NVARCHAR(50)   NOT NULL,
        IsAdmin      BIT            NOT NULL CONSTRAINT DF_SupportMessages_IsAdmin DEFAULT (0),
        Body         NVARCHAR(2000) NOT NULL,
        CreatedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_SupportMessages_CreatedAt DEFAULT (SYSDATETIME())
    );
GO

IF DB_NAME() = N'CHR-Nexus' AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SupportThreads_User' AND object_id = OBJECT_ID(N'Nexus.SupportThreads'))
    CREATE INDEX IX_SupportThreads_User ON Nexus.SupportThreads (UserID, UpdatedAt DESC);
GO

IF DB_NAME() = N'CHR-Nexus' AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SupportMessages_Thread' AND object_id = OBJECT_ID(N'Nexus.SupportMessages'))
    CREATE INDEX IX_SupportMessages_Thread ON Nexus.SupportMessages (ThreadID, MessageID);
GO
