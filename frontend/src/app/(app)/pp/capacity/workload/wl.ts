"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { calcMachine, conditionCols, type Calc, type PpMachine, type PpShift } from "@/lib/pp";

// 👥 WORKLOAD: ข้อมูล + สูตรที่ใช้ร่วมกันระหว่างตาราง (CAPACITY › WORKLOAD) กับ DASHBOARD › WORKLOAD
//   PDT = Total P1 · Direct = Total P9 · Production (N-1) = Total A1 ของ Capacity หน่วยงานนั้น (สูตรเดียวกับหน้า Capacity)
//   Ind1 / Ind2 ของแผน = คนที่มีจริง (Current) · Total = Direct + Ind1 + Ind2 · Actual = Current Direct − Plan Direct (ติดลบ = คนขาด)
export type WlRow = { key: string; grp: string; name: string; short: string; dept?: string; direct?: boolean };
export const WL_ROWS: WlRow[] = [
  { key: "TPS", grp: "แผนกบริหารการผลิตและโลจิสติกส์", name: "วางแผนการผลิตและTPS", short: "TPS" },
  { key: "DELIVERY", grp: "แผนกบริหารการผลิตและโลจิสติกส์", name: "จัดส่งและส่งมอบ", short: "DELIVERY" },
  { key: "QA", grp: "แผนกบริหารคุณภาพ", name: "ประกันคุณภาพและมาตรฐาน", short: "QA" },
  { key: "QC", grp: "แผนกบริหารคุณภาพ", name: "ควบคุมคุณภาพ", short: "QC", dept: "QC", direct: false }, // Excel: QC ดึงเฉพาะ PDT (Direct = 0)
  { key: "PRESS1", grp: "แผนกผลิต 1", name: "ปั๊ม 1", short: "PRESS 1", dept: "PRESS1" },
  { key: "PRESS2", grp: "แผนกผลิต 1", name: "ปั๊ม 2", short: "PRESS 2", dept: "PRESS2" },
  { key: "ASSEMBLY", grp: "แผนกผลิต 1", name: "ประกอบ", short: "ASSEMBLY", dept: "ASSEMBLY" },
  { key: "DIE", grp: "แผนกผลิต 1", name: "บำรุงรักษาแม่พิมพ์", short: "DIE", dept: undefined },
  { key: "PIPEPART", grp: "แผนกผลิต 2", name: "ชิ้นส่วนท่อ", short: "PIPE PART", dept: "PIPEPART" },
  { key: "PIPEASSY", grp: "แผนกผลิต 2", name: "ประกอบท่อ", short: "PIPE ASSY", dept: "PIPEASSY" },
  { key: "PAINTPART", grp: "แผนกผลิต 2", name: "ชิ้นส่วนสี", short: "PAINT PART", dept: "PAINTPART" },
];
export const WL_GROUPS = WL_ROWS.reduce<{ grp: string; n: number }[]>((a, r) => {
  const g = a.find((x) => x.grp === r.grp);
  if (g) g.n++;
  else a.push({ grp: r.grp, n: 1 });
  return a;
}, []);

export type WlMonth = { month: string; days: number; workdays: number[]; workdaySource: "COMPANY" | "DEFAULT"; depts: Record<string, PpMachine[]> };
export type WlHead = { month: string; row: string; direct: number | null; ind1: number | null; ind2: number | null; updatedBy: string | null; updatedAt: string };
export type WlRes = { data: { month: string; shifts: PpShift[]; settings: Record<string, number>; months: WlMonth[]; heads: WlHead[] }; can: { edit: boolean } };
export type WlField = "direct" | "ind1" | "ind2";
export type Heads = { direct: number; ind1: number; ind2: number };
export type WlPlan = { pdt: number; direct: number; ind1: number; ind2: number; total: number; diff: number };
export type WlTableRow = { r: WlRow; prevPlan: WlPlan; prevAct: Heads & { prod: number; total: number }; cur: Heads & { total: number }; plans: WlPlan[] };
export type WlTable = {
  rows: WlTableRow[];
  tot: { prevPlan: WlPlan; prevAct: Heads & { prod: number; total: number }; cur: Heads & { total: number }; plans: WlPlan[] };
};
type Tot = { p1: number; p9: number; a1: number };

export const WL_FIELDS: WlField[] = ["direct", "ind1", "ind2"];
export const EN = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};
export const ENS = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short" }).toUpperCase() + " '" + String(y).slice(2);
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const signed = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? "0" : r > 0 ? `+${r}` : String(r);
};

// Total ของหน่วยงาน (คอลัมน์ TOTAL ของ Condition M/C) ด้วยสูตรเดียวกับหน้า Capacity
export function deptTotals(m: WlMonth, shifts: PpShift[], settings: Record<string, number>): Record<string, Tot> {
  const out: Record<string, Tot> = {};
  for (const [dept, machines] of Object.entries(m.depts)) {
    const d = { dept, month: m.month, days: m.days, workdays: m.workdays, workdaySource: m.workdaySource, shifts, settings, machines };
    const calcs = new Map<number, Calc>(machines.map((x) => [x.id, calcMachine(x, d)]));
    const t = conditionCols(d, calcs).find((c) => c.kind === "total")?.c;
    out[dept] = { p1: t?.P1 ?? 0, p9: t?.P9 ?? 0, a1: t?.A1 ?? 0 };
  }
  return out;
}

// ตารางทั้งหมด: N-1 Plan · N-1 Actual · Current · N…N+3 Plan · headOf = คนที่มีจริงของเดือน (ค่าที่กำลังพิมพ์ / ที่บันทึกไว้)
export function buildTable(data: WlRes["data"], totals: Record<string, Tot>[], headOf: (m: string, row: string) => Heads): WlTable | null {
  const ms = data.months;
  if (ms.length < 5) return null;
  const prevM = ms[0].month,
    curM = ms[1].month;
  const rows = WL_ROWS.map((r) => {
    const prev = headOf(prevM, r.key);
    const cur = headOf(curM, r.key);
    const plan = (i: number, ind: { ind1: number; ind2: number }, have: number): WlPlan => {
      const t = r.dept ? totals[i][r.dept] : undefined;
      const pdt = t?.p1 ?? 0;
      const direct = r.direct === false ? 0 : (t?.p9 ?? 0);
      const total = direct + ind.ind1 + ind.ind2;
      return { pdt, direct, ind1: ind.ind1, ind2: ind.ind2, total, diff: have - direct };
    };
    return {
      r,
      prevPlan: plan(0, prev, prev.direct),
      prevAct: { prod: r.dept ? (totals[0][r.dept]?.a1 ?? 0) : 0, ...prev, total: prev.direct + prev.ind1 + prev.ind2 },
      cur: { ...cur, total: cur.direct + cur.ind1 + cur.ind2 },
      plans: [1, 2, 3, 4].map((i) => plan(i, cur, cur.direct)),
    };
  });
  const S = (f: (x: WlTableRow) => number) => sum(rows.map(f));
  const P = (g: (x: WlTableRow) => WlPlan): WlPlan => ({
    pdt: S((x) => g(x).pdt),
    direct: S((x) => g(x).direct),
    ind1: S((x) => g(x).ind1),
    ind2: S((x) => g(x).ind2),
    total: S((x) => g(x).total),
    diff: S((x) => g(x).diff),
  });
  return {
    rows,
    tot: {
      prevPlan: P((x) => x.prevPlan),
      prevAct: { prod: S((x) => x.prevAct.prod), direct: S((x) => x.prevAct.direct), ind1: S((x) => x.prevAct.ind1), ind2: S((x) => x.prevAct.ind2), total: S((x) => x.prevAct.total) },
      cur: { direct: S((x) => x.cur.direct), ind1: S((x) => x.cur.ind1), ind2: S((x) => x.cur.ind2), total: S((x) => x.cur.total) },
      plans: [0, 1, 2, 3].map((i) => P((x) => x.plans[i])),
    },
  };
}

export function savedHeads(heads: WlHead[]) {
  const map = new Map<string, WlHead>();
  for (const h of heads) map.set(`${h.month}|${h.row}`, h);
  return map;
}
export const updOf = (heads: WlHead[], m: string) => {
  const t = heads.filter((h) => h.month === m).map((h) => h.updatedAt).sort().pop();
  return t ? new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–";
};

// โหลด /pp/workload + เรียลไทม์ (Capacity / Actual / STD / Forecast / วันทำงานเปลี่ยน = โหลดเงียบ ๆ · paused = กำลังแก้อยู่ ไม่ทับ)
export function useWorkload(month: string, paused = false) {
  const toast = useToast();
  const [res, setRes] = useState<WlRes | null>(null);
  const [err, setErr] = useState("");
  const seq = useRef(0);
  const last = useRef("");
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      try {
        const r = await api<WlRes>("/pp/workload", { query: { month } });
        if (my !== seq.current) return;
        const sig = JSON.stringify(r);
        if (quiet && sig === last.current) return; // เรียลไทม์แต่ข้อมูลเดิม = ไม่วาดใหม่
        last.current = sig;
        setRes(r);
        setErr("");
      } catch (e) {
        if (my !== seq.current) return;
        setErr((e as Error).message);
        if (!quiet) toast.show("ERROR", "โหลด Workload ไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [month, toast],
  );
  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["pp", "forecast", "maxmin"], () => (pausedRef.current ? undefined : load(true)), 60_000);
  return { res, err, load };
}
