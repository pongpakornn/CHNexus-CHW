/* ============================================================================
   CHR-Nexus : MIN REPORT - reason groups (SETUP › MIN REASONS)
   ----------------------------------------------------------------------------
   Nexus.MinReasonGroups  = groups of reasons shown as buttons in the REPORT box
                            StockIDs = comma list of stocks that see the group (NULL = every stock)
   Nexus.MinReportReasons + GroupID (every existing reason -> group "CIMS", shown in every stock)
   - adds a table + a column only; old reports keep their own reason text
   - re-runnable · CHR-Nexus only · rollback: 68_Min_Reason_Groups_rollback.sql
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    SET NOEXEC ON;   -- skips every later batch too (RETURN would only end this one)
END;
GO
IF OBJECT_ID(N'Nexus.MinReasonGroups', N'U') IS NULL
    CREATE TABLE Nexus.MinReasonGroups
    (
        GroupID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_MinReasonGroups PRIMARY KEY,
        GroupName   NVARCHAR(60)  NOT NULL,
        StockIDs    NVARCHAR(400) NULL,
        SortNo      INT           NOT NULL CONSTRAINT DF_MinReasonGroups_SortNo DEFAULT (0),
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_MinReasonGroups_Updated DEFAULT (GETDATE())
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MinReasonGroups_Name' AND object_id = OBJECT_ID(N'Nexus.MinReasonGroups'))
    CREATE UNIQUE INDEX UX_MinReasonGroups_Name ON Nexus.MinReasonGroups (GroupName);
GO
IF NOT EXISTS (SELECT 1 FROM Nexus.MinReasonGroups)
    INSERT INTO Nexus.MinReasonGroups (GroupName, StockIDs, SortNo, UpdatedBy) VALUES (N'CIMS', NULL, 1, N'SYSTEM');
GO
IF COL_LENGTH('Nexus.MinReportReasons', 'GroupID') IS NULL
    ALTER TABLE Nexus.MinReportReasons ADD GroupID INT NULL;
GO
UPDATE Nexus.MinReportReasons
SET GroupID = (SELECT MIN(GroupID) FROM Nexus.MinReasonGroups WHERE GroupName = N'CIMS')
WHERE GroupID IS NULL;
GO
-- the same reason text may now exist in two groups: unique per group instead of system-wide
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MinReportReasons_Text' AND object_id = OBJECT_ID(N'Nexus.MinReportReasons'))
    DROP INDEX UX_MinReportReasons_Text ON Nexus.MinReportReasons;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MinReportReasons_GroupText' AND object_id = OBJECT_ID(N'Nexus.MinReportReasons'))
    CREATE UNIQUE INDEX UX_MinReportReasons_GroupText ON Nexus.MinReportReasons (GroupID, ReasonText);
GO
SELECT g.GroupName, g.StockIDs, COUNT(r.ReasonID) AS Reasons
FROM Nexus.MinReasonGroups g LEFT JOIN Nexus.MinReportReasons r ON r.GroupID = g.GroupID
GROUP BY g.GroupName, g.StockIDs;
