-- ============================================================================
-- 49_Min_Last_Move.sql  (CHR-Nexus เท่านั้น · ไม่แตะ CIMS / StorePC)
-- 🔁 MIN REPORT: รายการที่รายงานแล้ว จะแจ้งเตือนอีกครั้งเมื่อ "ไม่มีการเคลื่อนไหวครบ StuckDays วัน" (ตาม SETUP เช่น 3 วัน)
--    นับจากเวลาล่าสุดของ (รายงาน / ยอดเปลี่ยน) · ยอดกลับไม่ต่ำกว่า MIN = ปิดรอบ ไม่แจ้งเตือนอีก
--    Nexus.MinWatch.LastMoveAt = เวลาที่ยอดเปลี่ยนล่าสุดขณะใต้ MIN (Min watcher เขียนทุกรอบที่ยอดต่างจากเดิม)
-- ============================================================================
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF COL_LENGTH('Nexus.MinWatch', 'LastMoveAt') IS NULL
    ALTER TABLE Nexus.MinWatch ADD LastMoveAt DATETIME NULL;
GO
SET QUOTED_IDENTIFIER ON;
-- ค่าตั้งต้นจากยอดรายวันที่เก็บไว้ (47_Min_Tracking.sql): วันที่มีการเปลี่ยนยอดล่าสุด
IF OBJECT_ID('Nexus.MinWatchDays') IS NOT NULL
    UPDATE W SET W.LastMoveAt = D.LastMove
    FROM Nexus.MinWatch W
    JOIN (SELECT WatchID, MAX(UpdatedAt) AS LastMove FROM Nexus.MinWatchDays WHERE Moves > 0 GROUP BY WatchID) D ON D.WatchID = W.WatchID
    WHERE W.LastMoveAt IS NULL;
GO
SELECT COUNT(*) AS OpenWatches, SUM(CASE WHEN LastMoveAt IS NOT NULL THEN 1 ELSE 0 END) AS WithMove FROM Nexus.MinWatch WHERE ResolvedAt IS NULL;
