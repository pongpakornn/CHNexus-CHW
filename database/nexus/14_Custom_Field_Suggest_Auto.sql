/* ============================================================================
   CHR-Nexus : ➕ ช่องกรอกเพิ่มเอง - ช่วยกรอก (ต่อจาก 13_Custom_Field_Unit_Dropdown.sql)
   ----------------------------------------------------------------------------
   - Nexus.PartFieldDefs.Suggest  = 1 : ตอนกรอกแสดงค่าที่เคยกรอกไว้แล้วให้เลือก (ช่องชื่อเดียวกันทุกคลัง)
   - Nexus.PartFieldDefs.AutoFrom = ช่องต้นทางที่ใช้เติมค่าให้อัตโนมัติ เช่น SUPPLIER / CODE / CF12
                                    (กรอก SUPPLIER = PANTA -> เติม SUPPLIER NAME จากสินค้าที่เคยกรอก PANTA ไว้)
   - รันซ้ำได้ · เพิ่มคอลัมน์อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.PartFieldDefs', 'Suggest') IS NULL
    ALTER TABLE Nexus.PartFieldDefs ADD Suggest BIT NOT NULL CONSTRAINT DF_PartFieldDefs_Suggest DEFAULT (0);
GO
IF COL_LENGTH('Nexus.PartFieldDefs', 'AutoFrom') IS NULL
    ALTER TABLE Nexus.PartFieldDefs ADD AutoFrom VARCHAR(20) NULL;
GO
