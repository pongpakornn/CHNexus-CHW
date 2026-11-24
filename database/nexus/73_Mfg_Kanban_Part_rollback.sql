-- rollback 73: drop the part columns of Kanban.Kanbans (the Kanbans stay; PART A / PART NO values are lost)
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO
IF COL_LENGTH('Kanban.Kanbans', 'PartNo') IS NOT NULL ALTER TABLE Kanban.Kanbans DROP COLUMN PartNo;
IF COL_LENGTH('Kanban.Kanbans', 'PartA') IS NOT NULL ALTER TABLE Kanban.Kanbans DROP COLUMN PartA;
IF COL_LENGTH('Kanban.Kanbans', 'PartID') IS NOT NULL ALTER TABLE Kanban.Kanbans DROP COLUMN PartID;
GO
