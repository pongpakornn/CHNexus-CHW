/* Rollback of 68_Min_Reason_Groups.sql : back to one reason list (reasons of every group are kept; duplicate texts across groups keep the first)
   After running: restart the API (pm2) so it stops using the GroupID column */
IF DB_NAME() <> N'CHR-Nexus' BEGIN RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1); SET NOEXEC ON; END;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MinReportReasons_GroupText' AND object_id = OBJECT_ID(N'Nexus.MinReportReasons'))
    DROP INDEX UX_MinReportReasons_GroupText ON Nexus.MinReportReasons;
GO
DELETE r FROM Nexus.MinReportReasons r
WHERE EXISTS (SELECT 1 FROM Nexus.MinReportReasons o WHERE o.ReasonText = r.ReasonText AND o.ReasonID < r.ReasonID);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MinReportReasons_Text' AND object_id = OBJECT_ID(N'Nexus.MinReportReasons'))
    CREATE UNIQUE INDEX UX_MinReportReasons_Text ON Nexus.MinReportReasons (ReasonText);
GO
IF COL_LENGTH('Nexus.MinReportReasons', 'GroupID') IS NOT NULL
    ALTER TABLE Nexus.MinReportReasons DROP COLUMN GroupID;
GO
IF OBJECT_ID(N'Nexus.MinReasonGroups', N'U') IS NOT NULL
    DROP TABLE Nexus.MinReasonGroups;
GO
