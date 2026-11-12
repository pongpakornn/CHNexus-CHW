-- ============================================================================
-- 43_User_Org_Options.sql  (CHR-Nexus เท่านั้น · เพิ่มตารางใหม่ ไม่แก้ตารางเดิม)
-- ⚙ SETUP › ADD USERID : ตัวเลือก Dropdown ของหน้า ＋ ADD USER / ✏ EDIT USER
--   POSITION (ตำแหน่ง) = รายการเดียว
--   DIVISION (ฝ่าย) -> SECTION (แผนก) -> UNIT (หน่วยงาน) = เลือกฝ่ายแล้วเห็นเฉพาะแผนกของฝ่ายนั้น · เลือกแผนกแล้วเห็นเฉพาะหน่วยงานของแผนกนั้น
--   ค่าในตาราง Nexus.Users ยังเป็นข้อความเดิม (Position / Division / Section / Department) -> ระบบ CIMS เดิมไม่กระทบ
--   ตั้งต้น: ดึงค่าที่ผู้ใช้มีอยู่แล้วมาเป็นตัวเลือก (รันซ้ำได้ ไม่สร้างซ้ำ)
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('Nexus.UserOrgOptions', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.UserOrgOptions
    (
        OptionID  INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_UserOrgOptions PRIMARY KEY,
        Kind      VARCHAR(10)   NOT NULL CONSTRAINT CK_UserOrgOptions_Kind CHECK (Kind IN ('POSITION', 'DIVISION', 'SECTION', 'UNIT')),
        Name      NVARCHAR(100) NOT NULL,
        ParentID  INT           NULL,       -- SECTION -> DIVISION · UNIT -> SECTION
        SortNo    INT           NOT NULL CONSTRAINT DF_UserOrgOptions_Sort DEFAULT (0),
        UpdatedBy NVARCHAR(50)  NULL,
        UpdatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_UserOrgOptions_At DEFAULT (SYSDATETIME())
    );
    CREATE INDEX IX_UserOrgOptions_Kind ON Nexus.UserOrgOptions (Kind, ParentID, SortNo);
END
GO

-- ตั้งต้นจากผู้ใช้ปัจจุบัน (เฉพาะตอนตารางยังว่าง)
IF NOT EXISTS (SELECT 1 FROM Nexus.UserOrgOptions)
BEGIN
    BEGIN TRAN;

    INSERT INTO Nexus.UserOrgOptions (Kind, Name, SortNo, UpdatedBy)
    SELECT 'POSITION', v, ROW_NUMBER() OVER (ORDER BY v), 'SYSTEM'
    FROM (SELECT DISTINCT LTRIM(RTRIM(Position)) AS v FROM Nexus.Users WHERE NULLIF(LTRIM(RTRIM(Position)), '') IS NOT NULL) x;

    INSERT INTO Nexus.UserOrgOptions (Kind, Name, SortNo, UpdatedBy)
    SELECT 'DIVISION', v, ROW_NUMBER() OVER (ORDER BY v), 'SYSTEM'
    FROM (SELECT DISTINCT LTRIM(RTRIM(Division)) AS v FROM Nexus.Users WHERE NULLIF(LTRIM(RTRIM(Division)), '') IS NOT NULL) x;

    -- แผนกใต้ฝ่ายที่ผู้ใช้อยู่จริง (ไม่มีฝ่าย = แผนกลอย ParentID ว่าง)
    INSERT INTO Nexus.UserOrgOptions (Kind, Name, ParentID, SortNo, UpdatedBy)
    SELECT 'SECTION', x.s, d.OptionID, ROW_NUMBER() OVER (PARTITION BY d.OptionID ORDER BY x.s), 'SYSTEM'
    FROM (SELECT DISTINCT NULLIF(LTRIM(RTRIM(Division)), '') AS dv, LTRIM(RTRIM(Section)) AS s
          FROM Nexus.Users WHERE NULLIF(LTRIM(RTRIM(Section)), '') IS NOT NULL) x
    LEFT JOIN Nexus.UserOrgOptions d ON d.Kind = 'DIVISION' AND d.Name = x.dv;

    -- หน่วยงานใต้แผนก (ฝ่าย + แผนกเดียวกับที่ผู้ใช้อยู่)
    INSERT INTO Nexus.UserOrgOptions (Kind, Name, ParentID, SortNo, UpdatedBy)
    SELECT 'UNIT', x.u, s.OptionID, ROW_NUMBER() OVER (PARTITION BY s.OptionID ORDER BY x.u), 'SYSTEM'
    FROM (SELECT DISTINCT NULLIF(LTRIM(RTRIM(Division)), '') AS dv, NULLIF(LTRIM(RTRIM(Section)), '') AS sc, LTRIM(RTRIM(Department)) AS u
          FROM Nexus.Users WHERE NULLIF(LTRIM(RTRIM(Department)), '') IS NOT NULL) x
    LEFT JOIN Nexus.UserOrgOptions d ON d.Kind = 'DIVISION' AND d.Name = x.dv
    LEFT JOIN Nexus.UserOrgOptions s ON s.Kind = 'SECTION' AND s.Name = x.sc AND ((s.ParentID IS NULL AND d.OptionID IS NULL) OR s.ParentID = d.OptionID);

    COMMIT;
END
GO

SELECT Kind, COUNT(*) AS Options FROM Nexus.UserOrgOptions GROUP BY Kind ORDER BY Kind;
