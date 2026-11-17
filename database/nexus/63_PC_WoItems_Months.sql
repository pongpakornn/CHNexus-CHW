-- ============================================================================
-- 63_PC_WoItems_Months.sql  (CHR-Nexus only · additive: 2 nullable columns on PC.WoItems, no data changed)
-- WORK ORDER FOLLOW: part validity by month. Visible in month M when (FromMonth IS NULL OR FromMonth <= M) AND (ToMonth IS NULL OR ToMonth >= M)
-- Existing rows keep FromMonth NULL = from the beginning. Safe to re-run. Run AFTER 62_PC_WorkOrderFollow_v2.sql.
-- Undo: ALTER TABLE PC.WoItems DROP COLUMN FromMonth, ToMonth
-- ============================================================================
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('PC.WoItems') IS NULL BEGIN RAISERROR(N'Run 62_PC_WorkOrderFollow_v2.sql first - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF COL_LENGTH('PC.WoItems', 'FromMonth') IS NULL ALTER TABLE PC.WoItems ADD FromMonth DATE NULL;
GO
IF COL_LENGTH('PC.WoItems', 'ToMonth') IS NULL ALTER TABLE PC.WoItems ADD ToMonth DATE NULL;
GO
SELECT COUNT(*) AS Items, SUM(CASE WHEN FromMonth IS NULL THEN 1 ELSE 0 END) AS FromBeginning FROM PC.WoItems;
GO
SET NOEXEC OFF;
GO
