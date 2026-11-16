/* =====================================================================
   🔄 EDP: ดึงแผนเก่าจาก EDP Systems (.exe · ฐาน EDP_SYSTEM) มาลง CHR-Nexus เฉพาะวันที่ "ก่อน" @cut
   - ใช้หลังเริ่มใช้ CHR-Nexus จริง (16 พ.ย. 2026): แผนวันที่ >= @cut ใน CHR-Nexus ไม่แตะเลย (ข้อมูลที่ผู้ใช้กรอกบนเว็บ)
   - แผนวันที่ < @cut = ให้ตรงกับ EDP_SYSTEM (หัวแผน · การ์ด · Log แก้ไข · Log แก้เวลา) แบบ 30_EDP_Sync_From_EDP_SYSTEM.sql
   - ไม่แตะค่า HG ของชิ้นงาน (Master Data) - ต่างจาก 30_ ข้อ 7
   - EDP_SYSTEM อ่านอย่างเดียว (SELECT) · เขียนเฉพาะ schema EDP ใน CHR-Nexus
   - @apply = 0 (ค่าเริ่มต้น) = ทดลองรัน แสดงจำนวนที่จะเปลี่ยนแล้ว ROLLBACK ทั้งหมด · ดูผลแล้วค่อยแก้เป็น 1 แล้วรันอีกครั้ง
   - เลข ID ชนกับแผนบนเว็บ (วันที่ >= @cut) = หยุด ไม่เปลี่ยนอะไร แล้วแจ้งจำนวน
   รันซ้ำได้
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> 'CHR-Nexus' THROW 50000, N'ต้องรันบนฐาน CHR-Nexus', 1;
IF DB_ID('EDP_SYSTEM') IS NULL THROW 50001, N'ไม่พบฐาน EDP_SYSTEM', 1;

DECLARE @cut DATE = '2026-11-16';   -- วันแรกที่ใช้ CHR-Nexus จริง (วันนี้ขึ้นไปไม่แตะ)
DECLARE @apply BIT = 0;             -- 0 = ทดลอง (ROLLBACK) · 1 = บันทึกจริง

-- รอบก่อนพังกลางทาง = IDENTITY_INSERT อาจค้าง ON ในหน้าต่างนี้
SET IDENTITY_INSERT EDP.PlanHeaders OFF; SET IDENTITY_INSERT EDP.PlanCards OFF;
SET IDENTITY_INSERT EDP.PlanEditLogs OFF; SET IDENTITY_INSERT EDP.PlanTimeFixLogs OFF;

BEGIN TRAN;
-- ล็อกตารางแผนระหว่างรัน (ไม่กี่วินาที): กันผู้ใช้เพิ่มการ์ด / Log ระหว่างที่สคริปต์กำลังเทียบข้อมูล · หน้าเว็บ EDP จะรอจนจบ
SELECT TOP 0 1 FROM EDP.PlanHeaders WITH (TABLOCKX, HOLDLOCK);
SELECT TOP 0 1 FROM EDP.PlanCards WITH (TABLOCKX, HOLDLOCK);
SELECT TOP 0 1 FROM EDP.PlanEditLogs WITH (TABLOCKX, HOLDLOCK);
SELECT TOP 0 1 FROM EDP.PlanTimeFixLogs WITH (TABLOCKX, HOLDLOCK);

IF OBJECT_ID('EDP.PartStocks') IS NULL OR NOT EXISTS (SELECT 1 FROM EDP.PartStocks)
    THROW 50002, N'ยังไม่ได้ตั้งคลังชิ้นงาน EDP (รัน 48_EDP_Part_Stocks.sql ก่อน)', 1;

-- ขอบเขต: หัวแผน / การ์ด / Log ของวันที่ < @cut ทั้งฝั่ง EDP_SYSTEM (E) และ CHR-Nexus (N)
DECLARE @eh TABLE (PLH_ID INT PRIMARY KEY);
INSERT INTO @eh SELECT PLH_ID FROM EDP_SYSTEM.dbo.TRN_PLAN_H WHERE PLH_DATE < @cut;
DECLARE @ed TABLE (PLD_ID INT PRIMARY KEY);
INSERT INTO @ed SELECT D.PLD_ID FROM EDP_SYSTEM.dbo.TRN_PLAN_D D JOIN @eh H ON H.PLH_ID = D.PLH_ID;
DECLARE @newh TABLE (PLH_ID INT PRIMARY KEY);   -- หัวแผนบนเว็บที่ห้ามแตะ
INSERT INTO @newh SELECT PLH_ID FROM EDP.PlanHeaders WHERE PLH_DATE >= @cut;
DECLARE @newd TABLE (PLD_ID INT PRIMARY KEY);
INSERT INTO @newd SELECT C.PLD_ID FROM EDP.PlanCards C JOIN @newh H ON H.PLH_ID = C.PLH_ID;

-- 0) เลข ID ชน: ID ของแผนเก่า (EDP_SYSTEM) ไปตรงกับแผนใหม่บนเว็บ = หยุดทั้งหมด
DECLARE @clashH INT = (SELECT COUNT(*) FROM @eh E JOIN @newh N ON N.PLH_ID = E.PLH_ID);
DECLARE @clashD INT = (SELECT COUNT(*) FROM @ed E JOIN @newd N ON N.PLD_ID = E.PLD_ID);
DECLARE @clashL INT = (SELECT COUNT(*) FROM EDP_SYSTEM.dbo.TRN_PLAN_EDIT_LOG E JOIN @ed D ON D.PLD_ID = E.PLD_ID
                       JOIN EDP.PlanEditLogs N ON N.LOG_ID = E.LOG_ID JOIN @newd W ON W.PLD_ID = N.PLD_ID);
DECLARE @clashT INT = (SELECT COUNT(*) FROM EDP_SYSTEM.dbo.TRN_PLAN_D_TIMEFIX_LOG E JOIN @ed D ON D.PLD_ID = E.PLD_ID
                       JOIN EDP.PlanTimeFixLogs N ON N.FIX_ID = E.FIX_ID JOIN @newd W ON W.PLD_ID = N.PLD_ID);
DECLARE @clashU INT = (SELECT COUNT(*) FROM EDP_SYSTEM.dbo.TRN_PLAN_H E JOIN @eh S ON S.PLH_ID = E.PLH_ID
                       JOIN EDP.PlanHeaders N ON N.PLH_DATE = E.PLH_DATE AND N.SHIFT = E.SHIFT AND N.PLH_ID <> E.PLH_ID);  -- วัน+กะ เดียวกันแต่คนละเลข (UNIQUE)
IF @clashH + @clashD + @clashL + @clashT + @clashU > 0
BEGIN
    ROLLBACK;
    SELECT @clashU AS SameDateShiftClash, @clashH AS HeaderIdClash, @clashD AS CardIdClash, @clashL AS EditLogIdClash, @clashT AS TimeFixIdClash;
    THROW 50003, N'เลข ID ของแผนเก่าชนกับแผนบนเว็บ (วันที่ >= @cut) - หยุด ไม่ได้เปลี่ยนอะไร ส่งผลนี้ให้ทีมพัฒนา', 1;
END;

-- ชิ้นงาน: PT_ID ของ EDP_SYSTEM -> Nexus PartID (เหมือน 30_)
DECLARE @vp TABLE (PartID INT PRIMARY KEY, Code NVARCHAR(100), StockID INT, SortNo INT);
INSERT INTO @vp (PartID, Code, StockID, SortNo)
SELECT V.PT_ID, LTRIM(RTRIM(V.PT_CODE)), V.PT_STOCK, E.SortNo
FROM EDP.vw_Parts V JOIN EDP.PartStocks E ON E.StockID = V.PT_STOCK
WHERE NULLIF(LTRIM(RTRIM(V.PT_CODE)), '') IS NOT NULL;
DECLARE @map TABLE (OLD_ID INT PRIMARY KEY, PartID INT, StockID INT);
INSERT INTO @map (OLD_ID, PartID, StockID)
SELECT M.PT_ID, X.PartID, X.StockID
FROM EDP_SYSTEM.dbo.MST_PART M
CROSS APPLY (SELECT TOP 1 V.PartID, V.StockID FROM @vp V WHERE V.Code = LTRIM(RTRIM(M.PT_CODE)) ORDER BY V.SortNo, V.PartID) X;

DECLARE @r TABLE (Step VARCHAR(30), N INT);
-- การ์ดแผนเก่า (ทั้งบนเว็บและ .exe): Log ที่ลบ / เทียบได้ต้องเป็นของการ์ดชุดนี้เท่านั้น
DECLARE @oldd TABLE (PLD_ID INT PRIMARY KEY);
INSERT INTO @oldd SELECT C.PLD_ID FROM EDP.PlanCards C JOIN EDP.PlanHeaders H ON H.PLH_ID = C.PLH_ID WHERE H.PLH_DATE < @cut
UNION SELECT PLD_ID FROM @ed;

-- 1) หัวแผน (เฉพาะวันที่ < @cut)
UPDATE N SET N.PLH_DATE = E.PLH_DATE, N.SHIFT = E.SHIFT, N.STAT = E.STAT
FROM EDP.PlanHeaders N JOIN EDP_SYSTEM.dbo.TRN_PLAN_H E ON E.PLH_ID = N.PLH_ID JOIN @eh S ON S.PLH_ID = E.PLH_ID
WHERE N.PLH_DATE <> E.PLH_DATE OR N.SHIFT <> E.SHIFT OR ISNULL(N.STAT, '') <> ISNULL(E.STAT, '');
INSERT INTO @r VALUES ('headers_updated', @@ROWCOUNT);

SET IDENTITY_INSERT EDP.PlanHeaders ON;
INSERT INTO EDP.PlanHeaders (PLH_ID, PLH_DATE, SHIFT, STAT, CREATE_BY, CREATE_AT)
SELECT E.PLH_ID, E.PLH_DATE, E.SHIFT, E.STAT, E.CREATE_BY, E.CREATE_AT
FROM EDP_SYSTEM.dbo.TRN_PLAN_H E JOIN @eh S ON S.PLH_ID = E.PLH_ID
WHERE NOT EXISTS (SELECT 1 FROM EDP.PlanHeaders N WHERE N.PLH_ID = E.PLH_ID);
INSERT INTO @r VALUES ('headers_added', @@ROWCOUNT);
SET IDENTITY_INSERT EDP.PlanHeaders OFF;

-- 2) การ์ดของแผนเก่าบนเว็บที่ .exe ไม่มี = เอาออก (ไม่แตะการ์ดของแผนวันที่ >= @cut)
DELETE N FROM EDP.PlanCards N JOIN EDP.PlanHeaders H ON H.PLH_ID = N.PLH_ID
WHERE H.PLH_DATE < @cut AND NOT EXISTS (SELECT 1 FROM @ed E WHERE E.PLD_ID = N.PLD_ID);
INSERT INTO @r VALUES ('cards_removed', @@ROWCOUNT);

-- 3) การ์ดที่ค่าไม่ตรง
UPDATE N SET N.PLH_ID = E.PLH_ID, N.PT_ID = X.PartID, N.TIME_START = E.TIME_START, N.TIME_END = E.TIME_END,
             N.QTY_PLAN = E.QTY_PLAN, N.HG_PLAN = E.HG_PLAN, N.QTY_ACT = E.QTY_ACT, N.HG_ACT = E.HG_ACT, N.REMARK = E.REMARK,
             N.IS_DONE = E.IS_DONE, N.IS_VISIBLE = E.IS_VISIBLE, N.IS_PROBLEM = E.IS_PROBLEM, N.ROUND_ID = E.ROUND_ID,
             N.OP_NAME = E.OP_NAME, N.QTY_DIFF = E.QTY_DIFF, N.CUR_STD_TIME_HG = E.CUR_STD_TIME_HG, N.TOTAL_TIME_MIN = E.TOTAL_TIME_MIN,
             N.TIME_DIFF_MIN = E.TIME_DIFF_MIN, N.ACCUM_DIFF_MIN = E.ACCUM_DIFF_MIN
FROM EDP.PlanCards N
JOIN EDP_SYSTEM.dbo.TRN_PLAN_D E ON E.PLD_ID = N.PLD_ID
JOIN @ed S ON S.PLD_ID = E.PLD_ID
LEFT JOIN @map X ON X.OLD_ID = E.PT_ID
WHERE EXISTS (SELECT N.PLH_ID, N.PT_ID, N.TIME_START, N.TIME_END, N.QTY_PLAN, N.HG_PLAN, N.QTY_ACT, N.HG_ACT, N.REMARK, N.IS_DONE, N.IS_VISIBLE, N.IS_PROBLEM, N.ROUND_ID, N.OP_NAME, N.QTY_DIFF, N.CUR_STD_TIME_HG, N.TOTAL_TIME_MIN, N.TIME_DIFF_MIN, N.ACCUM_DIFF_MIN
              EXCEPT
              SELECT E.PLH_ID, X.PartID, E.TIME_START, E.TIME_END, E.QTY_PLAN, E.HG_PLAN, E.QTY_ACT, E.HG_ACT, E.REMARK, E.IS_DONE, E.IS_VISIBLE, E.IS_PROBLEM, E.ROUND_ID, E.OP_NAME, E.QTY_DIFF, E.CUR_STD_TIME_HG, E.TOTAL_TIME_MIN, E.TIME_DIFF_MIN, E.ACCUM_DIFF_MIN);
INSERT INTO @r VALUES ('cards_updated', @@ROWCOUNT);

-- 4) การ์ดที่ยังไม่มี
SET IDENTITY_INSERT EDP.PlanCards ON;
INSERT INTO EDP.PlanCards (PLD_ID, PLH_ID, PT_ID, TIME_START, TIME_END, QTY_PLAN, HG_PLAN, QTY_ACT, REMARK, IS_DONE, QTY_DIFF, OP_NAME,
                           CUR_STD_TIME_HG, HG_ACT, TOTAL_TIME_MIN, TIME_DIFF_MIN, ACCUM_DIFF_MIN, IS_VISIBLE, IS_PROBLEM, ROUND_ID)
SELECT E.PLD_ID, E.PLH_ID, X.PartID, E.TIME_START, E.TIME_END, E.QTY_PLAN, E.HG_PLAN, E.QTY_ACT, E.REMARK, E.IS_DONE, E.QTY_DIFF, E.OP_NAME,
       E.CUR_STD_TIME_HG, E.HG_ACT, E.TOTAL_TIME_MIN, E.TIME_DIFF_MIN, E.ACCUM_DIFF_MIN, E.IS_VISIBLE, E.IS_PROBLEM, E.ROUND_ID
FROM EDP_SYSTEM.dbo.TRN_PLAN_D E JOIN @ed S ON S.PLD_ID = E.PLD_ID LEFT JOIN @map X ON X.OLD_ID = E.PT_ID
WHERE NOT EXISTS (SELECT 1 FROM EDP.PlanCards N WHERE N.PLD_ID = E.PLD_ID);
INSERT INTO @r VALUES ('cards_added', @@ROWCOUNT);
SET IDENTITY_INSERT EDP.PlanCards OFF;

-- 5) Log แก้ไขการ์ด ของการ์ดแผนเก่า: ให้ตรงกับ EDP_SYSTEM (Log ของการ์ดวันที่ >= @cut ไม่แตะ)
DELETE N FROM EDP.PlanEditLogs N
WHERE EXISTS (SELECT 1 FROM @oldd O WHERE O.PLD_ID = N.PLD_ID)
  AND NOT EXISTS (SELECT 1 FROM EDP_SYSTEM.dbo.TRN_PLAN_EDIT_LOG E JOIN @ed D ON D.PLD_ID = E.PLD_ID WHERE E.LOG_ID = N.LOG_ID AND E.PLD_ID = N.PLD_ID);
INSERT INTO @r VALUES ('edit_logs_removed', @@ROWCOUNT);
SET IDENTITY_INSERT EDP.PlanEditLogs ON;
INSERT INTO EDP.PlanEditLogs (LOG_ID, PLD_ID, OLD_CUST, OLD_PT_NO, OLD_QTY_PLAN, OLD_HG_PLAN, NEW_CUST, NEW_PT_NO, NEW_QTY_PLAN, NEW_HG_PLAN, IS_PROBLEM, REMARK, EDIT_BY, EDIT_DATE)
SELECT E.LOG_ID, E.PLD_ID, E.OLD_CUST, E.OLD_PT_NO, E.OLD_QTY_PLAN, E.OLD_HG_PLAN, E.NEW_CUST, E.NEW_PT_NO, E.NEW_QTY_PLAN, E.NEW_HG_PLAN, E.IS_PROBLEM, E.REMARK, E.EDIT_BY, E.EDIT_DATE
FROM EDP_SYSTEM.dbo.TRN_PLAN_EDIT_LOG E JOIN @ed D ON D.PLD_ID = E.PLD_ID
WHERE NOT EXISTS (SELECT 1 FROM EDP.PlanEditLogs N WHERE N.LOG_ID = E.LOG_ID);
INSERT INTO @r VALUES ('edit_logs_added', @@ROWCOUNT);
SET IDENTITY_INSERT EDP.PlanEditLogs OFF;

-- 6) Log แก้เวลา / สลับการ์ด ของการ์ดแผนเก่า
DELETE N FROM EDP.PlanTimeFixLogs N
WHERE EXISTS (SELECT 1 FROM @oldd O WHERE O.PLD_ID = N.PLD_ID)
  AND NOT EXISTS (SELECT 1 FROM EDP_SYSTEM.dbo.TRN_PLAN_D_TIMEFIX_LOG E JOIN @ed D ON D.PLD_ID = E.PLD_ID WHERE E.FIX_ID = N.FIX_ID AND E.PLD_ID = N.PLD_ID);
INSERT INTO @r VALUES ('timefix_removed', @@ROWCOUNT);
SET IDENTITY_INSERT EDP.PlanTimeFixLogs ON;
INSERT INTO EDP.PlanTimeFixLogs (FIX_ID, PLD_ID, OLD_TIME_START, NEW_TIME_START, OLD_ROUND_ID, NEW_ROUND_ID, FIXED_AT)
SELECT E.FIX_ID, E.PLD_ID, E.OLD_TIME_START, E.NEW_TIME_START, E.OLD_ROUND_ID, E.NEW_ROUND_ID, E.FIXED_AT
FROM EDP_SYSTEM.dbo.TRN_PLAN_D_TIMEFIX_LOG E JOIN @ed D ON D.PLD_ID = E.PLD_ID
WHERE NOT EXISTS (SELECT 1 FROM EDP.PlanTimeFixLogs N WHERE N.FIX_ID = E.FIX_ID);
INSERT INTO @r VALUES ('timefix_added', @@ROWCOUNT);
SET IDENTITY_INSERT EDP.PlanTimeFixLogs OFF;

-- 7) หัวแผนเก่าบนเว็บที่ .exe ไม่มีและไม่เหลือการ์ด = เอาออก
DELETE N FROM EDP.PlanHeaders N
WHERE N.PLH_DATE < @cut
  AND NOT EXISTS (SELECT 1 FROM @eh E WHERE E.PLH_ID = N.PLH_ID)
  AND NOT EXISTS (SELECT 1 FROM EDP.PlanCards C WHERE C.PLH_ID = N.PLH_ID);
INSERT INTO @r VALUES ('headers_removed', @@ROWCOUNT);

-- ผลหลังรัน (ก่อน COMMIT / ROLLBACK)
SELECT CASE WHEN @apply = 1 THEN N'บันทึกจริง' ELSE N'ทดลอง (ROLLBACK - ยังไม่เปลี่ยนอะไร)' END AS Mode, Step, N FROM @r;
SELECT (SELECT COUNT(*) FROM EDP.PlanCards C JOIN EDP.PlanHeaders H ON H.PLH_ID = C.PLH_ID WHERE H.PLH_DATE < @cut) AS NexusOldCards,
       (SELECT COUNT(*) FROM @ed) AS ExeOldCards,
       (SELECT COUNT(*) FROM @newd) AS WebCardsFromCutNotTouched,
       (SELECT COUNT(*) FROM EDP.PlanCards C JOIN EDP.PlanHeaders H ON H.PLH_ID = C.PLH_ID WHERE H.PLH_DATE < @cut AND NOT EXISTS (SELECT 1 FROM @ed E WHERE E.PLD_ID = C.PLD_ID)) AS OnlyNexusOld,  -- ควรเป็น 0
       (SELECT COUNT(*) FROM @ed E WHERE NOT EXISTS (SELECT 1 FROM EDP.PlanCards C WHERE C.PLD_ID = E.PLD_ID)) AS OnlyExeOld;  -- ควรเป็น 0

IF @apply = 1 COMMIT TRAN; ELSE ROLLBACK TRAN;
GO
