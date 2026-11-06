/* ============================================================================
   CHR-Nexus : 🔐 รหัสผ่านแบบ Hash (PBKDF2-SHA256 · Salt ต่อคน · 120,000 รอบ)
   ----------------------------------------------------------------------------
   Nexus.Users.PasswordHash = รูปแบบ PBKDF2$120000$<salt>$<hash> (สร้างโดย API: PasswordStore.cs)
   - เพิ่มคอลัมน์ NULL อย่างเดียว · ไม่แก้ / ไม่ลบคอลัมน์ Password เดิม (โปรแกรม CIMS Windows ยังใช้ตรวจ)
   - API เปิดขึ้นมา = สร้าง Hash ให้บัญชีเดิมทั้งหมดเองเบื้องหลัง · ตั้ง / เปลี่ยนรหัสจากเว็บ = เขียน Hash เสมอ
   - ภายหลังเมื่อ CIMS เปลี่ยนมาตรวจ Hash แล้ว จึงล้างคอลัมน์ Password ได้ (API จะใช้ Hash อย่างเดียวอัตโนมัติ)
   - รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF COL_LENGTH('Nexus.Users', 'PasswordHash') IS NULL
    ALTER TABLE Nexus.Users ADD PasswordHash NVARCHAR(200) NULL;
GO
