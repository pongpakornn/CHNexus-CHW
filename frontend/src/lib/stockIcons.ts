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

/** [ภาพไอคอน, สีประจำคลัง] */
export const stockIcon = (code: string, i: number): [string, string] =>
  STOCK_ICON[code.split("-").pop()!.toUpperCase()] ?? [img("products"), FALLBACK[i % FALLBACK.length]];

export const COIL_ICON = img("coil");

/** พื้นไล่สีของกรอบไอคอน (สีอ่อน -> สีประจำคลัง) */
export const tileStyle = (col: string): React.CSSProperties => ({
  background: `linear-gradient(145deg, color-mix(in srgb, ${col} 62%, white), ${col})`,
  boxShadow: `0 6px 14px -7px ${col}, inset 0 1px 0 rgb(255 255 255 / .35)`,
});
