/* ============================================================================
   CHR-Nexus : 🟢 สถานะ ONLINE ไม่ค้าง (Nexus.Users.LastSeenAt)
   ----------------------------------------------------------------------------
   - LastSeenAt = ครั้งล่าสุดที่โปรแกรม (เว็บ / WPF ที่อัพเดทแล้ว) แจ้งว่ายังใช้งานอยู่ (heartbeat ทุก 60 วินาที)
   - ONLINE แต่ LastSeenAt เก่ากว่า 3 นาที = ปิดโปรแกรม / ปิดหน้าต่าง / เน็ตหลุด -> ตั้ง OFFLINE ให้เอง และ Login เครื่องอื่นได้
   - LastSeenAt = NULL (WPF เวอร์ชันเก่าที่ยังไม่ส่ง heartbeat) = ไม่แตะ ใช้เงื่อนไขเดิม
   - รันซ้ำได้ · เพิ่มคอลัมน์อย่างเดียว ไม่แก้ / ลบข้อมูลเดิม · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.Users', 'LastSeenAt') IS NULL
    ALTER TABLE Nexus.Users ADD LastSeenAt DATETIME2(0) NULL;
GO
