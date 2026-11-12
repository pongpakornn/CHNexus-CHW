"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { EASE, panelIn, fadeOnly } from "@/lib/motion";
import { DOW, deptOf, dowOf, f0, f1, monthLabel, pc, thisMonth, type Calc } from "@/lib/pp";
import { PpChart, type Series } from "../PpChart";
import { ConditionMatrix, DeptPicker, EffPill, Kpi, MonthPicker, PpIcon, usePpMonth, type DeptTab } from "../shared";
import { WorkloadDash } from "./WorkloadDash";
import { ForecastSection, WorkloadSection } from "./DashSections";
import { Seg } from "../Seg";
import "../pp.css";

// 📈 PRODUCTION PLAN › DASHBOARD: เลือกหน่วยงาน (PRESS 1 · PRESS 2 · ASSEMBLY · PIPE PART · PIPE ASSY · PAINT PART) · ภาพรวมทุกเครื่องของเดือน
//   KPI (วันทำงาน · Plan / Actual Stroke · Plan / Actual Hr · เครื่องที่ถึงเป้า Eff) · กราฟ Plan vs Actual (รายเครื่อง / รายวัน / สะสม)
//   %EFF รายเครื่องเทียบเป้า · ตาราง Condition M/C ทุกเครื่อง + รวมกลุ่ม + TOTAL (เหมือนชีท Press 1 table) · อัพเดทเองเมื่อหน้างานบันทึก Actual
const C = { plan: "#4f46e5", plan2: "#818cf8", act: "#0891b2", act2: "#67e8f9", target: "#d97706" };

// แท็บ WORKLOAD ต่อจาก QC (สรุปอัตรากำลังคน · ข้อมูลเดียวกับ CAPACITY › WORKLOAD)
const WL_TAB: DeptTab = { code: "WORKLOAD", name: "WORKLOAD", th: "อัตรากำลังคน (Man-power)" };

export default function PpDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [month, setMonth] = useState(thisMonth);
  const [dept, setDeptState] = useState(() => (params.get("dept")?.toUpperCase() === WL_TAB.code ? WL_TAB.code : (deptOf(params.get("dept")).code as string)));
  const setDept = (c: string) => {
    setDeptState(c);
    const p = new URLSearchParams(params.toString());
    p.set("dept", c);
    router.replace(`?${p.toString()}`, { scroll: false });
  };
  const picker = <DeptPicker value={dept} onChange={setDept} extra={[WL_TAB]} />;
  return dept === WL_TAB.code ? <WorkloadDash month={month} setMonth={setMonth} picker={picker} /> : <DeptDash dept={dept} month={month} setMonth={setMonth} picker={picker} />;
}

function DeptDash({ dept, month, setMonth, picker }: { dept: string; month: string; setMonth: (m: string) => void; picker: React.ReactNode }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const D = deptOf(dept);
  const { data, calcs } = usePpMonth(dept, month);
  const [view, setView] = useState<"machine" | "daily">("machine");
  const [metric, setMetric] = useState<"stroke" | "hr">("stroke");
  const [acc, setAcc] = useState(false);

  const list = useMemo(() => (data ? data.machines.map((m) => ({ m, c: calcs.get(m.id)! })).filter((x) => x.c) : []), [data, calcs]);
  const sum = useMemo(() => {
    let p1 = 0,
      a1 = 0,
      p4 = 0,
      a2 = 0,
      ok = 0,
      run = 0,
      p9 = 0;
    for (const { c } of list) {
      p1 += c.P1;
      a1 += c.A1;
      p4 += c.P4;
      a2 += c.A2;
      p9 += c.P9;
      if (c.A2 > 0) {
        run++;
        if (c.A4 >= c.C4) ok++;
      }
    }
    return { p1, a1, p4, a2, ok, run, p9 };
  }, [list]);

  // วันที่ผ่านมาแล้วของเดือนนี้ (เทียบแผนสะสมถึงวันนี้)
  const nd = data?.days ?? 30;
  const daily = useMemo(() => {
    if (!data) return null;
    const z = () => Array.from({ length: nd }, () => 0);
    const plan = z(),
      act = z(),
      planHr = z(),
      actHr = z();
    let has = -1;
    for (const { c } of list)
      for (let i = 0; i < nd; i++) {
        plan[i] += c.plan[i] ?? 0;
        planHr[i] += c.planHr[i] ?? 0;
        act[i] += c.actStroke[i] ?? 0;
        actHr[i] += c.actHr[i] ?? 0;
        if ((c.actStroke[i] ?? 0) > 0 || (c.actHr[i] ?? 0) > 0) has = Math.max(has, i);
      }
    const accum = (a: number[], stop = nd - 1) => {
      let s = 0;
      return a.map((v, i) => (i > stop ? null : (s += v)));
    };
    return { plan, act, planHr, actHr, has, planAcc: accum(plan), actAcc: accum(act, has), planHrAcc: accum(planHr), actHrAcc: accum(actHr, has) };
  }, [data, list, nd]);

  const chart = useMemo((): { cats: string[]; sub?: string[]; off?: boolean[]; series: Series[] } | null => {
    if (!data || !daily) return null;
    const isHr = metric === "hr";
    const fmt = isHr ? f1 : f0;
    if (view === "machine")
      return {
        cats: list.map((x) => x.m.code.replace(/^PROG /, "")),
        series: [
          { key: "plan", label: isHr ? "PLAN HR. (P4)" : "PLAN STROKE (P1)", kind: "bar", color: C.plan, color2: C.plan2, values: list.map((x) => (isHr ? x.c.P4 : x.c.P1)), fmt },
          { key: "act", label: isHr ? "ACTUAL HR. (A2)" : "ACTUAL STROKE (A1)", kind: "bar", color: C.act, color2: C.act2, values: list.map((x) => (isHr ? x.c.A2 : x.c.A1)), fmt },
        ],
      };
    const wd = new Set(data.workdays);
    const days = Array.from({ length: nd }, (_, i) => i);
    const base = { cats: days.map((i) => String(i + 1)), sub: days.map((i) => DOW[dowOf(data.month, i + 1)].slice(0, 2)), off: days.map((i) => !wd.has(i + 1)) };
    if (acc)
      return {
        ...base,
        series: [
          { key: "pacc", label: "PLAN ACC", kind: "line", color: C.plan, area: true, values: isHr ? daily.planHrAcc : daily.planAcc, fmt },
          { key: "aacc", label: "ACTUAL ACC", kind: "line", color: C.act, area: true, values: isHr ? daily.actHrAcc : daily.actAcc, fmt },
        ],
      };
    return {
      ...base,
      series: [
        { key: "act", label: isHr ? "ACTUAL HR." : "ACTUAL STROKE", kind: "bar", color: C.act, color2: C.act2, values: isHr ? daily.actHr : daily.act, fmt },
        { key: "plan", label: isHr ? "PLAN HR. / DAY" : "PLAN STROKE / DAY", kind: "line", color: C.plan, dashed: true, values: days.map((i) => (wd.has(i + 1) ? (isHr ? daily.planHr[i] : daily.plan[i]) : null)), fmt },
      ],
    };
  }, [data, daily, list, view, metric, acc, nd]);

  if (!data || !daily)
    return (
      <PageBody className="pp-page">
        <PageHeader icon="/icons/Dashboard.png" title="PRODUCTION PLAN • DASHBOARD" subtitle={`${D.name} · CAPACITY PLANNING`} actions={<MonthPicker value={month} onChange={setMonth} />} />
        <ForecastSection />
        {picker}
        <Loading />
      </PageBody>
    );

  const effList = [...list].sort((a, b) => b.c.A4 - a.c.A4);
  const effMax = Math.max(1.2, ...list.map((x) => x.c.A4), ...list.map((x) => x.c.C4));

  return (
    <PageBody className="pp-page">
      <PageHeader
        icon="/icons/Dashboard.png"
        title="PRODUCTION PLAN • DASHBOARD"
        subtitle={`${D.name} (${D.th}) · CAPACITY PLANNING · ${monthLabel(month).toUpperCase()} · ${list.length} M/C`}
        actions={<MonthPicker value={month} onChange={setMonth} />}
      />
      <ForecastSection />
      {picker}
      {data.workdaySource === "DEFAULT" && (
        <div className="pp-note">
          ⚠ ยังไม่ได้ตั้ง <b>Company Workdays</b> ของเดือนนี้ · ใช้ จันทร์–เสาร์ ({data.workdays.length} วัน) ไปก่อน · ตั้งได้ที่ MASTER DATA › Company Workdays
        </div>
      )}

      <div className="pp-kpis">
        <Kpi i={0} tone="day" icon={<PpIcon k="day" />} label="WORKING DAYS • C1" value={data.workdays.length} fmt={f0} unit=" days" sub={`${data.workdaySource === "COMPANY" ? "Company Workdays" : "จันทร์–เสาร์"} · ${data.days} วันในเดือน`} frac={data.workdays.length / data.days} />
        <Kpi i={1} tone="plan" icon={<PpIcon k="plan" />} spark={daily.act} label="PLAN STROKE • P1" value={sum.p1} fmt={f0} sub={`Actual ${f0(sum.a1)} · ${pc(sum.p1 ? sum.a1 / sum.p1 : 0)} ของแผน`} frac={sum.p1 ? sum.a1 / sum.p1 : 0} />
        <Kpi i={2} tone="act" icon={<PpIcon k="hr" />} spark={daily.actHr} label="WORKING HR. • P4 / A2" value={sum.p4} fmt={f0} unit=" hr" sub={`Actual ${f1(sum.a2)} hr · Req. Man ${f1(sum.p9)}`} frac={sum.p4 ? sum.a2 / sum.p4 : 0} />
        <Kpi
          i={3}
          icon={<PpIcon k="eff" />}
          tone={sum.run && sum.ok / sum.run >= 0.5 ? "ok" : "mid"}
          label="ON TARGET EFF"
          value={sum.ok}
          fmt={f0}
          unit={` / ${sum.run || list.length}`}
          sub={sum.run ? `เครื่องที่ %EFF ถึงเป้า (จาก ${sum.run} เครื่องที่มี Actual)` : "ยังไม่มี Actual ของเดือนนี้"}
          frac={sum.run ? sum.ok / sum.run : 0}
        />
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={2}>
        <Card
          clip={false}
          title={view === "machine" ? "PLAN vs ACTUAL • BY MACHINE" : acc ? "PLAN vs ACTUAL • ACCUMULATED" : "PLAN vs ACTUAL • DAILY (ALL M/C)"}
          actions={
            <>
              <Seg id="v" value={view} onChange={setView} options={[{ v: "machine", l: "BY MACHINE" }, { v: "daily", l: "DAILY" }]} />
              <AnimatePresence initial={false}>
                {view === "daily" && (
                  <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.25, ease: EASE }}>
                    <Seg id="a" value={acc ? "acc" : "day"} onChange={(v) => setAcc(v === "acc")} options={[{ v: "day", l: "DAILY" }, { v: "acc", l: "ACC" }]} />
                  </motion.span>
                )}
              </AnimatePresence>
              <Seg id="m" value={metric} onChange={setMetric} options={[{ v: "stroke", l: "STROKE" }, { v: "hr", l: "WORKING HR." }]} />
            </>
          }
          bodyClass="px-2 pb-3 pt-2 md:px-4"
        >
          {chart && (
            <PpChart
              key={view + (acc ? "a" : "")}
              ariaLabel="Plan versus actual chart"
              cats={chart.cats}
              sub={chart.sub}
              off={chart.off}
              today={view === "daily" && month === thisMonth() ? new Date().getDate() - 1 : undefined}
              empty={view === "daily" && !acc ? "ยังไม่มี Actual ของเดือนนี้" : undefined}
              series={chart.series}
              tipTitle={(i) => (view === "machine" ? list[i].m.code : `${i + 1} ${monthLabel(month)} · ${DOW[dowOf(month, i + 1)]}${chart.off?.[i] ? " · วันหยุด" : ""}`)}
              tipExtra={(i) =>
                view === "machine" ? (
                  <div className="r is-sum">
                    <span>EFF% (A4)</span>
                    <b>
                      {pc(list[i].c.A4)} <EffPill a={list[i].c.A4} t={list[i].c.C4} />
                    </b>
                  </div>
                ) : null
              }
              onPick={view === "machine" ? (i) => router.push(`/pp/capacity/${D.slug}?m=${list[i].m.id}&month=${month}`) : undefined}
            />
          )}
        </Card>
      </motion.div>

      <div className="pp-two">
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
          <Card title="EFF% BY MACHINE • TARGET" bodyClass="p-3 md:p-4">
            <div className="pp-eff">
              {effList.map(({ m, c }: { m: { id: number; code: string; group: string }; c: Calc }, i) => {
                const tone = c.A2 ? (c.A4 >= c.C4 ? "ok" : c.A4 >= c.C4 * 0.85 ? "mid" : "low") : "none";
                return (
                  <button key={m.id} type="button" className={`pp-eff-row is-${tone}`} onClick={() => router.push(`/pp/capacity/${D.slug}?m=${m.id}&month=${month}`)} title="ดูรายละเอียด / บันทึก Actual">
                    <span className="n">
                      <b>{m.code}</b>
                      <small>{m.group}</small>
                    </span>
                    <span className="bar">
                      <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, c.A4 / effMax) }} transition={{ duration: reduce ? 0 : 0.8, ease: EASE, delay: Math.min(i * 0.04, 0.5) }} />
                      <em style={{ left: `${(c.C4 / effMax) * 100}%` }} title={`Target ${pc(c.C4)}`} />
                    </span>
                    <span className="v">{c.A2 ? pc(c.A4) : "–"}</span>
                  </button>
                );
              })}
            </div>
            <p className="pp-hint">เส้นสีส้ม = Target Eff ของเครื่อง · เขียว = ถึงเป้า · ส้ม = ใกล้เป้า (≥ 85% ของเป้า) · แดง = ต่ำกว่า</p>
          </Card>
        </motion.div>
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
          <Card title="PLAN SPH • SHIFT LOAD" bodyClass="p-3 md:p-4">
            <ShiftLoad list={list} shifts={data.shifts.map((s) => s.name)} />
          </Card>
        </motion.div>
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
        <Card title={`CONDITION M/C • ${D.name} TABLE`} actions={<span className="pp-hint m-0">กดชื่อเครื่อง = ดูรายละเอียด / บันทึก Actual</span>}>
          <ConditionMatrix data={data} calcs={calcs} dept={D.slug} />
        </Card>
      </motion.div>
      <WorkloadSection month={month} dept={dept} />
    </PageBody>
  );
}

// กะที่ต้องใช้ของแต่ละเครื่อง: กะแรกที่ Plan SPH (C5-C9) ≥ P1 · ไม่พอทุกกะ = OVER
function ShiftLoad({ list, shifts }: { list: { m: { id: number; code: string }; c: Calc }[]; shifts: string[] }) {
  const rows = list.map(({ m, c }) => {
    const idx = c.sh.findIndex((v) => v != null && v >= c.P1);
    return { m, c, idx, load: c.sh[0] ? c.P1 / c.sh[0] : 0 };
  });
  const count = shifts.map((_, i) => rows.filter((r) => r.idx === i).length);
  const over = rows.filter((r) => r.idx < 0 && r.c.P1 > 0).length;
  return (
    <div className="pp-shift">
      {shifts.map((s, i) => (
        <div key={s} className="pp-shift-row">
          <span>{s}</span>
          <b>{count[i]}</b>
          <div className="chips">
            {rows
              .filter((r) => r.idx === i)
              .map((r) => (
                <em key={r.m.id} title={`P1 ${f0(r.c.P1)} · 1 Shift ${pc(r.load)}`}>
                  {r.m.code.replace(/^PROG /, "")}
                </em>
              ))}
          </div>
        </div>
      ))}
      <div className={`pp-shift-row ${over ? "is-over" : ""}`}>
        <span>เกินกำลังทุกกะ (OVER)</span>
        <b>{over}</b>
        <div className="chips">
          {rows
            .filter((r) => r.idx < 0 && r.c.P1 > 0)
            .map((r) => (
              <em key={r.m.id}>{r.m.code}</em>
            ))}
        </div>
      </div>
    </div>
  );
}
