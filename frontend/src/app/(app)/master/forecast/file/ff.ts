// 📂 FORECAST FILE: ชนิดข้อมูล + ตัวช่วยกรอง (ย้ายมาจาก Forecast_Order_Filter.html ของนนท์)

export type Nums = (number | null)[]; // 12 ช่อง (ม.ค. … ธ.ค.)
export type FPart = { no: string; model: string; partA: string; tag: string; partNo: string; partName: string; note: string; f: Nums; o: Nums; d: Nums; x: Nums };
export type FSheet = { name: string; customer: string; months: number[]; parts: FPart[] };
export type FRef = { name: string; names: string[]; total: { f: Nums; o: Nums; d: Nums } | null } | null;
export type FFile = { id: string; fileName: string; year: number | null; skipped: string[]; sheets: FSheet[]; ref: FRef };
export type Met = "F" | "O" | "D" | "X";

/** 1 แถว = 1 Part × 1 เดือน (แบบ Template FORECAST ORDER) */
export type FlatRow = { sh: FSheet; p: FPart; m: number };
/** แถวที่ส่งให้ Server (preview / apply) */
export type SendRow = { sheet: string; customer: string; partA: string; partNo: string; name: string; month: number; f: number | null; o: number | null; d: number | null };

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const n0 = (v: number | null | undefined) => (v == null ? "" : Math.round(v).toLocaleString("en-US"));

export const hasMonthData = (p: FPart, m: number) => !!(p.f[m - 1] || p.o[m - 1] || p.d[m - 1]);

// ค้นหา: คั่นหลายคำค้นด้วย , หรือ ; (อย่างใดอย่างหนึ่ง) · ในคำค้นเดียว เว้นวรรค = ต้องมีทุกคำ · ไม่สนตัวพิมพ์ / เว้นวรรค / ขีด
const squash = (s: string) => s.toLowerCase().replace(/[\s\-_./]+/g, "");
export function matcher(q: string) {
  const groups = q
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((g) => g.split(/\s+/));
  if (!groups.length) return null;
  return (sh: FSheet, p: FPart) => {
    const hay = [p.partA, p.tag, p.partNo, p.partName, p.model, p.note, sh.name, sh.customer].join(" ").toLowerCase();
    const hs = squash(hay);
    return groups.some((ws) => ws.every((w) => hay.includes(w) || hs.includes(squash(w))));
  };
}

/** เดือนเริ่มต้น: เดือนล่าสุดที่มี ORDER / DELIVERY (แบบไฟล์ของนนท์) */
export function defaultMonths(sheets: FSheet[]) {
  let best = 0,
    first = 0;
  for (const sh of sheets) {
    for (const m of sh.months) if (!first || m < first) first = m;
    for (const p of sh.parts) for (const m of sh.months) if (((p.o[m - 1] ?? 0) > 0 || (p.d[m - 1] ?? 0) > 0) && m > best) best = m;
  }
  const pick = best || first;
  return new Set(pick ? [pick] : []);
}

/** กลุ่มของรายการที่หาไม่ได้ (ตรงกับ KeyOf ฝั่ง Server) */
export const keyOf = (r: { sheet: string; partA: string; partNo: string }) => (r.partA.trim() ? r.partA.trim().toUpperCase() : `#${r.sheet}|${r.partNo.trim()}`);

// ---------------------------------------------------------------- ผลตรวจก่อน IMPORT
export type PvItem = { status: "NEW" | "CHANGED" | "SAME"; customer: string; partA: string; partB: string; partNo: string; name: string; month: string; f: number; o: number; d: number; oldF: number | null; oldO: number | null; oldD: number | null };
export type Prod = { ptId: number; partCode: string; partA: string; partB: string; partNo: string; name: string; customer: string };
export type PvMissing = {
  key: string;
  partA: string;
  kind: "NOT_FOUND" | "NO_CUSTOMER" | "MULTI" | "NO_PART_A" | "INVALID";
  reason: string;
  sheet: string;
  customer: string;
  partNo: string;
  name: string;
  months: number[];
  rows: number;
  f: number;
  o: number;
  d: number;
  suggest: Prod[];
};
export type Preview = { year: number; counts: { new: number; changed: number; same: number; missing: number; missingRows: number }; items: PvItem[]; missing: PvMissing[]; defaults: { category: string } };

/** ฟอร์มเพิ่ม Product ใหม่ (ช่องเดียวกับ MASTER DATA › Product Control) */
export type NewProd = { partCode: string; partA: string; partB: string; partNo: string; partName: string; customer: string; model: string; category: string; packSize: string; supplier: string; bin: string; stock: number | "MAIN" };
/** วิธีแก้รายการที่ไม่มีในระบบ: ใช้ PART A ที่มีอยู่ / เพิ่ม Product ใหม่ */
export type Fix = { mode: "map"; prod: Prod } | { mode: "new"; form: NewProd; done?: Prod };
