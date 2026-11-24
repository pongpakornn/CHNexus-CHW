-- rollback 74: drop Zone & Workstation Information tables (their data is lost; Kanban flows keep their zone / point text)
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO
IF OBJECT_ID(N'Master.Workstations', N'U') IS NOT NULL DROP TABLE Master.Workstations;
IF OBJECT_ID(N'Master.ProductionZones', N'U') IS NOT NULL DROP TABLE Master.ProductionZones;
IF OBJECT_ID(N'Master.LineSideStores', N'U') IS NOT NULL DROP TABLE Master.LineSideStores;
GO
