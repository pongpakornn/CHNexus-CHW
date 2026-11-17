-- ============================================================================
-- 58_PR_Department_Users.sql  (CHR-Nexus only · ERP / CIMS / EDP_SYSTEM untouched)
-- 1) Nexus.DepartmentUsers: UserID -> department (picked at User Management > SETUP > DEPARTMENTS)
-- 2) trg_ScanTransactions_AutoPR: auto PR (SCAN OUT) takes the requester's department; no mapping = old behaviour
-- 3) History: PRs of UserID 33310 -> 11201122-จัดซื้อและพัสดุ (owner request 17-11-2026), and 33310 mapped to it
-- Safe to re-run · undo trigger: 58_PR_Department_Users_rollback.sql
-- ============================================================================
SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF OBJECT_ID('Nexus.DepartmentUsers', 'U') IS NULL
    CREATE TABLE Nexus.DepartmentUsers (
        UserID         VARCHAR(20)   NOT NULL CONSTRAINT PK_DepartmentUsers PRIMARY KEY,
        DepartmentName NVARCHAR(200) NOT NULL,
        UpdatedBy      VARCHAR(20)   NULL,
        UpdatedDate    DATETIME      NOT NULL CONSTRAINT DF_DepartmentUsers_Date DEFAULT (GETDATE())
    );
GO
-- SCAN OUT -> "Waiting" PR (same as before + StockID / PartID)
-- Department / Target Dept = the values used most recently on the PR page (fallback: the old defaults).
-- Wrapped in TRY/CATCH so a PR problem can never block the scan itself.
CREATE OR ALTER TRIGGER Nexus.trg_ScanTransactions_AutoPR
ON Nexus.ScanTransactions
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;

    IF NOT EXISTS (SELECT 1 FROM inserted WHERE TransactionType = 'OUT') RETURN;

    BEGIN TRY
        DECLARE @prefix VARCHAR(4) = RIGHT(CAST(YEAR(GETDATE()) AS VARCHAR(4)), 2) + 'PR';

        DECLARE @dept NVARCHAR(200) = ISNULL((SELECT TOP 1 LookupValue FROM Nexus.PRLookups WHERE FieldName = 'DEPT' ORDER BY LastUsed DESC), N'41304134-บำรุงรักษาแม่พิมพ์');
        DECLARE @target NVARCHAR(200) = ISNULL((SELECT TOP 1 LookupValue FROM Nexus.PRLookups WHERE FieldName = 'TARGET' ORDER BY LastUsed DESC), N'ชนนิกานต์');

        DECLARE @last INT = ISNULL((
            SELECT MAX(TRY_CAST(RIGHT(PRNumber, 8) AS INT))
            FROM Nexus.PRHeaders WITH (UPDLOCK, HOLDLOCK)
            WHERE PRNumber LIKE @prefix + '%' AND LEN(PRNumber) = 12), 0);

        DECLARE @rows TABLE (RN INT, TransactionID INT, UserID VARCHAR(20), Description NVARCHAR(200), Quantity INT, UNIT NVARCHAR(20), StockCode VARCHAR(30),
                             StockID INT, PartID INT);

        INSERT INTO @rows (RN, TransactionID, UserID, Description, Quantity, UNIT, StockCode, StockID, PartID)
        SELECT ROW_NUMBER() OVER (ORDER BY i.TransactionID), i.TransactionID, i.UserID, p.Description, i.Quantity,
               ISNULL(s.Unit, 'KG'), ISNULL(s.StockCode, 'Stock-CHR'), s.StockID, i.PartID
        FROM inserted i
        JOIN Nexus.Parts p       ON p.PartID = i.PartID
        -- old rows without StockID belong to the main stock
        LEFT JOIN Nexus.Stocks s ON s.StockID = ISNULL(i.StockID, (SELECT TOP 1 m.StockID FROM Nexus.Stocks m WHERE m.IsMain = 1))
        WHERE i.TransactionType = 'OUT'
          AND ISNULL(s.AutoPR, 1) = 1;      -- only stocks switched ON in PR SETTINGS

        IF NOT EXISTS (SELECT 1 FROM @rows) RETURN;

        INSERT INTO Nexus.PRHeaders (PRNumber, PRDate, UserID, RequesterName, RequestDepartment, TargetDepartment, Status, Remark,
                                  IsExported, Source, ScanTransactionID, CreatedAt, StockID)
        SELECT @prefix + RIGHT('00000000' + CAST(@last + r.RN AS VARCHAR(8)), 8),
               CAST(GETDATE() AS DATE), r.UserID, u.FullName, ISNULL(du.DepartmentName, @dept), @target, N'Waiting',
               N'AUTO: SCAN OUT (' + r.StockCode + N')', 'N', 'SCAN_OUT', r.TransactionID, GETDATE(), r.StockID
        FROM @rows r
        LEFT JOIN Nexus.Users u ON u.UserID = r.UserID
        LEFT JOIN Nexus.DepartmentUsers du ON du.UserID = r.UserID;   -- 58: requester's department (User Management > SETUP > DEPARTMENTS)

        INSERT INTO Nexus.PRDetails (PRNumber, Description, RequestQuantity, Unit, PartID)
        SELECT @prefix + RIGHT('00000000' + CAST(@last + r.RN AS VARCHAR(8)), 8), r.Description, r.Quantity, r.UNIT, r.PartID
        FROM @rows r;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> -1
            INSERT INTO Nexus.SystemLogs (UserID, ActionType, Description, Reference, LogDate)
            VALUES (NULL, 'AUTO_PR_ERROR', N'Scan out -> PR failed: ' + ERROR_MESSAGE(), '', GETDATE());
    END CATCH
END
GO
IF NOT EXISTS (SELECT 1 FROM Nexus.DepartmentUsers WHERE UserID = '33310')
    INSERT INTO Nexus.DepartmentUsers (UserID, DepartmentName, UpdatedBy) VALUES ('33310', N'11201122-จัดซื้อและพัสดุ', '2124');
DECLARE @n INT;
UPDATE Nexus.PRHeaders SET RequestDepartment = N'11201122-จัดซื้อและพัสดุ'
WHERE UserID = '33310' AND ISNULL(RequestDepartment, '') <> N'11201122-จัดซื้อและพัสดุ';
SET @n = @@ROWCOUNT;
IF @n > 0 INSERT INTO Nexus.SystemLogs (UserID, ActionType, Description, Reference, LogDate)
          VALUES ('2124', 'PR_DEPT_FIX', CONCAT(N'PR of 33310 -> 11201122-จัดซื้อและพัสดุ: ', @n), N'58_PR_Department_Users', GETDATE());
SELECT @n AS PrFixed;
GO
SET NOEXEC OFF;
GO
