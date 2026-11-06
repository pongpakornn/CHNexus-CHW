/* ============================================================================
   CHR-Nexus : 🧭 ชื่อตารางตามระบบ (Schema ต่อระบบ) - รองรับ MES หลายระบบ
   ----------------------------------------------------------------------------
   Master.*  = MASTER DATA (ตารางจริง)   : Master.Customers, Master.Suppliers
   CIMS.*    = ระบบคลัง CIMS (ชื่อเรียก)   : CIMS.Parts, CIMS.Stocks, CIMS.vw_StockMonitoring, CIMS.sp_... ฯลฯ
   Core.*    = ส่วนกลางทุกระบบ (ชื่อเรียก) : Core.Users, Core.Permissions, Core.SystemLogs, แชท, แจ้ง Admin ...
   - ตารางเดิมยังอยู่ที่ Nexus.* เหมือนเดิม (CIMS Windows / API เดิมใช้ต่อได้ ไม่พัง)
     CIMS.* / Core.* เป็น SYNONYM ชี้ไปตารางเดิม = เรียกด้วยชื่อระบบได้ทันที ข้อมูลชุดเดียวกัน
   - ย้ายตารางจริงไป Schema ใหม่ได้ภายหลัง เมื่อ CIMS Windows เปลี่ยนมาใช้ชื่อใหม่แล้ว
   - เพิ่มอย่างเดียว (ไม่แก้ / ไม่ลบตารางเดิม) · รันซ้ำได้ (ตารางที่เพิ่มทีหลังได้ชื่อใหม่ด้วย) · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF SCHEMA_ID(N'Master') IS NULL EXEC (N'CREATE SCHEMA Master AUTHORIZATION dbo');
IF SCHEMA_ID(N'CIMS') IS NULL EXEC (N'CREATE SCHEMA CIMS AUTHORIZATION dbo');
IF SCHEMA_ID(N'Core') IS NULL EXEC (N'CREATE SCHEMA Core AUTHORIZATION dbo');
GO

-- MASTER DATA (ตารางใหม่ ยังไม่มีระบบเดิมใช้) -> ย้ายตารางจริงไป Schema Master
IF OBJECT_ID(N'Nexus.Customers', N'U') IS NOT NULL AND OBJECT_ID(N'Master.Customers', N'U') IS NULL
    ALTER SCHEMA Master TRANSFER Nexus.Customers;
IF OBJECT_ID(N'Nexus.Suppliers', N'U') IS NOT NULL AND OBJECT_ID(N'Master.Suppliers', N'U') IS NULL
    ALTER SCHEMA Master TRANSFER Nexus.Suppliers;
GO

-- ชื่อตามระบบของตาราง / View / Stored Procedure / Function เดิมใน Nexus (ส่วนกลาง = Core · ที่เหลือ = CIMS)
DECLARE @core TABLE (name SYSNAME PRIMARY KEY);
INSERT INTO @core VALUES (N'Users'), (N'Permissions'), (N'UserSettings'), (N'SystemLogs'), (N'BugLogs'), (N'AdminContacts'),
                         (N'ChatMessages'), (N'ChatReactions'), (N'SupportMessages'), (N'SupportThreads');

DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'CREATE SYNONYM ' + QUOTENAME(x.sch) + N'.' + QUOTENAME(o.name) + N' FOR Nexus.' + QUOTENAME(o.name) + N';' + CHAR(10)
FROM sys.objects o
CROSS APPLY (SELECT CASE WHEN EXISTS (SELECT 1 FROM @core c WHERE c.name = o.name) THEN N'Core' ELSE N'CIMS' END AS sch) x
WHERE o.schema_id = SCHEMA_ID(N'Nexus') AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF')
  AND OBJECT_ID(x.sch + N'.' + QUOTENAME(o.name)) IS NULL;
EXEC sys.sp_executesql @sql;
GO
