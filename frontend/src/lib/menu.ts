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
  can?: string; // key ใน Me.can (ไม่ระบุ = ทุกคนที่เห็นระบบนี้)
  ready?: boolean;
  children?: MenuItem[]; // เมนูย่อย (กาง / พับ)
  caption?: string; // หัวข้อกลุ่มในเมนูย่อย (เช่น PRODUCT CONTROL)
  stockType?: string; // เมนูย่อยเป็นรายชื่อคลังประเภทนี้ (โหลดจาก /master/menu)
};

export type SystemKey = "root" | "cims";

// การ์ดหน้าเลือกระบบ: name = ชื่อบนการ์ด · sub = คำอธิบายสั้น · art = ภาพประกอบการ์ด · color = สีแถบ/เงาการ์ด · desc = tooltip
export type SystemDef = { key: string; label: string; name: string; sub: string; art: string; title: string; desc: string; icon: string; color: string; menu: MenuItem[] };

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
  ],
};

export const CIMS: SystemDef = {
  key: "cims",
  label: "CIMS",
  name: "CIMS",
  sub: "CHR Inventory Management",
  art: "/images/systems/cims.webp",
  title: "CIMS • INVENTORY CONTROL",
  desc: "ระบบคลังสินค้า: Store Max-Min · Multi-Scanner · Pick List · PR · Forecast · Activity Log",
  icon: "/icons/StoreMaxMin.png",
  color: "#6750a4",
  menu: [
    { href: "/cims/dashboard", label: "Dashboard", title: "DASHBOARD", icon: "/icons/Dashboard.png", can: "dashboard" },
    { href: "/cims/store", label: "Store ( Max - Min )", title: "STORE ( MAX - MIN )", icon: "/icons/StoreMaxMin.png", can: "store" },
    { href: "/cims/scanner", label: "Multi-Scanner", title: "MULTI-SCANNER", icon: "/icons/MultiScanner.png", can: "scanner" },
    { href: "/cims/pick-list", label: "Pick List", title: "PICK LIST", icon: "/icons/PickList.png", can: "pickList" },
    { href: "/cims/max-min", label: "Max-Min Calculator", title: "MAX-MIN CALCULATOR", icon: "/icons/CalculatorMxMn.png", can: "maxMinCalc" },
    { href: "/cims/forecast", label: "Forecast / Order", title: "FORECAST / ORDER / DELIVERY", icon: "/icons/ForecastOrder.png", can: "forecast" },
    { href: "/cims/pr", label: "PR Management", title: "PURCHASE REQUEST", icon: "/icons/PR.png", can: "pr" },
    { href: "/cims/activity-log", label: "Activity Log", title: "ACTIVITY LOG", icon: "/icons/ActivityLog.png", can: "activityLog" },
    USERS_ITEM,
  ],
};

export const MASTER: SystemDef = {
  key: "master",
  label: "MASTER DATA",
  name: "Master Data",
  sub: "Customer · Supplier · Product",
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
  name: "User Management",
  sub: "User & Permission",
  art: "/images/systems/user-management.webp",
  title: "USER MANAGEMENT",
  desc: "ผู้ใช้งาน · สิทธิ์ทุกระบบ · ⚙ SETUP ทั้งหมด (Admin)",
  icon: "/icons/management.png",
  color: "#4f46e5",
  menu: [USERS_ITEM],
};

// การ์ดหน้าเลือกระบบ (ลำดับที่แสดง)
export const SYSTEMS: SystemDef[] = [CIMS, MASTER, ADMIN];

// Sidebar นอกระบบ CIMS: เลือกระบบ · MASTER DATA (เมนูย่อย) · USER MANAGEMENT
export const ROOT_MENU: MenuItem[] = [SYSTEMS_ITEM, MASTER_ITEM, USERS_ITEM];
export const CIMS_MENU: MenuItem[] = [SYSTEMS_ITEM, ...CIMS.menu];

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

// ระบบของหน้าปัจจุบัน: /cims = CIMS · /admin = คงระบบที่มา (ไม่ระบุ) · อื่น ๆ = ROOT
export const systemOf = (path: string): SystemKey | null => (path.startsWith("/cims") ? "cims" : path.startsWith("/admin") ? null : "root");

// หน้า (รวมเมนูย่อย) ที่ตรงกับ URL ปัจจุบัน - เมนูที่มี ?type= ต้องตรง query ด้วย
export function findItem(path: string, search: string): MenuItem | undefined {
  const all = [...CIMS_MENU, ...ROOT_MENU].flatMap((m) => [...(m.children ?? []), m]); // เมนูย่อยก่อน = ตรงที่สุด
  const type = new URLSearchParams(search).get("type");
  return all.find((m) => {
    const [p, q] = m.href.split("?");
    if (path !== p && !path.startsWith(p + "/")) return false;
    return !q || new URLSearchParams(q).get("type") === type;
  });
}

// หน้าแรกหลัง Login = หน้าเลือกระบบ (มีสิทธิ์อย่างน้อย 1 ระบบ)
export function startPage(can: Record<string, boolean>): string | null {
  return systemsFor(can).length > 0 ? "/systems" : null;
}
