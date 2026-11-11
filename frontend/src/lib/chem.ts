// 🧪 CHEMICAL CONTROL · ชนิดข้อมูล + การประเมินผล (ใช้ร่วมกันทุกหน้า)
//   สถานะผลการตรวจวัด: OK = อยู่ในขีดจำกัดควบคุม · WARN = เกิน UCL / LCL แต่ยังอยู่ในข้อกำหนด · OUT = นอกข้อกำหนด (Spec Min / Max)
export type ChemParam = {
  id: number;
  code: string;
  name: string;
  nameTh: string | null;
  line: string;
  process: string | null;
  category: string;
  unit: string | null;
  specMin: number | null;
  specMax: number | null;
  lcl: number | null;
  ucl: number | null;
  target: number | null;
  decimals: number;
  shifts: "D" | "DN";
  dayTimes: string | null;
  nightTimes: string | null;
  method: string | null;
  formNo: string | null;
  sort: number;
  active: boolean;
  readings: number;
  updatedBy: string | null;
  updatedAt: string;
};
export type ChemReading = { id: number; paramId: number; date: string; shift: "D" | "N"; slot: number; time: string | null; value: number; inspector: string | null; inspectorId: string | null; remark: string | null };
export type ChemAction = { id: number; paramId: number; date: string; checkTime: string | null; problem: string | null; before: number | null; after: number | null; correction: string | null; adjustTime: string | null; responsible: string | null; createdBy: string | null };
export type ChemCan = { record: boolean; edit: boolean; setup: boolean; add: boolean; setupEdit: boolean; delete: boolean; admin: boolean };
export type Status = "OK" | "WARN" | "OUT" | "NONE";

export const times = (s: string | null | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
export const slotsOf = (p: ChemParam, shift: "D" | "N") => (shift === "N" && p.shifts === "D" ? [] : times(shift === "N" ? p.nightTimes : p.dayTimes));

export function statusOf(p: ChemParam, v: number | null | undefined): Status {
  if (v == null || !isFinite(v)) return "NONE";
  if ((p.specMin != null && v < p.specMin) || (p.specMax != null && v > p.specMax)) return "OUT";
  if ((p.lcl != null && v < p.lcl) || (p.ucl != null && v > p.ucl)) return "WARN";
  return "OK";
}
export const STATUS_TEXT: Record<Status, string> = { OK: "IN CONTROL", WARN: "WARNING", OUT: "OUT OF SPEC", NONE: "NO DATA" };
export const STATUS_TH: Record<Status, string> = { OK: "อยู่ในเกณฑ์ควบคุม", WARN: "เกินขีดจำกัดควบคุม", OUT: "นอกข้อกำหนด", NONE: "ยังไม่ตรวจวัด" };

export const specText = (p: ChemParam) => {
  const f = (v: number) => fmt(p, v);
  if (p.specMin != null && p.specMax != null) return `${f(p.specMin)} – ${f(p.specMax)}`;
  if (p.specMax != null) return `≤ ${f(p.specMax)}`;
  if (p.specMin != null) return `≥ ${f(p.specMin)}`;
  return "–";
};
export const fmt = (p: { decimals: number }, v: number | null | undefined) =>
  v == null || !isFinite(v) ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: Math.max(p.decimals, 2) });

/** สถิติของชุดค่า: n · mean · σ (sample) · min · max · Cp · Cpk · นอกข้อกำหนด */
export function stats(p: ChemParam, vals: number[]) {
  const n = vals.length;
  const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const cp = sd > 0 && p.specMin != null && p.specMax != null ? (p.specMax - p.specMin) / (6 * sd) : null;
  const k: number[] = [];
  if (sd > 0 && p.specMax != null) k.push((p.specMax - mean) / (3 * sd));
  if (sd > 0 && p.specMin != null) k.push((mean - p.specMin) / (3 * sd));
  return {
    n,
    mean,
    sd,
    min: n ? Math.min(...vals) : null,
    max: n ? Math.max(...vals) : null,
    cp,
    cpk: k.length ? Math.min(...k) : null,
    out: vals.filter((v) => statusOf(p, v) === "OUT").length,
    warn: vals.filter((v) => statusOf(p, v) === "WARN").length,
  };
}

export const CATEGORY: Record<string, { label: string; color: string }> = {
  CHEMICAL: { label: "CHEMICAL", color: "#2563eb" },
  WATER: { label: "WATER", color: "#0891b2" },
  PAINT: { label: "PAINT", color: "#7c3aed" },
  TEMPERATURE: { label: "TEMPERATURE", color: "#ea580c" },
};
export const catOf = (c: string) => CATEGORY[c] ?? { label: c, color: "#52525b" };

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const thisMonth = () => isoDate(new Date()).slice(0, 7);
/** กะปัจจุบัน: 08:00-19:59 = กลางวัน · นอกนั้น = กลางคืน (หลังเที่ยงคืน = กะของเมื่อวาน) */
export function currentShift(now = new Date()): { date: string; shift: "D" | "N" } {
  const h = now.getHours();
  if (h >= 8 && h < 20) return { date: isoDate(now), shift: "D" };
  const d = new Date(now);
  if (h < 8) d.setDate(d.getDate() - 1);
  return { date: isoDate(d), shift: "N" };
}
