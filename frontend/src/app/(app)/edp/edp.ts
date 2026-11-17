// 🏭 EDP PLANNING: ชนิดข้อมูล + การคำนวณเวลา (เงื่อนไขเดียวกับโปรแกรม EDP Systems)
//   1 HG = 3.25 นาที · ส่วนต่างสะสมแบบละเอียด แล้วปัดเป็นนาทีที่ใกล้ที่สุดตอนแสดง (±3.25 → ±3 · ±6.5 → ±7)
//   ชิ้น <-> HG ใช้ QTY_HG (ชิ้นต่อ 1 HG · BaseQtyPerHg ของโปรแกรมเดิม) ไม่ใช่ PCS_HG
//   รอบ 1-3 (08:00-20:00) = กะ DAY · รอบ 4-6 (20:00-08:00) = กะ NIGHT · กะดึก 00:xx อยู่หลัง 23:xx

export const MIN_PER_HG = 3.25;
export type Shift = "DAY" | "NIGHT";
export type Scope = Shift | "ALL";

export type Round = { roundId: number; startHour: number; endHour: number; shift: Shift };
export type Meta = { rounds: Round[]; now: string; can: { submit: boolean; planning: boolean; add: boolean; edit: boolean; delete: boolean } };
export type Part = { partId: number; customer: string; partNo: string; partCode: string | null; partName: string | null; img: string | null; pcsHg: number; qtyHg: number; totalPcs: number };
export type Card = {
  pldId: number;
  plhId: number;
  shift: Shift;
  roundId: number;
  timeStart: string | null;
  timeEnd: string | null;
  partId: number | null;
  customer: string;
  partNo: string;
  partCode: string | null;
  partName: string | null;
  img: string | null;
  pcsHg: number;
  qtyHg: number; // ชิ้นต่อ 1 HG (QTY_HG) = ฐานแปลง ชิ้น <-> HG
  qtyPlan: number;
  hgPlan: number;
  qtyAct: number;
  hgAct: number | null;
  isDone: boolean;
  isVisible: boolean;
  isProblem: boolean;
  remark: string | null;
  isEdited?: boolean;
  origHg: number | null;
};
// planSig = ลายเซ็นแผน (ค่าที่ใช้คิดเวลาเท่านั้น) ส่งกลับตอนสลับการ์ด กันสลับทับแผนที่เครื่องอื่นแก้ไปแล้ว (SUB-14)
export type CardsRes = { status: string | null; sig: string; planSig?: string; cards: Card[]; reopen?: { id: number; by: string; at: string; text: string } | null };

// ช่วงเวลา "HH:mm-HH:mm" -> [ต้น, ปลาย]
export const split = (t: string | null): [string, string] => {
  const [a, b] = (t ?? "").split("-");
  return [a || "00:00", b || "00:00"];
};
export const join = (a: string, b: string) => `${a}-${b}`;

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? +m[1] * 60 + +m[2] : NaN;
};
const fromMin = (n: number) => {
  const v = ((Math.round(n) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

// บวกนาที (ปัดครึ่งออกจากศูนย์ ให้บวก / ลบได้ผลเท่ากัน)
export function addMin(t: string, minutes: number) {
  const m = toMin(t);
  if (Number.isNaN(m)) return t;
  const r = Math.sign(minutes) * Math.round(Math.abs(minutes));
  return fromMin(m + r);
}

// นาทีนับจากต้นกะ (เวลาก่อนต้นกะ = ของวันถัดไป)
export function sortMin(t: string, shiftStartHour: number) {
  const m = toMin(t);
  if (Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
  return m < shiftStartHour * 60 ? m + 1440 : m;
}
export const shiftStart = (s: Shift) => (s === "DAY" ? 8 : 20);

// ความยาวช่วง (นาที) ข้ามเที่ยงคืนได้
const len = (a: string, b: string) => {
  const x = toMin(a),
    y = toMin(b);
  return Number.isNaN(x) || Number.isNaN(y) ? 0 : (y - x + 1440) % 1440;
};

// ชิ้น -> HG (ปัดขึ้นเฉพาะเศษ >= 0.5) · ไม่มีฐาน (QTY_HG = 0) = HG เท่าเดิม (แบบ PlanItem.QtyAct ของโปรแกรมเดิม)
export const hgOf = (qty: number, perHg: number, keep = 0) => (perHg > 0 ? ((qty / perHg) % 1 >= 0.5 ? Math.ceil(qty / perHg) : Math.floor(qty / perHg)) : keep);

/** ช่องเวลา 4 ค่า (START ต้น-ปลาย · OUT ต้น-ปลาย) */
export type Times = { sb: string; se: string; ob: string; oe: string };
export const timesOf = (start: string | null, end: string | null): Times => {
  const [sb, se] = split(start);
  const [ob, oe] = split(end);
  return { sb, se, ob, oe };
};

/**
 * คิดเวลาใหม่ทั้งชุดจากเวลาฐาน (ไม่บวกต่อจากค่าบนจอ):
 * ส่วนต่างการ์ด = (HG ตอนนี้ − HG ฐาน) × 3.25 · HG = 0 หรือผลิตไม่ได้ = ไม่คิดส่วนต่าง
 * เวลาต้น = ฐาน + ส่วนต่างสะสมของการ์ดก่อนหน้า · เวลาปลาย = เวลาต้น + ส่วนต่างของตัวเอง · ขึ้นกะใหม่ = เริ่มนับใหม่
 * zeroBase = true (Plan Setting): HG ฐาน = 0 ไม่คิดส่วนต่างด้วย · false (Plan Submission): คิดตามจริง (เหมือน DashboardViewModel)
 */
export function cascade<T extends { key: number | string; shift: Shift; base: Times; baseHg: number; hg: number; skip?: boolean }>(items: T[], zeroBase = true): Map<T["key"], Times> {
  const out = new Map<T["key"], Times>();
  let cum = 0;
  let last: Shift | null = null;
  for (const it of items) {
    if (it.shift !== last) {
      cum = 0;
      last = it.shift;
    }
    const self = it.skip || it.hg <= 0 || (zeroBase && it.baseHg <= 0) ? 0 : (it.hg - it.baseHg) * MIN_PER_HG;
    out.set(it.key, { sb: addMin(it.base.sb, cum), se: addMin(it.base.se, cum + self), ob: addMin(it.base.ob, cum), oe: addMin(it.base.oe, cum + self) });
    cum += self;
  }
  return out;
}

// HG ฐานของช่องเวลา: ไม่มี HG (แม่แบบเวลาอย่างเดียว) = ความยาวช่วง START ÷ 3.25
export const baseHgOf = (hg: number, t: Times) => (hg > 0 ? hg : Math.round(len(t.sb, t.se) / MIN_PER_HG));

/**
 * ลากสลับการ์ด i กับ j (เรียงตามเวลา): ช่องแรกเริ่มเท่าเดิม จบ + d · การ์ดระหว่างกลางเลื่อน d · ช่องหลังเริ่ม + d จบเท่าเดิม
 * d = (HG ช่องหลัง − HG ช่องแรก) × 3.25 (กันช่วงติดลบ)
 */
export function slotSwap(slots: (Times & { hg: number })[], i: number, j: number): Map<number, Times> {
  if (i > j) [i, j] = [j, i];
  const a = slots[i],
    b = slots[j];
  let d = Math.sign((b.hg - a.hg) * MIN_PER_HG) * Math.round(Math.abs((b.hg - a.hg) * MIN_PER_HG));
  d = Math.max(d, -Math.min(len(a.sb, a.se), len(a.ob, a.oe)));
  d = Math.min(d, Math.min(len(b.sb, b.se), len(b.ob, b.oe)));
  const r = new Map<number, Times>();
  r.set(j, { sb: a.sb, se: addMin(a.se, d), ob: a.ob, oe: addMin(a.oe, d) });
  for (let k = i + 1; k < j; k++) {
    const s = slots[k];
    r.set(k, { sb: addMin(s.sb, d), se: addMin(s.se, d), ob: addMin(s.ob, d), oe: addMin(s.oe, d) });
  }
  r.set(i, { sb: addMin(b.sb, d), se: b.se, ob: addMin(b.ob, d), oe: b.oe });
  return r;
}

// วันที่ YYYY-MM-DD (เวลาเครื่อง)
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dmy = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

// รอบ / กะ ตามนาฬิกาตอนนี้ (00:00-07:59 = กะดึกของเมื่อวาน)
export function nowSlot(rounds: Round[]) {
  const now = new Date();
  const h = now.getHours();
  const r = rounds.find((x) => h >= x.startHour && h < (x.endHour || 24)) ?? rounds[0];
  const date = new Date(now);
  if (h < 8) date.setDate(date.getDate() - 1);
  return { date: ymd(date), shift: (r?.shift ?? "DAY") as Shift, round: r?.roundId ?? 1 };
}

export const roundLabel = (r: Round) => `รอบ ${r.roundId} (${String(r.startHour % 24).padStart(2, "0")}:00 - ${String(r.endHour % 24).padStart(2, "0")}:00)`;
export const imgOf = (c: { partId: number | null; img: string | null }) => (c.partId && c.img ? `/api/images/part/${c.partId}` : null);
