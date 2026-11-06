/* ============================================================================
   CHR-Nexus : 📋 MIN REPORT - ตัวเลือกหมายเหตุ (SETUP › MIN REASONS : เพิ่ม / แก้ไข / ลบ / เรียงลำดับ)
   ----------------------------------------------------------------------------
   Nexus.MinReportReasons = ปุ่มหมายเหตุที่เลือกได้ตอนกด REPORT (เรียงตาม SortNo)
   - สร้างตารางใหม่อย่างเดียว · ไม่แก้ตารางเดิม · รายงานเก่าเก็บข้อความหมายเหตุไว้ในตัวเองแล้ว (แก้ / ลบตัวเลือกไม่กระทบ)
   - ใส่ตัวเลือกเริ่มต้นให้เมื่อตารางยังว่าง · รันซ้ำได้ · ใช้กับฐาน CHR-Nexus เท่านั้น
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_NAME() <> N'CHR-Nexus'
BEGIN
    RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1);
    RETURN;
END;

IF OBJECT_ID(N'Nexus.MinReportReasons', N'U') IS NULL
    CREATE TABLE Nexus.MinReportReasons
    (
        ReasonID    INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_MinReportReasons PRIMARY KEY,
        ReasonText  NVARCHAR(60)  NOT NULL,
        SortNo      INT           NOT NULL CONSTRAINT DF_MinReportReasons_SortNo DEFAULT (0),
        UpdatedBy   NVARCHAR(50)  NULL,
        UpdatedDate DATETIME      NOT NULL CONSTRAINT DF_MinReportReasons_Updated DEFAULT (GETDATE())
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MinReportReasons_Text' AND object_id = OBJECT_ID(N'Nexus.MinReportReasons'))
    CREATE UNIQUE INDEX UX_MinReportReasons_Text ON Nexus.MinReportReasons (ReasonText);
GO

IF NOT EXISTS (SELECT 1 FROM Nexus.MinReportReasons)
    INSERT INTO Nexus.MinReportReasons (ReasonText, SortNo, UpdatedBy)
    VALUES (N'กำลังผลิต', 1, N'SYSTEM'), (N'รอ Box FG', 2, N'SYSTEM'), (N'รอ Check', 3, N'SYSTEM'), (N'รอ Q-Gate', 4, N'SYSTEM'),
           (N'รอซ่อม', 5, N'SYSTEM'), (N'ปัญหาคุณภาพ', 6, N'SYSTEM'), (N'ยังไม่มีแผนผลิต', 7, N'SYSTEM'), (N'รอของจาก Supplier', 8, N'SYSTEM'),
           (N'PR อยู่ระหว่างอนุมัติ', 9, N'SYSTEM'), (N'ใช้มากกว่าปกติ / Order เพิ่ม', 10, N'SYSTEM'), (N'ปรับค่า MIN / MAX ใหม่แล้ว', 11, N'SYSTEM');
GO
