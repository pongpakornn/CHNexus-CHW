-- 67_StorePC_Users_FG.sql  (writes CHR-Nexus only; reads StorePC.dbo.MST_USER)
-- StorePC users that are not in CHR-Nexus yet -> Nexus.Users (same password as StorePC, like the existing shared rows)
-- Rights: Multi-Scanner (open + scan) + Store (Max-Min) view + STORE-FG view only; scan scope = STORE-FG (StockID of STORE-FG).
-- Existing users are never touched. Rollback: 67_StorePC_Users_FG_rollback.sql (deletes only the rows this script added, logged below).
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRAN;
DECLARE @fg INT = (SELECT StockID FROM Nexus.Stocks WHERE StockCode = 'STORE-FG');
IF @fg IS NULL THROW 50000, 'STORE-FG not found', 1;

DECLARE @new TABLE (UserID VARCHAR(50) PRIMARY KEY);
INSERT INTO Nexus.Users (UserID, Password, FullName, Position, Department, UserLevel, IsOnline, IsLocked, IsMasterAdmin)
OUTPUT inserted.UserID INTO @new
SELECT s.USR_ID, s.USR_PWD, s.USR_NAME, s.USR_POS, s.USR_DEPT, ISNULL(s.USR_LVL, 3), 0, ISNULL(s.IS_LOCKED, 0), 0
FROM StorePC.dbo.MST_USER s
WHERE NOT EXISTS (SELECT 1 FROM Nexus.Users n WHERE n.UserID = s.USR_ID COLLATE DATABASE_DEFAULT);

-- adding a user may create default permission rows: close every right first, then open only these 3
UPDATE p SET CanView = 'N', CanAdd = 'N', CanEdit = 'N', CanDelete = 'N', CanApprove = 'N'
FROM Nexus.Permissions p JOIN @new n ON n.UserID = p.UserID;
MERGE Nexus.Permissions AS t
USING (SELECT n.UserID, x.SystemID FROM @new n CROSS JOIN (VALUES ('MultiScanner'), ('StoreMaxMin'), ('STORE-FG')) x(SystemID)) AS s
ON t.UserID = s.UserID AND t.SystemID = s.SystemID
WHEN MATCHED THEN UPDATE SET CanView = 'Y'
WHEN NOT MATCHED THEN INSERT (UserID, SystemID, CanView, CanAdd, CanEdit, CanDelete, CanApprove) VALUES (s.UserID, s.SystemID, 'Y', 'N', 'N', 'N', 'N');

DELETE FROM Nexus.UserScanStocks WHERE UserID IN (SELECT UserID FROM @new);
INSERT INTO Nexus.UserScanStocks (UserID, StockID, IsPriority, UpdatedBy, UpdatedDate)
SELECT UserID, @fg, 1, 'SCRIPT67', GETDATE() FROM @new;

INSERT INTO Nexus.SystemLogs (UserID, ActionType, Description, Reference, LogDate, ComputerName)
SELECT '2124', 'IMPORT_STOREPC_USER', 'Added from StorePC: MultiScanner + StoreMaxMin + STORE-FG view, scan scope STORE-FG', UserID, GETDATE(), 'SCRIPT67' FROM @new;

SELECT UserID AS added FROM @new ORDER BY UserID;
COMMIT;
GO
