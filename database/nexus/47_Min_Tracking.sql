-- ============================================================================
-- 47_Min_Tracking.sql  (CHR-Nexus เท่านั้น)
-- 📈 MIN TRACKING: ติดตามการเคลื่อนไหวของสินค้าที่อยู่ใต้ MIN รายวัน
--    Nexus.MinWatchDays = ต่อช่วงใต้ MIN ต่อวัน: ยอดต้นวัน / ล่าสุด · อัพเดทกี่ครั้ง · MIN / MAX ของวันนั้น (MinWatchService บันทึกเอง)
--    Nexus.MinWatch.ResolvedQty = ยอดตอนกลับเป็นเขียว (พ้น MIN)
-- ============================================================================
SET NOCOUNT ON;
IF OBJECT_ID('Nexus.MinWatchDays') IS NULL
    CREATE TABLE Nexus.MinWatchDays (
        WatchID   INT            NOT NULL,
        [Day]     DATE           NOT NULL,
        FirstQty  DECIMAL(18, 3) NULL,
        LastQty   DECIMAL(18, 3) NULL,
        MinQty    DECIMAL(18, 3) NULL,
        MaxQty    DECIMAL(18, 3) NULL,
        Moves     INT            NOT NULL CONSTRAINT DF_MinWatchDays_Moves DEFAULT (0),
        UpdatedAt DATETIME       NOT NULL CONSTRAINT DF_MinWatchDays_At DEFAULT (GETDATE()),
        CONSTRAINT PK_MinWatchDays PRIMARY KEY (WatchID, [Day])
    );
IF COL_LENGTH('Nexus.MinWatch', 'ResolvedQty') IS NULL
    ALTER TABLE Nexus.MinWatch ADD ResolvedQty DECIMAL(18, 3) NULL;
GO
-- ช่วงที่ยังเปิดอยู่: เริ่มบันทึกของวันนี้จากยอดล่าสุดที่มี
INSERT INTO Nexus.MinWatchDays (WatchID, [Day], FirstQty, LastQty, MinQty, MaxQty)
SELECT W.WatchID, CAST(GETDATE() AS DATE), W.Qty, W.Qty, W.MinQty, W.MaxQty
FROM Nexus.MinWatch W
WHERE W.ResolvedAt IS NULL AND NOT EXISTS (SELECT 1 FROM Nexus.MinWatchDays D WHERE D.WatchID = W.WatchID AND D.[Day] = CAST(GETDATE() AS DATE));
SELECT COUNT(*) AS DaysRows FROM Nexus.MinWatchDays;
