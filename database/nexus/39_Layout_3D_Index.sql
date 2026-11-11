/* ============================================================================
   CHR-Nexus : 🧊 LAYOUT 3D (CIMS › Layout 3D) - Index เพิ่มความเร็ว
   ----------------------------------------------------------------------------
   หน้า Layout 3D อ่านอย่างเดียว ไม่มีตาราง / คอลัมน์ใหม่: ใช้ข้อมูลเดิมทั้งหมด
     - Nexus.Coils (Status = 'IN')                    = ม้วนที่ยังอยู่ในคลัง
     - Nexus.CoilMoves (ผูก ScanTransactionID)        = รายการสแกนล่าสุดที่ทำให้ม้วนอยู่ในคลัง
     - Nexus.ScanTransactions.Layout                  = ตำแหน่งที่สแกน QR ไว้ตอนรับเข้า (20_Storage_Layout.sql)
   Script นี้เพิ่ม Index ให้หา "รายการล่าสุดของแต่ละม้วน" ได้เร็ว (เดิมมี Index ตาม ScanTransactionID อย่างเดียว)
   - ไม่รันก็ใช้หน้า Layout 3D ได้ แต่จะช้าลงเมื่อประวัติ CoilMoves เยอะ
   - รันซ้ำได้ (สร้างเมื่อยังไม่มี) · ไม่แก้ข้อมูล · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('Nexus.CoilMoves', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'Nexus.CoilMoves') AND name = N'IX_CoilMoves_Coil')
    CREATE NONCLUSTERED INDEX IX_CoilMoves_Coil ON Nexus.CoilMoves (CoilID, MoveID DESC)
        INCLUDE (ScanTransactionID, Action, ToStockID, ToStatus, Undone);
GO

SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'Nexus.CoilMoves') AND name = N'IX_CoilMoves_Coil') THEN 1 ELSE 0 END AS IX_CoilMoves_Coil;
