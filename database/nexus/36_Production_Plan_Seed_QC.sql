/* =====================================================================
   📈 PRODUCTION PLAN · ข้อมูลตั้งต้นหน่วยงาน QC (Quality · สถานีตรวจ A · B.1-B.4 · C.1-C.5 · D)
   จาก Excel "12-2026-QC.xlsx" (QUALITY CAPACITY PLANNING December 2026)
   ---------------------------------------------------------------------
   1) STORE-PC: PART A ที่ยังไม่มี (เพิ่มเฉพาะใน CHR-Nexus · ไม่แตะฐาน StorePC) · STORE-SUB: PART B ที่ยังไม่มี (มีอยู่แล้ว = ไม่แก้)
   2) เครื่องจักร / ไลน์ของแต่ละหน่วยงาน + ค่า STD (Q'ty · Target Eff · STD Man · SPH 100% กำหนดเองเมื่อ Excel ไม่ตรงสูตร · Stroke = PCS)
   3) ตาราง Product ของแต่ละเครื่อง (Process หลายช่องรวมเป็น A^B^C)
   - รันซ้ำได้: ข้ามหน่วยงานที่มีเครื่องอยู่แล้ว · ใช้กับฐาน CHR-Nexus เท่านั้น (รัน 33_Production_Plan.sql ก่อน)
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'CHR-Nexus' THROW 50000, N'รันสคริปต์นี้กับฐาน CHR-Nexus เท่านั้น', 1;
IF COL_LENGTH('ProductionPlan.Machines', 'StrokeByPcs') IS NULL THROW 50000, N'รัน 33_Production_Plan.sql ก่อน', 1;

DECLARE @sub INT = (SELECT StockID FROM Nexus.Stocks WHERE StockCode = N'STORE-SUB');
DECLARE @pc  INT = (SELECT StockID FROM Nexus.Stocks WHERE StockCode = N'STORE-PC');
IF @sub IS NULL OR @pc IS NULL THROW 50000, N'ไม่พบคลัง STORE-SUB / STORE-PC', 1;

DECLARE @m TABLE (Dept NVARCHAR(20), Code NVARCHAR(50), Grp NVARCHAR(30), Sub NVARCHAR(30), Sort INT, Qty DECIMAL(9,2), Eff DECIMAL(6,4), Man DECIMAL(9,2), Sph DECIMAL(12,4) NULL, ByPcs BIT);
DECLARE @r TABLE (Dept NVARCHAR(20), No INT, Machine NVARCHAR(50), A NVARCHAR(60), B NVARCHAR(60), Name NVARCHAR(200), ProcCode NVARCHAR(200), TP DECIMAL(9,3), Col DECIMAL(9,3), CT DECIMAL(9,3), Man DECIMAL(9,2));

INSERT INTO @m VALUES
  (N'QC', N'Station A', N'STATION A', NULL, 1, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station B.1', N'STATION B', N'Station B.1', 2, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station B.2', N'STATION B', N'Station B.2', 3, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station B.3', N'STATION B', N'Station B.3', 4, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station B.4', N'STATION B', N'Station B.4', 5, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station C.1', N'STATION C', N'Station C.1', 6, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station C.2', N'STATION C', N'Station C.2', 7, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station C.3', N'STATION C', N'Station C.3', 8, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station C.4', N'STATION C', N'Station C.4', 9, 1.0, 0.9, 1.0, NULL, 0),
  (N'QC', N'Station C.5', N'STATION C', N'Station C.5', 10, 1.0, 0.9, 1.0, 13.9249, 0),
  (N'QC', N'Station D', N'STATION D', NULL, 11, 1.0, 0.9, 1.0, NULL, 0);
INSERT INTO @r VALUES
  (N'QC', 1, N'Station A', N'A916-00001', N'COVER SLIDING SHAFT DUST', NULL, NULL, 1.0, 1.0, 12.6, 1.0),
  (N'QC', 2, N'Station A', N'A224-00053', N'PIPE WATER BY PASS NO.2', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 3, N'Station A', N'A250-00026', N'PIPE WATER BY PASS NO.2', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 4, N'Station A', N'A907-00001', N'PIPE/PIPE,CYLINDER', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 5, N'Station A', N'A918-00005', N'PIPE (ตัวตรง)', NULL, NULL, 1.0, 1.0, 21.6, 1.0),
  (N'QC', 1, N'Station B.1', N'A950-00041', N'CLAMP, INJECTION PIPE NO.2', NULL, NULL, 1.0, 1.0, 5.4, 1.0),
  (N'QC', 2, N'Station B.1', N'A950-00024', N'CLAMP, INJECTION PIPE NO.2', NULL, NULL, 1.0, 1.0, 5.4, 1.0),
  (N'QC', 3, N'Station B.1', N'A950-00055', N'CLAMP, INJECTION PIPE NO.2', NULL, NULL, 1.0, 1.0, 5.4, 1.0),
  (N'QC', 4, N'Station B.1', N'A950-00047', N'CLAMP, INJECTION PIPE NO.2', NULL, NULL, 1.0, 1.0, 5.4, 1.0),
  (N'QC', 5, N'Station B.1', N'A924-00086', N'CLAMP, INJECTION PIPE NO.2', NULL, NULL, 1.0, 1.0, 5.4, 1.0),
  (N'QC', 6, N'Station B.1', N'A903-00006', N'collar', NULL, NULL, 1.0, 1.0, 6.5, 1.0),
  (N'QC', 1, N'Station B.2', N'A950-00057', N'GUIDE, OIL LEVEL GAGE', NULL, NULL, 1.0, 1.0, 45.0, 1.0),
  (N'QC', 2, N'Station B.2', N'A924-00090', N'PIPE,WATER BY-PASS (112Y)', NULL, NULL, 1.0, 1.0, 20.0, 1.0),
  (N'QC', 3, N'Station B.2', N'A924-00076', N'PIPE,WATER BY-PASS (926F)', NULL, NULL, 1.0, 1.0, 18.0, 1.0),
  (N'QC', 4, N'Station B.2', N'A924-00075', N'PIPE,WATER BY-PASS (112Y)', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 5, N'Station B.2', N'A924-00077', N'PIPE,WATER BY-PASS (150Y)', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 6, N'Station B.2', N'A924-00078', N'PIPE,WATER BY-PASS,NO.2', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 7, N'Station B.2', N'A924-00079', N'PIPE,WATER BY-PASS,NO.2', NULL, NULL, 1.0, 1.0, 17.0, 1.0),
  (N'QC', 8, N'Station B.2', N'A950-00071', N'STAY, EGR PIPE   D.17', NULL, NULL, 1.0, 1.0, 18.0, 1.0),
  (N'QC', 1, N'Station B.3', N'A924-00072', N'PLATE NO.1 CONNECTOR,GLOW PLUG', NULL, NULL, 1.0, 1.0, 13.5, 1.0),
  (N'QC', 2, N'Station B.3', N'A950-00034', N'PLATE NO.1 CONNECTOR,GLOW PLUG', NULL, NULL, 1.0, 1.0, 18.0, 1.0),
  (N'QC', 3, N'Station B.3', N'A924-00089', N'PLATE NO.1 CONNECTOR,GLOW PLUG', NULL, NULL, 1.0, 1.0, 18.0, 1.0),
  (N'QC', 1, N'Station B.4', N'A950-00036', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 2, N'Station B.4', N'A950-00025', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 3, N'Station B.4', N'A950-00042', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 4, N'Station B.4', N'A950-00043', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 5, N'Station B.4', N'A950-00051', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 6, N'Station B.4', N'A950-00037', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 7, N'Station B.4', N'A950-00028', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 8, N'Station B.4', N'A950-00056', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 9, N'Station B.4', N'A924-00081', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 10, N'Station B.4', N'A924-00082', N'HANGER, ENGINE, NO.1 UPR / 851F', NULL, NULL, 1.0, 1.0, 8.1, 1.0),
  (N'QC', 1, N'Station C.1', N'A971-00014', N'PIPE NO.1', NULL, NULL, 1.0, 1.0, 62.0, 1.0),
  (N'QC', 2, N'Station C.1', N'A971-00003', N'PIPE NO.1', NULL, NULL, 1.0, 1.0, 62.0, 1.0),
  (N'QC', 3, N'Station C.1', N'A971-00001', N'PIPE', NULL, NULL, 1.0, 1.0, 67.3, 1.0),
  (N'QC', 4, N'Station C.1', N'A948-00054', N'BRACKET, TURN CHAMBER ( 049 )', NULL, NULL, 1.0, 1.0, 54.0, 1.0),
  (N'QC', 5, N'Station C.1', N'A960-00075', N'PIPE,HAND RAIL RH', NULL, NULL, 1.0, 1.0, 60.0, 1.0),
  (N'QC', 6, N'Station C.1', N'A960-00076', N'PIPE,HAND RAIL LH', NULL, NULL, 1.0, 1.0, 60.0, 1.0),
  (N'QC', 7, N'Station C.1', N'A960-00077', N'GRIP S/A  RH', NULL, NULL, 1.0, 1.0, 51.0, 1.0),
  (N'QC', 8, N'Station C.1', N'A960-00078', N'GRIP S/A  LH', NULL, NULL, 1.0, 1.0, 51.0, 1.0),
  (N'QC', 9, N'Station C.1', N'A958-00001', N'PAN ASSY-OIL N17T', NULL, NULL, 1.0, 1.0, 75.0, 1.0),
  (N'QC', 10, N'Station C.1', N'A000-00000', N'Service', NULL, NULL, 1.0, 1.0, 75.0, 1.0),
  (N'QC', 1, N'Station C.2', N'B903-00007', N'PLATE', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 2, N'Station C.2', N'A265-00014', N'Metal Bracket (FIS)', NULL, NULL, 1.0, 1.0, 150.0, 1.0),
  (N'QC', 3, N'Station C.2', N'B903-00008', N'PLATE R FR BHD', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 4, N'Station C.2', N'B903-00009', N'PLATE L FR BHD', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 1, N'Station C.3', N'A961-00102', N'RETAINING PLATE ( 183 )', NULL, NULL, 1.0, 1.0, 36.0, 1.0),
  (N'QC', 2, N'Station C.3', N'A961-00103', N'PLATE SCREW PLATE ( 419 )', NULL, NULL, 1.0, 1.0, 36.0, 1.0),
  (N'QC', 3, N'Station C.3', N'A961-00104', N'PLATE SCREW PLATE  ( 254 )', NULL, NULL, 1.0, 1.0, 36.0, 1.0),
  (N'QC', 4, N'Station C.3', N'A961-00105', N'PLATE SCREW PLATE ( 250 )', NULL, NULL, 1.0, 1.0, 36.0, 1.0),
  (N'QC', 5, N'Station C.3', N'A122-00062', N'SPOKE1', NULL, NULL, 1.0, 1.0, 33.0, 1.0),
  (N'QC', 6, N'Station C.3', N'A122-00019', N'SPOKE2', NULL, NULL, 1.0, 1.0, 33.0, 1.0),
  (N'QC', 7, N'Station C.3', N'A953-00010', N'BRACKET ASM , FLEX HOSE (358)', NULL, NULL, 1.0, 1.0, 12.6, 1.0),
  (N'QC', 8, N'Station C.3', N'A953-00011', N'BRACKET; A  RH-LH', NULL, NULL, 1.0, 1.0, 12.6, 1.0),
  (N'QC', 9, N'Station C.3', N'A953-00012', N'BRACKET; A', NULL, NULL, 1.0, 1.0, 12.6, 1.0),
  (N'QC', 1, N'Station C.4', N'A948-00042', N'HEAT SHIELD, HORIZONTAL MUFFLER (551)', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 2, N'Station C.4', N'A948-00032', N'HEAT SHIELD,HORIZONTAL MU', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 3, N'Station C.4', N'A948-00034', N'HEAT SHIELD,HORIZONTAL MU', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 4, N'Station C.4', N'A148-00003', N'HEAT SHIELD, HORIZONTAL MUFFLER (Common Die 627)', NULL, NULL, 1.0, 1.0, 108.0, 1.0),
  (N'QC', 1, N'Station C.5', N'A248-00002', N'HEAT SHIELD HORIZONTAL MUFFLER UD BRAND(196)', NULL, NULL, 1.0, 1.0, 315.0, 1.0),
  (N'QC', 2, N'Station C.5', N'A948-00003', N'HEAT SHIELD FUEL TANK HORIZONTAL MUFFLER', NULL, NULL, 1.0, 1.0, 450.0, 1.0),
  (N'QC', 3, N'Station C.5', N'A948-00021', N'HEAT SHIELD FUEL TANK', NULL, NULL, 1.0, 1.0, 450.0, 1.0),
  (N'QC', 4, N'Station C.5', N'A948-00029', N'HEAT SHIELD,FUEL TANK,', NULL, NULL, 1.0, 1.0, 450.0, 1.0),
  (N'QC', 5, N'Station C.5', N'A948-00031', N'HEAT SHIELD,FUEL TANK,', NULL, NULL, 1.0, 1.0, 450.0, 1.0),
  (N'QC', 6, N'Station C.5', N'A948-00062', N'HEAT SHIELD FUEL TANK HORIZONTAL MUFFLER', NULL, NULL, 1.0, 1.0, 450.0, 1.0),
  (N'QC', 1, N'Station D', N'A955-00006', N'PAN, OIL COMP', NULL, NULL, 1.0, 1.0, 35.0, 1.0),
  (N'QC', 2, N'Station D', N'A955-00001', N'PAN, OIL COMP', NULL, NULL, 1.0, 1.0, 35.0, 1.0),
  (N'QC', 3, N'Station D', N'A955-00002', N'PAN, OIL COMP', NULL, NULL, 1.0, 1.0, 35.0, 1.0),
  (N'QC', 4, N'Station D', N'A955-00004', N'PAN, OIL COMP', NULL, NULL, 1.0, 1.0, 35.0, 1.0);

-- หน่วยงานที่มีเครื่องอยู่แล้ว = ข้าม (รันซ้ำไม่ซ้ำ)
DELETE FROM @m WHERE Dept IN (SELECT DISTINCT Dept FROM ProductionPlan.Machines);
DELETE FROM @r WHERE Dept NOT IN (SELECT Dept FROM @m);
IF NOT EXISTS (SELECT 1 FROM @m) BEGIN PRINT N'ทุกหน่วยงานมีข้อมูลแล้ว (ข้าม)'; RETURN; END;

BEGIN TRAN;
-- 1a) PART A ที่ยังไม่มีใน STORE-PC -> เพิ่ม (PRODUCT CODE = PART A) เฉพาะ CHR-Nexus
DECLARE @newA TABLE (A NVARCHAR(60) PRIMARY KEY, Name NVARCHAR(200));
INSERT INTO @newA (A, Name)
SELECT x.A, x.Name FROM (SELECT r.A, r.Name, ROW_NUMBER() OVER (PARTITION BY r.A ORDER BY r.Dept, r.Machine, r.No) rn FROM @r r) x
WHERE x.rn = 1 AND NOT EXISTS (SELECT 1 FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID AND ps.StockID = @pc WHERE LTRIM(RTRIM(p.PartA)) = x.A);
INSERT INTO Nexus.Parts (PartCode, Description, PackSize, QRCode, MaxQuantity, MinQuantity, Category, Bin, StockQuantity, IsActive, IsShowInMaster, PartA)
SELECT n.A, ISNULL(n.Name, N''), 0, n.A, 0, 0, N'A', N'N/A', 0, 1, 0, n.A FROM @newA n
WHERE NOT EXISTS (SELECT 1 FROM Nexus.Parts p WHERE p.PartCode = n.A AND p.PartA = n.A);
INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity, MaxQuantity, MinQuantity, IsShow)
SELECT @pc, p.PartID, 0, 0, 0, 1 FROM Nexus.Parts p JOIN @newA n ON p.PartCode = n.A AND p.PartA = n.A
WHERE NOT EXISTS (SELECT 1 FROM Nexus.PartStocks s WHERE s.StockID = @pc AND s.PartID = p.PartID);
PRINT N'STORE-PC: เพิ่ม PART A ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + N' รายการ';

-- 1b) PART B ที่ยังไม่มี -> STORE-SUB (ชื่อ / ลูกค้า ตามแถวแรกที่พบ)
DECLARE @newB TABLE (B NVARCHAR(60) PRIMARY KEY, Name NVARCHAR(200), Cust NVARCHAR(100));
INSERT INTO @newB (B, Name, Cust)
SELECT x.B, x.Name, x.Cust FROM (
    SELECT r.B, r.Name, pa.Customer AS Cust, ROW_NUMBER() OVER (PARTITION BY r.B ORDER BY r.Dept, r.Machine, r.No) AS rn
    FROM @r r
    OUTER APPLY (SELECT TOP 1 p.Customer FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID AND ps.StockID = @pc WHERE LTRIM(RTRIM(p.PartA)) = r.A) pa
    WHERE r.B IS NOT NULL AND r.B <> r.A) x
WHERE x.rn = 1
  AND NOT EXISTS (SELECT 1 FROM Nexus.Parts p WHERE LTRIM(RTRIM(p.PartCode)) = x.B OR LTRIM(RTRIM(ISNULL(p.PartB, N''))) = x.B OR LTRIM(RTRIM(ISNULL(p.PartA, N''))) = x.B);
INSERT INTO Nexus.Parts (PartCode, Description, PackSize, QRCode, MaxQuantity, MinQuantity, Category, Bin, StockQuantity, IsActive, IsShowInMaster, Customer, PartB)
SELECT n.B, ISNULL(n.Name, N''), 0, n.B, 0, 0, N'A', N'N/A', 0, 1, 0, n.Cust, n.B FROM @newB n;
INSERT INTO Nexus.PartStocks (StockID, PartID, Quantity, MaxQuantity, MinQuantity, IsShow)
SELECT @sub, p.PartID, 0, 0, 0, 1 FROM Nexus.Parts p JOIN @newB n ON p.PartCode = n.B
WHERE NOT EXISTS (SELECT 1 FROM Nexus.PartStocks s WHERE s.StockID = @sub AND s.PartID = p.PartID);
PRINT N'STORE-SUB: เพิ่ม PART B ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + N' รายการ';

-- 2) เครื่องจักร / ไลน์ + ค่า STD
INSERT INTO ProductionPlan.Machines (Dept, MachineCode, GroupName, SubGroup, SortNo, QtyLine, TargetEff, ManPower, SphOverride, StrokeByPcs, CreatedBy, UpdatedBy)
SELECT Dept, Code, Grp, Sub, Sort, Qty, Eff, Man, Sph, ByPcs, N'SYSTEM', N'SYSTEM' FROM @m;

-- 3) ตาราง Product: PART A = STORE-PC · PART B = STORE-SUB (B-xxx) / STORE-PC (ชิ้นเดียวกับ PART A)
INSERT INTO ProductionPlan.MachineParts (MachineID, SortNo, PartAID, PartBID, ProcessCode, TotalProcess, PcsPerStroke, CycleTime, StdMan, CreatedBy, UpdatedBy)
SELECT m.MachineID, r.No, a.PartID, COALESCE(b.PartID, ab.PartID), r.ProcCode, r.TP, r.Col, r.CT, r.Man, N'SYSTEM', N'SYSTEM'
FROM @r r
JOIN ProductionPlan.Machines m ON m.Dept = r.Dept AND m.MachineCode = r.Machine
CROSS APPLY (SELECT TOP 1 p.PartID FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID AND ps.StockID = @pc WHERE LTRIM(RTRIM(p.PartA)) = r.A ORDER BY p.PartID) a
OUTER APPLY (SELECT TOP 1 p.PartID FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID AND ps.StockID = @sub WHERE LTRIM(RTRIM(p.PartCode)) = r.B ORDER BY p.PartID) b
OUTER APPLY (SELECT TOP 1 p.PartID FROM Nexus.Parts p JOIN Nexus.PartStocks ps ON ps.PartID = p.PartID AND ps.StockID = @pc WHERE LTRIM(RTRIM(p.PartA)) = r.B ORDER BY p.PartID) ab;
DECLARE @n INT = @@ROWCOUNT, @x INT = (SELECT COUNT(*) FROM @r);
PRINT N'MachineParts: ' + CAST(@n AS NVARCHAR(10)) + N' แถว (Excel ' + CAST(@x AS NVARCHAR(10)) + N')';
COMMIT;
