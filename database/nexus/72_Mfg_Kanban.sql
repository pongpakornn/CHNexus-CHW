/* ============================================================================
   CHR-Nexus 72: MANUFACTURING › KANBAN CONTROL (schema Kanban)
   ----------------------------------------------------------------------------
   Kanbans    : Set Kanban (code unique · pcs per box · customer = Master.Customers) · FlowSteps = Set Flow (zone + update point per step)
   Scans      : accumulated quantity (sales scan history) · Rules = target per Kanban + AUTO receive
   Receipts   : quantity received and waiting for a production order (WAITING / ORDERED)
   Orders     : production order (STANDARD flow = Kanban flow · TEMP = own steps in OrderSteps) -> Cards = qty / pcs per box (rounded up)
   Permission SystemID 'MFG_KANBAN' is code-registered (User Management) - no row needed here.
   New schema + tables only · re-runnable · CHR-Nexus only (rollback: 72_Mfg_Kanban_rollback.sql)
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
IF SCHEMA_ID(N'Kanban') IS NULL EXEC (N'CREATE SCHEMA Kanban AUTHORIZATION dbo');
GO

IF OBJECT_ID(N'Kanban.Kanbans', N'U') IS NULL
    CREATE TABLE Kanban.Kanbans
    (
        KanbanID     INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Kanbans PRIMARY KEY,
        KanbanCode   NVARCHAR(50)  NOT NULL CONSTRAINT UX_Kanbans_Code UNIQUE,
        KanbanName   NVARCHAR(200) NOT NULL,
        CustomerCode NVARCHAR(50)  NULL,
        PerBox       INT           NOT NULL CONSTRAINT CK_Kanbans_PerBox CHECK (PerBox > 0),
        OrderQty     INT           NOT NULL CONSTRAINT CK_Kanbans_OrderQty CHECK (OrderQty > 0),
        Zone         NVARCHAR(50)  NULL,
        Note         NVARCHAR(300) NULL,
        CreatedBy    NVARCHAR(50)  NULL,
        CreatedDate  DATETIME      NOT NULL CONSTRAINT DF_Kanbans_Created DEFAULT (GETDATE()),
        UpdatedBy    NVARCHAR(50)  NULL,
        UpdatedDate  DATETIME      NOT NULL CONSTRAINT DF_Kanbans_Updated DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Kanban.FlowSteps', N'U') IS NULL
    CREATE TABLE Kanban.FlowSteps
    (
        KanbanID INT           NOT NULL CONSTRAINT FK_FlowSteps_Kanban REFERENCES Kanban.Kanbans (KanbanID) ON DELETE CASCADE,
        Seq      INT           NOT NULL,
        Zone     NVARCHAR(50)  NOT NULL,
        Point    NVARCHAR(100) NOT NULL,
        CONSTRAINT PK_FlowSteps PRIMARY KEY (KanbanID, Seq)
    );
GO

IF OBJECT_ID(N'Kanban.Rules', N'U') IS NULL
    CREATE TABLE Kanban.Rules
    (
        KanbanID    INT          NOT NULL CONSTRAINT PK_Rules PRIMARY KEY CONSTRAINT FK_Rules_Kanban REFERENCES Kanban.Kanbans (KanbanID) ON DELETE CASCADE,
        TargetQty   INT          NOT NULL CONSTRAINT CK_Rules_Target CHECK (TargetQty >= 0),
        AutoReceive BIT          NOT NULL CONSTRAINT DF_Rules_Auto DEFAULT (0),
        UpdatedBy   NVARCHAR(50) NULL,
        UpdatedDate DATETIME     NOT NULL CONSTRAINT DF_Rules_Updated DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Kanban.Scans', N'U') IS NULL
    CREATE TABLE Kanban.Scans
    (
        ScanID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Scans PRIMARY KEY,
        KanbanID  INT           NOT NULL CONSTRAINT FK_Scans_Kanban REFERENCES Kanban.Kanbans (KanbanID),
        Qty       INT           NOT NULL CONSTRAINT CK_Scans_Qty CHECK (Qty > 0),
        RefNo     NVARCHAR(50)  NULL,
        CreatedBy NVARCHAR(50)  NULL,
        CreatedAt DATETIME      NOT NULL CONSTRAINT DF_Scans_At DEFAULT (GETDATE())
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Scans_Kanban')
    CREATE INDEX IX_Scans_Kanban ON Kanban.Scans (KanbanID) INCLUDE (Qty);
GO

IF OBJECT_ID(N'Kanban.Orders', N'U') IS NULL
    CREATE TABLE Kanban.Orders
    (
        OrderID      INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
        KanbanID     INT           NOT NULL CONSTRAINT FK_Orders_Kanban REFERENCES Kanban.Kanbans (KanbanID),
        Qty          INT           NOT NULL CONSTRAINT CK_Orders_Qty CHECK (Qty > 0),
        PerBox       INT           NOT NULL,
        Cards        INT           NOT NULL,
        FlowMode     NVARCHAR(10)  NOT NULL CONSTRAINT CK_Orders_Flow CHECK (FlowMode IN (N'STANDARD', N'TEMP')),
        PlannedStart DATETIME      NULL,
        CreatedBy    NVARCHAR(50)  NULL,
        CreatedAt    DATETIME      NOT NULL CONSTRAINT DF_Orders_At DEFAULT (GETDATE())
    );
GO

IF OBJECT_ID(N'Kanban.OrderSteps', N'U') IS NULL
    CREATE TABLE Kanban.OrderSteps
    (
        OrderID INT           NOT NULL CONSTRAINT FK_OrderSteps_Order REFERENCES Kanban.Orders (OrderID) ON DELETE CASCADE,
        Seq     INT           NOT NULL,
        Zone    NVARCHAR(50)  NOT NULL,
        Point   NVARCHAR(100) NOT NULL,
        CONSTRAINT PK_OrderSteps PRIMARY KEY (OrderID, Seq)
    );
GO

IF OBJECT_ID(N'Kanban.Cards', N'U') IS NULL
    CREATE TABLE Kanban.Cards
    (
        CardID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Cards PRIMARY KEY,
        OrderID   INT          NOT NULL CONSTRAINT FK_Cards_Order REFERENCES Kanban.Orders (OrderID) ON DELETE CASCADE,
        Seq       INT          NOT NULL,
        StepIndex INT          NOT NULL CONSTRAINT DF_Cards_Step DEFAULT (0),
        Status    NVARCHAR(10) NOT NULL CONSTRAINT DF_Cards_Status DEFAULT (N'QUEUE') CONSTRAINT CK_Cards_Status CHECK (Status IN (N'QUEUE', N'RUNNING', N'DONE')),
        UpdatedAt DATETIME     NOT NULL CONSTRAINT DF_Cards_At DEFAULT (GETDATE()),
        CONSTRAINT UX_Cards_Order_Seq UNIQUE (OrderID, Seq)
    );
GO

IF OBJECT_ID(N'Kanban.Receipts', N'U') IS NULL
    CREATE TABLE Kanban.Receipts
    (
        ReceiptID  INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Receipts PRIMARY KEY,
        KanbanID   INT          NOT NULL CONSTRAINT FK_Receipts_Kanban REFERENCES Kanban.Kanbans (KanbanID),
        Qty        INT          NOT NULL CONSTRAINT CK_Receipts_Qty CHECK (Qty > 0),
        Status     NVARCHAR(10) NOT NULL CONSTRAINT DF_Receipts_Status DEFAULT (N'WAITING') CONSTRAINT CK_Receipts_Status CHECK (Status IN (N'WAITING', N'ORDERED')),
        OrderID    INT          NULL CONSTRAINT FK_Receipts_Order REFERENCES Kanban.Orders (OrderID),
        IsAuto     BIT          NOT NULL CONSTRAINT DF_Receipts_Auto DEFAULT (0),
        ReceivedBy NVARCHAR(50) NULL,
        ReceivedAt DATETIME     NOT NULL CONSTRAINT DF_Receipts_At DEFAULT (GETDATE())
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Receipts_Kanban')
    CREATE INDEX IX_Receipts_Kanban ON Kanban.Receipts (KanbanID) INCLUDE (Qty, Status);
GO
