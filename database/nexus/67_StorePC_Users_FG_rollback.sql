-- 67 rollback: remove only the users script 67 added (found by its SystemLogs rows)
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @ids TABLE (UserID VARCHAR(50) PRIMARY KEY);
INSERT INTO @ids SELECT DISTINCT Reference FROM Nexus.SystemLogs WHERE ActionType = 'IMPORT_STOREPC_USER' AND ComputerName = 'SCRIPT67';
DELETE FROM Nexus.UserScanStocks WHERE UserID IN (SELECT UserID FROM @ids);
DELETE FROM Nexus.Permissions   WHERE UserID IN (SELECT UserID FROM @ids);
DELETE FROM Nexus.Users         WHERE UserID IN (SELECT UserID FROM @ids);
COMMIT;
