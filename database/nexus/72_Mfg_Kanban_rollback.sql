-- rollback 72: drop schema Kanban and all its tables (Kanban data is lost; nothing else references them)
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;
GO
IF OBJECT_ID(N'Kanban.Receipts', N'U') IS NOT NULL DROP TABLE Kanban.Receipts;
IF OBJECT_ID(N'Kanban.Cards', N'U') IS NOT NULL DROP TABLE Kanban.Cards;
IF OBJECT_ID(N'Kanban.OrderSteps', N'U') IS NOT NULL DROP TABLE Kanban.OrderSteps;
IF OBJECT_ID(N'Kanban.Orders', N'U') IS NOT NULL DROP TABLE Kanban.Orders;
IF OBJECT_ID(N'Kanban.Scans', N'U') IS NOT NULL DROP TABLE Kanban.Scans;
IF OBJECT_ID(N'Kanban.Rules', N'U') IS NOT NULL DROP TABLE Kanban.Rules;
IF OBJECT_ID(N'Kanban.FlowSteps', N'U') IS NOT NULL DROP TABLE Kanban.FlowSteps;
IF OBJECT_ID(N'Kanban.Kanbans', N'U') IS NOT NULL DROP TABLE Kanban.Kanbans;
GO
IF SCHEMA_ID(N'Kanban') IS NOT NULL EXEC (N'DROP SCHEMA Kanban');
GO
