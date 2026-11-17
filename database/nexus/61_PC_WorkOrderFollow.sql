-- ============================================================================
-- 61_PC_WorkOrderFollow.sql  (CHR-Nexus only · additive: new schema PC + 5 tables, nothing existing is changed)
-- WORK ORDER FOLLOW: monthly production follow sheet per customer + work order (PL / OR / WO / ORDER / PROD D / PROD N / DEL x day 1-31)
-- Permission SystemID 'PC_WOF' is code-registered (User Management > permissions) - no row needed here.
-- Safe to re-run · undo: DROP TABLE PC.WoSigns, PC.WoCells, PC.WoItems, PC.WoEditors, PC.WoSheets (in that order)
-- ============================================================================
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
SET QUOTED_IDENTIFIER ON;
GO
IF SCHEMA_ID('PC') IS NULL EXEC('CREATE SCHEMA PC');
GO
IF OBJECT_ID('PC.WoSheets') IS NULL
CREATE TABLE PC.WoSheets (
    SheetID       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WoSheets PRIMARY KEY,
    MonthStart    DATE NOT NULL,
    CustomerCode  NVARCHAR(50)  NOT NULL,
    CustomerName  NVARCHAR(200) NOT NULL,
    WorkOrderNo   NVARCHAR(100) NOT NULL,
    OwnerUserID   NVARCHAR(50)  NOT NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_WoSheets_Created DEFAULT (SYSDATETIME()),
    UpdatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_WoSheets_Updated DEFAULT (SYSDATETIME()),
    IsDeleted     BIT NOT NULL CONSTRAINT DF_WoSheets_Deleted DEFAULT (0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WoSheets_Month' AND object_id = OBJECT_ID('PC.WoSheets'))
    CREATE INDEX IX_WoSheets_Month ON PC.WoSheets (MonthStart) WHERE IsDeleted = 0;
GO
IF OBJECT_ID('PC.WoEditors') IS NULL
CREATE TABLE PC.WoEditors (
    SheetID INT NOT NULL CONSTRAINT FK_WoEditors_Sheet FOREIGN KEY REFERENCES PC.WoSheets(SheetID),
    UserID  NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_WoEditors PRIMARY KEY (SheetID, UserID)
);
GO
IF OBJECT_ID('PC.WoItems') IS NULL
CREATE TABLE PC.WoItems (
    ItemID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WoItems PRIMARY KEY,
    SheetID    INT NOT NULL CONSTRAINT FK_WoItems_Sheet FOREIGN KEY REFERENCES PC.WoSheets(SheetID),
    SortNo     INT NOT NULL CONSTRAINT DF_WoItems_Sort DEFAULT (0),
    PartID     INT NULL CONSTRAINT FK_WoItems_Part FOREIGN KEY REFERENCES Nexus.Parts(PartID),
    IntCode    NVARCHAR(50)  NULL,
    PartName   NVARCHAR(200) NULL,
    PartNo     NVARCHAR(100) NULL,
    Material   NVARCHAR(100) NULL,
    PcsPerBox  INT NULL,
    BarColor   NVARCHAR(20)  NULL,
    Remark     NVARCHAR(500) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WoItems_Sheet' AND object_id = OBJECT_ID('PC.WoItems'))
    CREATE INDEX IX_WoItems_Sheet ON PC.WoItems (SheetID, SortNo);
GO
IF OBJECT_ID('PC.WoCells') IS NULL
CREATE TABLE PC.WoCells (
    ItemID INT NOT NULL CONSTRAINT FK_WoCells_Item FOREIGN KEY REFERENCES PC.WoItems(ItemID),
    RowKey VARCHAR(8) NOT NULL CONSTRAINT CK_WoCells_Row CHECK (RowKey IN ('PL','OR','WO','ORDER','PROD_D','PROD_N','DEL')),
    [Day]  TINYINT NOT NULL CONSTRAINT CK_WoCells_Day CHECK ([Day] BETWEEN 1 AND 31),
    Qty    DECIMAL(18,3) NOT NULL CONSTRAINT CK_WoCells_Qty CHECK (Qty >= 0),
    CONSTRAINT PK_WoCells PRIMARY KEY (ItemID, RowKey, [Day])
);
GO
IF OBJECT_ID('PC.WoSigns') IS NULL
CREATE TABLE PC.WoSigns (
    SheetID     INT NOT NULL CONSTRAINT FK_WoSigns_Sheet FOREIGN KEY REFERENCES PC.WoSheets(SheetID),
    [Role]      VARCHAR(10) NOT NULL CONSTRAINT CK_WoSigns_Role CHECK ([Role] IN ('PREPARE','CHECK','APPROVE')),
    RequestedTo NVARCHAR(50) NULL,
    RequestedBy NVARCHAR(50) NULL,
    RequestedAt DATETIME2(0) NULL,
    SignedBy    NVARCHAR(50) NULL,
    SignedAt    DATETIME2(0) NULL,
    CONSTRAINT PK_WoSigns PRIMARY KEY (SheetID, [Role])
);
GO
SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('PC') ORDER BY name;
GO
SET NOEXEC OFF;
GO
