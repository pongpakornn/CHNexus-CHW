// 🧭 ระบบ + เมนู Sidebar (MES หลายระบบ)
//   Login -> /systems (เลือกระบบ) -> Sidebar เปลี่ยนตามระบบที่อยู่
//   ROOT  = เลือกระบบ · MASTER DATA (Customer / Supplier / Product Control) · USER MANAGEMENT
//   CIMS  = ระบบคลังเดิมทั้งหมด (ไม่มี Inventory Registration แล้ว -> ย้ายไป MASTER DATA › Product Control)
//   เพิ่มระบบใหม่ = เพิ่มใน SYSTEMS + โฟลเดอร์ app/(app)/<system>/
export type MenuItem = {
  href: string;
  label: string;
  title: string; // ชื่อหน้าบนแถบด้านบน
  icon: string;
  can?: string; // key ใน Me.can (ไม่ระบุ = ทุกคนที่เห็นระบบนี้) · "level1" = Admin Level 1 เท่านั้น (Shell ใส่ให้จาก userLevel)
  ready?: boolean;
  children?: MenuItem[]; // เมนูย่อย (กาง / พับ)
  caption?: string; // หัวข้อกลุ่มในเมนูย่อย (เช่น PRODUCT CONTROL)
  stockType?: string; // เมนูย่อยเป็นรายชื่อคลังประเภทนี้ (โหลดจาก /master/menu)
};

export type SystemKey = "root" | "cims" | "edp" | "pp" | "chem" | "pc" | "wof" | "mfg";

// การ์ดหน้าเลือกระบบ: name = ชื่อบนการ์ด · sub = คำอธิบายสั้น · art = ภาพประกอบการ์ด · color = สีแถบ/เงาการ์ด · desc = tooltip
export type SystemDef = { key: string; label: string; name: string; sub: string; art: string; title: string; desc: string; icon: string; color: string; menu: MenuItem[]; soon?: boolean };

// ประเภทคลัง -> ชื่อเมนู Product Control
export const STOCK_TYPES: { type: string; label: string; icon: string }[] = [
  { type: "PRODUCT", label: "Part Information", icon: "/icons/ProductControl.png" },
  { type: "MATERIAL", label: "Material Information", icon: "/icons/StoreWarehouse.png" },
  { type: "COMPONENT", label: "Component Information", icon: "/icons/registration.png" },
  { type: "CONSUMABLE", label: "Consumable Information", icon: "/icons/InventoryRegistration.png" },
  { type: "SPAREPART", label: "Spare Part Information", icon: "/icons/spareparts.png" },
];

const SYSTEMS_ITEM: MenuItem = { href: "/systems", label: "Systems", title: "SELECT SYSTEM", icon: "/icons/Systems.png" };
const USERS_ITEM: MenuItem = { href: "/admin/users", label: "User Management", title: "USER MANAGEMENT", icon: "/icons/management.png", can: "userMgmt" };

// ⚙ SYSTEM CONFIGURATION (Admin Level 1 เท่านั้น = ตรงกับ SetupController): แต่ละรายการ = /admin/setup/<slug> (แผงเดิมจาก SetupModal)
export const SETUP_GROUPS: { key: string; name: string; items: [slug: string, label: string][] }[] = [
  { key: "pr", name: "PR MANAGEMENT", items: [["pr-settings", "PR SETTINGS"], ["excel", "EXCEL SETUP"], ["departments", "DEPARTMENTS"]] },
  { key: "cims", name: "CIMS · INVENTORY", items: [["min-report", "MIN REPORT"], ["min-reasons", "MIN REASONS"], ["sign-flow-min", "SIGN FLOW"]] }, // LAYOUT SETUP moved to Master Data › Product Control (main material stock)
  { key: "chem", name: "CHEMICAL CONTROL", items: [["sign-flow-chem", "SIGN FLOW"]] },
  { key: "edp", name: "EDP PLANNING", items: [["edp-alert", "EDP ALERT"]] },
  { key: "user", name: "USER MANAGEMENT", items: [["organization", "ORGANIZATION MASTER"]] },
];
const SETUP_MENU: MenuItem[] = SETUP_GROUPS.map((g, i) => ({
  href: `#setup-${g.key}`,
  label: g.name,
  title: `SYSTEM CONFIGURATION • ${g.name}`,
  icon: "/icons/management.png",
  caption: i === 0 ? "SYSTEM CONFIGURATION" : undefined,
  children: g.items.map(([slug, label]) => ({ href: `/admin/setup/${slug}`, label, title: `${g.name} • ${label}`, icon: "/icons/management.png", can: "level1" })),
}));
const USER_GROUP: MenuItem = {
  href: "/admin",
  label: "User Management",
  title: "USER MANAGEMENT",
  icon: "/icons/management.png",
  children: [
    { href: "/admin/users", label: "USER ACCOUNTS", title: "USER MANAGEMENT • USER ACCOUNTS", icon: "/icons/management.png", can: "userMgmt" },
    { href: "/admin/access", label: "ACCESS CONTROL", title: "USER MANAGEMENT • ACCESS CONTROL", icon: "/icons/management.png", can: "userMgmt" },
    { href: "/admin/setup-center", label: "SETUP CENTER", title: "USER MANAGEMENT • SETUP CENTER", icon: "/icons/management.png", can: "setupAny" },
    ...SETUP_MENU,
  ],
};

export const MASTER_ITEM: MenuItem = {
  href: "/master",
  label: "Master Data",
  title: "MASTER DATA",
  icon: "/icons/ProductControl.png",
  children: [
    { href: "/master/customers", label: "Customer Information", title: "MASTER DATA • CUSTOMER INFORMATION", icon: "/icons/user.png", can: "masterData" },
    { href: "/master/suppliers", label: "Supplier Information", title: "MASTER DATA • SUPPLIER INFORMATION", icon: "/icons/StoreWarehouse.png", can: "masterData" },
    ...STOCK_TYPES.map((t, i) => ({
      href: `/master/product?type=${t.type}`,
      label: t.label,
      title: `PRODUCT CONTROL • ${t.label.toUpperCase()}`,
      icon: t.icon,
      can: "productControl",
      stockType: t.type,
      caption: i === 0 ? "Product Control" : undefined,
    })),
    // 🏭 MACHINE / MOLD INFORMATION (script 71): rights = MASTER DATA (same as Customer / Supplier)
    { href: "/master/machines", label: "Machine Information", title: "PRODUCT CONTROL • MACHINE INFORMATION", icon: "/icons/64engine_motorFF.png", can: "masterData" },
    { href: "/master/molds", label: "Mold Information", title: "PRODUCT CONTROL • MOLD INFORMATION", icon: "/icons/Capacity.png", can: "masterData" },
    // 🏭 ZONE & WORKSTATION INFORMATION (script 74): production zones · workstations · line-side stores (used by Kanban Set Flow)
    { href: "/master/zones", label: "Zone & Workstation", title: "PRODUCT CONTROL • ZONE & WORKSTATION INFORMATION", icon: "/icons/StoreWarehouse.png", can: "masterData" },
    // 📦 FORECAST / ORDER / DELIVERY (ย้ายมาจาก CIMS): ข้อมูลกลางที่ CIMS (Max-Min) และ Production Plan (PCS) ใช้ร่วมกัน
    { href: "/master/forecast", label: "Forecast / Order", title: "MASTER DATA • FORECAST / ORDER / DELIVERY", icon: "/icons/ForecastOrder.png", can: "forecast", caption: "Planning" },
    // 📅 WORKDAYS (ย้ายมาจาก CIMS › Max-Min Calculator): ลูกค้า · บริษัท
    { href: "/master/workdays", label: "Customer Workdays", title: "MASTER DATA • CUSTOMER WORKDAYS", icon: "/icons/CalculatorMxMn.png", can: "maxMinCalc", caption: "Workdays" },
    { href: "/master/workdays/company", label: "Company Workdays", title: "MASTER DATA • COMPANY WORKDAYS", icon: "/icons/Dashboard.png", can: "maxMinCalc" },
    // 📈 PRODUCTION PLAN STD: เครื่องจักร + Target Eff + Plan SPH · ตาราง Product ของเครื่อง (PART A / PART B / Process)
    { href: "/master/production-plan", label: "Machine STD", title: "MASTER DATA • PRODUCTION PLAN STD", icon: "/icons/64engine_motorFF.png", can: "ppSetup", caption: "Production Plan" },
    { href: "/master/production-plan/products", label: "Machine Products", title: "MASTER DATA • MACHINE PRODUCTS", icon: "/icons/InventoryRegistration.png", can: "ppSetup" },
  ],
};

export const CIMS: SystemDef = {
  key: "cims",
  label: "CIMS",
  name: "CIMS",
  sub: "CHR Inventory Management System",
  art: "/images/systems/cims.webp",
  title: "CIMS • INVENTORY CONTROL",
  desc: "ระบบคลังสินค้า: Store Max-Min · Multi-Scanner · Pick List · Max-Min · PR",
  icon: "/icons/StoreMaxMin.png",
  color: "#6750a4",
  menu: [
    { href: "/cims/dashboard", label: "Dashboard", title: "DASHBOARD", icon: "/icons/Dashboard.png", can: "dashboard" },
    { href: "/cims/store", label: "Store ( Max - Min )", title: "STORE ( MAX - MIN )", icon: "/icons/StoreMaxMin.png", can: "store" },
    { href: "/cims/scanner", label: "Multi-Scanner", title: "MULTI-SCANNER", icon: "/icons/MultiScanner.png", can: "scanner" },
    { href: "/cims/pick-list", label: "Pick List", title: "PICK LIST", icon: "/icons/PickList.png", can: "pickList" },
    { href: "/cims/max-min", label: "Max-Min Calculator", title: "MAX-MIN CALCULATOR", icon: "/icons/CalculatorMxMn.png", can: "maxMinCalc" },
    // 📦 Forecast / Order ย้ายไป MASTER DATA › Planning (Sidebar กลาง) · /cims/forecast พาไป /master/forecast
    { href: "/cims/pr", label: "PR Management", title: "PURCHASE REQUEST", icon: "/icons/PR.png", can: "pr" },
    // 🕘 Activity Log ย้ายไปที่ USER MANAGEMENT › ปุ่ม ACTIVITY LOG (ข้าง ADD USER) · หน้า /cims/activity-log ยังเปิดตรงได้
    // 👤 USER MANAGEMENT ไม่อยู่ใน Sidebar แล้ว -> เข้าจากการ์ดที่หน้า SELECT SYSTEM
  ],
};

export const MASTER: SystemDef = {
  key: "master",
  label: "MASTER DATA",
  name: "Master Data Management",
  sub: "Customer · Supplier · Product · Forecast",
  art: "/images/systems/master-data.webp",
  title: "MASTER DATA",
  desc: "ข้อมูลกลางของทุกระบบ: Customer · Supplier · Product Control (Part / Material / Component)",
  icon: "/icons/ProductControl.png",
  color: "#2563eb",
  menu: MASTER_ITEM.children!,
};

export const ADMIN: SystemDef = {
  key: "admin",
  label: "USER MANAGEMENT",
  name: "User & Access Management",
  sub: "Accounts · Access Control · Configuration",
  art: "/images/systems/user-management.webp",
  title: "USER MANAGEMENT",
  desc: "ผู้ใช้งาน · สิทธิ์ทุกระบบ · ⚙ SYSTEM CONFIGURATION ทั้งหมด (Admin)",
  icon: "/icons/management.png",
  color: "#4f46e5",
  menu: [USERS_ITEM],
};

// 🏭 EDP PLANNING: วางแผนผลิต EDP (ชิ้นงานจาก MASTER DATA › STORE-PC) · สิทธิ์แยกรายหน้า
export const EDP: SystemDef = {
  key: "edp",
  label: "EDP PLANNING",
  name: "EDP Planning",
  sub: "EDP Line Planning · HG · Round",
  art: "/images/systems/edp-planning.webp",
  title: "EDP • PRODUCTION PLANNING",
  desc: "วางแผนผลิต EDP รายรอบ · หน้างาน MARK SUCCESS · ติดตามแผน · กราฟประสิทธิภาพ",
  icon: "/icons/ForecastOrder.png",
  color: "#7c3aed",
  menu: [
    { href: "/edp/graph", label: "Dashboard", title: "EDP • DASHBOARD", icon: "/icons/Dashboard.png", can: "edpGraph" },
    { href: "/edp/submission", label: "Plan Submission", title: "EDP • PLAN SUBMISSION", icon: "/icons/registration.png", can: "edpSubmit" },
    { href: "/edp/planning", label: "EDP Planning", title: "EDP • EDP PLANNING", icon: "/icons/ForecastOrder.png", can: "edpPlanning" },
    { href: "/edp/plan-setting", label: "Plan Setting", title: "EDP • PLAN SETTING", icon: "/icons/ProductControl.png", can: "edpSetting" },
  ],
};

// 📈 PRODUCTION PLAN: Capacity Planning ต่อหน่วยงาน (PRESS 1 · PRESS 2 · ASSEMBLY · PIPE PART · PIPE ASSY · PAINT PART · QC) + WORKLOAD · ค่า STD อยู่ที่ MASTER DATA › Production Plan
// หน่วยงาน (ชุดเดียวกับ lib/pp.ts › DEPTS)
const PP_DEPTS = [
  { slug: "press1", name: "PRESS 1" },
  { slug: "press2", name: "PRESS 2" },
  { slug: "assembly", name: "ASSEMBLY" },
  { slug: "pipepart", name: "PIPE PART" },
  { slug: "pipeassy", name: "PIPE ASSY" },
  { slug: "paintpart", name: "PAINT PART" },
  { slug: "qc", name: "QC" },
];

export const PP: SystemDef = {
  key: "pp",
  label: "PRODUCTION PLANNING",
  name: "Production Planning",
  sub: "Capacity Planning · 7 Departments",
  art: "/images/systems/production-plan.webp",
  title: "PRODUCTION PLAN • CAPACITY",
  desc: "Capacity Planning: แผนเครื่องจักรจาก Forecast / Order · บันทึก M/C Actual · %EFF รายวัน",
  icon: "/icons/DashboardChart.png",
  color: "#0d9488",
  menu: [
    { href: "/pp/dashboard", label: "Dashboard", title: "PRODUCTION PLAN • DASHBOARD", icon: "/icons/Dashboard.png", can: "ppDashboard" },
    {
      href: "/pp/capacity",
      label: "Capacity",
      title: "PRODUCTION PLAN • CAPACITY",
      icon: "/icons/Capacity.png",
      // WORKLOAD (สรุปอัตรากำลังคน แผน, ผล) ต่อจากหน่วยงานสุดท้าย · ดึง P1 / P9 / A1 จาก Capacity ทุกหน่วยงาน
      children: [
        ...PP_DEPTS.map((d) => ({ href: `/pp/capacity/${d.slug}`, label: d.name, title: `CAPACITY • ${d.name}`, icon: "/icons/Capacity.png", can: "ppCapacity" })),
        { href: "/pp/capacity/workload", label: "WORKLOAD", title: "PRODUCTION PLAN • WORKLOAD", icon: "/icons/management.png", can: "ppCapacity" },
      ],
    },
  ],
};

// 🧪 CHEMICAL CONTROL: ควบคุมคุณภาพน้ำยาเคมี (สาย ED Paint) · ตั้งค่าพารามิเตอร์ควบคุมเองได้ · อนุมัติตาม SIGN FLOW (User Management › System Configuration)
export const CHEM: SystemDef = {
  key: "chem",
  label: "CHEMICAL CONTROL",
  name: "Chemical Control",
  sub: "Chemical Bath Monitoring · SPC",
  art: "/images/systems/chemical-control.webp",
  title: "CHEMICAL CONTROL • ED PAINT LINE",
  desc: "ควบคุมคุณภาพน้ำยาเคมี: บันทึกผลการตรวจวัด · แผนภูมิควบคุม (UCL / LCL) · บันทึกการแก้ไข · อนุมัติตาม FLOW ลายเซ็น · Export PDF / Excel",
  icon: "/icons/DashboardChart.png",
  color: "#2563eb",
  menu: [
    { href: "/chem/dashboard", label: "Dashboard", title: "CHEMICAL CONTROL • DASHBOARD", icon: "/icons/Dashboard.png", can: "chemRecord" },
    { href: "/chem/record", label: "Inspection Record", title: "CHEMICAL CONTROL • INSPECTION RECORD", icon: "/icons/registration.png", can: "chemRecord" },
    { href: "/chem/chart", label: "Control Chart", title: "CHEMICAL CONTROL • CONTROL CHART", icon: "/icons/ControlChart.png", can: "chemRecord" },
    { href: "/chem/setup", label: "Parameter Setup", title: "CHEMICAL CONTROL • PARAMETER SETUP", icon: "/icons/ProductControl.png", can: "chemSetup" },
  ],
};

// การ์ดหน้าเลือกระบบ (ลำดับที่แสดง)
// 🗂 PC DIGITAL WORKSPACE: ตาราง WORK ORDER FOLLOW รายเดือนต่อลูกค้า (แผน / สั่งผลิต / ผลิตได้ / ส่งของ) · ลงลายเซ็น PREPARE · CHECK · APPROVE
export const PC_PERM = "PC_WOF"; // key ใน Me.can (ต้องตรงกับ backend Auth/MeDto.cs)
export const PC: SystemDef = {
  key: "pc-workspace",
  label: "PC DIGITAL WORKSPACE",
  name: "PC Digital Workspace",
  sub: "Production Planning & TPS",
  art: "/images/systems/pc-workspace.webp",
  title: "PC • WORK ORDER FOLLOW",
  desc: "ตามงาน Work Order รายเดือนต่อลูกค้า: แผน · สั่งผลิต · ผลิตได้ · ส่งของ · ลงลายเซ็น PREPARE / CHECK / APPROVE",
  icon: "/icons/ForecastOrder.png",
  color: "#4f46e5",
  // landing first (launcher card opens /pc) · SETUP FLOW page checks can.setup itself
  menu: [
    { href: "/pc", label: "PC Digital Workspace", title: "PC DIGITAL WORKSPACE", icon: "/icons/ForecastOrder.png", can: PC_PERM },
    { href: "/pc/setup-flow", label: "SETUP FLOW", title: "PC • SETUP FLOW", icon: "/icons/management.png", can: PC_PERM },
  ],
};
// inside WORK ORDER FOLLOW: DASHBOARD + WORK ORDER FOLLOW
const WOF_ITEMS: MenuItem[] = [
  { href: "/pc/wof/dashboard", label: "DASHBOARD", title: "WORK ORDER FOLLOW • DASHBOARD", icon: "/icons/Dashboard.png", can: PC_PERM },
  { href: "/pc/wof", label: "WORK ORDER FOLLOW", title: "PC • WORK ORDER FOLLOW", icon: "/icons/ForecastOrder.png", can: PC_PERM },
];

// 🏭 MANUFACTURING (MES): Production Scheduling & Work Order · Kanban · Product Structure (BOM) in one system
//   on plan = every user sees it · real pages = replace /mfg/[slug] and add a can key per menu
export const MFG: SystemDef = {
  key: "mfg",
  label: "MANUFACTURING",
  name: "Manufacturing",
  sub: "MES · Scheduling · Kanban · BOM",
  art: "/images/systems/scheduling.webp",
  title: "MANUFACTURING • MES",
  desc: "Manufacturing Execution System: Production Scheduling & Work Order · Kanban · Product Structure (BOM)",
  icon: "/icons/ForecastOrder.png",
  color: "#2563eb",
  soon: true,
  menu: [
    // 🏭 KANBAN CONTROL (script 72, SystemID MFG_KANBAN): group like Product Control · Dashboard first
    {
      href: "#mfg-kanban",
      label: "Kanban",
      title: "MANUFACTURING • KANBAN",
      icon: "/icons/Kanban.png",
      children: [
        { href: "/mfg/kanban", label: "Dashboard", title: "KANBAN • DASHBOARD", icon: "/icons/Dashboard.png", can: "mfgKanban", caption: "Kanban" },
        { href: "/mfg/kanban/board", label: "Kanban Board", title: "KANBAN • KANBAN BOARD", icon: "/icons/DashboardChart.png", can: "mfgKanban" },
        { href: "/mfg/kanban/set", label: "Kanban Management", title: "KANBAN • KANBAN MANAGEMENT", icon: "/icons/Kanban.png", can: "mfgKanban" },
        { href: "/mfg/kanban/stock", label: "สะสมยอด / รับยอด", title: "KANBAN • สะสมยอด / รับยอด", icon: "/icons/MultiScanner.png", can: "mfgKanban" },
        { href: "/mfg/kanban/orders", label: "สั่งผลิต", title: "KANBAN • สั่งผลิต", icon: "/icons/ForecastOrder.png", can: "mfgKanban" },
      ],
    },
    { href: "/mfg/scheduling", label: "Production Scheduling & Work Order", title: "MANUFACTURING • PRODUCTION SCHEDULING & WORK ORDER", icon: "/icons/ForecastOrder.png" },
    { href: "/mfg/bom", label: "Product Structure (BOM)", title: "MANUFACTURING • PRODUCT STRUCTURE (BOM)", icon: "/icons/ProductControl.png" },
  ],
};

export const SYSTEMS: SystemDef[] = [CIMS, EDP, PP, CHEM, PC, MFG, MASTER, ADMIN];

// Sidebar นอกระบบ CIMS: เลือกระบบ · MASTER DATA (เมนูย่อย) · USER MANAGEMENT
// USER MANAGEMENT ใต้ MASTER DATA (เห็นเฉพาะผู้มีสิทธิ์ userMgmt) + เข้าได้จาก SELECT SYSTEM เหมือนเดิม
export const ROOT_MENU: MenuItem[] = [SYSTEMS_ITEM, MASTER_ITEM, USER_GROUP];
export const CIMS_MENU: MenuItem[] = [SYSTEMS_ITEM, ...CIMS.menu];
export const EDP_MENU: MenuItem[] = [SYSTEMS_ITEM, ...EDP.menu];
export const PP_MENU: MenuItem[] = [SYSTEMS_ITEM, ...PP.menu];
export const CHEM_MENU: MenuItem[] = [SYSTEMS_ITEM, ...CHEM.menu];
export const PC_MENU: MenuItem[] = [SYSTEMS_ITEM, PC.menu[1]];
export const WOF_MENU: MenuItem[] = [SYSTEMS_ITEM, ...WOF_ITEMS];
export const MFG_MENU: MenuItem[] = [SYSTEMS_ITEM, ...MFG.menu];
// Sidebar ของแต่ละระบบ
export const menuOf = (sys: SystemKey): MenuItem[] => (sys === "cims" ? CIMS_MENU : sys === "edp" ? EDP_MENU : sys === "pp" ? PP_MENU : sys === "chem" ? CHEM_MENU : sys === "pc" ? PC_MENU : sys === "wof" ? WOF_MENU : sys === "mfg" ? MFG_MENU : ROOT_MENU);

// เห็นเมนูไหนบ้างตามสิทธิ์ (กลุ่มที่ไม่มีเมนูย่อยเหลือ = ซ่อนทั้งกลุ่ม)
export function allowed(items: MenuItem[], can: Record<string, boolean>): MenuItem[] {
  return items.flatMap((m) => {
    if (m.can && !can[m.can]) return [];
    if (!m.children) return [m];
    const kids = allowed(m.children, can);
    return kids.length ? [{ ...m, children: kids }] : [];
  });
}

export const systemsFor = (can: Record<string, boolean>) => SYSTEMS.filter((s) => allowed(s.menu, can).length > 0);

// ระบบของหน้าปัจจุบัน: /cims = CIMS · /master = คงระบบที่มา (ไม่ระบุ) · /admin และอื่น ๆ = ROOT
export const systemOf = (path: string): SystemKey | null =>
  path.startsWith("/cims") ? "cims" : path.startsWith("/edp") ? "edp" : path.startsWith("/pp") ? "pp" : path.startsWith("/chem") ? "chem" : path.startsWith("/pc/wof") ? "wof" : path.startsWith("/pc/") || path === "/pc" ? "pc" : path.startsWith("/mfg") ? "mfg" : path.startsWith("/master") ? null : "root";

// หน้า (รวมเมนูย่อย) ที่ตรงกับ URL ปัจจุบัน - เมนูที่มี ?type= ต้องตรง query ด้วย
export function findItem(path: string, search: string): MenuItem | undefined {
  const flat = (m: MenuItem): MenuItem[] => [...(m.children ?? []).flatMap(flat), m]; // เมนูย่อยก่อน = ตรงที่สุด
  const all = [...CIMS_MENU, ...EDP_MENU, ...PP_MENU, ...CHEM_MENU, ...PC.menu, ...PC_MENU, ...WOF_MENU, ...MFG_MENU, ...ROOT_MENU, ...ADMIN.menu].flatMap(flat);
  const type = new URLSearchParams(search).get("type");
  // ตรงที่สุดก่อน: path ตรงเป๊ะ > path ยาวกว่า (เช่น /master/workdays/company ไม่ไปไฮไลต์ /master/workdays)
  let best: MenuItem | undefined;
  let score = -1;
  for (const m of all) {
    const [p, q] = m.href.split("?");
    if (path !== p && !path.startsWith(p + "/")) continue;
    if (q && new URLSearchParams(q).get("type") !== type) continue;
    const sc = (path === p ? 10000 : 0) + p.length * 2 + (q ? 1 : 0);
    if (sc > score) {
      best = m;
      score = sc;
    }
  }
  return best;
}

// หน้าแรกหลัง Login = หน้าเลือกระบบ (มีสิทธิ์อย่างน้อย 1 ระบบ)
export function startPage(can: Record<string, boolean>): string | null {
  return systemsFor(can).some((s) => !s.soon) ? "/systems" : null; // an on-plan system alone does not count
}
