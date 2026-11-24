-- rollback 75: drop Kanban card formulas (Kanbans fall back to ROUND UP by packing)
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO
IF OBJECT_ID(N'FK_Kanbans_Formula', N'F') IS NOT NULL ALTER TABLE Kanban.Kanbans DROP CONSTRAINT FK_Kanbans_Formula;
IF COL_LENGTH('Kanban.Kanbans', 'FormulaID') IS NOT NULL ALTER TABLE Kanban.Kanbans DROP COLUMN FormulaID;
IF OBJECT_ID(N'Kanban.Formulas', N'U') IS NOT NULL DROP TABLE Kanban.Formulas;
GO
