-- 70: Store table can group by MATERIAL (steel grade from the part name) - set per stock (STOCK SETTING > GROUP BY).
-- Only the view changes; no table / data change. Rollback = 70_Store_Group_Material_rollback.sql (view of script 66).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER VIEW Nexus.vw_StockMonitoring AS
WITH base AS (
    -- main stock: balance / max / min / remark live in Nexus.Parts
    SELECT s.StockID, s.UseMaxMin, s.MaxMinBasis, s.GroupBy, p.PartID,
           p.MaxQuantity AS QMAX, p.MinQuantity AS QMIN, ISNULL(p.StockQuantity, 0) AS Quantity, p.Remark AS RMK,
           CASE WHEN s.CountCoil = 1 THEN p.CoilQuantity ELSE CAST(NULL AS INT) END AS BOXQ,   -- KG stock: QTY (COIL) = coils scanned
           p.Category, p.Supplier, p.ImageFileName, p.PartCode, p.Description, p.PackSize, p.Status, p.Bin, p.Customer, p.PartA, p.PartNumber, p.Model
    FROM Nexus.Stocks s
    JOIN Nexus.Parts p ON s.IsMain = 1
    WHERE p.IsActive = 1 AND p.IsShowInMaster = 1 AND p.MainHidden = 0   -- 66: hidden rows stay in STORE-MAT (Master Data) but not in the Store table

    UNION ALL

    -- other stocks: balance per part in Nexus.PartStocks
    SELECT s.StockID, s.UseMaxMin, s.MaxMinBasis, s.GroupBy, p.PartID,
           ps.MaxQuantity, ps.MinQuantity, ps.Quantity, ps.Remark, ps.BoxQuantity,
           p.Category, p.Supplier, p.ImageFileName, p.PartCode, p.Description, p.PackSize, p.Status, p.Bin, p.Customer, p.PartA, p.PartNumber, p.Model
    FROM Nexus.PartStocks ps
    JOIN Nexus.Stocks s ON s.StockID = ps.StockID AND s.IsMain = 0 AND s.LiveSource IS NULL
    JOIN Nexus.Parts p  ON p.PartID  = ps.PartID
    WHERE p.IsActive = 1 AND ps.IsShow = 1

    UNION ALL

    -- TEMPORARY: stock shown live from the old StorePC program (read only)
    SELECT s.StockID, s.UseMaxMin, s.MaxMinBasis, s.GroupBy, l.PartID,
           l.QMAX, l.QMIN, l.Quantity, l.RMK, l.BOXQ,
           l.Category, l.Supplier, l.ImageFileName, l.PartCode, l.Description, l.PackSize, l.Status, l.Bin, l.Customer, l.PartA, l.PartNumber, l.Model
    FROM Nexus.vw_StorePcLive l
    JOIN Nexus.Stocks s ON s.LiveSource = N'StorePC' AND s.IsMain = 0
),
calc AS (
    SELECT b.*,
           -- STOCK (BOX): other stocks keep their own box count (scan = +1 / -1 box), main stock = balance / pack size
           CASE WHEN b.BOXQ IS NOT NULL THEN b.BOXQ WHEN ISNULL(b.PackSize, 0) > 0 THEN CAST(FLOOR(b.Quantity / b.PackSize) AS INT) ELSE 0 END AS BoxQuantity
    FROM base b
)
SELECT
    c.StockID        AS StkId,
    c.PartID,
    c.Category       AS Category,
    c.Supplier       AS Supplier,
    c.ImageFileName  AS ImageFileName,
    c.PartCode       AS PartCode,
    c.Description    AS PartName,
    c.PackSize       AS PackSize,
    c.QMAX           AS [Max],
    c.QMIN           AS [Min],
    c.Quantity       AS QtyStkb,
    c.RMK            AS Remark,
    c.Status         AS Priority,
    c.Bin            AS Bin,
    c.Customer       AS Customer,
    c.PartA          AS PartA,
    c.PartNumber     AS PartNo,
    c.Model          AS Model,
    c.BoxQuantity    AS StockBox,
    c.Quantity       AS StockPcs,
    -- group header of the Store table: Category (default) / Customer / Supplier / Material
    -- fixed length (NVARCHAR(200)): Supplier is NVARCHAR(MAX) - a MAX GroupKey makes DISTINCT / ORDER BY ask for a huge memory grant
    CAST(CASE WHEN c.GroupBy = 'CUSTOMER' THEN ISNULL(NULLIF(c.Customer, ''), '-')
              WHEN c.GroupBy = 'SUPPLIER' THEN ISNULL(NULLIF(CAST(c.Supplier AS NVARCHAR(200)), ''), '-')
              -- 70: MATERIAL = steel grade = first word of the part name, cut at ',' or '(' (SPCE 3.2x100xC -> SPCE, SAPH45-P,440P -> SAPH45-P)
              WHEN c.GroupBy = 'MATERIAL' THEN ISNULL(NULLIF(LEFT(g.W, PATINDEX('%[,(]%', g.W + ',') - 1), ''), '-')
              ELSE ISNULL(NULLIF(c.Category, ''), '-') END AS NVARCHAR(200)) AS GroupKey,
    CASE
        WHEN c.UseMaxMin = 0 THEN 'NORMAL'      -- stock without Max/Min: plain rows (not the grey NO_CONFIG look)
        WHEN ISNULL(c.QMAX, 0) = 0 AND ISNULL(c.QMIN, 0) = 0 THEN 'NO_CONFIG'
        -- MAX / MIN compared with Quantity (stock unit) or with STOCK (BOX)
        WHEN (CASE WHEN c.MaxMinBasis IN ('BOX', 'COIL') THEN c.BoxQuantity ELSE c.Quantity END) < ISNULL(c.QMIN, 0) THEN 'UNDER_MIN'
        WHEN (CASE WHEN c.MaxMinBasis IN ('BOX', 'COIL') THEN c.BoxQuantity ELSE c.Quantity END) > ISNULL(c.QMAX, 0) AND ISNULL(c.QMAX, 0) > 0 THEN 'OVER_MAX'
        WHEN (CASE WHEN c.MaxMinBasis IN ('BOX', 'COIL') THEN c.BoxQuantity ELSE c.Quantity END) BETWEEN ISNULL(c.QMIN, 0) AND ISNULL(c.QMAX, 0) THEN 'NORMAL_GOOD'
        ELSE 'NORMAL'
    END AS StockStatus
FROM calc c
CROSS APPLY (SELECT LEFT(LTRIM(ISNULL(c.Description, '')), CHARINDEX(' ', LTRIM(ISNULL(c.Description, '')) + ' ') - 1) AS W) g;
GO
