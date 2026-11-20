/* CHR-Nexus : MIN REPORT restart for the new rule (STOCK(Box) <= MIN 3 days -> alert, report again each day until above MIN)
   - closes test rows that alerted whatever the stock was
   - clears the daily values of open periods (they were pieces; from now on they are in the stock's MAX/MIN unit, box for STORE-FG)
     the next sweep (<= 5 min) writes today's value again · reports and closed history are kept
   CHR-Nexus only */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus' BEGIN RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1); SET NOEXEC ON; END;
GO
UPDATE Nexus.MinWatch SET ResolvedAt = GETDATE() WHERE ResolvedAt IS NULL AND Source = 'TEST';
GO
IF OBJECT_ID(N'Nexus.MinWatchDays', N'U') IS NOT NULL
    DELETE d FROM Nexus.MinWatchDays d JOIN Nexus.MinWatch w ON w.WatchID = d.WatchID WHERE w.ResolvedAt IS NULL;
GO
