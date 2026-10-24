/* ============================================================================
   CHR-Nexus : แก้ไข / ลบข้อความ และลบแชททั้งหมด
   ----------------------------------------------------------------------------
   Nexus.ChatMessages    + EditedAt / DeletedAt (ลบข้อความ = แสดง "ข้อความถูกลบ" ทั้งสองฝั่ง)
                         + HiddenForFrom / HiddenForTo (ลบแชททั้งหมด = ซ่อนเฉพาะฝั่งที่กดลบ อีกฝั่งยังเห็น)
   Nexus.SupportMessages + EditedAt / DeletedAt
   - รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH(N'Nexus.ChatMessages', N'EditedAt') IS NULL
    ALTER TABLE Nexus.ChatMessages ADD
        EditedAt      DATETIME2(0) NULL,
        DeletedAt     DATETIME2(0) NULL,
        HiddenForFrom BIT NOT NULL CONSTRAINT DF_ChatMessages_HiddenFrom DEFAULT (0),
        HiddenForTo   BIT NOT NULL CONSTRAINT DF_ChatMessages_HiddenTo DEFAULT (0);
GO

IF DB_NAME() = N'CHR-Nexus' AND COL_LENGTH(N'Nexus.SupportMessages', N'EditedAt') IS NULL
    ALTER TABLE Nexus.SupportMessages ADD
        EditedAt  DATETIME2(0) NULL,
        DeletedAt DATETIME2(0) NULL;
GO
