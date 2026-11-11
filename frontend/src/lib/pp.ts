// 📈 PRODUCTION PLAN · สูตรเดียวกับ Excel "PRESS 1 CAPACITY PLANNING" (1 ชีท = 1 เครื่อง + ชีท Press 1 table)
//   ตาราง Product : SPH = 3600 ÷ MC CT · Stroke = PCS × Total Process ÷ Col.(Pcs./Stroke) (เครื่อง Transfer = PCS ÷ Col.) · MC Hr = Stroke ÷ SPH
//   Condition M/C : C1 วันทำงาน · C2 Q'ty Line · C3 SPH 100% = ΣStroke ÷ ΣMC Hr · C4 Target Eff · C5-C9 Plan SPH ต่อกะ (กะถัดไปแสดงเมื่อกะก่อนหน้า < P1)
//   Plan          : P1 ΣStroke · P2 = P1/C1 · P3 = P1/C3 · P4 = P3/C4 · P5 = P4/C1 · P6 = P5/C2 · P7 STD Man · P8 = P6×P7×C2×1.023 · P9 = P8/11
//   Actual        : A1 ΣStroke · A2 ΣWorking hr · A3 = A1/A2 · A4 %EFF = A3/C3 · A5 Man เฉลี่ย
//   คอลัมน์รวมกลุ่ม / Total = ตามชีท Press 1 table
export type PpPart = {
  id: number;
  machineId: number;
  sort: number;
  partAId: number;
  partA: string;
  pdCode: string;
  customer: string;
  partBId: number | null;
  partB: string | null;
  name: string;
  process: string | null;
  tp: number;
  col: number;
  ct: number;
  man: number | null;
  active: boolean;
  pcs: number;
  pcsFrom: "ORDER" | "FORECAST" | "";
};
export type PpActual = { day: number; hr: number | null; stroke: number | null; man: number | null };
export type PpMachine = { id: number; code: string; group: string; subGroup: string | null; sort: number; qty: number; eff: number; man: number; sph: number | null; byPcs: boolean; parts: PpPart[]; actual: PpActual[] };
export type PpShift = { id: number; name: string; hours: number; sort: number };
export type PpMonth = {
  dept: string;
  month: string; // yyyy-MM
  days: number;
  workdays: number[];
  workdaySource: "COMPANY" | "DEFAULT";
  shifts: PpShift[];
  settings: Record<string, number>;
  machines: PpMachine[];
};

export const sphOf = (p: { ct: number }) => (p.ct > 0 ? 3600 / p.ct : 0);
/** byPcs = เครื่อง Transfer (TRBS / NBT): Stroke = PCS ÷ Pcs./Stroke (ไม่คูณ Total Process) ตามชีท Excel */
export const strokeOf = (p: { pcs: number; tp: number; col: number }, byPcs = false) => (p.col > 0 ? (p.pcs * (byPcs ? 1 : p.tp)) / p.col : 0);
export const mcHrOf = (p: { pcs: number; tp: number; col: number; ct: number }, byPcs = false) => {
  const s = sphOf(p);
  return s > 0 ? strokeOf(p, byPcs) / s : 0;
};
const div = (a: number, b: number) => (b ? a / b : 0);

export type Calc = {
  C1: number;
  C2: number;
  C3: number;
  C3auto: boolean;
  C4: number;
  sh: (number | null)[];
  P1: number;
  P2: number;
  P3: number;
  P4: number;
  P5: number;
  P6: number;
  P7: number;
  P8: number;
  P9: number;
  A1: number;
  A2: number;
  A3: number;
  A4: number;
  A5: number;
  pcs: number;
  // รายวัน (index 0 = วันที่ 1)
  plan: (number | null)[];
  planHr: (number | null)[];
  planAcc: number[];
  planHrAcc: number[];
  actStroke: (number | null)[];
  actHr: (number | null)[];
  actMan: (number | null)[];
  actAcc: (number | null)[];
  actHrAcc: (number | null)[];
  sphDay: (number | null)[];
  effDay: (number | null)[];
  last: number; // วันสุดท้ายที่มี Actual (-1 = ยังไม่มี)
};

/** คำนวณเครื่องเดียวทั้งเดือน (ตรงกับชีทของเครื่องใน Excel) */
export function calcMachine(m: PpMachine, d: PpMonth): Calc {
  const wd = new Set(d.workdays);
  const factor = d.settings.ManHourFactor ?? 1.023;
  const perDay = d.settings.ManHourPerDay ?? 11;
  let S = 0,
    H = 0,
    pcs = 0;
  for (const p of m.parts) {
    S += strokeOf(p, m.byPcs);
    H += mcHrOf(p, m.byPcs);
    pcs += p.pcs;
  }
  // SPH 100%: กำหนดเองที่ STD > ΣStroke ÷ ΣMC Hr > ยังไม่มี PCS เลย = SPH เฉลี่ยของตาราง Product
  const avgSph = m.parts.length ? m.parts.reduce((a, p) => a + sphOf(p), 0) / m.parts.length : 0;
  const C3 = m.sph && m.sph > 0 ? m.sph : H > 0 ? S / H : avgSph;
  const C1 = wd.size,
    C2 = m.qty,
    C4 = m.eff;
  const P1 = S,
    P2 = div(P1, C1),
    P3 = div(P1, C3),
    P4 = div(P3, C4),
    P5 = div(P4, C1),
    P6 = div(P5, C2),
    P7 = m.man,
    P8 = P6 * P7 * C2 * factor,
    P9 = div(P8, perDay);
  const base = C1 * C2 * C3 * C4;
  const sh: (number | null)[] = [];
  d.shifts.forEach((s, i) => {
    const prev = i === 0 ? null : sh[i - 1];
    sh.push(i === 0 ? base * s.hours : prev != null && prev < P1 ? base * s.hours : null);
  });

  const nd = d.days;
  const byDay = new Map(m.actual.map((a) => [a.day, a]));
  const plan: (number | null)[] = [],
    planHr: (number | null)[] = [],
    planAcc: number[] = [],
    planHrAcc: number[] = [],
    actStroke: (number | null)[] = [],
    actHr: (number | null)[] = [],
    actMan: (number | null)[] = [],
    actAcc: (number | null)[] = [],
    actHrAcc: (number | null)[] = [],
    sphDay: (number | null)[] = [],
    effDay: (number | null)[] = [];
  let ps = 0,
    ph = 0,
    A1 = 0,
    A2 = 0,
    mSum = 0,
    mCnt = 0,
    last = -1;
  for (let i = 0; i < nd; i++) {
    const a = byDay.get(i + 1);
    if (a && ((a.stroke ?? 0) > 0 || (a.hr ?? 0) > 0)) last = i;
  }
  let as = 0,
    ah = 0;
  for (let i = 0; i < nd; i++) {
    const w = wd.has(i + 1);
    plan.push(w ? P2 : null);
    planHr.push(w ? P5 : null);
    ps += w ? P2 : 0;
    ph += w ? P5 : 0;
    planAcc.push(ps);
    planHrAcc.push(ph);
    const a = byDay.get(i + 1);
    const st = a?.stroke ?? null,
      hr = a?.hr ?? null,
      mn = a?.man ?? null;
    actStroke.push(st);
    actHr.push(hr);
    actMan.push(mn);
    as += st ?? 0;
    ah += hr ?? 0;
    A1 += st ?? 0;
    A2 += hr ?? 0;
    if (mn != null && mn > 0) {
      mSum += mn;
      mCnt++;
    }
    actAcc.push(i <= last ? as : null);
    actHrAcc.push(i <= last ? ah : null);
    const sp = hr && hr > 0 ? (st ?? 0) / hr : null;
    sphDay.push(sp);
    effDay.push(sp != null && C3 > 0 ? sp / C3 : null);
  }
  const A3 = div(A1, A2);
  return {
    C1,
    C2,
    C3,
    C3auto: !(m.sph && m.sph > 0),
    C4,
    sh,
    P1,
    P2,
    P3,
    P4,
    P5,
    P6,
    P7,
    P8,
    P9,
    A1,
    A2,
    A3,
    A4: div(A3, C3),
    A5: mCnt ? mSum / mCnt : 0,
    pcs,
    plan,
    planHr,
    planAcc,
    planHrAcc,
    actStroke,
    actHr,
    actMan,
    actAcc,
    actHrAcc,
    sphDay,
    effDay,
    last,
  };
}

/** แถวของตาราง Condition M/C (Press 1 table) */
export type Sum = Pick<Calc, "C1" | "C2" | "C3" | "C4" | "sh" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "A1" | "A2" | "A3" | "A4" | "A5">;

const sumN = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sumSh = (cs: Sum[], n: number) =>
  Array.from({ length: n }, (_, i) => {
    const v = cs.map((c) => c.sh[i]).filter((x): x is number => x != null);
    return v.length ? sumN(v) : null;
  });

/** คอลัมน์รวมของกลุ่ม (เช่น GROUP 1 = 1.1-1.6) ตามสูตร Press 1 table */
export function groupSum(cs: Sum[], factor = 1.023): Sum {
  const C1 = cs[0]?.C1 ?? 0,
    C2 = sumN(cs.map((c) => c.C2)),
    P1 = sumN(cs.map((c) => c.P1)),
    P3 = sumN(cs.map((c) => c.P3)),
    P4x = sumN(cs.map((c) => c.P4)),
    C4 = div(P3, P4x) || cs[0]?.C4 || 0,
    C3 = div(P1, P3),
    P4 = div(P3, C4),
    P5 = div(P4, C1),
    P6 = div(P5, C2),
    P7 = sumN(cs.map((c) => c.P7)),
    A1 = sumN(cs.map((c) => c.A1)),
    A2 = sumN(cs.map((c) => c.A2)),
    A3 = div(A1, A2);
  return {
    C1,
    C2,
    C3,
    C4,
    sh: sumSh(cs, Math.max(0, ...cs.map((c) => c.sh.length))),
    P1,
    P2: div(P1, C1),
    P3,
    P4,
    P5,
    P6,
    P7,
    P8: P6 * P7 * C2 * factor,
    P9: sumN(cs.map((c) => c.P9)),
    A1,
    A2,
    A3,
    A4: div(A3, C3),
    A5: sumN(cs.map((c) => c.A5)),
  };
}

/** คอลัมน์ Total ของทั้งหน่วยงาน (รวมจากคอลัมน์ของแต่ละกลุ่ม) */
export function totalSum(groups: Sum[]): Sum {
  const P1 = sumN(groups.map((c) => c.P1)),
    P3 = sumN(groups.map((c) => c.P3)),
    P4 = sumN(groups.map((c) => c.P4)),
    C3 = div(P1, P3),
    A1 = sumN(groups.map((c) => c.A1)),
    A2 = sumN(groups.map((c) => c.A2)),
    A3 = div(A1, A2);
  return {
    C1: groups[0]?.C1 ?? 0,
    C2: sumN(groups.map((c) => c.C2)),
    C3,
    C4: div(P3, P4),
    sh: sumSh(groups, Math.max(0, ...groups.map((c) => c.sh.length))),
    P1,
    P2: sumN(groups.map((c) => c.P2)),
    P3,
    P4,
    P5: sumN(groups.map((c) => c.P5)),
    P6: sumN(groups.map((c) => c.P6)),
    P7: sumN(groups.map((c) => c.P7)),
    P8: sumN(groups.map((c) => c.P8)),
    P9: sumN(groups.map((c) => c.P9)),
    A1,
    A2,
    A3,
    A4: div(A3, C3),
    A5: sumN(groups.map((c) => c.A5)),
  };
}

export type Col = { key: string; label: string; sub?: string; kind: "machine" | "group" | "total"; machine?: PpMachine; c: Sum; calc?: Calc };

/** คอลัมน์ของตาราง Condition M/C: กลุ่มที่มีหลายเครื่อง = คอลัมน์รวมกลุ่ม + เครื่องในกลุ่ม · ท้ายสุด Total */
export function conditionCols(d: PpMonth, calcs: Map<number, Calc>): Col[] {
  const factor = d.settings.ManHourFactor ?? 1.023;
  const groups: { name: string; ms: PpMachine[] }[] = [];
  for (const m of d.machines) {
    const g = groups.find((x) => x.name === m.group);
    if (g) g.ms.push(m);
    else groups.push({ name: m.group, ms: [m] });
  }
  const cols: Col[] = [];
  const groupVals: Sum[] = [];
  for (const g of groups) {
    const cs = g.ms.map((m) => calcs.get(m.id)!);
    if (g.ms.length > 1) {
      const s = groupSum(cs, factor);
      groupVals.push(s);
      cols.push({ key: "g-" + g.name, label: g.name, sub: `${g.ms.length} M/C`, kind: "group", c: s });
      g.ms.forEach((m, i) => cols.push({ key: "m-" + m.id, label: m.code, sub: m.subGroup ?? g.name, kind: "machine", machine: m, c: cs[i], calc: cs[i] }));
    } else {
      groupVals.push(cs[0]);
      cols.push({ key: "m-" + g.ms[0].id, label: g.ms[0].code, sub: g.name, kind: "machine", machine: g.ms[0], c: cs[0], calc: cs[0] });
    }
  }
  if (groupVals.length) cols.push({ key: "total", label: "TOTAL", sub: d.dept, kind: "total", c: totalSum(groupVals) });
  return cols;
}

// ---------------------------------------------------------------- ตัวเลข
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ok = (v: number | null | undefined): v is number => v != null && isFinite(v);
export const f0 = (v: number | null | undefined) => (ok(v) ? nf0.format(Math.round(v)) : "–");
export const f1 = (v: number | null | undefined) => (ok(v) ? nf1.format(v) : "–");
export const f2 = (v: number | null | undefined) => (ok(v) ? nf2.format(v) : "–");
export const pc = (v: number | null | undefined) => (ok(v) ? (v * 100).toFixed(1) + "%" : "–");
export const shortN = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(+v.toFixed(1));
};
/** สถานะ Eff เทียบเป้า: ถึงเป้า / ใกล้ (≥ 85% ของเป้า) / ต่ำกว่า */
export const effTone = (a: number, t: number) => (a >= t ? "ok" : a >= t * 0.85 ? "mid" : "low");

export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
};
export const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const dowOf = (month: string, day: number) => {
  const [y, mo] = month.split("-").map(Number);
  return new Date(y, mo - 1, day).getDay();
};

// 🏭 หน่วยงานของ Production Plan (code = ProductionPlan.Machines.Dept · slug = URL /pp/capacity/<slug>)
export const DEPTS = [
  { code: "PRESS1", slug: "press1", name: "PRESS 1", th: "ปั๊ม 1" },
  { code: "PRESS2", slug: "press2", name: "PRESS 2", th: "ปั๊ม 2" },
  { code: "ASSEMBLY", slug: "assembly", name: "ASSEMBLY", th: "ประกอบ" },
  { code: "PIPEPART", slug: "pipepart", name: "PIPE PART", th: "ชิ้นส่วนท่อ" },
  { code: "PIPEASSY", slug: "pipeassy", name: "PIPE ASSY", th: "ประกอบท่อ" },
  { code: "PAINTPART", slug: "paintpart", name: "PAINT PART", th: "ชิ้นส่วนสี" },
] as const;
export type Dept = (typeof DEPTS)[number];
export const deptOf = (v: string | null | undefined): Dept => DEPTS.find((d) => d.code === (v ?? "").toUpperCase() || d.slug === (v ?? "").toLowerCase()) ?? DEPTS[0];
