/* ============================================================================
   CHR-Nexus : 🐞 BUG LOG (ปุ่มกลมแจ้งเตือนในหน้า ACTIVITY LOG - เฉพาะ Admin Level 1)
   ----------------------------------------------------------------------------
   - Nexus.BugLogs = ข้อผิดพลาดของระบบ: API (Exception ที่ไม่ได้ดักไว้ / บันทึกไม่สำเร็จ) และหน้าเว็บ (JavaScript error)
   - ข้อความเดิมซ้ำ = นับเพิ่ม (Hits) แถวเดิม ไม่เพิ่มแถวใหม่ · เก็บ 90 วัน (ระบบลบของเก่าให้เอง)
   - รันซ้ำได้ · ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.BugLogs', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.BugLogs
    (
        BugID      BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_BugLogs PRIMARY KEY,
        Source     VARCHAR(10)    NOT NULL,              -- API / WEB
        Severity   VARCHAR(10)    NOT NULL,              -- ERROR / WARN
        Message    NVARCHAR(1000) NOT NULL,
        Detail     NVARCHAR(MAX)  NULL,                  -- Stack trace / ข้อมูลเพิ่ม
        Path       NVARCHAR(400)  NULL,                  -- URL ที่เกิด
        Method     VARCHAR(10)    NULL,
        StatusCode INT            NULL,
        UserID     NVARCHAR(50)   NULL,
        Client     NVARCHAR(200)  NULL,                  -- เครื่อง / Browser
        Hash       VARCHAR(40)    NOT NULL,              -- Source + Message + Path (รวมแถวซ้ำ)
        Hits       INT            NOT NULL CONSTRAINT DF_BugLogs_Hits DEFAULT (1),
        FirstAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_BugLogs_FirstAt DEFAULT (SYSDATETIME()),
        LastAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_BugLogs_LastAt DEFAULT (SYSDATETIME()),
        IsRead     BIT            NOT NULL CONSTRAINT DF_BugLogs_IsRead DEFAULT (0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BugLogs_LastAt' AND object_id = OBJECT_ID('Nexus.BugLogs'))
    CREATE INDEX IX_BugLogs_LastAt ON Nexus.BugLogs (LastAt DESC) INCLUDE (IsRead);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BugLogs_Hash' AND object_id = OBJECT_ID('Nexus.BugLogs'))
    CREATE INDEX IX_BugLogs_Hash ON Nexus.BugLogs (Hash, LastAt DESC);
GO
