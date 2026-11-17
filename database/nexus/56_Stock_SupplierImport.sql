-- ============================================================================
-- 56_Stock_SupplierImport.sql  (CHR-Nexus only · adds 1 column, no data deleted)
-- Nexus.Stocks.InSupplierImport = stock uses IMPORT PENTA STOCK (supplier file review) in its EXCEL menu
-- On for STORE-MAT and STORE-PANTA only · safe to re-run · undo: ALTER TABLE Nexus.Stocks DROP CONSTRAINT DF_Stocks_InSupplierImport, COLUMN InSupplierImport
-- ============================================================================
SET NOCOUNT ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF COL_LENGTH('Nexus.Stocks', 'InSupplierImport') IS NULL
    ALTER TABLE Nexus.Stocks ADD InSupplierImport BIT NOT NULL CONSTRAINT DF_Stocks_InSupplierImport DEFAULT (0);
GO
UPDATE Nexus.Stocks SET InSupplierImport = 1 WHERE StockCode IN ('STORE-MAT', 'STORE-PANTA') AND InSupplierImport = 0;
SELECT StockID, StockCode, InSupplierImport FROM Nexus.Stocks ORDER BY SortNo;
GO
SET NOEXEC OFF;
GO
