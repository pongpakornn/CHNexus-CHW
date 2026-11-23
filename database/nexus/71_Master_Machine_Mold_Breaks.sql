/* ============================================================================
   CHR-Nexus 71: MASTER DATA › Machine Information · Mold Information · Company break times
   ----------------------------------------------------------------------------
   Master.Machines      : one row per machine (code unique) · grouped by MachineType
   Master.Molds         : one row per mold (code unique) · OwnerType CUSTOMER (CustomerCode = Master.Customers) / COMPANY
   Master.CompanyBreaks : company break / pause times per shift (production time counting stops here)
   New tables only · re-runnable · CHR-Nexus database only (rollback: 71_..._rollback.sql)
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO

IF OBJECT_ID(N'Master.Machines', N'U') IS NULL
    CREATE TABLE Master.Machines
    (
        MachineID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Machines PRIMARY KEY,
        MachineCode   NVARCHAR(50)  NOT NULL CONSTRAINT UX_Machines_Code UNIQUE,
        MachineName   NVARCHAR(200) NULL,
        MachineType   NVARCHAR(50)  NOT NULL,
        MachineZone   NVARCHAR(50)  NULL,
        SetupMin      DECIMAL(9, 2) NULL,          -- STD setup time (min)
        ChangeMoldMin DECIMAL(9, 2) NULL,          -- change mold time (min)
        SpeedSph      INT           NULL,          -- machine speed (stroke / hr)
        Status        NVARCHAR(10)  NOT NULL CONSTRAINT DF_Machines_Status DEFAULT (N'ACTIVE')
                      CONSTRAINT CK_Machines_Status CHECK (Status IN (N'ACTIVE', N'INACTIVE')),
        CreatedBy     NVARCHAR(50)  NULL,
        CreatedDate   DATETIME      NOT NULL CONSTRAINT DF_Machines_Created DEFAULT (GETDATE()),
        UpdatedBy     NVARCHAR(50)  NULL,
        UpdatedDate   DATETIME      NOT NULL CONSTRAINT DF_Machines_Updated DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Master.Molds', N'U') IS NULL
    CREATE TABLE Master.Molds
    (
        MoldID         INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Molds PRIMARY KEY,
        MoldCode       NVARCHAR(50)  NOT NULL CONSTRAINT UX_Molds_Code UNIQUE,
        MoldName       NVARCHAR(200) NULL,
        OwnerType      NVARCHAR(10)  NOT NULL CONSTRAINT CK_Molds_Owner CHECK (OwnerType IN (N'CUSTOMER', N'COMPANY')),
        CustomerCode   NVARCHAR(50)  NULL,         -- Master.Customers.CustomerCode (NULL = company mold)
        MoldZone       NVARCHAR(50)  NULL,
        PartsPerStroke INT           NULL,         -- pcs per stroke (replaces Cavity)
        Status         NVARCHAR(10)  NOT NULL CONSTRAINT DF_Molds_Status DEFAULT (N'ACTIVE')
                       CONSTRAINT CK_Molds_Status CHECK (Status IN (N'ACTIVE', N'REPAIR', N'INACTIVE')),
        CreatedBy      NVARCHAR(50)  NULL,
        CreatedDate    DATETIME      NOT NULL CONSTRAINT DF_Molds_Created DEFAULT (GETDATE()),
        UpdatedBy      NVARCHAR(50)  NULL,
        UpdatedDate    DATETIME      NOT NULL CONSTRAINT DF_Molds_Updated DEFAULT (GETDATE()),
        CONSTRAINT CK_Molds_Customer CHECK ((OwnerType = N'CUSTOMER' AND CustomerCode IS NOT NULL) OR (OwnerType = N'COMPANY' AND CustomerCode IS NULL))
    );
GO

IF OBJECT_ID(N'Master.CompanyBreaks', N'U') IS NULL
    CREATE TABLE Master.CompanyBreaks
    (
        BreakID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_CompanyBreaks PRIMARY KEY,
        BreakName   NVARCHAR(100) NOT NULL,
        Shift       NVARCHAR(5)   NOT NULL CONSTRAINT CK_CompanyBreaks_Shift CHECK (Shift IN (N'DAY', N'NIGHT', N'ALL')),
        StartTime   TIME(0)       NOT NULL,
        EndTime     TIME(0)       NOT NULL,        -- EndTime <= StartTime = crosses midnight
        IsActive    BIT           NOT NULL CONSTRAINT DF_CompanyBreaks_Active DEFAULT (1),
        CreatedBy   NVARCHAR(50)  NULL,
        CreatedDate DATETIME      NOT NULL CONSTRAINT DF_CompanyBreaks_Created DEFAULT (GETDATE()),
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_CompanyBreaks_Updated DEFAULT (GETDATE()),
        CONSTRAINT CK_CompanyBreaks_Time CHECK (StartTime <> EndTime)
    );
GO
