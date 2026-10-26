/* ============================================================================
   CHR-Nexus : Index เพิ่มความเร็ว (ตามที่ SQL Server แนะนำจากการใช้งานจริง)
   ----------------------------------------------------------------------------
   - Nexus.Parts กรอง IsActive / IsShowInMaster เกือบทุกหน้า (Store / Product Control / Max-Min / Dashboard)
   - Nexus.ForecastOrderImports รวมยอดตามช่วงวันที่ (หน้า Forecast / Dashboard / Max-Min)
   - รันซ้ำได้ (สร้างเมื่อยังไม่มี) · ไม่แก้ข้อมูล · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'Nexus.Parts') AND name = N'IX_Parts_Active_Show')
    CREATE NONCLUSTERED INDEX IX_Parts_Active_Show ON Nexus.Parts (IsActive, IsShowInMaster)
        INCLUDE (PartCode, PartA, Customer, Category, Supplier, PackSize, MaxQuantity, MinQuantity, StockQuantity, CoilQuantity);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'Nexus.ForecastOrderImports') AND name = N'IX_ForecastOrderImports_Date')
    CREATE NONCLUSTERED INDEX IX_ForecastOrderImports_Date ON Nexus.ForecastOrderImports (TargetDate)
        INCLUDE (CustomerCode, PartACode, ForecastQuantity, OrderQuantity, DeliveryQuantity);
GO
