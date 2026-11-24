/* ============================================================================
   CHR-Nexus 73: KANBAN MANAGEMENT › part of the Kanban (Part Information = Nexus.Parts)
   ----------------------------------------------------------------------------
   Kanban.Kanbans + PartID / PartA / PartNo (KanbanName keeps the Product Name)
   PartID points at Nexus.Parts (no FK: a part deleted later keeps the Kanban and its copied PART A / PART NO / name)
   Nullable columns only · re-runnable · CHR-Nexus only (rollback: 73_Mfg_Kanban_Part_rollback.sql)
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
IF OBJECT_ID(N'Kanban.Kanbans', N'U') IS NULL
BEGIN
    RAISERROR(N'Run 72_Mfg_Kanban.sql first.', 16, 1);
    RETURN;
END;
GO
IF COL_LENGTH('Kanban.Kanbans', 'PartID') IS NULL ALTER TABLE Kanban.Kanbans ADD PartID INT NULL;
IF COL_LENGTH('Kanban.Kanbans', 'PartA') IS NULL ALTER TABLE Kanban.Kanbans ADD PartA NVARCHAR(50) NULL;
IF COL_LENGTH('Kanban.Kanbans', 'PartNo') IS NULL ALTER TABLE Kanban.Kanbans ADD PartNo NVARCHAR(100) NULL;
GO
