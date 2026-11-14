-- ============================================================================
-- 48_EDP_Part_Stocks.sql  (CHR-Nexus เท่านั้น · ไม่แตะ EDP_SYSTEM / StorePC / CIMS)
-- 🏷 คลังชิ้นงาน EDP ผูกด้วยเลข StockID (ไม่ใช่รหัสคลัง) -> เปลี่ยนรหัส / ชื่อคลังภายหลังได้ ไม่กระทบ EDP
--    EDP.PartStocks : StockID · PartCol (PARTA / PARTB = ช่องที่ใช้จับคู่กับ PT_CODE ของ EDP_SYSTEM) · SortNo (เจอทั้ง 2 คลัง = ใช้คลังลำดับแรก)
--      18 STORE-FG  (Store FG - Visual Control FG) : PART A
--      28 STORE-SUB (Store Work In Process)        : PART B   (เช่น B060-00012 GRIP RH ของ HMMT)
--    STORE-SUB ได้ช่อง EDP แบบเดียวกับ STORE-FG (HG TYPE · PCS/HG · HG QTY · CT (SEC) · STD TIME (MIN.)) + ฟอร์ม / ตาราง Product Control ใช้ PART B
--    Min Report ของ STORE-SUB : บรรทัด 1 = PART B · PRODUCT CODE / บรรทัด 2 = PART NO · PRODUCT NAME
--    ชิ้นงาน B060-00012 / B060-00013 (GRIP RH / LH · HMMT) ที่ EDP_SYSTEM ใช้ใน 65 การ์ด แต่ยังไม่มีใน CHR-Nexus = เพิ่มเข้า STORE-SUB
--    รันซ้ำได้ · รันแล้วให้รัน 30_EDP_Sync_From_EDP_SYSTEM.sql เพื่อผูกชิ้นงานให้การ์ด + คัดลอกค่า HG
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> 'CHR-Nexus' THROW 50000, N'ต้องรันบนฐาน CHR-Nexus', 1;
GO
IF OBJECT_ID('EDP.PartStocks') IS NULL
BEGIN
    CREATE TABLE EDP.PartStocks (
        StockID   INT          NOT NULL CONSTRAINT PK_EDP_PartStocks PRIMARY KEY,
        PartCol   VARCHAR(10)  NOT NULL CONSTRAINT CK_EDP_PartStocks_Col CHECK (PartCol IN ('PARTA', 'PARTB')),
        SortNo    INT          NOT NULL,
        UpdatedBy NVARCHAR(50) NULL,
        UpdatedAt DATETIME     NOT NULL CONSTRAINT DF_EDP_PartStocks_At DEFAULT (GETDATE())
    );
    -- ค่าเริ่มต้น: หาด้วยรหัสครั้งเดียวตอนสร้าง (หลังจากนี้ผูกด้วย StockID)
    INSERT INTO EDP.PartStocks (StockID, PartCol, SortNo, UpdatedBy)
    SELECT TOP 1 StockID, 'PARTA', 1, N'SETUP' FROM Nexus.Stocks WHERE StockCode IN ('STORE-FG', 'STORE-PC') ORDER BY CASE StockCode WHEN 'STORE-FG' THEN 0 ELSE 1 END;
    INSERT INTO EDP.PartStocks (StockID, PartCol, SortNo, UpdatedBy)
    SELECT StockID, 'PARTB', 2, N'SETUP' FROM Nexus.Stocks WHERE StockCode = 'STORE-SUB';
END
GO
CREATE OR ALTER VIEW EDP.vw_Parts
AS
-- ชิ้นงาน EDP = สินค้าในคลังของ EDP.PartStocks · PT_CODE = PART A หรือ PART B ตามคลัง · ค่า HG = ช่องเพิ่มเองของคลังนั้น
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
    ORDER BY X.SortNo, X.StockID
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

BEGIN TRAN;
DECLARE @fg INT = (SELECT TOP 1 StockID FROM EDP.PartStocks WHERE PartCol = 'PARTA' ORDER BY SortNo);
DECLARE @sub INT = (SELECT TOP 1 StockID FROM EDP.PartStocks WHERE PartCol = 'PARTB' ORDER BY SortNo);

IF @fg IS NOT NULL AND @sub IS NOT NULL
BEGIN
    -- 1) ช่อง EDP ของ STORE-SUB = แบบเดียวกับ STORE-FG (ชื่อ / ชนิด / หน่วย / ลำดับ)
    INSERT INTO Nexus.PartFieldDefs (StockID, Label, DataType, SortNo, CreatedAt, CreatedBy, Unit, Suggest, AutoFrom)
    SELECT @sub, D.Label, D.DataType, D.SortNo, SYSDATETIME(), N'EDP_SETUP', D.Unit, D.Suggest, D.AutoFrom
    FROM Nexus.PartFieldDefs D
    WHERE D.StockID = @fg AND D.Label IN (N'HG TYPE', N'PCS/HG', N'HG QTY', N'CT (SEC)', N'STD TIME (MIN.)')
      AND NOT EXISTS (SELECT 1 FROM Nexus.PartFieldDefs X WHERE X.StockID = @sub AND X.Label = D.Label);

    -- 2) Product Control ของ STORE-SUB = แบบ STORE-FG แต่ใช้ PART B (ตาราง + ช่องกรอก REGISTER PRODUCT)
    DECLARE @cf NVARCHAR(200) = (SELECT STRING_AGG('CF' + CAST(FieldID AS VARCHAR(10)), ',') WITHIN GROUP (ORDER BY SortNo)
                                 FROM Nexus.PartFieldDefs WHERE StockID = @sub AND Label IN (N'HG TYPE', N'PCS/HG', N'HG QTY', N'CT (SEC)', N'STD TIME (MIN.)'));
    UPDATE Nexus.ProductControlSettings
    SET ColumnOrder = REPLACE(ColumnOrder, 'PARTA', 'PARTB'),
        FormFields  = 'IMAGE,CUSTOMER,CATEGORY,MODEL,CODE,PARTB,PARTNO,NAME,PACKSIZE,WEIGHT,' + @cf + ',QRCODE',
        UpdatedBy = N'2124', UpdatedDate = GETDATE()
    WHERE StockID = @sub AND (ISNULL(ColumnOrder, '') LIKE '%PARTA%' OR ISNULL(FormFields, '') NOT LIKE '%' + @cf + '%');

    -- 3) Min Report ของ STORE-SUB: PART B + PRODUCT CODE (ค่าซ้ำกันแสดงครั้งเดียว) / PART NO · PRODUCT NAME
    IF NOT EXISTS (SELECT 1 FROM Nexus.MinReportDisplay WHERE StockID = @sub)
        INSERT INTO Nexus.MinReportDisplay (StockID, Line1, Line2, UpdatedBy, UpdatedDate) VALUES (@sub, 'PARTB,CODE', 'PARTNO,NAME', N'2124', GETDATE());

    -- 4) ชิ้นงาน GRIP RH / LH (HMMT) ที่ EDP_SYSTEM ใช้แต่ CHR-Nexus ยังไม่มี -> STORE-SUB (แบบสินค้าอื่นของคลังนี้: PRODUCT CODE = PART B)
    DECLARE @new TABLE (Code NVARCHAR(50), PartNo NVARCHAR(100), Name NVARCHAR(200));
    INSERT INTO @new VALUES (N'B060-00012', N'74074-EW010 (RH)', N'GRIP RH'), (N'B060-00013', N'74074-EW020 (LH)', N'GRIP LH');
    DECLARE @ids TABLE (PartID INT, Code NVARCHAR(50));
    INSERT INTO Nexus.Parts (PartCode, Category, Description, Bin, PackSize, MaxQuantity, MinQuantity, StockQuantity, QRCode, IsActive, IsShowInMaster, Customer, PartNumber, CoilQuantity, PartB)
    OUTPUT inserted.PartID, inserted.PartCode INTO @ids
    SELECT N.Code, 'A', N.Name, 'N/A', '0', 0, 0, 0, N.Code, 1, 0, N'HMMT', N.PartNo, 0, N.Code
    FROM @new N
    WHERE NOT EXISTS (SELECT 1 FROM Nexus.Parts P WHERE P.PartCode = N.Code OR P.PartB = N.Code OR P.PartA = N.Code);
    INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity, MaxQuantity, MinQuantity, UpdatedDate, BoxQuantity, IsShow)
    SELECT @sub, I.PartID, 0, 0, 0, GETDATE(), 0, 1 FROM @ids I;

    -- 📝 Activity Log
    INSERT INTO Nexus.SystemLogs (UserID, ActionType, Description, Reference, LogDate, ComputerName)
    SELECT '2124', 'EDP_PART_STOCKS',
           N'EDP ผูกคลังชิ้นงานด้วย StockID: ' + CAST(@fg AS NVARCHAR(10)) + N' (PART A) / ' + CAST(@sub AS NVARCHAR(10)) + N' (PART B) · STORE-SUB ได้ช่อง EDP + PART B ใน Product Control / Min Report'
           + ISNULL(N' · เพิ่มสินค้า STORE-SUB: ' + (SELECT STRING_AGG(Code, ', ') FROM @ids), N''),
           'EDP', GETDATE(), N'CLAUDE'
    WHERE NOT EXISTS (SELECT 1 FROM Nexus.SystemLogs WHERE ActionType = 'EDP_PART_STOCKS') OR EXISTS (SELECT 1 FROM @ids);
END
COMMIT;
GO
SELECT E.StockID, K.StockCode, E.PartCol, E.SortNo FROM EDP.PartStocks E JOIN Nexus.Stocks K ON K.StockID = E.StockID ORDER BY E.SortNo;
SELECT PT_COL, COUNT(*) AS Parts, SUM(CASE WHEN PCS_HG IS NOT NULL OR QTY_HG IS NOT NULL THEN 1 ELSE 0 END) AS WithHg FROM EDP.vw_Parts GROUP BY PT_COL;
