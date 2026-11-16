-- ============================================================================
-- 51_EDP_Parts_Prefer_HG.sql  (CHR-Nexus only · does not touch EDP_SYSTEM / StorePC / CIMS · no data change)
-- Part in both EDP stocks (STORE-FG + STORE-SUB): vw_Parts used to always take the first stock (SortNo),
-- so a part whose HG values live only in the other stock (e.g. VOLVO 22641880) showed no HG and was hidden in EDP.
-- Now: the stock that has PCS/HG or HG QTY wins; SortNo still decides when both / neither have HG.
-- Step 1 = check the part (read only) · Step 2 = ALTER VIEW · safe to re-run
-- ============================================================================
SET NOCOUNT ON;
USE [CHR-Nexus];
GO
-- wrong DB = stop every batch below (THROW alone only stops its own batch)
IF DB_NAME() <> 'CHR-Nexus' BEGIN RAISERROR(N'Run on CHR-Nexus - nothing was changed', 16, 1); SET NOEXEC ON; END
GO
-- 1) Check: which EDP stocks hold 22641880 and their HG values (before the change)
SELECT P.PartID, P.Customer, P.PartNumber, P.PartA, P.PartB, P.IsActive, X.StockID, X.PartCol, X.SortNo, D.Label, V.Value
FROM Nexus.Parts P
JOIN Nexus.PartStocks S ON S.PartID = P.PartID
JOIN EDP.PartStocks X ON X.StockID = S.StockID
LEFT JOIN Nexus.PartFieldDefs D ON D.StockID = X.StockID AND D.Label IN ('HG TYPE', 'PCS/HG', 'HG QTY', 'CT (SEC)')
LEFT JOIN Nexus.PartFieldValues V ON V.FieldID = D.FieldID AND V.PartID = P.PartID
WHERE P.PartNumber LIKE '%22641880%' OR P.PartA LIKE '%22641880%' OR P.PartB LIKE '%22641880%'
ORDER BY P.PartID, X.SortNo, D.Label;
GO
-- 2) View: prefer the EDP stock that has HG values
CREATE OR ALTER VIEW EDP.vw_Parts
AS
SELECT P.PartID                       AS PT_ID,
       P.Category                     AS PT_CAT,
       P.Customer                     AS CUST_CODE,
       P.ImageFileName                AS PT_IMG,
       CASE E.PartCol WHEN 'PARTB' THEN P.PartB ELSE P.PartA END AS PT_CODE,
       P.PartNumber                   AS PT_NO,
       P.Description                  AS PT_NAME,
       F.HG_TYPE,
       F.PCS_HG,
       F.QTY_HG,
       F.STD_CT,
       P.WeightKG                     AS STD_WT,
       ISNULL(F.STD_TIME_HG, 3.25)    AS STD_TIME_HG,
       F.PCS_HG * F.QTY_HG            AS TOTAL_PCS,
       CAST(ISNULL(P.IsActive, 1) AS BIT) AS IS_ACTIVE,
       E.StockID                      AS PT_STOCK,
       E.PartCol                      AS PT_COL
FROM Nexus.Parts P
CROSS APPLY (
    SELECT TOP 1 X.StockID, X.PartCol
    FROM EDP.PartStocks X
    JOIN Nexus.PartStocks S ON S.StockID = X.StockID AND S.PartID = P.PartID
    ORDER BY CASE WHEN EXISTS (SELECT 1 FROM Nexus.PartFieldDefs D
                               JOIN Nexus.PartFieldValues V ON V.FieldID = D.FieldID AND V.PartID = P.PartID
                               WHERE D.StockID = X.StockID AND D.Label IN ('PCS/HG', 'HG QTY')
                                 AND ISNULL(TRY_CAST(V.Value AS INT), 0) > 0) THEN 0 ELSE 1 END,
             X.SortNo, X.StockID
) E
OUTER APPLY (
    SELECT MAX(CASE WHEN D.Label = 'HG TYPE'         THEN V.Value END)                                 AS HG_TYPE,
           MAX(CASE WHEN D.Label = 'PCS/HG'          THEN TRY_CAST(V.Value AS INT) END)                AS PCS_HG,
           MAX(CASE WHEN D.Label = 'HG QTY'          THEN TRY_CAST(V.Value AS INT) END)                AS QTY_HG,
           MAX(CASE WHEN D.Label = 'CT (SEC)'        THEN TRY_CAST(V.Value AS DECIMAL(10,2)) END)      AS STD_CT,
           MAX(CASE WHEN D.Label = 'STD TIME (MIN.)' THEN TRY_CAST(V.Value AS DECIMAL(10,2)) END)      AS STD_TIME_HG
    FROM Nexus.PartFieldDefs D
    JOIN Nexus.PartFieldValues V ON V.FieldID = D.FieldID AND V.PartID = P.PartID
    WHERE D.StockID = E.StockID
) F;
GO
-- 3) After: what EDP now sees for 22641880 (QTY_HG / PCS_HG > 0 and IS_ACTIVE = 1 = selectable in Plan Setting / Submission)
SELECT PT_ID, CUST_CODE, PT_CODE, PT_NO, PT_NAME, PT_COL, HG_TYPE, PCS_HG, QTY_HG, IS_ACTIVE
FROM EDP.vw_Parts WHERE PT_NO LIKE '%22641880%' OR PT_CODE LIKE '%22641880%';
GO
SET NOEXEC OFF;
GO
