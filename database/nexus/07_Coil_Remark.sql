/* ============================================================================
   CHR-Nexus : Nexus.Coils.Remark (หมายเหตุของ Coil ลูกแต่ละม้วน - พิมพ์ได้ในแถว Coil หน้า Store)
   ----------------------------------------------------------------------------
   - รันซ้ำได้ (เพิ่มคอลัมน์เมื่อยังไม่มี) · คอลัมน์ว่างได้ ไม่กระทบข้อมูลเดิม
   - ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH(N'Nexus.Coils', N'Remark') IS NULL
    ALTER TABLE Nexus.Coils ADD Remark NVARCHAR(500) NULL;
GO
