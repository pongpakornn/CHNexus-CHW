-- ============================================================================
-- 62_PC_WorkOrderFollow_v2.sql  (CHR-Nexus only · replaces the v1 tables of 61 (2 owner test rows only) with the v2 plan model)
-- PC.WoPlans (owner + customer) · WoEditors · WoItems (parts persist across months) · WoMonths (W/O no + status per month)
-- WoCells (+MonthStart) · PC.Flows (approval steps, several users per step = any can sign) · WoApprovals (plan + month + step)
-- v1 tables are dropped ONLY while PC.WoSheets (v1 marker) exists -> safe to re-run after v2 exists.
-- Undo: DROP the 7 v2 tables (WoApprovals, WoCells, WoMonths, WoItems, WoEditors, WoPlans, Flows); v1 would need 61 re-run (data not restored).
-- ============================================================================
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
USE [CHR-Nexus];
GO
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('PC.WoSheets') IS NOT NULL
BEGIN
    DROP TABLE IF EXISTS PC.WoCells;
    DROP TABLE IF EXISTS PC.WoSigns;
    DROP TABLE IF EXISTS PC.WoItems;
    DROP TABLE IF EXISTS PC.WoEditors;
    DROP TABLE PC.WoSheets;
END
GO
IF SCHEMA_ID('PC') IS NULL EXEC('CREATE SCHEMA PC');
GO
IF OBJECT_ID('PC.WoPlans') IS NULL
CREATE TABLE PC.WoPlans (
    PlanID       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WoPlans PRIMARY KEY,
    OwnerUserID  NVARCHAR(50)  NOT NULL,
    CustomerCode NVARCHAR(50)  NOT NULL,
    CustomerName NVARCHAR(200) NULL,
    CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_WoPlans_Created DEFAULT (SYSDATETIME()),
    UpdatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_WoPlans_Updated DEFAULT (SYSDATETIME()),
    IsDeleted    BIT NOT NULL CONSTRAINT DF_WoPlans_Deleted DEFAULT (0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WoPlans_OwnerCustomer' AND object_id = OBJECT_ID('PC.WoPlans'))
    CREATE UNIQUE INDEX UX_WoPlans_OwnerCustomer ON PC.WoPlans (OwnerUserID, CustomerCode) WHERE IsDeleted = 0;
GO
IF OBJECT_ID('PC.WoEditors') IS NULL
CREATE TABLE PC.WoEditors (
    PlanID INT NOT NULL CONSTRAINT FK_WoEditors_Plan FOREIGN KEY REFERENCES PC.WoPlans(PlanID),
    UserID NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_WoEditors PRIMARY KEY (PlanID, UserID)
);
GO
IF OBJECT_ID('PC.WoItems') IS NULL
CREATE TABLE PC.WoItems (
    ItemID        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WoItems PRIMARY KEY,
    PlanID        INT NOT NULL CONSTRAINT FK_WoItems_Plan FOREIGN KEY REFERENCES PC.WoPlans(PlanID),
    SortNo        INT NOT NULL CONSTRAINT DF_WoItems_Sort DEFAULT (0),
    PartID        INT NULL CONSTRAINT FK_WoItems_Part FOREIGN KEY REFERENCES Nexus.Parts(PartID),
    PartCode      NVARCHAR(100) NULL,
    PartA         NVARCHAR(100) NULL,
    PartB         NVARCHAR(100) NULL,
    PartNo        NVARCHAR(100) NULL,
    PartName      NVARCHAR(200) NULL,
    PackSize      INT NULL,
    ImageFileName NVARCHAR(260) NULL,
    Remark        NVARCHAR(500) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WoItems_Plan' AND object_id = OBJECT_ID('PC.WoItems'))
    CREATE INDEX IX_WoItems_Plan ON PC.WoItems (PlanID, SortNo);
GO
IF OBJECT_ID('PC.WoMonths') IS NULL
CREATE TABLE PC.WoMonths (
    PlanID      INT NOT NULL CONSTRAINT FK_WoMonths_Plan FOREIGN KEY REFERENCES PC.WoPlans(PlanID),
    MonthStart  DATE NOT NULL,
    WorkOrderNo NVARCHAR(100) NOT NULL CONSTRAINT DF_WoMonths_Wo DEFAULT (N''),
    [Status]    VARCHAR(10) NOT NULL CONSTRAINT DF_WoMonths_Status DEFAULT ('DRAFT') CONSTRAINT CK_WoMonths_Status CHECK ([Status] IN ('DRAFT','SENT','APPROVED','REJECTED')),
    SentBy      NVARCHAR(50) NULL,
    SentAt      DATETIME2(0) NULL,
    CONSTRAINT PK_WoMonths PRIMARY KEY (PlanID, MonthStart)
);
GO
IF OBJECT_ID('PC.WoCells') IS NULL
CREATE TABLE PC.WoCells (
    ItemID     INT NOT NULL CONSTRAINT FK_WoCells_Item FOREIGN KEY REFERENCES PC.WoItems(ItemID),
    MonthStart DATE NOT NULL,
    RowKey     VARCHAR(8) NOT NULL CONSTRAINT CK_WoCells_Row CHECK (RowKey IN ('PL','OR','WO','ORDER','PROD_D','PROD_N','DEL')),
    [Day]      TINYINT NOT NULL CONSTRAINT CK_WoCells_Day CHECK ([Day] BETWEEN 1 AND 31),
    Qty        DECIMAL(18,3) NOT NULL CONSTRAINT CK_WoCells_Qty CHECK (Qty >= 0),
    CONSTRAINT PK_WoCells PRIMARY KEY (ItemID, MonthStart, RowKey, [Day])
);
GO
IF OBJECT_ID('PC.Flows') IS NULL
CREATE TABLE PC.Flows (
    FlowKey VARCHAR(20)  NOT NULL,
    StepNo  INT          NOT NULL,
    Title   NVARCHAR(100) NOT NULL,
    UserID  NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Flows PRIMARY KEY (FlowKey, StepNo, UserID)
);
GO
IF OBJECT_ID('PC.WoApprovals') IS NULL
CREATE TABLE PC.WoApprovals (
    PlanID     INT NOT NULL,
    MonthStart DATE NOT NULL,
    StepNo     INT NOT NULL,
    [Status]   VARCHAR(10) NOT NULL CONSTRAINT DF_WoApprovals_Status DEFAULT ('PENDING') CONSTRAINT CK_WoApprovals_Status CHECK ([Status] IN ('PENDING','SIGNED','REJECTED')),
    SignedBy   NVARCHAR(50) NULL,
    SignedAt   DATETIME2(0) NULL,
    Remark     NVARCHAR(500) NULL,
    CONSTRAINT PK_WoApprovals PRIMARY KEY (PlanID, MonthStart, StepNo),
    CONSTRAINT FK_WoApprovals_Month FOREIGN KEY (PlanID, MonthStart) REFERENCES PC.WoMonths(PlanID, MonthStart)
);
GO
SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('PC') ORDER BY name;
GO
SET NOEXEC OFF;
GO
