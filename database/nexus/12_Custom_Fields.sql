/* ============================================================================
   CHR-Nexus : ➕ ช่องกรอกข้อมูลเพิ่มเอง ต่อคลัง (CUSTOM FIELDS) - Inventory Registration เป็นศูนย์กลางข้อมูลสินค้า
   ----------------------------------------------------------------------------
   - Nexus.PartFieldDefs   = ช่องที่ Admin เพิ่มเอง (ชื่อช่อง / ชนิด / ลำดับ) ต่อคลัง
   - Nexus.PartFieldValues = ค่าของช่องนั้นต่อสินค้า (1 ช่อง x 1 สินค้า = 1 ค่า)
   - คีย์ที่ใช้ในการตั้งค่า (ช่องกรอก / คอลัมน์ตาราง / คอลัมน์หน้า Store / Template Excel) = "CF" + FieldID เช่น CF12
   - ลบช่อง = ลบค่าของช่องนั้นทั้งหมด (CASCADE) · ลบสินค้า = ลบค่าของสินค้านั้น (CASCADE)
   - รันซ้ำได้ · สร้างตารางใหม่อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.PartFieldDefs', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.PartFieldDefs
    (
        FieldID   INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PartFieldDefs PRIMARY KEY,
        StockID   INT            NOT NULL CONSTRAINT FK_PartFieldDefs_Stock REFERENCES Nexus.Stocks (StockID) ON DELETE CASCADE,
        Label     NVARCHAR(60)   NOT NULL,
        DataType  VARCHAR(10)    NOT NULL CONSTRAINT DF_PartFieldDefs_Type DEFAULT ('TEXT'),   -- TEXT / NUMBER / DATE
        SortNo    INT            NOT NULL CONSTRAINT DF_PartFieldDefs_Sort DEFAULT (0),
        CreatedAt DATETIME2(0)   NOT NULL CONSTRAINT DF_PartFieldDefs_Created DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(50)   NULL,
        UpdatedAt DATETIME2(0)   NULL,
        UpdatedBy NVARCHAR(50)   NULL,
        CONSTRAINT UQ_PartFieldDefs_Label UNIQUE (StockID, Label),
        CONSTRAINT CK_PartFieldDefs_Type CHECK (DataType IN ('TEXT', 'NUMBER', 'DATE'))
    );
END;
GO

IF OBJECT_ID('Nexus.PartFieldValues', 'U') IS NULL
BEGIN
    CREATE TABLE Nexus.PartFieldValues
    (
        FieldID   INT            NOT NULL CONSTRAINT FK_PartFieldValues_Field REFERENCES Nexus.PartFieldDefs (FieldID) ON DELETE CASCADE,
        PartID    INT            NOT NULL CONSTRAINT FK_PartFieldValues_Part REFERENCES Nexus.Parts (PartID) ON DELETE CASCADE,
        Value     NVARCHAR(400)  NOT NULL,
        UpdatedAt DATETIME2(0)   NOT NULL CONSTRAINT DF_PartFieldValues_Updated DEFAULT (SYSDATETIME()),
        UpdatedBy NVARCHAR(50)   NULL,
        CONSTRAINT PK_PartFieldValues PRIMARY KEY (FieldID, PartID)
    );
    CREATE INDEX IX_PartFieldValues_Part ON Nexus.PartFieldValues (PartID) INCLUDE (Value);
END;
GO
