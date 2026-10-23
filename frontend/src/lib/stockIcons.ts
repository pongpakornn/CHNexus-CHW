// ไอคอน (ภาพขาว) + สีของแต่ละคลัง ดูจากท้ายรหัสคลัง - ใช้ร่วมกันทั้ง Dashboard และหน้า Store
//   MAT / PANTA / MSH = CoilMaterial · PC / SUB = products · CONS = Consumables · SP = Sparepart · CPN = component
//   คลังที่ไม่รู้จัก = products + สีตามลำดับ
const img = (n: string) => `/images/stocks/${n}.png`;

const STOCK_ICON: Record<string, [string, string]> = {
  MAT: [img("coil"), "#8b5cf6"],
  PANTA: [img("coil"), "#3b82f6"],
  PC: [img("products"), "#06b6d4"],
  SP: [img("sparepart"), "#f59e0b"],
  CPN: [img("component"), "#14b8a6"],
  SUB: [img("products"), "#ec4899"],
  CONS: [img("consumables"), "#6366f1"],
  MSH: [img("coil"), "#2563eb"],
};
const FALLBACK = ["#8b5cf6", "#3b82f6", "#06b6d4", "#f59e0b", "#14b8a6", "#ec4899"];

// ประเภทคลัง (Nexus.Stocks.StockType) - เลือกตอนสร้าง / แก้คลัง = ไอคอนของคลัง
export const STOCK_TYPES = [
  { value: "MATERIAL", label: "Material", hint: "เหล็ก / Coil (แบบ STOCK-MAT)", icon: img("coil"), color: "#8b5cf6" },
  { value: "PRODUCT", label: "Product", hint: "สินค้า (แบบ STORE-PC)", icon: img("products"), color: "#06b6d4" },
  { value: "SPAREPART", label: "Spare part", hint: "อะไหล่ (แบบ STORE-SP)", icon: img("sparepart"), color: "#f59e0b" },
  { value: "COMPONENT", label: "Component", hint: "ชิ้นส่วน (แบบ STORE-CPN)", icon: img("component"), color: "#14b8a6" },
  { value: "CONSUMABLE", label: "Consumable", hint: "วัสดุสิ้นเปลือง (แบบ STOCK-CONS)", icon: img("consumables"), color: "#6366f1" },
] as const;

/** [ภาพไอคอน, สีประจำคลัง] - ไอคอนตามประเภทคลัง (ถ้ามี) · สีตามรหัสคลังเดิม ถ้าไม่รู้จักใช้สีของประเภท */
export const stockIcon = (code: string, i: number, type?: string | null): [string, string] => {
  const byCode = STOCK_ICON[code.split("-").pop()!.toUpperCase()];
  const t = STOCK_TYPES.find((x) => x.value === type);
  if (t) return [t.icon, byCode?.[1] ?? t.color];
  return byCode ?? [img("products"), FALLBACK[i % FALLBACK.length]];
};

export const COIL_ICON = img("coil");

/** พื้นไล่สีของกรอบไอคอน (สีอ่อน -> สีประจำคลัง) */
export const tileStyle = (col: string): React.CSSProperties => ({
  background: `linear-gradient(145deg, color-mix(in srgb, ${col} 62%, white), ${col})`,
  boxShadow: `0 6px 14px -7px ${col}, inset 0 1px 0 rgb(255 255 255 / .35)`,
});
