/* =====================================================================
   📋 MIN REPORT: เลือกผู้รับแจ้งเตือนรายคลัง (SETUP › MIN REPORT)
   - Nexus.MinReportStocks.AlertUsers = UserID คั่นด้วย , (ว่าง = ทุกคนที่ดูคลังนั้นได้ แบบเดิม)
   - เพิ่มคอลัมน์อย่างเดียว ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
   ===================================================================== */
IF COL_LENGTH('Nexus.MinReportStocks', 'AlertUsers') IS NULL
    ALTER TABLE Nexus.MinReportStocks ADD AlertUsers NVARCHAR(MAX) NULL;
GO
