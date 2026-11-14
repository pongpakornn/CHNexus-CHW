-- ============================================================================
-- 45_EDP_Store_FG.sql  (CHR-Nexus เท่านั้น · ไม่แตะ EDP_SYSTEM)
-- 🏷 คลังชิ้นงาน EDP เปลี่ยนรหัสจาก STORE-PC เป็น STORE-FG (Store FG - Visual Control FG) เมื่อ 14/11/2026
--    EDP.vw_Parts หาคลังด้วยรหัสใหม่ (ยังรับรหัสเดิมด้วย) -> ชิ้นงาน EDP กลับมา
--    รันแล้วให้รัน 30_EDP_Sync_From_EDP_SYSTEM.sql ใหม่ เพื่อผูกชิ้นงานให้การ์ดอีกครั้ง
-- ============================================================================
SET NOCOUNT ON;
GO
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
JOIN Nexus.Stocks K     ON K.StockID = S.StockID AND K.StockCode IN ('STORE-FG', 'STORE-PC')   -- คลัง FG (เดิมชื่อ STORE-PC)
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
SELECT COUNT(*) AS EdpParts FROM EDP.vw_Parts;
