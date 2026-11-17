-- ============================================================================
-- 60_Stock_PentaPicking.sql  (CHR-Nexus only · adds 1 column, no data deleted)
-- Nexus.Stocks.PentaPicking = IMPORT PENTA STOCK review shows "QR PICK LIST" (print Pick List QR cards for the file's coils)
-- On for STORE-MAT and STORE-PANTA · safe to re-run · undo: ALTER TABLE Nexus.Stocks DROP CONSTRAINT DF_Stocks_PentaPicking, COLUMN PentaPicking
-- ============================================================================
SET NOCOUNT ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF COL_LENGTH('Nexus.Stocks', 'PentaPicking') IS NULL
    ALTER TABLE Nexus.Stocks ADD PentaPicking BIT NOT NULL CONSTRAINT DF_Stocks_PentaPicking DEFAULT (0);
GO
UPDATE Nexus.Stocks SET PentaPicking = 1 WHERE StockCode IN ('STORE-MAT', 'STORE-PANTA') AND PentaPicking = 0;
SELECT StockID, StockCode, InSupplierImport, PentaPicking FROM Nexus.Stocks ORDER BY SortNo;
GO
SET NOEXEC OFF;
GO
