-- ============================================================================
-- 52_Stock_Order.sql  (CHR-Nexus only · Nexus.Stocks.SortNo only)
-- Stock display order requested 2026-11-16: PANTA > MAT > FG > SUB > COMPONENT > SP > CONS
-- Bound by StockID (rename-safe). Later changes: Admin Level 1 > STORE (MAX-MIN) > SORT STOCKS
-- ============================================================================
SET NOCOUNT ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
UPDATE s SET SortNo = o.n
FROM Nexus.Stocks s
JOIN (VALUES (16, 1), (1, 2), (18, 3), (28, 4), (27, 5), (26, 6), (29, 7)) o(id, n) ON o.id = s.StockID;
SELECT StockID, StockCode, SortNo FROM Nexus.Stocks ORDER BY SortNo, StockCode;
GO
SET NOEXEC OFF;
GO
