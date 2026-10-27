/* ============================================================================
   CHR-Nexus : ➕ ช่องกรอกเพิ่มเอง - หน่วยของช่องตัวเลข + ชนิด DROPDOWN (ต่อจาก 12_Custom_Fields.sql)
   ----------------------------------------------------------------------------
   - Nexus.PartFieldDefs.Unit  = หน่วยของช่อง NUMBER เช่น KG / PCS / MM (แสดงต่อท้ายค่า)
   - DataType 'SELECT'         = DROPDOWN เลือกจากรายการ
   - Nexus.PartFieldOptions    = รายการให้เลือกของช่อง DROPDOWN (เรียงตาม SortNo) - ลบช่อง = ลบรายการด้วย
   - รันซ้ำได้ · เพิ่มอย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.PartFieldDefs', 'Unit') IS NULL
    ALTER TABLE Nexus.PartFieldDefs ADD Unit NVARCHAR(20) NULL;
GO

-- ชนิดข้อมูล: เพิ่ม SELECT (DROPDOWN)
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PartFieldDefs_Type' AND definition NOT LIKE '%SELECT%')
    ALTER TABLE Nexus.PartFieldDefs DROP CONSTRAINT CK_PartFieldDefs_Type;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PartFieldDefs_Type')
    ALTER TABLE Nexus.PartFieldDefs ADD CONSTRAINT CK_PartFieldDefs_Type CHECK (DataType IN ('TEXT', 'NUMBER', 'DATE', 'SELECT'));
GO

IF OBJECT_ID('Nexus.PartFieldOptions', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.PartFieldOptions
    (
        OptionID  INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PartFieldOptions PRIMARY KEY,
        FieldID   INT           NOT NULL CONSTRAINT FK_PartFieldOptions_Field REFERENCES Nexus.PartFieldDefs (FieldID) ON DELETE CASCADE,
        Value     NVARCHAR(200) NOT NULL,
        SortNo    INT           NOT NULL CONSTRAINT DF_PartFieldOptions_Sort DEFAULT (0),
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_PartFieldOptions_Created DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(50)  NULL,
        CONSTRAINT UQ_PartFieldOptions_Value UNIQUE (FieldID, Value)
    );
END;
GO
