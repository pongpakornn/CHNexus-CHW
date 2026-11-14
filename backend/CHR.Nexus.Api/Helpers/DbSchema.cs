using Nexus.Core;
using Microsoft.Data.SqlClient;
using System;

namespace Nexus.Helpers
{
    // ตรวจว่าฐานข้อมูลรัน Script อัพเดทแล้วหรือยัง (เช็กครั้งเดียวต่อการเปิดโปรแกรม)
    // ยังไม่รัน -> โปรแกรมเวอร์ชันใหม่ยังเปิดใช้กับฐานเดิมได้ (ฟีเจอร์ใหม่ปิดไว้ก่อน) แทนที่จะ Error ทั้งโปรแกรม
    public static class DbSchema
    {
        private static bool? _allowDecimal;
        private static bool? _liveSource;
        private static bool? _countCoil;
        private static bool? _columnOrder;
        private static bool? _coilRegister;

        // Update_20261015.sql: Nexus.UserScanStocks (คลังสแกนที่ Admin กำหนดให้แต่ละ UserID) / Nexus.AdminContacts (ผู้ติดต่อ Admin)
        private static bool? _userScanStocks, _adminContacts;
        public static bool HasUserScanStocks => _userScanStocks ?? (_userScanStocks = TableExists("Nexus.UserScanStocks")) ?? false;
        public static bool HasAdminContacts => _adminContacts ?? (_adminContacts = TableExists("Nexus.AdminContacts")) ?? false;

        // database/nexus/03_Add_Support.sql: แชทแจ้ง Admin (Nexus.SupportThreads + Nexus.SupportMessages)
        private static bool? _support;
        public static bool HasSupport => _support ?? (_support = TableExists("Nexus.SupportMessages") == true && MsgEditExists()) ?? false;

        // database/nexus/04_Add_Chat.sql: แชทระหว่างผู้ใช้ (Nexus.ChatMessages)
        private static bool? _chat;
        public static bool HasChat => _chat ?? (_chat = TableExists("Nexus.ChatMessages") == true && MsgEditExists()) ?? false;

        // database/nexus/05_Chat_EditDelete.sql + 06_Chat_Attach_React.sql: แก้ไข / ลบ / แนบไฟล์ / อีโมจิ (ต้องมีก่อนเปิดแชท / แจ้ง Admin)
        private static bool MsgEditExists()
        {
            try
            {
                using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.ChatMessages', 'EditedAt') IS NOT NULL AND COL_LENGTH('Nexus.SupportMessages', 'EditedAt') IS NOT NULL AND COL_LENGTH('Nexus.ChatMessages', 'AttachName') IS NOT NULL AND COL_LENGTH('Nexus.SupportMessages', 'AttachName') IS NOT NULL AND OBJECT_ID('Nexus.ChatReactions', 'U') IS NOT NULL THEN 1 ELSE 0 END", conn))
                {
                    conn.Open();
                    return Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
            }
            catch { return false; }
        }

        // Update_20261016.sql: Nexus.UserScanStocks.ShowDeduct (ปุ่ม DEDUCTED / NOT DEDUCTED ตาม UserID + คลัง)
        private static bool? _scanDeduct;
        public static bool HasScanDeduct
        {
            get
            {
                if (_scanDeduct.HasValue) return _scanDeduct.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.UserScanStocks', 'ShowDeduct') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _scanDeduct = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _scanDeduct.Value;
            }
        }

        // Update_20261016b.sql: Nexus.DeductMisses.Status (PENDING = ยังไม่รับเข้า รอ APPROVE / RECEIVED / APPROVED / REGISTERED)
        private static bool? _missStatus;
        public static bool HasMissStatus
        {
            get
            {
                if (_missStatus.HasValue) return _missStatus.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.DeductMisses', 'Status') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _missStatus = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _missStatus.Value;
            }
        }

        // Update_20261016c.sql: Nexus.Parts.PartB + Nexus.Stocks.ShowColPartB (PART B) / Nexus.ProductControlSettings (ตารางหน้า Inventory Registration + QR ต่อคลัง)
        private static bool? _partB, _pcSettings;
        public static bool HasPartB
        {
            get
            {
                if (_partB.HasValue) return _partB.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.Parts', 'PartB') IS NOT NULL AND COL_LENGTH('Nexus.Stocks', 'ShowColPartB') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _partB = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _partB.Value;
            }
        }
        // Update_20261017.sql: PR ตามคลัง (Nexus.PRHeaders.StockID / PRDetails.PartID / Stocks.PRExportPath)
        private static bool? _prStock;
        public static bool HasPrStock
        {
            get
            {
                if (_prStock.HasValue) return _prStock.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.PRHeaders', 'StockID') IS NOT NULL AND COL_LENGTH('Nexus.PRDetails', 'PartID') IS NOT NULL AND COL_LENGTH('Nexus.Stocks', 'PRExportPath') IS NOT NULL AND COL_LENGTH('Nexus.Stocks', 'PRExcelMap') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _prStock = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _prStock.Value;
            }
        }

        public static bool HasProductControlSettings => _pcSettings ?? (_pcSettings = TableExists("Nexus.ProductControlSettings")) ?? false;

        // Update_20261017b.sql: Nexus.ProductControlSettings.QrFields / QrLabel (QR รูปแบบที่ 1 ข้อความใต้ QR / รูปแบบที่ 2 สิ่งที่อยู่ใน QR)
        private static bool? _qrFields;
        public static bool HasQrFields
        {
            get
            {
                if (_qrFields.HasValue) return _qrFields.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.ProductControlSettings', 'QrFields') IS NOT NULL AND COL_LENGTH('Nexus.ProductControlSettings', 'QrLabel') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _qrFields = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _qrFields.Value;
            }
        }

        // database/nexus/16_Qr_Separator.sql: Nexus.ProductControlSettings.QrSep (ตัวคั่นช่องใน QR ระบบ ตั้งเองต่อคลัง)
        private static bool? _qrSep;
        public static bool HasQrSep
        {
            get
            {
                if (_qrSep.HasValue) return _qrSep.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.ProductControlSettings', 'QrSep') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _qrSep = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _qrSep.Value;
            }
        }

        // Update_20261020b.sql: EMPLOYEE ID / DEPARTMENT ที่หน้า Multi-Scanner (Nexus.UserScanStocks.AskEmployee / AskDepartment +
        //   Nexus.ScanTransactions.EmployeeID / Department) · Nexus.ScanDepartments (Dropdown แผนก) · Nexus.ScanRpaLayouts (EXPORT RPA)
        private static bool? _scanWho, _scanDepartments, _scanRpa;
        // database/nexus/07_Coil_Remark.sql: Nexus.Coils.Remark (หมายเหตุของ Coil ลูก)
        private static bool? _coilRemark;
        public static bool HasCoilRemark => _coilRemark ?? (_coilRemark = ColumnIn("Nexus.Coils", "Remark")) ?? false;
        // database/nexus/09_ProductControl_FormFields.sql: ช่องกรอกลงทะเบียนตามคลัง + น้ำหนักสินค้า (Nexus.Parts.WeightKG)
        private static bool? _formFields, _partWeight;
        public static bool HasFormFields => _formFields ?? (_formFields = ColumnIn("Nexus.ProductControlSettings", "FormFields")) ?? false;
        public static bool HasPartWeight => _partWeight ?? (_partWeight = ColumnIn("Nexus.Parts", "WeightKG")) ?? false;
        public static bool HasScanWho => _scanWho ?? (_scanWho = ColumnIn("Nexus.ScanTransactions", "EmployeeID")) ?? false;
        public static bool HasScanDepartments => _scanDepartments ?? (_scanDepartments = TableExists("Nexus.ScanDepartments")) ?? false;
        // database/nexus/43_User_Org_Options.sql: ตัวเลือก POSITION / ฝ่าย / แผนก / หน่วยงาน ของฟอร์มผู้ใช้
        private static bool _userOrg;
        public static bool HasUserOrg => _userOrg || (_userOrg = TableExists("Nexus.UserOrgOptions") == true);
        public static bool HasScanRpa => _scanRpa ?? (_scanRpa = TableExists("Nexus.ScanRpaLayouts")) ?? false;
        // database/nexus/17_Scan_Qr_Suffix.sql: ต่อท้าย QR ตอนสแกนรับเข้า (DATE / REF / RUNNING ต่อ UserID + คลัง) + เลขรันนิ่งรายวันของคลัง
        private static bool? _scanQrSuffix;
        public static bool HasScanQrSuffix => _scanQrSuffix ?? (_scanQrSuffix = ColumnIn("Nexus.UserScanStocks", "QrRunStart") is bool c && TableExists("Nexus.ScanQrRunning") is bool t ? c && t : (bool?)null) ?? false;

        // database/nexus/18_Coil_Manage.sql: ประวัติ MANAGE STOCK ของคลัง Coil (ยังไม่รัน = ถามใหม่ทุกครั้ง รันแล้วใช้ได้ทันทีไม่ต้อง Restart)
        private static bool _coilManage;
        public static bool HasCoilManageLog => _coilManage || (_coilManage = TableExists("Nexus.CoilManageLog") ?? false);

        // database/nexus/19_Min_Report.sql: 📋 MIN REPORT (ค้างที่ MIN นานเกินกำหนด -> แจ้งเตือน + รายงานสาเหตุ)
        private static bool _minReport;
        public static bool HasMinReport => _minReport || (_minReport = TableExists("Nexus.MinReports") == true && TableExists("Nexus.MinWatch") == true && TableExists("Nexus.MinReportSettings") == true);

        // 📈 MIN TRACKING (47_Min_Tracking.sql): Nexus.MinWatchDays (ยอดรายวันช่วงใต้ MIN) · MinWatch.ResolvedQty
        private static bool _minTrack;
        public static bool HasMinTracking => _minTrack || (_minTrack = HasMinReport && TableExists("Nexus.MinWatchDays") == true && ColumnIn("Nexus.MinWatch", "ResolvedQty") == true);

        // ✍ MIN REPORT (21_Min_Report_Sign.sql): รูปแบบการแสดงสินค้าต่อคลัง + FLOW ลายเซ็น Prepared / Checked / Checked / Approved
        private static bool _minSign;
        public static bool HasMinSign => _minSign || (_minSign = HasMinReport && TableExists("Nexus.MinReportDisplay") == true && TableExists("Nexus.MinReportFlow") == true
                                                                 && TableExists("Nexus.MinReportSigns") == true && ColumnIn("Nexus.MinReports", "DoneAt") == true);

        // 📋 MIN REPORT ตัวเลือกหมายเหตุ (23_Min_Report_Reasons.sql): SETUP › MIN REASONS
        private static bool _minReason;
        public static bool HasMinReason => _minReason || (_minReason = TableExists("Nexus.MinReportReasons") == true);

        // 🗂 MASTER DATA (24_Master_Data.sql): Master.Customers / Master.Suppliers (Schema ของระบบ)
        private static bool _master;
        public static bool HasMasterData => _master || (_master = TableExists("Master.Customers") == true && TableExists("Master.Suppliers") == true);

        // 🏭 EDP PLANNING (26_EDP_Planning.sql): EDP.PlanHeaders / EDP.PlanCards / EDP.vw_Parts (view)
        private static bool _edp;
        public static bool HasEdp => _edp || (_edp = TableExists("EDP.PlanCards") == true && TableExists("EDP.PlanTemplates") == true);

        // 📈 PRODUCTION PLAN (33_Production_Plan.sql): ProductionPlan.Machines / MachineParts / DailyActuals
        private static bool _pp;
        public static bool HasProductionPlan => _pp || (_pp = TableExists("ProductionPlan.Machines") == true && TableExists("ProductionPlan.MachineParts") == true
                                                             && TableExists("ProductionPlan.DailyActuals") == true && TableExists("ProductionPlan.ShiftHours") == true
                                                             && ColumnIn("ProductionPlan.Machines", "StrokeByPcs") == true);

        // 👥 PRODUCTION PLAN › WORKLOAD (38_Production_Plan_Workload.sql): คนที่มีจริงต่อเดือน (Direct / Ind1 / Ind2)
        private static bool _ppWl;
        public static bool HasPpWorkload => _ppWl || (_ppWl = HasProductionPlan && TableExists("ProductionPlan.WorkloadHeads") == true);

        // 👥 WORKLOAD เทียบไฟล์ Excel Work load (41_Production_Plan_Workload_Excel.sql): ProductionPlan.WorkloadRef / WorkloadNotes
        private static bool _ppWlRef;
        public static bool HasPpWorkloadRef => _ppWlRef || (_ppWlRef = HasPpWorkload && TableExists("ProductionPlan.WorkloadRef") == true && TableExists("ProductionPlan.WorkloadNotes") == true);

        // 📈 PRODUCTION PLAN › PCS ที่กำหนดเองรายเดือน + 📊 FORECAST SUMMARY DIFF (2) / (3) (39_Production_Plan_Pcs_Override_Forecast_Summary.sql)
        private static bool _ppOv, _fcSum;
        public static bool HasPpPcsOverride => _ppOv || (_ppOv = HasProductionPlan && TableExists("ProductionPlan.PcsOverrides") == true);
        public static bool HasForecastSummary => _fcSum || (_fcSum = TableExists("Nexus.ForecastSummary") == true);

        // 🧪 CHEMICAL CONTROL (37_Chemical_Control.sql): ChemControl.Parameters / Readings / Sheets / SignFlow
        private static bool _chem;
        public static bool HasChemControl => _chem || (_chem = TableExists("ChemControl.Parameters") == true && TableExists("ChemControl.Readings") == true
                                                                && TableExists("ChemControl.Sheets") == true && TableExists("ChemControl.SignFlow") == true && TableExists("ChemControl.Signs") == true);

        // 📅 EDP แม่แบบประจำวัน (44_EDP_Daily_Template.sql): EDP.PlanTemplates.IS_DAILY
        private static bool _edpDaily;
        public static bool HasEdpDaily => _edpDaily || (_edpDaily = HasEdp && ColumnIn("EDP.PlanTemplates", "IS_DAILY") == true);

        // 📅 รอบที่ตั้งใจให้ว่าง (46_EDP_Daily_Skip.sql): EDP.PlanDailySkips
        private static bool _edpSkip;
        public static bool HasEdpDailySkip => _edpSkip || (_edpSkip = HasEdpDaily && TableExists("EDP.PlanDailySkips") == true);

        // ⏰ EDP ALERT (29_EDP_Alert.sql): EDP.AlertSettings (แจ้งเตือนการ์ดเลยเวลา)
        private static bool _edpAlert;
        public static bool HasEdpAlert => _edpAlert || (_edpAlert = HasEdp && TableExists("EDP.AlertSettings") == true);

        // 🔊 EDP ALERT เสียง + ผู้รับแจ้งเตือน (40_EDP_Alert_Sound_Users.sql): EDP.AlertSettings.MsgMy · EDP.AlertVoices
        private static bool _edpSound;
        public static bool HasEdpAlertSound => _edpSound || (_edpSound = HasEdpAlert && ColumnIn("EDP.AlertSettings", "MsgMy") == true && TableExists("EDP.AlertVoices") == true);

        // 📋 MIN REPORT ผู้รับแจ้งเตือนรายคลัง (32_Min_Report_Alert_Users.sql): Nexus.MinReportStocks.AlertUsers
        private static bool _minUsers;
        public static bool HasMinAlertUsers => _minUsers || (_minUsers = HasMinReport && ColumnIn("Nexus.MinReportStocks", "AlertUsers") == true);

        // 🔐 รหัสผ่านแบบ Hash (22_User_Password_Hash.sql): Nexus.Users.PasswordHash
        private static bool _pwHash;
        public static bool HasPasswordHash => _pwHash || (_pwHash = ColumnIn("Nexus.Users", "PasswordHash") == true);

        // 📍 LAYOUT จัดเก็บ (20_Storage_Layout.sql): ตำแหน่ง (ประเภท + ชื่อ) + สิทธิ์ LAYOUT ต่อคลังของ Multi-Scanner + ตำแหน่งที่บันทึกกับแถวสแกน
        private static bool _layout;
        public static bool HasLayout => _layout || (_layout = TableExists("Nexus.LayoutTypes") == true && TableExists("Nexus.LayoutLocations") == true && TableExists("Nexus.LayoutSettings") == true
                                                             && ColumnIn("Nexus.UserScanStocks", "AskLayout") == true && ColumnIn("Nexus.ScanTransactions", "Layout") == true);

        private static bool? ColumnIn(string table, string column)
        {
            try
            {
                using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH(@t, @c) IS NOT NULL THEN 1 ELSE 0 END", conn))
                {
                    cmd.Parameters.AddWithValue("@t", table);
                    cmd.Parameters.AddWithValue("@c", column);
                    conn.Open();
                    return Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
            }
            catch { return null; }
        }

        private static bool? TableExists(string name)
        {
            try
            {
                using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                using (var cmd = new SqlCommand("SELECT CASE WHEN OBJECT_ID(@n, 'U') IS NOT NULL THEN 1 ELSE 0 END", conn))
                {
                    cmd.Parameters.AddWithValue("@n", name);
                    conn.Open();
                    return Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                }
            }
            catch { return null; }   // ต่อฐานไม่ได้ = ถามใหม่รอบหน้า
        }

        // Update_20261014.sql: Nexus.PickListPrintLogs.PrintCount / LastPrintedBy / LastPrintedDate (นับการพิมพ์ซ้ำ)
        private static bool? _printCount;
        public static bool HasPickListPrintCount
        {
            get
            {
                if (_printCount.HasValue) return _printCount.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.PickListPrintLogs', 'PrintCount') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _printCount = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _printCount.Value;
            }
        }

        // Update_20261013.sql: Nexus.UserScanDisplays (DISPLAY ของหน้าสแกน แยกตามผู้ใช้)
        private static bool? _userScanDisplays;
        public static bool HasUserScanDisplays
        {
            get
            {
                if (_userScanDisplays.HasValue) return _userScanDisplays.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN OBJECT_ID('Nexus.UserScanDisplays', 'U') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _userScanDisplays = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _userScanDisplays.Value;
            }
        }

        // Update_20261008.sql: ทะเบียน Coil (Nexus.Coils / Nexus.CoilMoves + BarcodeFormats.CoilNoPosition)
        public static bool HasCoilRegister
        {
            get
            {
                if (_coilRegister.HasValue) return _coilRegister.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN OBJECT_ID('Nexus.Coils', 'U') IS NOT NULL AND COL_LENGTH('Nexus.BarcodeFormats', 'CoilNoPosition') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _coilRegister = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _coilRegister.Value;
            }
        }

        // Update_20261010b.sql: Nexus.DeductMisses (ป้ายที่รับเข้าแล้วแต่ตัดคลังต้นทางไม่ได้ / ได้ไม่ครบ)
        private static bool? _deductMisses;
        public static bool HasDeductMisses
        {
            get
            {
                if (_deductMisses.HasValue) return _deductMisses.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN OBJECT_ID('Nexus.DeductMisses', 'U') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _deductMisses = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _deductMisses.Value;
            }
        }

        // Update_20261010c.sql: Nexus.StockTransfers.ScanTransactionID (รายการ DEDUCTED ผูกกับรายการแสกน)
        private static bool? _transferScanTx;
        public static bool HasTransferScanTx
        {
            get
            {
                if (_transferScanTx.HasValue) return _transferScanTx.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH('Nexus.StockTransfers', 'ScanTransactionID') IS NOT NULL THEN 1 ELSE 0 END", conn))
                    {
                        conn.Open();
                        _transferScanTx = Convert.ToInt32(cmd.ExecuteScalar()) == 1;
                    }
                }
                catch { return false; }
                return _transferScanTx.Value;
            }
        }

        // database/nexus/02_Add_StockType.sql: Nexus.Stocks.StockType (ประเภทคลัง = ไอคอนบนเว็บ)
        private static bool? _stockType;
        public static bool HasStockType => _stockType ?? (_stockType = ColumnExists("StockType")) ?? false;

        // Update_20261010d.sql: Nexus.Stocks.CardStyle (การ์ดสินค้า มีรูป / ไม่มีรูป / ปิด)
        private static bool? _cardStyle;
        public static bool HasCardStyle => _cardStyle ?? (_cardStyle = ColumnExists("CardStyle")) ?? false;

        // Update_20261020.sql: Nexus.Stocks.NotSetButton (ปุ่มสถานะที่ 3 = MAX-MIN NOT SET / NO ORDER)
        private static bool? _notSetButton;
        public static bool HasNotSetButton => _notSetButton ?? (_notSetButton = ColumnExists("NotSetButton")) ?? false;

        // Update_20261009.sql: Nexus.Stocks.MaxMinDecimal (MAX / MIN แสดง / เก็บทศนิยม แยกจาก DECIMAL QTY)
        private static bool? _maxMinDecimal;
        public static bool HasMaxMinDecimal => _maxMinDecimal ?? (_maxMinDecimal = ColumnExists("MaxMinDecimal")) ?? false;

        // Update_20261008b.sql: Nexus.Stocks.ShowCoilRows (กด PD CODE แล้วแสดงแถว Coil ย่อย - ตั้งได้ตอนสร้าง / แก้คลัง)
        private static bool? _coilRows;
        public static bool HasCoilRows => _coilRows ?? (_coilRows = ColumnExists("ShowCoilRows")) ?? false;

        // Update_20261006d.sql: Nexus.Stocks.ColumnOrder (ลำดับคอลัมน์ตามที่ติ๊กเลือก)
        public static bool HasColumnOrder => _columnOrder ?? (_columnOrder = ColumnExists("ColumnOrder")) ?? false;

        // Update_20261006c.sql: Nexus.Stocks.CountCoil + Nexus.Parts.CoilQuantity (QTY (COIL) ของคลัง KG)
        public static bool HasCountCoil => _countCoil ?? (_countCoil = ColumnExists("CountCoil")) ?? false;

        // Update_20261006b.sql: Nexus.Stocks.LiveSource (คลังที่แสดงข้อมูลสดจาก StorePC ชั่วคราว)
        public static bool HasLiveSource => _liveSource ?? (_liveSource = ColumnExists("LiveSource")) ?? false;

        private static bool? ColumnExists(string column)
        {
            try
            {
                using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                using (var cmd = new SqlCommand("SELECT COL_LENGTH('Nexus.Stocks', @c)", conn))
                {
                    cmd.Parameters.AddWithValue("@c", column);
                    conn.Open();
                    object v = cmd.ExecuteScalar();
                    return v != null && v != DBNull.Value;
                }
            }
            catch { return null; }   // ต่อฐานไม่ได้ตอนนี้ -> ลองใหม่ครั้งหน้า
        }

        // Update_20261006.sql: Nexus.Stocks.AllowDecimal (DECIMAL QTY) - ไม่มี = ทุกคลังเป็นจำนวนเต็มเหมือนเดิม
        public static bool HasAllowDecimal
        {
            get
            {
                if (_allowDecimal.HasValue) return _allowDecimal.Value;
                try
                {
                    using (var conn = new SqlConnection(GlobalConfig.ConnStr))
                    using (var cmd = new SqlCommand("SELECT COL_LENGTH('Nexus.Stocks', 'AllowDecimal')", conn))
                    {
                        conn.Open();
                        object v = cmd.ExecuteScalar();
                        _allowDecimal = v != null && v != DBNull.Value;
                    }
                }
                catch { return false; }   // ต่อฐานไม่ได้ตอนนี้ -> ลองใหม่ครั้งหน้า
                return _allowDecimal.Value;
            }
        }
    }
}
