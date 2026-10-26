/* ============================================================================
   CHR-Nexus : ช่องกรอกลงทะเบียนสินค้าแยกตามคลัง (Inventory Registration)
   ----------------------------------------------------------------------------
   - Nexus.ProductControlSettings.FormFields = ช่องกรอกของคลัง (คั่นด้วย ,) แยกจากคอลัมน์ตาราง (ColumnOrder)
     ตั้งได้ที่ปุ่ม ADMIN > FORM FIELDS · Template Excel ของคลังใช้ช่องชุดเดียวกัน
   - Nexus.Parts.WeightKG = น้ำหนักสินค้า (KG) สำหรับคลังที่ไม่นับ Coil (เช่น STORE-CPN)
     คลังที่นับ Coil ใช้น้ำหนักของแต่ละ Coil (Nexus.Coils.WeightKG) เหมือนเดิม
   - ค่าเริ่มต้นตามคลัง (ตั้งเฉพาะคลังที่ยังไม่เคยตั้ง FormFields)
   - รันซ้ำได้ · ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.ProductControlSettings', 'FormFields') IS NULL
    ALTER TABLE Nexus.ProductControlSettings ADD FormFields VARCHAR(400) NULL;
GO

IF COL_LENGTH('Nexus.Parts', 'WeightKG') IS NULL
    ALTER TABLE Nexus.Parts ADD WeightKG DECIMAL(18, 3) NULL;
GO

;WITH d AS (
    SELECT s.StockID,
           CASE
               WHEN s.StockCode IN ('STOCK-MAT', 'STOCK-PANTA', 'STOCK-MSH') THEN 'SUPPLIER,CATEGORY,CODE,NAME,PACKSIZE,BIN,MOTHER,COILNO,WEIGHT,QRCODE'
               WHEN s.StockCode IN ('STORE-PC', 'STORE-SUB')                 THEN 'IMAGE,CUSTOMER,CATEGORY,MODEL,CODE,PARTA,NAME,PACKSIZE,QRCODE'
               WHEN s.StockCode = 'STORE-SP'                                 THEN 'CUSTOMER,CATEGORY,CODE,NAME,PACKSIZE,QRCODE'
               WHEN s.StockCode IN ('STORE-CPN', 'STOCK-CPN')                THEN 'IMAGE,SUPPLIER,CATEGORY,CODE,NAME,PACKSIZE,WEIGHT,QRCODE'
               WHEN s.StockCode = 'STOCK-CONS'                               THEN 'SUPPLIER,CATEGORY,CODE,NAME,PACKSIZE,BIN,QRCODE'
           END AS FormFields
    FROM Nexus.Stocks s
)
MERGE Nexus.ProductControlSettings AS t
USING (SELECT StockID, FormFields FROM d WHERE FormFields IS NOT NULL) AS src
   ON t.StockID = src.StockID
WHEN MATCHED AND t.FormFields IS NULL THEN
    UPDATE SET FormFields = src.FormFields
WHEN NOT MATCHED THEN
    INSERT (StockID, ColumnOrder, GroupBy, FormFields, UpdatedBy, UpdatedDate)
    VALUES (src.StockID, NULL, 'CATEGORY', src.FormFields, 'SYSTEM', GETDATE());
GO
