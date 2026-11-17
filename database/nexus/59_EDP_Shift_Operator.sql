-- ============================================================================
-- 59_EDP_Shift_Operator.sql  (CHR-Nexus only · adds 1 table, nothing deleted)
-- EDP.ShiftOperators = OPERATOR (employee code) who started each shift (DAY / NIGHT) of a plan date
-- Safe to re-run · undo: DROP TABLE EDP.ShiftOperators
-- ============================================================================
SET NOCOUNT ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
IF OBJECT_ID('EDP.ShiftOperators', 'U') IS NULL
    CREATE TABLE EDP.ShiftOperators (
        PLAN_DATE     DATE          NOT NULL,
        SHIFT         VARCHAR(5)    NOT NULL,
        OPERATOR_CODE NVARCHAR(30)  NOT NULL,
        SAVED_BY      NVARCHAR(50)  NULL,
        SAVED_AT      DATETIME      NOT NULL CONSTRAINT DF_ShiftOperators_At DEFAULT (GETDATE()),
        CONSTRAINT PK_ShiftOperators PRIMARY KEY (PLAN_DATE, SHIFT)
    );
GO
SELECT COUNT(*) AS ShiftOperators FROM EDP.ShiftOperators;
GO
SET NOEXEC OFF;
GO
