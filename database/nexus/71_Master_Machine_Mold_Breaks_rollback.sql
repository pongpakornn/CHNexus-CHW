-- rollback 71: drop the 3 new tables (their data is lost; nothing else references them)
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO
IF OBJECT_ID(N'Master.CompanyBreaks', N'U') IS NOT NULL DROP TABLE Master.CompanyBreaks;
IF OBJECT_ID(N'Master.Molds', N'U') IS NOT NULL DROP TABLE Master.Molds;
IF OBJECT_ID(N'Master.Machines', N'U') IS NOT NULL DROP TABLE Master.Machines;
GO
