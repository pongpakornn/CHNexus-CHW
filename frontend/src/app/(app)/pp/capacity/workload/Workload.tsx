"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { calcMachine, conditionCols, f0, f1, thisMonth, type Calc, type PpMachine, type PpShift } from "@/lib/pp";
import { Kpi, MonthPicker, PpIcon } from "../../shared";
import "../../pp.css";

// 👥 PRODUCTION PLAN › CAPACITY › WORKLOAD : สรุปอัตรากำลังคน แผน, ผล ประจำเดือน (Monthly man-power Plan & Actual) · แทนชีท "9. ManPower" ของ Excel Work load
//   PDT    = Total P1 (Plan Stroke) ของ Capacity หน่วยงานนั้น · Direct = Total P9 (Required Man) · Production (N-1) = Total A1
//   Ind1 / Ind2 ของแผน = คนที่มีจริง (Current) · Total = Direct + Ind1 + Ind2 · Actual = Current Direct − Plan Direct (ติดลบ = คนขาด)
//   คนที่มีจริง (Current ของเดือน N · Actual ของเดือน N-1) = กรอกที่หน้านี้ แล้วกด SAVE · Capacity / Forecast / วันทำงานเปลี่ยน = อัพเดทเอง
type Row = { key: string; grp: string; name: string; dept?: string; direct?: boolean };
const ROWS: Row[] = [
  { key: "TPS", grp: "แผนกบริหารการผลิตและโลจิสติกส์", name: "วางแผนการผลิตและTPS" },
  { key: "DELIVERY", grp: "แผนกบริหารการผลิตและโลจิสติกส์", name: "จัดส่งและส่งมอบ" },
  { key: "QA", grp: "แผนกบริหารคุณภาพ", name: "ประกันคุณภาพและมาตรฐาน" },
  { key: "QC", grp: "แผนกบริหารคุณภาพ", name: "ควบคุมคุณภาพ", dept: "QC", direct: false }, // Excel: QC ดึงเฉพาะ PDT (Direct = 0)
  { key: "PRESS1", grp: "แผนกผลิต 1", name: "ปั๊ม 1", dept: "PRESS1" },
  { key: "PRESS2", grp: "แผนกผลิต 1", name: "ปั๊ม 2", dept: "PRESS2" },
  { key: "ASSEMBLY", grp: "แผนกผลิต 1", name: "ประกอบ", dept: "ASSEMBLY" },
  { key: "DIE", grp: "แผนกผลิต 1", name: "บำรุงรักษาแม่พิมพ์" },
  { key: "PIPEPART", grp: "แผนกผลิต 2", name: "ชิ้นส่วนท่อ", dept: "PIPEPART" },
  { key: "PIPEASSY", grp: "แผนกผลิต 2", name: "ประกอบท่อ", dept: "PIPEASSY" },
  { key: "PAINTPART", grp: "แผนกผลิต 2", name: "ชิ้นส่วนสี", dept: "PAINTPART" },
];
const GROUPS = ROWS.reduce<{ grp: string; n: number }[]>((a, r) => {
  const g = a.find((x) => x.grp === r.grp);
  if (g) g.n++;
  else a.push({ grp: r.grp, n: 1 });
  return a;
}, []);

type WlMonth = { month: string; days: number; workdays: number[]; workdaySource: "COMPANY" | "DEFAULT"; depts: Record<string, PpMachine[]> };
type Head = { month: string; row: string; direct: number | null; ind1: number | null; ind2: number | null; updatedBy: string | null; updatedAt: string };
type Res = { data: { month: string; shifts: PpShift[]; settings: Record<string, number>; months: WlMonth[]; heads: Head[] }; can: { edit: boolean } };
type Tot = { p1: number; p9: number; a1: number };
type Field = "direct" | "ind1" | "ind2";
type Draft = Record<string, string>; // `${month}|${row}|${field}` -> ข้อความที่พิมพ์

const FIELDS: Field[] = ["direct", "ind1", "ind2"];
const EN = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
const str = (v: number | null | undefined) => (v == null ? "" : String(+v.toFixed(2)));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const dl = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? "0" : r > 0 ? `+${r}` : String(r);
};

// Total ของหน่วยงาน (คอลัมน์ TOTAL ของ Condition M/C) ด้วยสูตรเดียวกับหน้า Capacity
function deptTotals(m: WlMonth, shifts: PpShift[], settings: Record<string, number>): Record<string, Tot> {
  const out: Record<string, Tot> = {};
  for (const [dept, machines] of Object.entries(m.depts)) {
    const d = { dept, month: m.month, days: m.days, workdays: m.workdays, workdaySource: m.workdaySource, shifts, settings, machines };
    const calcs = new Map<number, Calc>(machines.map((x) => [x.id, calcMachine(x, d)]));
    const t = conditionCols(d, calcs).find((c) => c.kind === "total")?.c;
    out[dept] = { p1: t?.P1 ?? 0, p9: t?.P9 ?? 0, a1: t?.A1 ?? 0 };
  }
  return out;
}

export default function Workload() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length;
  const dirtyRef = useRef(0);
  const seq = useRef(0);
  const last = useRef("");
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      try {
        const r = await api<Res>("/pp/workload", { query: { month } });
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
  // ⚡ Capacity / Actual / STD ("pp") · Forecast / Order ("forecast") · วันทำงานบริษัท ("maxmin") เปลี่ยน = โหลดเงียบ ๆ (กำลังแก้อยู่ = ไม่ทับ)
  useLive(["pp", "forecast", "maxmin"], () => (dirtyRef.current ? undefined : load(true)), 60_000);
  // ออกจากหน้าโดยยังไม่ SAVE = เตือน
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function changeMonth(m: string) {
    if (dirty) return toast.show("WARNING", "มีจำนวนคนที่ยังไม่ได้ SAVE · กด SAVE หรือ CANCEL ก่อนเปลี่ยนเดือน", "warn");
    setMonth(m);
    const p = new URLSearchParams(params.toString());
    p.set("month", m);
    router.replace(`?${p.toString()}`, { scroll: false });
  }

  const data = res?.data;
  const canEdit = !!res?.can.edit;
  const ms = data?.months ?? [];
  const prevM = ms[0]?.month ?? "";
  const curM = ms[1]?.month ?? "";

  const totals = useMemo(() => (data ? data.months.map((m) => deptTotals(m, data.shifts, data.settings)) : []), [data]);
  const saved = useMemo(() => {
    const map = new Map<string, Head>();
    for (const h of data?.heads ?? []) map.set(`${h.month}|${h.row}`, h);
    return map;
  }, [data]);
  // ค่าที่แสดง = ที่กำลังพิมพ์ (ถ้ามี) > ที่บันทึกไว้
  const headOf = useCallback(
    (m: string, row: string) => {
      const h = saved.get(`${m}|${row}`);
      const v = (f: Field) => {
        const k = `${m}|${row}|${f}`;
        return k in draft ? (num(draft[k]) ?? 0) : (h?.[f] ?? 0);
      };
      return { direct: v("direct"), ind1: v("ind1"), ind2: v("ind2") };
    },
    [saved, draft],
  );

  // ตารางทั้งหมด (ต่อแถว) : N-1 Plan · N-1 Actual · Current · N…N+3 Plan
  const table = useMemo(() => {
    if (!data || ms.length < 5) return null;
    const rows = ROWS.map((r) => {
      const prev = headOf(prevM, r.key);
      const cur = headOf(curM, r.key);
      const plan = (i: number, ind: { ind1: number; ind2: number }, have: number) => {
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
    const S = <T,>(f: (x: (typeof rows)[number]) => T & number) => sum(rows.map(f));
    const tot = {
      prevPlan: { pdt: S((x) => x.prevPlan.pdt), direct: S((x) => x.prevPlan.direct), ind1: S((x) => x.prevPlan.ind1), ind2: S((x) => x.prevPlan.ind2), total: S((x) => x.prevPlan.total), diff: S((x) => x.prevPlan.diff) },
      prevAct: { prod: S((x) => x.prevAct.prod), direct: S((x) => x.prevAct.direct), ind1: S((x) => x.prevAct.ind1), ind2: S((x) => x.prevAct.ind2), total: S((x) => x.prevAct.total) },
      cur: { direct: S((x) => x.cur.direct), ind1: S((x) => x.cur.ind1), ind2: S((x) => x.cur.ind2), total: S((x) => x.cur.total) },
      plans: [0, 1, 2, 3].map((i) => ({
        pdt: S((x) => x.plans[i].pdt),
        direct: S((x) => x.plans[i].direct),
        ind1: S((x) => x.plans[i].ind1),
        ind2: S((x) => x.plans[i].ind2),
        total: S((x) => x.plans[i].total),
        diff: S((x) => x.plans[i].diff),
      })),
    };
    return { rows, tot };
  }, [data, ms.length, totals, headOf, prevM, curM]);

  const upd = useMemo(() => {
    const t = (data?.heads ?? []).filter((h) => h.month === curM).map((h) => h.updatedAt).sort().pop();
    return t ? new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–";
  }, [data, curM]);

  const setCell = (m: string, row: string, f: Field, v: string) => {
    const k = `${m}|${row}|${f}`;
    const orig = str(saved.get(`${m}|${row}`)?.[f]);
    setDraft((d) => {
      const n = { ...d };
      if (v.trim() === orig) delete n[k];
      else n[k] = v.replace(/[^\d.]/g, "");
      return n;
    });
  };
  const cellVal = (m: string, row: string, f: Field) => {
    const k = `${m}|${row}|${f}`;
    return k in draft ? draft[k] : str(saved.get(`${m}|${row}`)?.[f]);
  };

  async function save() {
    if (!dirty || saving) return;
    // ส่งทีละเดือน: ทุกแถวที่มีการแก้ (ส่งครบ 3 ช่องของแถว)
    const byMonth = new Map<string, Set<string>>();
    for (const k of Object.keys(draft)) {
      const [m, row] = k.split("|");
      if (!byMonth.has(m)) byMonth.set(m, new Set());
      byMonth.get(m)!.add(row);
    }
    for (const k of Object.keys(draft)) {
      const v = num(draft[k]);
      if (v != null && (!isFinite(v) || v < 0 || v > 9999)) return toast.show("WARNING", "จำนวนคนต้องเป็นตัวเลข 0 - 9,999", "warn");
    }
    setSaving(true);
    try {
      const msgs: string[] = [];
      for (const [m, rows] of byMonth) {
        const cells = [...rows].map((row) => {
          const g = (f: Field) => {
            const k = `${m}|${row}|${f}`;
            return k in draft ? num(draft[k]) : (saved.get(`${m}|${row}`)?.[f] ?? null);
          };
          return { row, direct: g("direct"), ind1: g("ind1"), ind2: g("ind2") };
        });
        const r = await api<{ message: string }>("/pp/workload/heads", { method: "POST", body: { month: m, cells } });
        msgs.push(r.message);
      }
      toast.show("SAVED", msgs.join("\n"), "ok");
      setDraft({});
      await load(true);
    } catch (e) {
      toast.show("ERROR", "บันทึกไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function cancel() {
    if (dirty && !(await dlg.confirm({ title: "CANCEL", message: `ยกเลิกการแก้ไขจำนวนคน ${dirty} ช่อง ?`, ok: "YES, CANCEL", danger: true }))) return;
    setDraft({});
  }

  const header = (
    <PageHeader
      icon="/icons/management.png"
      title="PRODUCTION PLAN • WORKLOAD"
      subtitle={`สรุปอัตรากำลังคน แผน, ผล ประจำเดือน ${curM ? EN(curM).toUpperCase() : ""} · Monthly man-power Plan & Actual`}
      actions={<MonthPicker value={month} onChange={changeMonth} />}
    />
  );
  if (!data || !table)
    return (
      <PageBody className="pp-page">
        {header}
        {err ? <div className="pp-note">⚠ {err}</div> : <Loading />}
      </PageBody>
    );

  const N = table.tot.plans[0];
  const C = table.tot.cur;
  const gap = C.direct - N.direct;
  const edit = (m: string, row: string, f: Field, label: string) =>
    canEdit ? (
      <input
        className={`pp-in wl-in ${`${m}|${row}|${f}` in draft ? "is-dirty" : ""}`}
        inputMode="decimal"
        aria-label={label}
        value={cellVal(m, row, f)}
        placeholder="0"
        onChange={(e) => setCell(m, row, f, e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const tds = [...(e.currentTarget.closest("tbody")?.querySelectorAll<HTMLInputElement>(`input[data-col="${m}-${f}"]`) ?? [])];
            tds[tds.indexOf(e.currentTarget) + 1]?.focus();
          }
        }}
        data-col={`${m}-${f}`}
      />
    ) : (
      f1(headOf(m, row)[f])
    );

  return (
    <PageBody className="pp-page">
      {header}
      {ms.some((m) => m.workdaySource === "DEFAULT") && (
        <div className="pp-note">
          ⚠ บางเดือนยังไม่ได้ตั้ง <b>Company Workdays</b> ({ms.filter((m) => m.workdaySource === "DEFAULT").map((m) => EN(m.month)).join(", ")}) · ใช้ จันทร์–เสาร์ ไปก่อน · ตั้งได้ที่ MASTER DATA › Company Workdays
        </div>
      )}

      <div className="pp-kpis">
        <Kpi i={0} tone="plan" icon={<PpIcon k="plan" />} label={`PLAN MAN • ${EN(curM).toUpperCase()}`} value={N.total} fmt={f1} unit=" คน" sub={`Direct ${f1(N.direct)} · Ind1 ${f0(N.ind1)} · Ind2 ${f0(N.ind2)}`} />
        <Kpi i={1} tone="act" icon={<PpIcon k="act" />} label={`CURRENT • UPDATE ${upd}`} value={C.total} fmt={f0} unit=" คน" sub={`Direct ${f0(C.direct)} · Ind1 ${f0(C.ind1)} · Ind2 ${f0(C.ind2)}`} frac={N.total ? C.total / N.total : null} />
        <Kpi
          i={2}
          tone={Math.round(gap) >= 0 ? "ok" : "low"}
          icon={<PpIcon k="eff" />}
          label="DIRECT • CURRENT − PLAN"
          value={gap}
          fmt={dl}
          unit=" คน"
          sub={Math.round(gap) >= 0 ? "คน Direct พอตามแผนเดือนนี้" : `คน Direct ขาด ${Math.abs(Math.round(gap))} คน ตามแผนเดือนนี้`}
        />
        <Kpi i={3} tone="day" icon={<PpIcon k="day" />} label={`PDT • ${ms[1].workdays.length} DAY`} value={N.pdt} fmt={f0} sub={`Plan Stroke / Production รวมทุกหน่วยงาน · ${EN(curM)}`} />
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={2}>
        <Card
          title="9. MONTHLY MAN-POWER PLAN & ACTUAL"
          actions={<span className="pp-hint m-0">{canEdit ? "กรอกจำนวนคนที่มีจริงในช่อง CURRENT / ACTUAL แล้วกด SAVE · Plan คำนวณจาก Capacity เอง" : "ดูอย่างเดียว (ไม่มีสิทธิ์แก้จำนวนคน)"}</span>}
          bodyClass="p-0"
        >
          <div className="pp-scroll wl-scroll">
            <table className="pp-matrix wl-table">
              <thead>
                <tr className="wl-h1">
                  <th className="pp-stick wl-year" rowSpan={3} colSpan={2}>
                    {curM.slice(0, 4)}
                  </th>
                  <th colSpan={11} className="wl-mon">
                    {EN(prevM)} <span>(N-1)</span>
                  </th>
                  <th rowSpan={2} colSpan={4} className="wl-mon is-cur">
                    Current ({EN(curM).slice(0, 3)})<span>Update {upd}</span>
                  </th>
                  {ms.slice(1).map((m, i) => (
                    <th key={m.month} colSpan={6} className="wl-mon">
                      {EN(m.month)} <span>(N{i ? `+${i}` : ""})</span>
                    </th>
                  ))}
                </tr>
                <tr className="wl-h2">
                  <th colSpan={4}>Plan</th>
                  <th className="is-day">{ms[0].workdays.length} Day</th>
                  <th>Actual</th>
                  <th colSpan={5}>Actual</th>
                  {ms.slice(1).map((m) => (
                    <FragmentHead key={m.month} days={m.workdays.length} />
                  ))}
                </tr>
                <tr className="wl-h3">
                  <th>PDT</th>
                  <th>Direct</th>
                  <th>Ind1</th>
                  <th>Ind2</th>
                  <th className="is-day">Total</th>
                  <th>Total</th>
                  <th>Production</th>
                  <th>Direct</th>
                  <th>Ind1</th>
                  <th>Ind2</th>
                  <th className="is-cur">Total</th>
                  <th>Direct</th>
                  <th>Ind1</th>
                  <th>Ind2</th>
                  <th className="is-cur">Total</th>
                  {ms.slice(1).map((m) => (
                    <SubHead key={m.month} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((x, i) => {
                  const g = GROUPS.find((g) => g.grp === x.r.grp)!;
                  const first = i === 0 || table.rows[i - 1].r.grp !== x.r.grp;
                  return (
                    <tr key={x.r.key} className={`wl-row ${first ? "is-first" : ""}`} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                      {first && (
                        <td rowSpan={g.n} className="pp-stick wl-grp">
                          {x.r.grp}
                        </td>
                      )}
                      <td className="wl-name">
                        {x.r.name}
                        {x.r.dept && <i title="ดึง PDT / Direct จาก Capacity">CAP</i>}
                      </td>
                      <PlanCells p={x.prevPlan} />
                      <td>{f0(x.prevAct.prod)}</td>
                      {FIELDS.map((f) => (
                        <td key={f} className="wl-edit">
                          {edit(prevM, x.r.key, f, `${x.r.name} ${f} ${EN(prevM)}`)}
                        </td>
                      ))}
                      <td className="is-cur">{f0(x.prevAct.total)}</td>
                      {FIELDS.map((f) => (
                        <td key={f} className="wl-edit">
                          {edit(curM, x.r.key, f, `${x.r.name} ${f} current`)}
                        </td>
                      ))}
                      <td className="is-cur">{f0(x.cur.total)}</td>
                      {x.plans.map((p, j) => (
                        <PlanCells key={j} p={p} />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="wl-tot">
                  <td className="pp-stick" colSpan={2}>
                    Total
                  </td>
                  <PlanCells p={table.tot.prevPlan} total />
                  <td>{f0(table.tot.prevAct.prod)}</td>
                  <td>{f0(table.tot.prevAct.direct)}</td>
                  <td>{f0(table.tot.prevAct.ind1)}</td>
                  <td>{f0(table.tot.prevAct.ind2)}</td>
                  <td className="is-sum">{f1(table.tot.prevAct.total)}</td>
                  <td>{f0(C.direct)}</td>
                  <td>{f0(C.ind1)}</td>
                  <td>{f0(C.ind2)}</td>
                  <td className="is-sum">{f1(C.total)}</td>
                  {table.tot.plans.map((p, j) => (
                    <PlanCells key={j} p={p} total />
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="wl-legend">
            <span>
              <i className="is-day" /> Total แผน (Direct + Ind1 + Ind2)
            </span>
            <span>
              <i className="is-cur" /> คนที่มีจริง
            </span>
            <span>
              <b className="wl-pos">+n</b> / <b className="wl-neg">−n</b> Actual = คนที่มีจริง (Direct) − แผน (Direct) · ติดลบ = คนขาด
            </span>
            <span>PDT / Direct = Total P1 / P9 ของ Capacity · Production = Total A1 ของเดือนก่อน</span>
          </div>
        </Card>
      </motion.div>

      {/* แถบ SAVE ลอยล่าง: แสดงเมื่อมีการแก้ไข */}
      <AnimatePresence>
        {dirty > 0 && (
          <motion.div className="pp-savebar" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
            <span>
              แก้ไขจำนวนคน <b>{dirty}</b> ช่อง
            </span>
            <button type="button" className="btn-ghost" disabled={saving} onClick={cancel}>
              ✕ CANCEL
            </button>
            <button type="button" className="btn bg-success" disabled={saving} onClick={save}>
              {saving ? "…" : "💾 SAVE"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </PageBody>
  );
}

function FragmentHead({ days }: { days: number }) {
  return (
    <>
      <th colSpan={4}>Plan</th>
      <th className="is-day">{days} Day</th>
      <th>Actual</th>
    </>
  );
}
function SubHead() {
  return (
    <>
      <th>PDT</th>
      <th>Direct</th>
      <th>Ind1</th>
      <th>Ind2</th>
      <th className="is-day">Total</th>
      <th>Total</th>
    </>
  );
}
function PlanCells({ p, total }: { p: { pdt: number; direct: number; ind1: number; ind2: number; total: number; diff: number }; total?: boolean }) {
  const d = Math.round(p.diff);
  return (
    <>
      <td className="wl-sep">{f0(p.pdt)}</td>
      <td>{f1(p.direct)}</td>
      <td>{total ? f0(p.ind1) : f1(p.ind1)}</td>
      <td>{total ? f0(p.ind2) : f1(p.ind2)}</td>
      <td className={total ? "is-sum" : "is-day"}>{f1(p.total)}</td>
      <td className={total ? "" : d > 0 ? "wl-pos" : d < 0 ? "wl-neg" : ""}>{total ? "" : d}</td>
    </>
  );
}
