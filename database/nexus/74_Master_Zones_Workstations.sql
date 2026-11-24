/* ============================================================================
   CHR-Nexus 74: MASTER DATA › ZONE & WORKSTATION INFORMATION
   ----------------------------------------------------------------------------
   Master.LineSideStores    : line-side stores (end point of a zone · pick list only for now, CIMS link later)
   Master.ProductionZones   : production zone (code unique) -> its line-side store
   Master.Workstations      : workstations of a zone (code unique) · optional machine (Master.Machines code) · operators per station
                              (one machine with 2 operator positions = 2 workstations on the same machine)
   Rights = MASTER DATA (code) · new tables only · re-runnable · CHR-Nexus only (rollback: 74_Master_Zones_Workstations_rollback.sql)
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
IF SCHEMA_ID(N'Master') IS NULL EXEC (N'CREATE SCHEMA Master AUTHORIZATION dbo');
GO

IF OBJECT_ID(N'Master.LineSideStores', N'U') IS NULL
    CREATE TABLE Master.LineSideStores
    (
        StoreID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_LineSideStores PRIMARY KEY,
        StoreCode   NVARCHAR(50)  NOT NULL CONSTRAINT UX_LineSideStores_Code UNIQUE,
        StoreName   NVARCHAR(200) NULL,
        Status      NVARCHAR(10)  NOT NULL CONSTRAINT DF_LineSideStores_Status DEFAULT (N'ACTIVE') CONSTRAINT CK_LineSideStores_Status CHECK (Status IN (N'ACTIVE', N'INACTIVE')),
        CreatedBy   NVARCHAR(50)  NULL,
        CreatedDate DATETIME      NOT NULL CONSTRAINT DF_LineSideStores_Created DEFAULT (GETDATE()),
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_LineSideStores_Updated DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Master.ProductionZones', N'U') IS NULL
    CREATE TABLE Master.ProductionZones
    (
        ZoneID      INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ProductionZones PRIMARY KEY,
        ZoneCode    NVARCHAR(50)  NOT NULL CONSTRAINT UX_ProductionZones_Code UNIQUE,
        ZoneName    NVARCHAR(200) NULL,
        StoreID     INT           NULL CONSTRAINT FK_ProductionZones_Store REFERENCES Master.LineSideStores (StoreID),
        Status      NVARCHAR(10)  NOT NULL CONSTRAINT DF_ProductionZones_Status DEFAULT (N'ACTIVE') CONSTRAINT CK_ProductionZones_Status CHECK (Status IN (N'ACTIVE', N'INACTIVE')),
        CreatedBy   NVARCHAR(50)  NULL,
        CreatedDate DATETIME      NOT NULL CONSTRAINT DF_ProductionZones_Created DEFAULT (GETDATE()),
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_ProductionZones_Updated DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Master.Workstations', N'U') IS NULL
    CREATE TABLE Master.Workstations
    (
        StationID   INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Workstations PRIMARY KEY,
        ZoneID      INT           NOT NULL CONSTRAINT FK_Workstations_Zone REFERENCES Master.ProductionZones (ZoneID),
        StationCode NVARCHAR(50)  NOT NULL CONSTRAINT UX_Workstations_Code UNIQUE,
        StationName NVARCHAR(200) NULL,
        MachineCode NVARCHAR(50)  NULL,
        Operators   INT           NOT NULL CONSTRAINT DF_Workstations_Operators DEFAULT (1) CONSTRAINT CK_Workstations_Operators CHECK (Operators BETWEEN 1 AND 99),
        Status      NVARCHAR(10)  NOT NULL CONSTRAINT DF_Workstations_Status DEFAULT (N'ACTIVE') CONSTRAINT CK_Workstations_Status CHECK (Status IN (N'ACTIVE', N'INACTIVE')),
        CreatedBy   NVARCHAR(50)  NULL,
        CreatedDate DATETIME      NOT NULL CONSTRAINT DF_Workstations_Created DEFAULT (GETDATE()),
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_Workstations_Updated DEFAULT (GETDATE())
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Workstations_Zone' AND object_id = OBJECT_ID(N'Master.Workstations'))
    CREATE INDEX IX_Workstations_Zone ON Master.Workstations (ZoneID);
GO
