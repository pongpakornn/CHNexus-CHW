/* ============================================================================
   CHR-Nexus 75: KANBAN MANAGEMENT › card formulas (like Max-Min formulas)
   ----------------------------------------------------------------------------
   Kanban.Formulas        : standard formula = how an order qty becomes Kanban cards
                            CARDS = ROUND( QTY x (1 + ALLOWANCE % / 100) / PACKING ) · RoundMode UP / NEAREST / DOWN · at least 1 card
                            one default row (IsDefault = 1, cannot be deleted)
   Kanban.Kanbans         : + FormulaID (the formula the Kanban uses when ordered · NULL = default formula)
   OrderQty / Note stay (no longer edited in Kanban Management) · new tables / nullable column only
   Re-runnable · CHR-Nexus only (rollback: 75_Mfg_Kanban_Formula_rollback.sql)
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
    RAISERROR(N'Run 72_Mfg_Kanban.sql + 73_Mfg_Kanban_Part.sql first.', 16, 1);
    RETURN;
END;
GO

IF OBJECT_ID(N'Kanban.Formulas', N'U') IS NULL
    CREATE TABLE Kanban.Formulas
    (
        FormulaID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_KFormulas PRIMARY KEY,
        FormulaName  NVARCHAR(100) NOT NULL CONSTRAINT UX_KFormulas_Name UNIQUE,
        RoundMode    NVARCHAR(10)  NOT NULL CONSTRAINT DF_KFormulas_Round DEFAULT (N'UP') CONSTRAINT CK_KFormulas_Round CHECK (RoundMode IN (N'UP', N'NEAREST', N'DOWN')),
        AllowancePct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_KFormulas_Allow DEFAULT (0) CONSTRAINT CK_KFormulas_Allow CHECK (AllowancePct BETWEEN 0 AND 100),
        IsDefault    BIT           NOT NULL CONSTRAINT DF_KFormulas_Default DEFAULT (0),
        CreatedBy    NVARCHAR(50)  NULL,
        CreatedDate  DATETIME      NOT NULL CONSTRAINT DF_KFormulas_Created DEFAULT (GETDATE()),
        UpdatedBy    NVARCHAR(50)  NULL,
        UpdatedDate  DATETIME      NOT NULL CONSTRAINT DF_KFormulas_Updated DEFAULT (GETDATE())
    );
GO
IF NOT EXISTS (SELECT 1 FROM Kanban.Formulas WHERE IsDefault = 1)
    INSERT INTO Kanban.Formulas (FormulaName, RoundMode, AllowancePct, IsDefault, CreatedBy, UpdatedBy)
    VALUES (N'STANDARD (ROUND UP)', N'UP', 0, 1, N'SYSTEM', N'SYSTEM');
GO
IF COL_LENGTH('Kanban.Kanbans', 'FormulaID') IS NULL
    ALTER TABLE Kanban.Kanbans ADD FormulaID INT NULL CONSTRAINT FK_Kanbans_Formula REFERENCES Kanban.Formulas (FormulaID);
GO
