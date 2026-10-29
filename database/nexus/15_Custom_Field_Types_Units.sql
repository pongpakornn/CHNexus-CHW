/* ============================================================================
   CHR-Nexus : ➕ ช่องกรอกเพิ่มเอง - ตั้งค่าชนิดข้อมูล + หน่วย (ต่อจาก 14_Custom_Field_Suggest_Auto.sql)
   ----------------------------------------------------------------------------
   - Nexus.PartFieldTypes = ชนิดสำเร็จรูปที่ Admin ตั้งเอง = ชนิดพื้นฐาน (TEXT / NUMBER / DATE / SELECT) + หน่วยเริ่มต้น
                            เช่น "WEIGHT" = NUMBER + KG · "CYCLE TIME" = NUMBER + SEC (เลือกตอนเพิ่มช่อง)
   - Nexus.PartFieldUnits = รายการหน่วยให้เลือกของช่อง NUMBER แยกกลุ่ม (น้ำหนัก / จำนวน / ความยาว / ปริมาตร / เวลา)
   - รันซ้ำได้ · สร้างตาราง + ใส่หน่วยเริ่มต้นครั้งแรกเท่านั้น ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.PartFieldTypes', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.PartFieldTypes
    (
        TypeID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PartFieldTypes PRIMARY KEY,
        Name      NVARCHAR(40)  NOT NULL CONSTRAINT UQ_PartFieldTypes_Name UNIQUE,
        BaseType  VARCHAR(10)   NOT NULL CONSTRAINT CK_PartFieldTypes_Base CHECK (BaseType IN ('TEXT', 'NUMBER', 'DATE', 'SELECT')),
        Unit      NVARCHAR(20)  NULL,
        SortNo    INT           NOT NULL CONSTRAINT DF_PartFieldTypes_Sort DEFAULT (0),
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_PartFieldTypes_Created DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(50)  NULL
    );
END;
GO

IF OBJECT_ID('Nexus.PartFieldUnits', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.PartFieldUnits
    (
        UnitID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PartFieldUnits PRIMARY KEY,
        Unit      NVARCHAR(20)  NOT NULL CONSTRAINT UQ_PartFieldUnits_Unit UNIQUE,
        GroupName NVARCHAR(30)  NOT NULL CONSTRAINT DF_PartFieldUnits_Group DEFAULT (N'OTHER'),
        SortNo    INT           NOT NULL CONSTRAINT DF_PartFieldUnits_Sort DEFAULT (0),
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_PartFieldUnits_Created DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(50)  NULL
    );
    INSERT INTO Nexus.PartFieldUnits (Unit, GroupName, SortNo) VALUES
        (N'KG', N'WEIGHT', 1), (N'TON', N'WEIGHT', 2), (N'G', N'WEIGHT', 3),
        (N'PCS', N'COUNT', 11), (N'BOX', N'COUNT', 12), (N'SET', N'COUNT', 13), (N'COIL', N'COUNT', 14),
        (N'M', N'LENGTH', 21), (N'CM', N'LENGTH', 22), (N'MM', N'LENGTH', 23),
        (N'L', N'VOLUME', 31),
        (N'SEC', N'TIME', 41), (N'MIN', N'TIME', 42), (N'HR', N'TIME', 43), (N'DAY', N'TIME', 44), (N'WEEK', N'TIME', 45), (N'MONTH', N'TIME', 46), (N'YEAR', N'TIME', 47);
END;
GO
