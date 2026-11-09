/* =====================================================================
   🏭 EDP PLANNING ใน CHR-Nexus (schema EDP)
   ---------------------------------------------------------------------
   - ตารางแผนผลิตของโปรแกรม EDP Systems ย้ายมาอยู่ที่ฐาน CHR-Nexus (ชื่อตาราง / คอลัมน์เดิม ใต้ schema EDP)
   - ชิ้นงาน (MST_PART) ไม่มีตารางของตัวเองแล้ว = VIEW เหนือ MASTER DATA › Product Control › STORE-PC (Nexus.Parts)
       PT_ID = Nexus.Parts.PartID · PT_CODE = PART A · PT_NO = PART NO · ค่า HG = ช่องเพิ่มเติมของ STORE-PC
       (HG TYPE · PCS/HG · HG QTY · CT (SEC) · STD TIME (MIN.))
   - ข้อมูลเดิมจาก EDP_SYSTEM คัดลอกมาครั้งเดียว (อ่านอย่างเดียว ไม่แก้ฐาน EDP_SYSTEM)
       · ชิ้นงานที่ยังไม่มีใน STORE-PC เพิ่มให้ (จับคู่ด้วย PART A = PT_CODE)
       · ค่า HG / น้ำหนัก เติมเฉพาะช่องที่ยังว่าง (ไม่ทับค่าที่มีอยู่แล้ว)
       · แผน / ประวัติแก้ไข / แม่แบบ / รอบ คัดลอกพร้อมเลขเดิม (PLD_ID / PLH_ID …)
   - รันซ้ำได้: สร้างเฉพาะที่ยังไม่มี · คัดลอกแผนเฉพาะตอน EDP.PlanHeaders ยังว่าง
   ---------------------------------------------------------------------
   ชื่อตาราง (เดิมใน EDP_SYSTEM -> CHR-Nexus):
     EDP.Rounds             รอบผลิต 1-6 (เวลาเริ่ม / จบ)                     <- MST_ROUND_CONFIG
     EDP.PlanHeaders        หัวแผน: วันที่ + กะ + สถานะ READY / IN PROGRESS / COMPLETED  <- TRN_PLAN_H
     EDP.PlanCards          การ์ดแผนผลิต: ชิ้นงาน · เวลา · แผน / ยอดจริง · DONE · ผลิตไม่ได้ <- TRN_PLAN_D
     EDP.PlanEditLogs       ประวัติแก้ไขการ์ดจากหน้างาน (ค่าเดิม -> ค่าใหม่ · หมายเหตุ)   <- TRN_PLAN_EDIT_LOG
     EDP.PlanTimeFixLogs    ประวัติแก้เวลา / รอบของการ์ด                        <- TRN_PLAN_D_TIMEFIX_LOG
     EDP.PlanTemplates      แม่แบบแผน (ชื่อ · กะ · รอบ)                         <- MST_PLAN_TEMPLATE
     EDP.PlanTemplateCards  การ์ดในแม่แบบ                                      <- MST_PLAN_TEMPLATE_D
     EDP.vw_Parts           (VIEW) ชิ้นงาน STORE-PC + ค่า HG                    <- MST_PART
     EDP.vw_PlanCards       (VIEW) การ์ด + รอบจริง (EFF_ROUND_ID)               <- vw_TRN_PLAN_D_EFF
     ชื่อคอลัมน์คงเดิม (PLD_ID, HG_PLAN …) ให้เทียบกับโปรแกรม EDP Windows ได้
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
GO
IF SCHEMA_ID('EDP') IS NULL EXEC('CREATE SCHEMA EDP');
GO

/* ---------------------------------------------------------------- ตาราง */
IF OBJECT_ID('EDP.Rounds', 'U') IS NULL
CREATE TABLE EDP.Rounds
(
    ROUND_ID   INT NOT NULL CONSTRAINT PK_EDP_ROUND PRIMARY KEY,
    START_HOUR INT NULL,
    END_HOUR   INT NULL
);

IF OBJECT_ID('EDP.PlanHeaders', 'U') IS NULL
CREATE TABLE EDP.PlanHeaders
(
    PLH_ID    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EDP_PLAN_H PRIMARY KEY,
    PLH_DATE  DATE          NOT NULL,
    SHIFT     NVARCHAR(10)  NULL,
    STAT      NVARCHAR(20)  NULL CONSTRAINT DF_EDP_PLAN_H_STAT DEFAULT ('READY'),
    CREATE_BY VARCHAR(20)   NULL,
    CREATE_AT DATETIME      NULL CONSTRAINT DF_EDP_PLAN_H_AT DEFAULT (GETDATE())
);

IF OBJECT_ID('EDP.PlanCards', 'U') IS NULL
CREATE TABLE EDP.PlanCards
(
    PLD_ID          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EDP_PLAN_D PRIMARY KEY,
    PLH_ID          INT            NULL,
    PT_ID           INT            NULL,      -- = Nexus.Parts.PartID (STORE-PC)
    TIME_START      VARCHAR(20)    NULL,
    TIME_END        VARCHAR(20)    NULL,
    QTY_PLAN        INT            NULL CONSTRAINT DF_EDP_D_QTY  DEFAULT (0),
    HG_PLAN         INT            NULL CONSTRAINT DF_EDP_D_HG   DEFAULT (0),
    QTY_ACT         INT            NULL CONSTRAINT DF_EDP_D_QACT DEFAULT (0),
    REMARK          NVARCHAR(MAX)  NULL,
    IS_DONE         BIT            NULL CONSTRAINT DF_EDP_D_DONE DEFAULT (0),
    QTY_DIFF        INT            NULL,
    OP_NAME         NVARCHAR(100)  NULL,
    CUR_STD_TIME_HG DECIMAL(10,2)  NULL CONSTRAINT DF_EDP_D_STD  DEFAULT (3.25),
    HG_ACT          INT            NULL,
    TOTAL_TIME_MIN  DECIMAL(10,2)  NULL,
    TIME_DIFF_MIN   FLOAT          NULL CONSTRAINT DF_EDP_D_TDIF DEFAULT (0),
    ACCUM_DIFF_MIN  FLOAT          NULL CONSTRAINT DF_EDP_D_ADIF DEFAULT (0),
    IS_VISIBLE      BIT        NOT NULL CONSTRAINT DF_EDP_D_VIS  DEFAULT (1),
    IS_PROBLEM      BIT        NOT NULL CONSTRAINT DF_EDP_D_PROB DEFAULT (0),
    ROUND_ID        INT            NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EDP_PLAN_D_PLH' AND object_id = OBJECT_ID('EDP.PlanCards'))
    CREATE INDEX IX_EDP_PLAN_D_PLH ON EDP.PlanCards (PLH_ID, ROUND_ID) INCLUDE (PT_ID, IS_DONE, IS_VISIBLE);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EDP_PLAN_H_DATE' AND object_id = OBJECT_ID('EDP.PlanHeaders'))
    CREATE UNIQUE INDEX IX_EDP_PLAN_H_DATE ON EDP.PlanHeaders (PLH_DATE, SHIFT);

IF OBJECT_ID('EDP.PlanEditLogs', 'U') IS NULL
CREATE TABLE EDP.PlanEditLogs
(
    LOG_ID       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EDP_EDIT_LOG PRIMARY KEY,
    PLD_ID       INT            NOT NULL,
    OLD_CUST     NVARCHAR(50)   NULL,
    OLD_PT_NO    NVARCHAR(100)  NULL,
    OLD_QTY_PLAN INT            NULL,
    OLD_HG_PLAN  INT            NULL,
    NEW_CUST     NVARCHAR(50)   NULL,
    NEW_PT_NO    NVARCHAR(100)  NULL,
    NEW_QTY_PLAN INT            NULL,
    NEW_HG_PLAN  INT            NULL,
    IS_PROBLEM   BIT            NOT NULL CONSTRAINT DF_EDP_LOG_PROB DEFAULT (0),
    REMARK       NVARCHAR(500)  NULL,
    EDIT_BY      NVARCHAR(50)   NULL,
    EDIT_DATE    DATETIME       NOT NULL CONSTRAINT DF_EDP_LOG_DATE DEFAULT (GETDATE())
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EDP_EDIT_LOG_PLD' AND object_id = OBJECT_ID('EDP.PlanEditLogs'))
    CREATE INDEX IX_EDP_EDIT_LOG_PLD ON EDP.PlanEditLogs (PLD_ID);

IF OBJECT_ID('EDP.PlanTimeFixLogs', 'U') IS NULL
CREATE TABLE EDP.PlanTimeFixLogs
(
    FIX_ID         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EDP_TIMEFIX PRIMARY KEY,
    PLD_ID         INT           NOT NULL,
    OLD_TIME_START NVARCHAR(50)  NULL,
    NEW_TIME_START NVARCHAR(50)  NULL,
    OLD_ROUND_ID   INT           NULL,
    NEW_ROUND_ID   INT           NULL,
    FIXED_AT       DATETIME      NOT NULL CONSTRAINT DF_EDP_TIMEFIX_AT DEFAULT (GETDATE())
);

IF OBJECT_ID('EDP.PlanTemplates', 'U') IS NULL
CREATE TABLE EDP.PlanTemplates
(
    TPL_ID    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EDP_TPL PRIMARY KEY,
    TPL_NAME  NVARCHAR(100) NOT NULL CONSTRAINT UQ_EDP_TPL_NAME UNIQUE,
    SHIFT     NVARCHAR(10)  NULL,
    ROUND_ID  INT           NULL,
    REMARK    NVARCHAR(300) NULL,
    CREATE_BY VARCHAR(20)   NULL,
    CREATE_AT DATETIME      NOT NULL CONSTRAINT DF_EDP_TPL_AT DEFAULT (GETDATE()),
    UPDATE_AT DATETIME      NULL
);

IF OBJECT_ID('EDP.PlanTemplateCards', 'U') IS NULL
CREATE TABLE EDP.PlanTemplateCards
(
    TPD_ID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EDP_TPL_D PRIMARY KEY,
    TPL_ID     INT          NOT NULL CONSTRAINT FK_EDP_TPL_D REFERENCES EDP.PlanTemplates (TPL_ID) ON DELETE CASCADE,
    SEQ        INT          NOT NULL CONSTRAINT DF_EDP_TPL_D_SEQ DEFAULT (0),
    PT_ID      INT          NULL,      -- = Nexus.Parts.PartID (ว่าง = ช่องเวลาอย่างเดียว)
    TIME_START VARCHAR(20)  NULL,
    TIME_END   VARCHAR(20)  NULL,
    QTY_PLAN   INT          NULL,
    HG_PLAN    INT          NULL,
    IS_VISIBLE BIT          NOT NULL CONSTRAINT DF_EDP_TPL_D_VIS DEFAULT (1),
    ROUND_ID   INT          NULL
);
GO

/* ---------------------------------------------------------------- ชิ้นงาน = STORE-PC (Nexus.Parts + ช่องเพิ่มเติม) */
CREATE OR ALTER VIEW EDP.vw_Parts
AS
SELECT P.PartID                       AS PT_ID,
       P.Category                     AS PT_CAT,
       P.Customer                     AS CUST_CODE,
       P.ImageFileName                AS PT_IMG,
       P.PartA                        AS PT_CODE,
       P.PartNumber                   AS PT_NO,
       P.Description                  AS PT_NAME,
       F.HG_TYPE,
       F.PCS_HG,
       F.QTY_HG,
       F.STD_CT,
       P.WeightKG                     AS STD_WT,
       ISNULL(F.STD_TIME_HG, 3.25)    AS STD_TIME_HG,
       F.PCS_HG * F.QTY_HG            AS TOTAL_PCS,
       CAST(ISNULL(P.IsActive, 1) AS BIT) AS IS_ACTIVE
FROM Nexus.Parts P
JOIN Nexus.PartStocks S ON S.PartID = P.PartID
JOIN Nexus.Stocks K     ON K.StockID = S.StockID AND K.StockCode = 'STORE-PC'
OUTER APPLY (
    SELECT MAX(CASE WHEN D.Label = 'HG TYPE'         THEN V.Value END)                                 AS HG_TYPE,
           MAX(CASE WHEN D.Label = 'PCS/HG'          THEN TRY_CAST(V.Value AS INT) END)                AS PCS_HG,
           MAX(CASE WHEN D.Label = 'HG QTY'          THEN TRY_CAST(V.Value AS INT) END)                AS QTY_HG,
           MAX(CASE WHEN D.Label = 'CT (SEC)'        THEN TRY_CAST(V.Value AS DECIMAL(10,2)) END)      AS STD_CT,
           MAX(CASE WHEN D.Label = 'STD TIME (MIN.)' THEN TRY_CAST(V.Value AS DECIMAL(10,2)) END)      AS STD_TIME_HG
    FROM Nexus.PartFieldDefs D
    JOIN Nexus.PartFieldValues V ON V.FieldID = D.FieldID AND V.PartID = P.PartID
    WHERE D.StockID = K.StockID
) F;
GO

/* รอบจริงของการ์ด (การ์ดเก่าที่ไม่มี ROUND_ID = คิดจากชั่วโมงของเวลาเริ่ม) */
CREATE OR ALTER VIEW EDP.vw_PlanCards
AS
SELECT D.PLD_ID, D.PLH_ID, D.PT_ID, D.TIME_START, D.TIME_END, D.QTY_PLAN, D.HG_PLAN, D.QTY_ACT, D.HG_ACT,
       D.IS_DONE, D.IS_VISIBLE, D.IS_PROBLEM, D.REMARK, D.ROUND_ID, D.OP_NAME, D.CUR_STD_TIME_HG, D.TOTAL_TIME_MIN,
       EFF_ROUND_ID =
           CASE WHEN EXISTS (SELECT 1 FROM EDP.Rounds R WHERE R.ROUND_ID = D.ROUND_ID) THEN D.ROUND_ID
                ELSE (SELECT TOP 1 R2.ROUND_ID FROM EDP.Rounds R2
                       WHERE TRY_CAST(LEFT(D.TIME_START, 2) AS INT) % 24 >= R2.START_HOUR
                         AND TRY_CAST(LEFT(D.TIME_START, 2) AS INT) % 24 <  R2.END_HOUR
                       ORDER BY R2.ROUND_ID)
           END
FROM EDP.PlanCards D;
GO

/* ---------------------------------------------------------------- คัดลอกข้อมูลเดิมจาก EDP_SYSTEM (ครั้งเดียว) */
IF DB_ID('EDP_SYSTEM') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM EDP.PlanHeaders)
BEGIN
    BEGIN TRAN;

    DECLARE @pc INT = (SELECT StockID FROM Nexus.Stocks WHERE StockCode = 'STORE-PC');
    IF @pc IS NULL THROW 50001, N'ไม่พบคลัง STORE-PC', 1;

    -- รอบผลิต
    INSERT INTO EDP.Rounds (ROUND_ID, START_HOUR, END_HOUR)
    SELECT R.ROUND_ID, R.START_HOUR, R.END_HOUR FROM EDP_SYSTEM.dbo.MST_ROUND_CONFIG R
    WHERE NOT EXISTS (SELECT 1 FROM EDP.Rounds X WHERE X.ROUND_ID = R.ROUND_ID);

    -- 1) ชิ้นงานที่ยังไม่มีใน STORE-PC (จับคู่ PART A = PT_CODE) -> เพิ่มเข้า Product Control › STORE-PC
    DECLARE @new TABLE (PartID INT, PT_CODE VARCHAR(50));
    INSERT INTO Nexus.Parts (PartCode, Category, Description, Customer, PartA, PartNumber, ImageFileName, WeightKG, IsActive, IsShowInMaster)
    OUTPUT INSERTED.PartID, INSERTED.PartA INTO @new (PartID, PT_CODE)
    SELECT '-', M.PT_CAT, M.PT_NAME, M.CUST_CODE, M.PT_CODE, M.PT_NO, NULLIF(M.PT_IMG, ''), M.STD_WT, 1, 1
    FROM EDP_SYSTEM.dbo.MST_PART M
    WHERE NULLIF(M.PT_CODE, '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM Nexus.Parts P JOIN Nexus.PartStocks S ON S.PartID = P.PartID AND S.StockID = @pc
                      WHERE P.PartA = M.PT_CODE);
    INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity, BoxQuantity, IsShow)
    SELECT @pc, N.PartID, 0, 0, 1 FROM @new N;

    -- ตารางจับคู่ EDP PT_ID -> Nexus PartID
    DECLARE @map TABLE (OLD_ID INT PRIMARY KEY, PartID INT);
    INSERT INTO @map (OLD_ID, PartID)
    SELECT M.PT_ID, MIN(P.PartID)
    FROM EDP_SYSTEM.dbo.MST_PART M
    JOIN Nexus.Parts P ON P.PartA = M.PT_CODE
    JOIN Nexus.PartStocks S ON S.PartID = P.PartID AND S.StockID = @pc
    GROUP BY M.PT_ID;

    -- 2) ค่า HG / CT / STD TIME -> ช่องเพิ่มเติมของ STORE-PC (เติมเฉพาะที่ยังว่าง)
    ;WITH src AS (
        SELECT X.PartID, D.FieldID,
               CASE D.Label
                    WHEN 'HG TYPE'         THEN NULLIF(LTRIM(RTRIM(M.HG_TYPE)), '')
                    WHEN 'PCS/HG'          THEN CONVERT(NVARCHAR(50), M.PCS_HG)
                    WHEN 'HG QTY'          THEN CONVERT(NVARCHAR(50), M.QTY_HG)
                    WHEN 'CT (SEC)'        THEN CONVERT(NVARCHAR(50), CAST(M.STD_CT AS FLOAT))
                    WHEN 'STD TIME (MIN.)' THEN CONVERT(NVARCHAR(50), CAST(M.STD_TIME_HG AS FLOAT))
               END AS Val
        FROM @map X
        JOIN EDP_SYSTEM.dbo.MST_PART M ON M.PT_ID = X.OLD_ID
        CROSS JOIN Nexus.PartFieldDefs D
        WHERE D.StockID = @pc AND D.Label IN ('HG TYPE', 'PCS/HG', 'HG QTY', 'CT (SEC)', 'STD TIME (MIN.)')
    ), one AS (SELECT PartID, FieldID, MAX(Val) AS Val FROM src WHERE Val IS NOT NULL GROUP BY PartID, FieldID)
    INSERT INTO Nexus.PartFieldValues (FieldID, PartID, Value, UpdatedBy)
    SELECT o.FieldID, o.PartID, o.Val, 'EDP-IMPORT' FROM one o
    WHERE NOT EXISTS (SELECT 1 FROM Nexus.PartFieldValues V WHERE V.FieldID = o.FieldID AND V.PartID = o.PartID);

    UPDATE P SET WeightKG = M.STD_WT
    FROM Nexus.Parts P JOIN @map X ON X.PartID = P.PartID JOIN EDP_SYSTEM.dbo.MST_PART M ON M.PT_ID = X.OLD_ID
    WHERE P.WeightKG IS NULL AND M.STD_WT IS NOT NULL;

    -- 3) หัวแผน / การ์ด (เลขเดิม · PT_ID = Nexus PartID)
    SET IDENTITY_INSERT EDP.PlanHeaders ON;
    INSERT INTO EDP.PlanHeaders (PLH_ID, PLH_DATE, SHIFT, STAT, CREATE_BY, CREATE_AT)
    SELECT PLH_ID, PLH_DATE, SHIFT, STAT, CREATE_BY, CREATE_AT FROM EDP_SYSTEM.dbo.TRN_PLAN_H;
    SET IDENTITY_INSERT EDP.PlanHeaders OFF;

    SET IDENTITY_INSERT EDP.PlanCards ON;
    INSERT INTO EDP.PlanCards (PLD_ID, PLH_ID, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, QTY_ACT, REMARK, IS_DONE, QTY_DIFF, OP_NAME,
                                CUR_STD_TIME_HG, HG_ACT, TOTAL_TIME_MIN, TIME_DIFF_MIN, ACCUM_DIFF_MIN, IS_VISIBLE, IS_PROBLEM, ROUND_ID)
    SELECT D.PLD_ID, D.PLH_ID, X.PartID, D.TIME_START, D.TIME_END, D.QTY_PLAN, D.HG_PLAN, D.QTY_ACT, D.REMARK, D.IS_DONE, D.QTY_DIFF, D.OP_NAME,
           D.CUR_STD_TIME_HG, D.HG_ACT, D.TOTAL_TIME_MIN, D.TIME_DIFF_MIN, D.ACCUM_DIFF_MIN, D.IS_VISIBLE, D.IS_PROBLEM, D.ROUND_ID
    FROM EDP_SYSTEM.dbo.TRN_PLAN_D D LEFT JOIN @map X ON X.OLD_ID = D.PT_ID;
    SET IDENTITY_INSERT EDP.PlanCards OFF;

    SET IDENTITY_INSERT EDP.PlanEditLogs ON;
    INSERT INTO EDP.PlanEditLogs (LOG_ID, PLD_ID, OLD_CUST, OLD_PT_NO, OLD_QTY_PLAN, OLD_HG_PLAN, NEW_CUST, NEW_PT_NO, NEW_QTY_PLAN, NEW_HG_PLAN, IS_PROBLEM, REMARK, EDIT_BY, EDIT_DATE)
    SELECT LOG_ID, PLD_ID, OLD_CUST, OLD_PT_NO, OLD_QTY_PLAN, OLD_HG_PLAN, NEW_CUST, NEW_PT_NO, NEW_QTY_PLAN, NEW_HG_PLAN, IS_PROBLEM, REMARK, EDIT_BY, EDIT_DATE
    FROM EDP_SYSTEM.dbo.TRN_PLAN_EDIT_LOG;
    SET IDENTITY_INSERT EDP.PlanEditLogs OFF;

    SET IDENTITY_INSERT EDP.PlanTimeFixLogs ON;
    INSERT INTO EDP.PlanTimeFixLogs (FIX_ID, PLD_ID, OLD_TIME_START, NEW_TIME_START, OLD_ROUND_ID, NEW_ROUND_ID, FIXED_AT)
    SELECT FIX_ID, PLD_ID, OLD_TIME_START, NEW_TIME_START, OLD_ROUND_ID, NEW_ROUND_ID, FIXED_AT FROM EDP_SYSTEM.dbo.TRN_PLAN_D_TIMEFIX_LOG;
    SET IDENTITY_INSERT EDP.PlanTimeFixLogs OFF;

    SET IDENTITY_INSERT EDP.PlanTemplates ON;
    INSERT INTO EDP.PlanTemplates (TPL_ID, TPL_NAME, SHIFT, ROUND_ID, REMARK, CREATE_BY, CREATE_AT, UPDATE_AT)
    SELECT TPL_ID, TPL_NAME, SHIFT, ROUND_ID, REMARK, CREATE_BY, CREATE_AT, UPDATE_AT FROM EDP_SYSTEM.dbo.MST_PLAN_TEMPLATE;
    SET IDENTITY_INSERT EDP.PlanTemplates OFF;

    SET IDENTITY_INSERT EDP.PlanTemplateCards ON;
    INSERT INTO EDP.PlanTemplateCards (TPD_ID, TPL_ID, SEQ, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, IS_VISIBLE, ROUND_ID)
    SELECT T.TPD_ID, T.TPL_ID, T.SEQ, X.PartID, T.TIME_START, T.TIME_END, T.QTY_PLAN, T.HG_PLAN, T.IS_VISIBLE, NULL
    FROM EDP_SYSTEM.dbo.MST_PLAN_TEMPLATE_D T LEFT JOIN @map X ON X.OLD_ID = T.PT_ID;
    SET IDENTITY_INSERT EDP.PlanTemplateCards OFF;

    COMMIT;

    SELECT (SELECT COUNT(*) FROM @new) AS NewStorePcParts,
           (SELECT COUNT(*) FROM EDP.PlanHeaders) AS PlanHeaders,
           (SELECT COUNT(*) FROM EDP.PlanCards) AS PlanCards,
           (SELECT COUNT(*) FROM EDP.PlanCards WHERE PT_ID IS NULL) AS CardsWithoutPart;
END
ELSE IF NOT EXISTS (SELECT 1 FROM EDP.Rounds)
    -- ไม่มีฐาน EDP_SYSTEM ให้คัดลอก: รอบมาตรฐาน 1-6
    INSERT INTO EDP.Rounds (ROUND_ID, START_HOUR, END_HOUR)
    VALUES (1, 8, 12), (2, 12, 16), (3, 16, 20), (4, 20, 24), (5, 0, 4), (6, 4, 8);
GO
