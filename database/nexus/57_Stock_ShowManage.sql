-- ============================================================================
-- 57_Stock_ShowManage.sql  (CHR-Nexus only · adds 1 column, no data deleted)
-- Nexus.Stocks.ShowManageStock = show the MANAGE STOCK button of this stock to everyone (rights unchanged: EDIT + APPROVE)
-- Default 1 = same as today · safe to re-run · undo: ALTER TABLE Nexus.Stocks DROP CONSTRAINT DF_Stocks_ShowManageStock, COLUMN ShowManageStock
-- ============================================================================
SET NOCOUNT ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF COL_LENGTH('Nexus.Stocks', 'ShowManageStock') IS NULL
    ALTER TABLE Nexus.Stocks ADD ShowManageStock BIT NOT NULL CONSTRAINT DF_Stocks_ShowManageStock DEFAULT (1);
GO
SELECT StockID, StockCode, ShowManageStock FROM Nexus.Stocks ORDER BY SortNo;
GO
SET NOEXEC OFF;
GO
