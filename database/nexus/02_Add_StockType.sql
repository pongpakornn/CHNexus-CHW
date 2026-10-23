/* ============================================================================
   CHR-Nexus : Nexus.Stocks.StockType (ประเภทคลัง = ไอคอนของคลังบนเว็บ)
   ----------------------------------------------------------------------------
   MATERIAL / PRODUCT / SPAREPART / COMPONENT / CONSUMABLE  (NULL = ดูจากรหัสคลัง)
   - รันซ้ำได้ (เพิ่มคอลัมน์เมื่อยังไม่มี · เติมค่าเฉพาะคลังที่ยังว่าง)
   - ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH(N'Nexus.Stocks', N'StockType') IS NULL
    ALTER TABLE Nexus.Stocks ADD StockType NVARCHAR(20) NULL;
GO

IF DB_NAME() = N'CHR-Nexus'
    -- คลังที่มีอยู่แล้ว: เติมประเภทตามรหัสคลังเดิม (ไอคอนเหมือนเดิมทุกคลัง)
    UPDATE Nexus.Stocks
    SET StockType = CASE
            WHEN StockCode LIKE N'%-MAT' OR StockCode LIKE N'%-PANTA' OR StockCode LIKE N'%-MSH' THEN N'MATERIAL'
            WHEN StockCode LIKE N'%-PC' OR StockCode LIKE N'%-SUB' THEN N'PRODUCT'
            WHEN StockCode LIKE N'%-SP' THEN N'SPAREPART'
            WHEN StockCode LIKE N'%-CPN' THEN N'COMPONENT'
            WHEN StockCode LIKE N'%-CONS' THEN N'CONSUMABLE'
        END
    WHERE StockType IS NULL;
GO
