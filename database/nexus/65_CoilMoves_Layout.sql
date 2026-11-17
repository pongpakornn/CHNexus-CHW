-- ============================================================================
-- 65_CoilMoves_Layout.sql  (CHR-Nexus only · additive: 1 nullable column, no data changed)
-- Multi-Scanner > MOVE LOCATION: a coil's storage location change is one CoilMoves row (Action = 'MOVE_LAYOUT', Layout = new location text).
-- Layout 3D / PLATE capacity read the latest IN-move of each coil: Layout = COALESCE(CoilMoves.Layout, ScanTransactions.Layout).
-- Until this runs the MOVE LOCATION button answers "not ready"; everything else is unchanged. Safe to re-run.
-- Undo: ALTER TABLE Nexus.CoilMoves DROP COLUMN Layout   (delete the MOVE_LAYOUT rows first: DELETE FROM Nexus.CoilMoves WHERE Action = 'MOVE_LAYOUT')
-- ============================================================================
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('Nexus.CoilMoves') IS NULL BEGIN RAISERROR(N'Nexus.CoilMoves not found - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF COL_LENGTH('Nexus.CoilMoves', 'Layout') IS NULL ALTER TABLE Nexus.CoilMoves ADD Layout NVARCHAR(120) NULL;
GO
SELECT COUNT(*) AS CoilMoves, SUM(CASE WHEN Action = 'MOVE_LAYOUT' THEN 1 ELSE 0 END) AS MoveLayout FROM Nexus.CoilMoves;
GO
SET NOEXEC OFF;
GO
