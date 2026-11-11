using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Nexus.Models
{
    public class UserSession
    {
        public string UserId { get; set; }
        public string UserName { get; set; }
        public int UserLevel { get; set; }    // UserLevel (1, 2, 3)
        public bool IsMasterAdmin { get; set; } // สำหรับสิทธิ์พิเศษของคุณเอง
        public string Department { get; set; }

        #region === [ เพิ่มส่วนนี้เพื่อเช็คสิทธิ์แบบละเอียด (Permission) ] ===
        public List<UserPermission> Permissions { get; set; } = new List<UserPermission>();
        #endregion

        // =========================================================================
        // 🔐 สิทธิ์ใหม่ (ต.ค. 2026): Level 1 = Admin ทำได้ทุกอย่าง
        //    Level 2 / 3 ไม่มีสิทธิ์อัตโนมัติ ได้เฉพาะที่ติ๊กใน Nexus.Permissions (VIEW / ADD / EDIT / DEL / APPROVE)
        //    ไม่มีสิทธิ์ = ไม่แสดงเมนู / ปุ่ม / แก้ไขไม่ได้
        // =========================================================================
        private bool P(string sysId, Func<UserPermission, bool> check)
        {
            if (UserLevel == 1) return true;
            return !string.IsNullOrEmpty(sysId) &&
                   Permissions.Any(p => string.Equals(p.SystemId, sysId, StringComparison.OrdinalIgnoreCase) && check(p));
        }

        // 📊 Dashboard: VIEW
        public bool CanViewDashboard => P("DASHBOARD", p => p.CanView);

        // 📷 Multi-Scanner (SystemID MultiScanner)
        //    VIEW = ใช้หน้าสแกนได้ทุกปุ่ม: สแกนเข้า / ออก / คืน / เศษ / TEST MODE / HISTORY / DEDUCTED / NOT DEDUCTED (ยกเว้นลบ)
        //    EDIT = เลือกคลังที่สแกน (STOCK) + DISPLAY (ค่าที่แสดงต่อคลัง ของผู้ใช้คนนั้น)
        //    DEL  = ADJUST SCAN (แก้จำนวน / ลบรายการสแกน) + ลบรายการ NOT DEDUCTED
        public bool CanViewScannerMenu => P("MultiScanner", p => p.CanView);
        public bool CanViewScanIn => CanViewScannerMenu;
        public bool CanViewScanOut => CanViewScannerMenu;
        public bool CanScanReturn => CanViewScannerMenu;
        public bool CanEditScanner => CanViewScannerMenu && P("MultiScanner", p => p.CanEdit);
        public bool CanDeleteScan => CanViewScannerMenu && P("MultiScanner", p => p.CanDelete);
        // NOT DEDUCTED ช่อง ACTION: APPROVE (รับเข้า) / ลงทะเบียนสินค้า (PRODUCT CONTROL) / ลบ = APPROVE ของ Multi-Scanner
        public bool CanApproveScan => CanViewScannerMenu && P("MultiScanner", p => p.CanApprove);

        // 🏷️ Inventory Registration (ProductControl): VIEW = เมนู + ดู + Export QR / ADD = ลงทะเบียน + IMPORT
        //    EDIT = แก้ไข + SHOW/HIDE + รูปภาพ / DEL = ลบสินค้า
        public bool CanViewProductControl => P("ProductControl", p => p.CanView);
        public bool CanAddProduct => CanViewProductControl && P("ProductControl", p => p.CanAdd);
        public bool CanEditProduct => CanViewProductControl && P("ProductControl", p => p.CanEdit);
        public bool CanDeleteProduct => CanViewProductControl && P("ProductControl", p => p.CanDelete);

        // 🗂 MASTER DATA › Customer / Supplier Information (SystemID MasterData)
        //    VIEW = ดู · ADD = เพิ่ม · EDIT = แก้ไข / ACTIVE-INACTIVE · DEL = ลบ (เฉพาะรหัสที่ยังไม่มีสินค้าใช้)
        public bool CanViewMasterData => P("MasterData", p => p.CanView);
        public bool CanAddMasterData => CanViewMasterData && P("MasterData", p => p.CanAdd);
        public bool CanEditMasterData => CanViewMasterData && P("MasterData", p => p.CanEdit);
        public bool CanDeleteMasterData => CanViewMasterData && P("MasterData", p => p.CanDelete);

        // 🏭 EDP PLANNING (schema EDP · ระบบวางแผนผลิต EDP)
        //    EdpSubmission  : VIEW = หน้า Plan Submission · EDIT = MARK SUCCESS / แก้ไขการ์ด / ลากสลับ / ปิดกะ
        //    EdpPlanning    : VIEW = หน้า EDP Planning + Export · EDIT = Operator / Remark / Done
        //    EdpPlanSetting : VIEW = หน้า Plan Setting · ADD = บันทึกแผน / แม่แบบ · EDIT = ใช้แม่แบบ / คัดลอกแผน · DEL = ล้างแผน / ลบแม่แบบ
        //    EdpGraph       : VIEW = กราฟผลผลิต
        public bool CanViewEdpSubmit => P("EdpSubmission", p => p.CanView);
        public bool CanEditEdpSubmit => CanViewEdpSubmit && P("EdpSubmission", p => p.CanEdit);
        public bool CanViewEdpPlanning => P("EdpPlanning", p => p.CanView);
        public bool CanEditEdpPlanning => CanViewEdpPlanning && P("EdpPlanning", p => p.CanEdit);
        public bool CanViewEdpSetting => P("EdpPlanSetting", p => p.CanView);
        public bool CanAddEdpSetting => CanViewEdpSetting && P("EdpPlanSetting", p => p.CanAdd);
        public bool CanEditEdpSetting => CanViewEdpSetting && P("EdpPlanSetting", p => p.CanEdit);
        public bool CanDeleteEdpSetting => CanViewEdpSetting && P("EdpPlanSetting", p => p.CanDelete);
        public bool CanViewEdpGraph => P("EdpGraph", p => p.CanView);
        public bool CanViewEdpAny => CanViewEdpSubmit || CanViewEdpPlanning || CanViewEdpSetting || CanViewEdpGraph;

        // 📈 PRODUCTION PLAN (schema ProductionPlan · Capacity Planning)
        //    PpDashboard : VIEW = หน้า Dashboard (ทุกเครื่อง · Condition M/C · กราฟ)
        //    PpCapacity  : VIEW = หน้า Capacity (รายเครื่อง) · EDIT = บันทึก M/C Actual (Working hour / Stroke / Man)
        //    PpSetup     : MASTER DATA › Production Plan (STD) · VIEW = ดู · ADD = เพิ่มเครื่อง / Product · EDIT = แก้ STD / Plan SPH / Product · DEL = ลบ
        public bool CanViewPpDashboard => P("PpDashboard", p => p.CanView);
        public bool CanViewPpCapacity => P("PpCapacity", p => p.CanView);
        public bool CanEditPpCapacity => CanViewPpCapacity && P("PpCapacity", p => p.CanEdit);
        public bool CanViewPpSetup => P("PpSetup", p => p.CanView);
        public bool CanAddPpSetup => CanViewPpSetup && P("PpSetup", p => p.CanAdd);
        public bool CanEditPpSetup => CanViewPpSetup && P("PpSetup", p => p.CanEdit);
        public bool CanDeletePpSetup => CanViewPpSetup && P("PpSetup", p => p.CanDelete);
        public bool CanViewPpAny => CanViewPpDashboard || CanViewPpCapacity || CanViewPpSetup;

        // 🧪 CHEMICAL CONTROL (schema ChemControl · ควบคุมคุณภาพน้ำยาเคมี)
        //    ChemRecord : VIEW = Dashboard / แผนภูมิควบคุม / Export · ADD = บันทึกผลการตรวจวัด + บันทึกการแก้ไข + ส่งอนุมัติ
        //                 EDIT = แก้ / ลบผลการตรวจวัดของผู้อื่น + แก้ / ลบบันทึกการแก้ไข
        //    ChemSetup  : VIEW = ดูพารามิเตอร์ควบคุม · ADD = เพิ่มรายการตรวจวัดใหม่ · EDIT = แก้ค่ามาตรฐาน / ขีดจำกัด / เวลา · DEL = ลบ
        //    ลงลายเซ็น = ตาม FLOW (User Management › SETUP › SIGN FLOW › CHEMICAL CONTROL)
        public bool CanViewChemRecord => P("ChemRecord", p => p.CanView);
        public bool CanAddChemRecord => CanViewChemRecord && P("ChemRecord", p => p.CanAdd);
        public bool CanEditChemRecord => CanViewChemRecord && P("ChemRecord", p => p.CanEdit);
        public bool CanViewChemSetup => P("ChemSetup", p => p.CanView);
        public bool CanAddChemSetup => CanViewChemSetup && P("ChemSetup", p => p.CanAdd);
        public bool CanEditChemSetup => CanViewChemSetup && P("ChemSetup", p => p.CanEdit);
        public bool CanDeleteChemSetup => CanViewChemSetup && P("ChemSetup", p => p.CanDelete);

        // 📍 LAYOUT SETUP (ตำแหน่งจัดเก็บ) อยู่ที่ User Management › SETUP = Admin Level 1 (P() ให้ Level 1 ผ่านเสมอ · ไม่มีแถวสิทธิ์แยก)
        public bool CanViewLayout => P("LayoutSetup", p => p.CanView);
        public bool CanAddLayout => CanViewLayout && P("LayoutSetup", p => p.CanAdd);
        public bool CanEditLayout => CanViewLayout && P("LayoutSetup", p => p.CanEdit);
        public bool CanDeleteLayout => CanViewLayout && P("LayoutSetup", p => p.CanDelete);

        // 📦 Pick List: VIEW
        public bool CanViewPackingCard => P("PackingCard", p => p.CanView);

        // 🧾 PR: VIEW = เมนู + รายการ + APPROVED LIST / ADD = SUBMIT PR
        //    EDIT = EDIT ใน APPROVED LIST + PR SETTINGS / DEL = DEL ใน APPROVED LIST / APPROVE = APPROVE + REJECT + EXPORT
        public bool CanViewPR => P("PR", p => p.CanView);
        public bool CanSubmitPR => CanViewPR && P("PR", p => p.CanAdd);
        public bool CanEditPR => CanViewPR && P("PR", p => p.CanEdit);
        public bool CanDeletePR => CanViewPR && P("PR", p => p.CanDelete);
        public bool CanApprovePR => CanViewPR && P("PR", p => p.CanApprove);
        // ⚙ PR SETTINGS (คลังที่เก็บ PR + Export Path) อยู่หน้า User Management - Admin (Level 1) เท่านั้น
        public bool CanManagePrSettings => UserLevel == 1;

        // 📐 Max-Min Calculator: VIEW / EDIT (แก้ไข / Import / คำนวณ / สูตร)
        public bool CanViewMaxMinCalc => P("MAXMINCALC", p => p.CanView);
        public bool CanEditMaxMinCalc => CanViewMaxMinCalc && P("MAXMINCALC", p => p.CanEdit);

        // 📊 Forecast / Order / Delivery: VIEW = เมนู + ดู + Export / ADD = Import
        public bool CanViewForecastOrder => P("ForecastOrder", p => p.CanView);
        public bool CanImportForecastOrder => CanViewForecastOrder && P("ForecastOrder", p => p.CanAdd);

        // 🕘 Activity Log: VIEW
        public bool CanViewActivityLog => P("ACTIVITYLOG", p => p.CanView);

        // 👥 User Management: Level 1 / Master admin = ทำได้ทุกอย่าง / คนอื่นตามสิทธิ์ UserManagement
        //    VIEW = เปิดหน้า, ADD = เพิ่ม, EDIT = แก้ไข, DEL = ลบ, APPROVE = กำหนดสิทธิ์
        private bool UserMgmt(Func<UserPermission, bool> check) => IsMasterAdmin || P("UserManagement", check);
        public bool CanViewUserMgmt => UserMgmt(p => p.CanView);
        public bool CanAddUser => CanViewUserMgmt && UserMgmt(p => p.CanAdd);
        public bool CanEditUser => CanViewUserMgmt && UserMgmt(p => p.CanEdit);
        public bool CanDeleteUser => CanViewUserMgmt && UserMgmt(p => p.CanDelete);
        public bool CanSetPermissions => CanViewUserMgmt && UserMgmt(p => p.CanApprove);

        // =========================================================================
        // 🏬 หน้า Store (Max-Min) (SystemID StoreMaxMin)
        //   VIEW = เมนู + เข้าดูคลัง / EDIT = แก้รูปแบบบาร์โค้ด + ตั้งค่าคลัง
        //   ADD  = เพิ่มรูปแบบบาร์โค้ด + เพิ่มคลัง / DEL = ลบคลัง
        // ภายในแต่ละคลัง (SystemID = รหัสคลัง รวมคลังหลัก)
        //   VIEW = เห็นคลัง (ดูอย่างเดียว พิมพ์ REMARK ได้) / EDIT = แก้ MAX / MIN / QTY / STOCK(BOX) / STOCK(PCS)
        //   ADD  = IMPORT EXCEL
        // =========================================================================
        public bool CanViewStore => P("StoreMaxMin", p => p.CanView);
        public bool CanAddStore => CanViewStore && P("StoreMaxMin", p => p.CanAdd);
        public bool CanEditStore => CanViewStore && P("StoreMaxMin", p => p.CanEdit);
        public bool CanDeleteStore => CanViewStore && P("StoreMaxMin", p => p.CanDelete);

        // ปุ่ม BARCODE FORMATS เห็นเมื่อแก้ไขหรือเพิ่มได้
        public bool CanManageFormats => CanEditStore || CanAddStore;
        public bool CanCreateStock => CanAddStore;

        public bool CanViewStock(StockModel s) => s != null && P(s.PermSysId, p => p.CanView);
        // แก้ตัวเลขในตารางของคลัง (MAX / MIN / QTY / STOCK BOX / STOCK PCS)
        public bool CanEditStock(StockModel s) => s != null && CanViewStock(s) && P(s.PermSysId, p => p.CanEdit);
        // ลบคลัง (คลังหลักลบไม่ได้)
        public bool CanDeleteStock(StockModel s) => s != null && !s.IsMain && CanDeleteStore;
        // DEL ของคลัง (ติ๊ก DEL ที่สิทธิ์คลังนั้น) = ลบสินค้าในคลังนั้นจากหน้า Product Control ได้
        public bool CanDeleteInStock(StockModel s) => s != null && CanViewStock(s) && P(s.PermSysId, p => p.CanDelete);
        // Product Control: ติ๊กสินค้าใหม่เข้าคลังได้ = คลังที่มีสิทธิ์ VIEW (สิทธิ์ ADD ของหน้า Product Control ตรวจแยกที่ CanAddProduct)
        public bool CanAddInStock(StockModel s) => s != null && CanViewStock(s);
        public bool CanImportStock(StockModel s) => s != null && s.InExcel && CanViewStock(s) && P(s.PermSysId, p => p.CanAdd);
        // 🧲 ปุ่ม MANAGE STOCK (คลังที่นับ Coil / ประเภท Material): EDIT + APPROVE ของคลังนั้น (สิทธิ์ซ้อนอีกชั้นจาก EDIT)
        //    เพิ่ม Master Coil / Coil No · แก้ไข · โอนย้าย · ปรับปรุงยอด · ประวัติ
        public bool CanManageCoils(StockModel s) => s != null && s.CountCoil && !s.IsLiveView && CanEditStock(s) && P(s.PermSysId, p => p.CanApprove);

        // แก้รหัสคลังแล้ว ชื่อสิทธิ์ในฐานข้อมูลเปลี่ยนตาม -> เปลี่ยนในข้อมูลผู้ใช้ที่ Login อยู่ด้วย ไม่ต้อง Login ใหม่
        public void RenameStockPermission(string oldSysId, string newSysId)
        {
            if (string.IsNullOrEmpty(oldSysId) || oldSysId == newSysId) return;
            foreach (var p in Permissions.Where(p => string.Equals(p.SystemId, oldSysId, StringComparison.OrdinalIgnoreCase))) p.SystemId = newSysId;
        }

        // หลังสร้างคลังใหม่ ให้สิทธิ์ของผู้ใช้ที่ Login อยู่ตรงกับที่ฐานข้อมูลให้ทันที (Nexus.sp_Stock_GrantViewAll: ทุกคนได้ VIEW อย่างเดียว)
        public void GrantViewInSession(StockModel s)
        {
            if (s == null || Permissions.Any(p => string.Equals(p.SystemId, s.PermSysId, StringComparison.OrdinalIgnoreCase))) return;
            Permissions.Add(new UserPermission { SystemId = s.PermSysId, CanView = true });
        }
    }

}
