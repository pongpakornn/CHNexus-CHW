-- 66_Parts_MainHidden_rollback.sql : put the view / SP back as before 66, then drop the column
-- (parts hidden with MainHidden = 1 come back as shown in STORE-MAT)
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
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
    WHERE p.IsActive = 1 AND p.IsShowInMaster = 1

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
    -- group header of the Store table: Category (default) / Customer / Supplier
    -- fixed length (NVARCHAR(200)): Supplier is NVARCHAR(MAX) - a MAX GroupKey makes DISTINCT / ORDER BY ask for a huge memory grant
    CAST(CASE WHEN c.GroupBy = 'CUSTOMER' THEN ISNULL(NULLIF(c.Customer, ''), '-')
              WHEN c.GroupBy = 'SUPPLIER' THEN ISNULL(NULLIF(CAST(c.Supplier AS NVARCHAR(200)), ''), '-')
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
FROM calc c;
GO
-- @StkId: show only the parts in that stock (main = IsShowInMaster / other = row in Nexus.PartStocks), NULL = all
CREATE OR ALTER PROCEDURE Nexus.sp_GetPartForQR
    @SearchText NVARCHAR(100) = '',
    @StkId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @SearchText = ISNULL(TRIM(@SearchText), '');
    DECLARE @isMain BIT = ISNULL((SELECT IsMain FROM Nexus.Stocks WHERE StockID = @StkId), 0);
    DECLARE @like NVARCHAR(110) = '%' + @SearchText + '%';

    -- IS_SHOW_VIEW: SHOW/HIDE of the filtered stock (other stock = Nexus.PartStocks.IsShow / main or all = IsShowInMaster)
    SELECT v.*,
           CASE WHEN @StkId IS NOT NULL AND @isMain = 0
                THEN ISNULL((SELECT ps.IsShow FROM Nexus.PartStocks ps WHERE ps.StockID = @StkId AND ps.PartID = v.PartID), 1)
                ELSE v.IsShowInMaster END AS IS_SHOW_VIEW
    FROM Nexus.vw_PartQRReady v
    WHERE
        (@StkId IS NULL
         OR (@isMain = 1 AND v.IsShowInMaster = 1)
         OR (@isMain = 0 AND EXISTS (SELECT 1 FROM Nexus.PartStocks ps WHERE ps.StockID = @StkId AND ps.PartID = v.PartID)))
    AND (
        @SearchText = ''
        OR (
            ISNULL(PartCode, '')        LIKE @like
            OR ISNULL(Description, '')  LIKE @like
            OR ISNULL(Supplier, '')     LIKE @like
            OR ISNULL(Bin, '')          LIKE @like
            OR ISNULL(Category, '')     LIKE @like
            OR ISNULL(Customer, '')     LIKE @like
            OR ISNULL(PartA, '')        LIKE @like
            OR ISNULL(PartB, '')        LIKE @like
            OR ISNULL(PartNumber, '')   LIKE @like
            OR ISNULL(Model, '')        LIKE @like
            -- COIL NO / MASTER COIL of the coils in stock
            OR EXISTS (SELECT 1 FROM Nexus.Coils c
                       WHERE c.PartID = v.PartID AND c.Status = 'IN' AND (@StkId IS NULL OR c.StockID = @StkId)
                         AND (c.CoilNo LIKE @like OR ISNULL(c.MotherCoil, '') LIKE @like))
        )
    )
    ORDER BY Category ASC, PartCode ASC
    OPTION (MAX_GRANT_PERCENT = 5);   -- small memory grant: does not wait behind other queries (SQL Express)
END
GO
IF COL_LENGTH('Nexus.Parts', 'MainHidden') IS NOT NULL
BEGIN
    ALTER TABLE Nexus.Parts DROP CONSTRAINT DF_Parts_MainHidden;
    ALTER TABLE Nexus.Parts DROP COLUMN MainHidden;
END
GO
