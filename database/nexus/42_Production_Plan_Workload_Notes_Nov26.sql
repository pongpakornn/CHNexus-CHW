-- =====================================================================
-- 42_Production_Plan_Workload_Notes_Nov26.sql : 📝 เหตุผลที่ยอด Workload ตรง / ไม่ตรงกับไฟล์ Excel "11. Work load November 26"
--   จากการเทียบไฟล์ Capacity ของแต่ละหน่วยงาน (ธ.ค. 26 ครบทุกหน่วยงาน · พ.ย. / ต.ค. / ม.ค. 27 เฉพาะ PRESS 1) กับระบบ
--   ใส่เฉพาะที่ยังไม่มี (ไม่ทับหมายเหตุที่แก้ไว้ที่หน้า Workload) · ฐาน CHR-Nexus เท่านั้น · รันซ้ำได้
-- =====================================================================
IF DB_NAME() <> N'CHR-Nexus' BEGIN RAISERROR(N'Run this script on the CHR-Nexus database only.', 16, 1); RETURN; END;
GO
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'QC')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'QC', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'QC')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'QC', N'ยังไม่มีไฟล์ Capacity เดือน พ.ย. 26 ของหน่วยงานนี้ จึงยังแยกทีละรายการไม่ได้
จากการตรวจเดือน ธ.ค. 26 (ไฟล์ครบ) สาเหตุหลักคือ PCS: ไฟล์ Excel ใช้ยอดจากไฟล์ FORECAST / CHR_FORECAST_MASTER คนละวันกับยอดที่ Import เข้าระบบ (1–2 พ.ย.)
Direct ของ QC ไฟล์ Work load ไม่ดึงมา (เป็น 0 ทั้งสองแบบ)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'QC')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'QC', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 134,167 / Excel 137,794
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 137,794 = ตรงกับ Excel ทุกหลัก → สูตรและ STD ถูกต้อง ส่วนต่างทั้งหมดมาจากยอด PCS
• PART A 69 รายการ · PCS ไม่ตรง 26 รายการ: 23 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 1 รายการ Excel พิมพ์ 0 เอง · 2 รายการ Excel / ระบบใช้ยอดอื่น
• Direct: ไฟล์ Work load ไม่ดึง Direct ของ QC (เป็น 0 ทั้งสองแบบ)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'QC')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'QC', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'QC')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'QC', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'PRESS1')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'PRESS1', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'PRESS1')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'PRESS1', N'PDT ตรงกับ Excel (1,216,735) เพราะ
• PCS ในระบบ (Import 1–2 พ.ย.) = ยอดใน CHR_FORECAST_MASTER ที่ไฟล์ PRESS 1 ใช้ (Order 6 รายการ KFTC / HMMT อัพเดทให้ตรงแล้ว)
• แถวที่ Excel พิมพ์ PCS = 0 เอง 7 แถว (TDM 300-03 2 แถว · NACHI 5 แถว เพราะผลิตที่เครื่องอื่นแล้ว) ตั้งไว้ในระบบแล้ว (ตัว M ที่หน้า Capacity)
Direct ต่าง +5.16 คน (ระบบ 38.45 / Excel 33.29) เพราะ Excel พิมพ์ Req. Man power เอง 2 เครื่อง: TRBS 250-02 = 6 (สูตรได้ 4.79) และ NACHI = 4 (สูตรได้ 10.38 จาก 5 เครื่อง)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'PRESS1')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'PRESS1', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 1,061,454 / Excel 1,074,249
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 1,074,249 = ตรงกับ Excel ทุกหลัก → สูตรและ STD ถูกต้อง ส่วนต่างทั้งหมดมาจากยอด PCS
• PART A 271 รายการ · PCS ไม่ตรง 96 รายการ: 80 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 1 รายการ Excel พิมพ์ 0 เอง · 15 รายการ Excel / ระบบใช้ยอดอื่น
• Direct ระบบ 31.03 · ใช้ PCS เดียวกับ Excel = 32.32 · Excel 29.91 → ส่วนต่างที่เหลือ = Excel กรอก Req. Man power เองบางเครื่อง (แบบเดือน พ.ย.)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'PRESS1')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'PRESS1', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'PRESS1')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'PRESS1', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'PRESS2')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'PRESS2', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'PRESS2')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'PRESS2', N'ยังไม่มีไฟล์ Capacity เดือน พ.ย. 26 ของหน่วยงานนี้ จึงยังแยกทีละรายการไม่ได้
จากการตรวจเดือน ธ.ค. 26 (ไฟล์ครบ) สาเหตุหลักคือ PCS: ไฟล์ Excel ใช้ยอดจากไฟล์ FORECAST / CHR_FORECAST_MASTER คนละวันกับยอดที่ Import เข้าระบบ (1–2 พ.ย.)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'PRESS2')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'PRESS2', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 948,396 / Excel 867,811
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 867,811 = ตรงกับ Excel ทุกหลัก → สูตรและ STD ถูกต้อง ส่วนต่างทั้งหมดมาจากยอด PCS
• PART A 192 รายการ · PCS ไม่ตรง 84 รายการ: 72 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 1 รายการ Excel พิมพ์ 0 เอง · 11 รายการ Excel / ระบบใช้ยอดอื่น
• Direct ระบบ 24.17 · ใช้ PCS เดียวกับ Excel = 22.98 · Excel 25.64 → Excel กรอก Req. Man power เองบางโซน', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'PRESS2')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'PRESS2', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'PRESS2')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'PRESS2', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'ASSEMBLY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'ASSEMBLY', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'ASSEMBLY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'ASSEMBLY', N'ยังไม่มีไฟล์ Capacity เดือน พ.ย. 26 ของหน่วยงานนี้ จึงยังแยกทีละรายการไม่ได้
จากการตรวจเดือน ธ.ค. 26 (ไฟล์ครบ) สาเหตุหลักคือ PCS: ไฟล์ Excel ใช้ยอดจากไฟล์ FORECAST / CHR_FORECAST_MASTER คนละวันกับยอดที่ Import เข้าระบบ (1–2 พ.ย.)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'ASSEMBLY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'ASSEMBLY', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 14,770 / Excel 15,766
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 15,766 = ตรงกับ Excel ทุกหลัก → สูตรและ STD ถูกต้อง ส่วนต่างทั้งหมดมาจากยอด PCS
• PART A 28 รายการ · PCS ไม่ตรง 11 รายการ: 6 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 2 รายการ Excel พิมพ์ 0 เอง · 3 รายการ Excel / ระบบใช้ยอดอื่น
• Direct ระบบ 2.91 · ใช้ PCS เดียวกับ Excel = 3.00 · Excel 6.18 → Excel กรอก Req. Man power เองบางกลุ่ม', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'ASSEMBLY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'ASSEMBLY', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'ASSEMBLY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'ASSEMBLY', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'PIPEPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'PIPEPART', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'PIPEPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'PIPEPART', N'ยังไม่มีไฟล์ Capacity เดือน พ.ย. 26 ของหน่วยงานนี้ จึงยังแยกทีละรายการไม่ได้
จากการตรวจเดือน ธ.ค. 26 (ไฟล์ครบ) สาเหตุหลักคือ PCS: ไฟล์ Excel ใช้ยอดจากไฟล์ FORECAST / CHR_FORECAST_MASTER คนละวันกับยอดที่ Import เข้าระบบ (1–2 พ.ย.)
และเครื่อง 1.2 Cleaning ของ Excel รวมยอดไม่ครบทุกแถว (เดือน ธ.ค. ต่าง 50,976)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'PIPEPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'PIPEPART', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 1,165,324 / Excel 1,160,034
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 1,211,010
• PART A 110 รายการ · PCS ไม่ตรง 49 รายการ: 41 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 1 รายการ Excel พิมพ์ 0 เอง · 7 รายการ Excel / ระบบใช้ยอดอื่น
• โครงสร้างตาราง: เครื่อง 1.2 Cleaning: Excel รวมได้ 382,694 แต่ระบบรวมได้ 433,670 (+50,976) ด้วย PCS เดียวกัน → บางแถวในชีท Cleaning ของ Excel ไม่ถูกรวม (ต้องตรวจกับผู้ทำไฟล์) เครื่องอื่นตรงทุกเครื่อง
• Direct ระบบ 26.04 · ใช้ PCS เดียวกับ Excel = 27.01 · Excel 25.79', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'PIPEPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'PIPEPART', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'PIPEPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'PIPEPART', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'PIPEASSY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'PIPEASSY', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'PIPEASSY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'PIPEASSY', N'ยังไม่มีไฟล์ Capacity เดือน พ.ย. 26 ของหน่วยงานนี้ จึงยังแยกทีละรายการไม่ได้
จากการตรวจเดือน ธ.ค. 26 (ไฟล์ครบ) สาเหตุหลักคือ PCS: ไฟล์ Excel ใช้ยอดจากไฟล์ FORECAST / CHR_FORECAST_MASTER คนละวันกับยอดที่ Import เข้าระบบ (1–2 พ.ย.)
และ Excel ไม่นับ Group 1 Spot 076E · Group 5 Final Brazing คิดต่างจากระบบ', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'PIPEASSY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'PIPEASSY', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 379,537 / Excel 383,235
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 377,220
• PART A 113 รายการ · PCS ไม่ตรง 51 รายการ: 44 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 1 รายการ Excel พิมพ์ 0 เอง · 6 รายการ Excel / ระบบใช้ยอดอื่น
• โครงสร้างตาราง: Excel ไม่นับ Group 1 Spot 076E (712) และ Group 5 Final Brazing Excel = 76,594 แต่ระบบ = 69,867 (−6,727) ด้วย PCS เดียวกัน เครื่องอื่นตรงทุกเครื่อง
• Direct ระบบ 50.64 · ใช้ PCS เดียวกับ Excel = 50.46 · Excel 41.41 (ต่าง 9 คน) → Excel กรอก Req. Man power เองหลายกลุ่ม ต้องตรวจรายกลุ่มกับผู้ทำไฟล์', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'PIPEASSY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'PIPEASSY', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'PIPEASSY')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'PIPEASSY', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-10-01' AND RowKey = 'PAINTPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-10-01', 'PAINTPART', N'เดือน N-1 (ต.ค. 26): Excel ใช้ไฟล์ Capacity ต.ค. ของหน่วยงาน · ระบบคำนวณจาก Forecast / Order ที่มีในระบบตอนนี้ (ไม่ใช่ยอด ณ วันทำแผน)
มีไฟล์ ต.ค. เฉพาะ PRESS 1 (ตั้ง PCS = 0 ที่ Excel พิมพ์เองให้แล้ว 16 แถว) · หน่วยงานอื่นยังแยกรายการไม่ได้', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-11-01' AND RowKey = 'PAINTPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-11-01', 'PAINTPART', N'ยังไม่มีไฟล์ Capacity เดือน พ.ย. 26 ของหน่วยงานนี้ จึงยังแยกทีละรายการไม่ได้
จากการตรวจเดือน ธ.ค. 26 (ไฟล์ครบ) สาเหตุหลักคือ PCS: ไฟล์ Excel ใช้ยอดจากไฟล์ FORECAST / CHR_FORECAST_MASTER คนละวันกับยอดที่ Import เข้าระบบ (1–2 พ.ย.)
และตาราง TABLE ของ Excel ไม่นับ Group 1 BACKPLATE ZF / Group 3 (ระบบนับทุกเครื่อง)', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2026-12-01' AND RowKey = 'PAINTPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2026-12-01', 'PAINTPART', N'ไฟล์ Capacity ธ.ค. 26 ของหน่วยงานนี้มีครบ จึงเทียบได้ทีละรายการ
• PDT ระบบ 379,541 / Excel 349,263
• ทดลองให้ระบบใช้ PCS ชุดเดียวกับไฟล์ Excel (สูตร / STD เดิม) ได้ 419,030
• PART A 323 รายการ · PCS ไม่ตรง 144 รายการ: 47 รายการ Excel ใช้ยอด Forecast ธ.ค. ตามไฟล์ FORECAST 2026 แต่ระบบยังเป็นยอดที่ Import เมื่อ 1–2 พ.ย. · 4 รายการ Excel พิมพ์ 0 เอง · 93 รายการ Excel / ระบบใช้ยอดอื่น
• โครงสร้างตาราง: ตาราง TABLE ของ Excel ไม่นับ Group 1 BACKPLATE ZF (25,618) และ Group 3 SPOT BKT + Final CHW (44,149) รวม 69,767 แต่ระบบนับทุกเครื่อง
• Direct ระบบ 19.80 · ใช้ PCS เดียวกับ Excel = 21.21 · Excel 16.10 → มาจาก Group 1 / Group 3 ที่ Excel ไม่นับ + คนที่กรอกเอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-01-01' AND RowKey = 'PAINTPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-01-01', 'PAINTPART', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง', 'ANALYSIS');
IF NOT EXISTS (SELECT 1 FROM ProductionPlan.WorkloadNotes WHERE MonthStart = '2027-02-01' AND RowKey = 'PAINTPART')
    INSERT INTO ProductionPlan.WorkloadNotes (MonthStart, RowKey, Note, UpdatedBy) VALUES ('2027-02-01', 'PAINTPART', N'ระบบยังไม่มี Forecast / Order ปี 2027 (ไฟล์ FORECAST 2026 มีถึง ธ.ค. 26) → PDT / Direct ของระบบ = 0
Excel ใช้ไฟล์ Capacity เดือนนั้นของหน่วยงาน (ยอดจากไฟล์ Forecast ปี 2027 ของฝ่ายขาย)
แก้ไข: นำเข้าไฟล์ FORECAST 2027 ที่ MASTER DATA › Forecast / Order › FORECAST FILE แล้วระบบจะคำนวณให้เอง
และยังไม่ได้ตั้ง Company Workdays เดือน ก.พ. 27 (ใช้ จันทร์–เสาร์ ไปก่อน)', 'ANALYSIS');
GO
