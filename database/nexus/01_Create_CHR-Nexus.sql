-- =====================================================================================================
-- CHR-Nexus : สร้างฐาน [CHR-Nexus] จากฐาน CIMS (ข้อมูล + การตั้งค่าทั้งหมด ณ เวลาที่รัน)
--
--   วิธีใช้: เปิดไฟล์นี้ใน SSMS -> ต่อ 192.168.10.56 ด้วย Login ที่เป็น sysadmin -> Execute ครั้งเดียวทั้งไฟล์
--
--   1) BACKUP DATABASE [CIMS] ... WITH COPY_ONLY
--        = อ่าน CIMS อย่างเดียว / CIMS ใช้งานต่อได้ตามปกติ / ไม่กระทบลำดับ Backup ปกติของ CIMS
--   2) RESTORE เป็นฐานใหม่ [CHR-Nexus] (ไฟล์ CHR-Nexus.mdf / CHR-Nexus_log.ldf)
--   3) ใน [CHR-Nexus]: เปลี่ยน schema CIMS -> Nexus (ตาราง / View / Procedure / Function / Trigger)
--
--   ไม่แก้ไขอะไรในฐาน CIMS / StorePC / ERP (CHR) / CHR-Synchron
--   ได้การตั้งค่าครบ: Stocks, Store Max-Min, Multi-Scanner (คลัง / แผนก / การแสดงผล), Barcode Format,
--   Product Control, PR (Lookup / Excel Setup / RPA Layout), Max-Min Formula / Workday, Users / Permission
-- =====================================================================================================
SET NOCOUNT ON;
USE master;
GO

IF DB_ID(N'CHR-Nexus') IS NOT NULL
BEGIN
    RAISERROR(N'มีฐาน [CHR-Nexus] อยู่แล้ว - หยุด ไม่ทำอะไร (ถ้าจะสร้างใหม่ให้ DROP DATABASE [CHR-Nexus] ก่อน)', 16, 1);
    SET NOEXEC ON;
END
IF DB_ID(N'CIMS') IS NULL
BEGIN
    RAISERROR(N'ไม่พบฐาน CIMS - หยุด', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------------------------------
-- 1) + 2) BACKUP (COPY_ONLY) -> RESTORE เป็น [CHR-Nexus]
-- ---------------------------------------------------------------------------------------------------
BEGIN TRY
    DECLARE @bakDir nvarchar(400) = CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(400));
    IF @bakDir IS NULL   -- SQL Server รุ่นเก่า: ใช้โฟลเดอร์ของ Backup ล่าสุดบนเครื่องนี้
        SELECT TOP (1) @bakDir = LEFT(mf.physical_device_name, LEN(mf.physical_device_name) - CHARINDEX('\', REVERSE(mf.physical_device_name)))
        FROM msdb.dbo.backupmediafamily mf JOIN msdb.dbo.backupset bs ON bs.media_set_id = mf.media_set_id
        WHERE mf.physical_device_name LIKE '[A-Z]:\%' ORDER BY bs.backup_finish_date DESC;
    DECLARE @dataDir nvarchar(400) = CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(400));
    DECLARE @logDir  nvarchar(400) = CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(400));
    IF @bakDir IS NULL SET @bakDir = @dataDir;
    IF RIGHT(@bakDir, 1) <> '\' SET @bakDir += '\';
    IF RIGHT(@dataDir, 1) <> '\' SET @dataDir += '\';
    IF RIGHT(@logDir, 1) <> '\' SET @logDir += '\';

    DECLARE @bak nvarchar(500) = @bakDir + N'CIMS_for_CHR-Nexus_' + CONVERT(nchar(8), GETDATE(), 112) + N'.bak';
    PRINT N'1) BACKUP CIMS (COPY_ONLY) -> ' + @bak;
    BACKUP DATABASE [CIMS] TO DISK = @bak WITH COPY_ONLY, INIT, CHECKSUM, STATS = 25;

    -- ชื่อไฟล์ใหม่ของ CHR-Nexus (Logical name เดิมของ CIMS)
    DECLARE @move nvarchar(max) = N'', @n int = 0, @name sysname, @type tinyint;
    DECLARE f CURSOR LOCAL FAST_FORWARD FOR
        SELECT name, type FROM sys.master_files WHERE database_id = DB_ID(N'CIMS') ORDER BY type, file_id;
    OPEN f;
    FETCH NEXT FROM f INTO @name, @type;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF @type NOT IN (0, 1) RAISERROR(N'CIMS มีไฟล์ชนิดที่ Script นี้ไม่รองรับ (FILESTREAM / Full-text)', 16, 1);
        SET @n += 1;
        SET @move += N', MOVE N''' + REPLACE(@name, '''', '''''') + N''' TO N'''
                   + CASE @type WHEN 0 THEN @dataDir + N'CHR-Nexus' + CASE WHEN @n = 1 THEN N'.mdf' ELSE N'_' + CAST(@n AS nvarchar(10)) + N'.ndf' END
                                ELSE @logDir + N'CHR-Nexus_log' + CASE WHEN @n = 2 THEN N'' ELSE CAST(@n AS nvarchar(10)) END + N'.ldf' END
                   + N'''';
        FETCH NEXT FROM f INTO @name, @type;
    END
    CLOSE f; DEALLOCATE f;

    DECLARE @restore nvarchar(max) = N'RESTORE DATABASE [CHR-Nexus] FROM DISK = N''' + REPLACE(@bak, '''', '''''') + N''' WITH RECOVERY, CHECKSUM, STATS = 25' + @move;
    PRINT N'2) ' + @restore;
    EXEC (@restore);
END TRY
BEGIN CATCH
    PRINT N'❌ BACKUP / RESTORE ไม่สำเร็จ: ' + ERROR_MESSAGE();
    RAISERROR(N'หยุด - ไม่ได้สร้าง CHR-Nexus', 16, 1);
    SET NOEXEC ON;
END CATCH
GO

-- ---------------------------------------------------------------------------------------------------
-- 3) ใน [CHR-Nexus]: schema CIMS -> Nexus
-- ---------------------------------------------------------------------------------------------------
USE [CHR-Nexus];
GO
IF DB_NAME() <> N'CHR-Nexus' OR SCHEMA_ID(N'CIMS') IS NULL
BEGIN
    RAISERROR(N'ไม่ได้อยู่ในฐาน CHR-Nexus หรือไม่มี schema CIMS - หยุด', 16, 1);
    SET NOEXEC ON;
END
GO
CREATE SCHEMA Nexus AUTHORIZATION dbo;
GO
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

-- 3.1 เก็บ Definition ของ View / Procedure / Function / Trigger ไว้ก่อน (ถ้าค้างกลางทางยังสร้างคืนได้)
IF OBJECT_ID(N'dbo.__NexusModules') IS NOT NULL DROP TABLE dbo.__NexusModules;
CREATE TABLE dbo.__NexusModules (
    Id int IDENTITY PRIMARY KEY, Name sysname NOT NULL, Typ char(2) NOT NULL, Ord int NOT NULL,
    Def nvarchar(max) NOT NULL, QuotedId bit NOT NULL, AnsiNulls bit NOT NULL,
    ParentTable sysname NULL, TriggerDisabled bit NOT NULL DEFAULT 0,
    Done bit NOT NULL DEFAULT 0, Err nvarchar(4000) NULL);
INSERT dbo.__NexusModules (Name, Typ, Ord, Def, QuotedId, AnsiNulls, ParentTable, TriggerDisabled)
SELECT o.name, o.type,
       CASE o.type WHEN 'FN' THEN 1 WHEN 'IF' THEN 1 WHEN 'TF' THEN 1 WHEN 'V' THEN 2 WHEN 'P' THEN 3 ELSE 4 END,
       m.definition, m.uses_quoted_identifier, m.uses_ansi_nulls,
       OBJECT_NAME(NULLIF(o.parent_object_id, 0)), ISNULL(tr.is_disabled, 0)
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
LEFT JOIN sys.triggers tr ON tr.object_id = o.object_id
WHERE o.schema_id = SCHEMA_ID(N'CIMS');
PRINT N'3.1) เก็บ Definition ' + CAST(@@ROWCOUNT AS nvarchar(10)) + N' รายการ';

DECLARE @sql nvarchar(max), @id int, @nm sysname, @tp char(2), @pass int = 0, @left int, @prev int = -1;

-- 3.2 ลบ Trigger / Procedure / View / Function เดิม (ลำดับกลับกับตอนสร้าง)
DECLARE d CURSOR LOCAL FAST_FORWARD FOR SELECT Name, Typ FROM dbo.__NexusModules ORDER BY Ord DESC, Id;
OPEN d;
FETCH NEXT FROM d INTO @nm, @tp;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DROP ' + CASE @tp WHEN 'TR' THEN N'TRIGGER' WHEN 'P' THEN N'PROCEDURE' WHEN 'V' THEN N'VIEW' ELSE N'FUNCTION' END
             + N' CIMS.' + QUOTENAME(@nm);
    EXEC (@sql);
    FETCH NEXT FROM d INTO @nm, @tp;
END
CLOSE d; DEALLOCATE d;

-- 3.3 ย้ายตาราง (พร้อม Index / Constraint) + Sequence / Synonym / Type ไป schema Nexus
DECLARE t CURSOR LOCAL FAST_FORWARD FOR
    SELECT N'ALTER SCHEMA Nexus TRANSFER CIMS.' + QUOTENAME(name) FROM sys.objects WHERE schema_id = SCHEMA_ID(N'CIMS') AND parent_object_id = 0
    UNION ALL
    SELECT N'ALTER SCHEMA Nexus TRANSFER TYPE::CIMS.' + QUOTENAME(name) FROM sys.types WHERE schema_id = SCHEMA_ID(N'CIMS');
OPEN t;
FETCH NEXT FROM t INTO @sql;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC (@sql);
    FETCH NEXT FROM t INTO @sql;
END
CLOSE t; DEALLOCATE t;
SELECT @left = COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID(N'Nexus');
PRINT N'3.3) ย้ายตารางไป Nexus แล้ว: ' + CAST(@left AS nvarchar(10)) + N' ตาราง';

-- 3.4 สร้าง Function / View / Procedure / Trigger ใหม่ใน Nexus (CIMS.xxx -> Nexus.xxx) วนซ้ำจนครบ (View ที่อ้าง View อื่น)
WHILE 1 = 1
BEGIN
    SET @pass += 1;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM dbo.__NexusModules WHERE Done = 0 ORDER BY Ord, Id;
    OPEN c;
    FETCH NEXT FROM c INTO @id;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- ใช้ค่า QUOTED_IDENTIFIER / ANSI_NULLS เดิมของแต่ละตัว / Trigger ที่เคยปิดไว้ ปิดเหมือนเดิม
        DECLARE @outer nvarchar(400), @off nvarchar(400);
        SELECT @sql = REPLACE(REPLACE(Def, N'[CIMS].', N'[Nexus].'), N'CIMS.', N'Nexus.'),
               @outer = N'SET QUOTED_IDENTIFIER ' + CASE QuotedId WHEN 1 THEN N'ON' ELSE N'OFF' END
                      + N'; SET ANSI_NULLS ' + CASE AnsiNulls WHEN 1 THEN N'ON' ELSE N'OFF' END + N'; EXEC (@d);',
               @off = CASE WHEN Typ = 'TR' AND TriggerDisabled = 1
                           THEN N'DISABLE TRIGGER Nexus.' + QUOTENAME(Name) + N' ON Nexus.' + QUOTENAME(ParentTable) END
        FROM dbo.__NexusModules WHERE Id = @id;
        BEGIN TRY
            EXEC sp_executesql @outer, N'@d nvarchar(max)', @d = @sql;
            IF @off IS NOT NULL EXEC (@off);
            UPDATE dbo.__NexusModules SET Done = 1, Err = NULL WHERE Id = @id;
        END TRY
        BEGIN CATCH
            UPDATE dbo.__NexusModules SET Err = ERROR_MESSAGE() WHERE Id = @id;
        END CATCH
        FETCH NEXT FROM c INTO @id;
    END
    CLOSE c; DEALLOCATE c;
    SELECT @left = COUNT(*) FROM dbo.__NexusModules WHERE Done = 0;
    IF @left = 0 OR @left = @prev OR @pass >= 10 BREAK;
    SET @prev = @left;
END

IF @left = 0
BEGIN
    DROP TABLE dbo.__NexusModules;
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE schema_id = SCHEMA_ID(N'CIMS'))
       AND NOT EXISTS (SELECT 1 FROM sys.types WHERE schema_id = SCHEMA_ID(N'CIMS'))
        DROP SCHEMA CIMS;
    PRINT N'✅ เสร็จ: ฐาน [CHR-Nexus] พร้อมใช้ (schema Nexus)';
END
ELSE
BEGIN
    PRINT N'⚠️ สร้างใหม่ไม่ได้ ' + CAST(@left AS nvarchar(10)) + N' รายการ - ดูรายละเอียดใน dbo.__NexusModules (Done = 0, คอลัมน์ Err)';
    SELECT Name, Typ, Err FROM dbo.__NexusModules WHERE Done = 0;
END

-- สรุป
SELECT SCHEMA_NAME(schema_id) AS [Schema], type_desc AS [Type], COUNT(*) AS [Count]
FROM sys.objects WHERE is_ms_shipped = 0 AND parent_object_id = 0
GROUP BY SCHEMA_NAME(schema_id), type_desc ORDER BY 1, 2;
GO
SET NOEXEC OFF;
GO

-- ---------------------------------------------------------------------------------------------------
-- 4) (ไม่บังคับ) เมื่อเว็บใช้ CHR-Nexus ได้แล้ว ค่อยลบฐานเก่า CHR-Synchron - ลบแล้วกู้คืนไม่ได้
-- ---------------------------------------------------------------------------------------------------
-- USE master;
-- ALTER DATABASE [CHR-Synchron] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
-- DROP DATABASE [CHR-Synchron];
