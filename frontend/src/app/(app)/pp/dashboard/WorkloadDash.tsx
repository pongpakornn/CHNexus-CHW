"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { f0, f1 } from "@/lib/pp";
import { PpChart, type Series } from "../PpChart";
import { Kpi, MonthPicker, PpIcon } from "../shared";
import { Seg } from "../Seg";
import { EN, ENS, WL_ROWS, signed, useWorkload, type WlTableRow } from "../capacity/workload/wl";
import { ForecastSection, WlTableCard, useWlTable } from "./DashSections";

// 👥 PRODUCTION PLAN › DASHBOARD › WORKLOAD: ภาพรวมอัตรากำลังคน (ข้อมูล / สูตรเดียวกับ CAPACITY › WORKLOAD)
//   KPI · กราฟ Plan vs คนที่มีจริง รายแถว (เลือก N…N+3 · Direct / Total) · แนวโน้ม N-1 → N+3 · แถวที่คน Direct ขาด / เกิน
const C = { plan: "#4f46e5", plan2: "#818cf8", act: "#0891b2", act2: "#67e8f9", pdt: "#d97706" };
type Pick = "-1" | "0" | "1" | "2" | "3"; // -1 = เดือน N-1
type Metric = "direct" | "total";

export function WorkloadDash({ month, setMonth, picker }: { month: string; setMonth: (m: string) => void; picker: React.ReactNode }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { res, err } = useWorkload(month);
  const [pick, setPick] = useState<Pick>("0");
  const [metric, setMetric] = useState<Metric>("direct");

  const data = res?.data;
  const ms = data?.months ?? [];
  const curM = ms[1]?.month ?? "";
  // ยอดตามไฟล์ Excel Work load (ที่ Import) · เดือนที่ยังไม่ได้ Import = ยอดที่ระบบคำนวณ
  const { table, upd } = useWlTable(res);

  const header = (
    <PageHeader
      icon="/icons/Dashboard.png"
      title="PRODUCTION PLAN • DASHBOARD"
      subtitle={`WORKLOAD (อัตรากำลังคน) · MAN-POWER PLAN & ACTUAL${curM ? " · " + EN(curM).toUpperCase() : ""}`}
      actions={<MonthPicker value={month} onChange={setMonth} />}
    />
  );
  if (!data || !table)
    return (
      <PageBody className="pp-page">
        {header}
        <ForecastSection />
        {picker}
        {err ? <div className="pp-note">⚠ {err}</div> : <Loading />}
      </PageBody>
    );

  const i = Number(pick);
  const N = table.tot.plans[0];
  const Cur = table.tot.cur;
  const gap = Cur.direct - N.direct;
  const last = table.tot.plans[3];
  const need3 = last.total - Cur.total;
  const pm = ms[i + 1]?.month ?? curM;
  // N-1 = แผน / คนที่มีจริงของเดือนก่อน (Actual) · N…N+3 = แผน vs คนที่มีจริงตอนนี้ (Current)
  const planAt = (x: WlTableRow) => (i < 0 ? x.prevPlan : x.plans[i]);
  const haveAt = (x: WlTableRow) => (i < 0 ? x.prevAct : x.cur);
  const totPlan = i < 0 ? table.tot.prevPlan : table.tot.plans[i];
  const totHave = i < 0 ? table.tot.prevAct : Cur;
  const val = (x: WlTableRow) => (metric === "direct" ? { plan: planAt(x).direct, have: haveAt(x).direct } : { plan: planAt(x).total, have: haveAt(x).total });
  const rows = metric === "total" ? table.rows : table.rows.filter((x) => x.r.dept && x.r.direct !== false); // DIRECT = เฉพาะแถวที่ดึงจาก Capacity

  const byRow: { cats: string[]; series: Series[] } = {
    cats: rows.map((x) => x.r.short),
    series: [
      { key: "plan", label: metric === "direct" ? "PLAN MANPOWER (DIRECT)" : "PLAN MANPOWER", kind: "bar", color: C.plan, color2: C.plan2, values: rows.map((x) => val(x).plan), fmt: f1 },
      { key: "have", label: metric === "direct" ? "ACTUAL MANPOWER (DIRECT)" : "ACTUAL MANPOWER", kind: "bar", color: C.act, color2: C.act2, values: rows.map((x) => val(x).have), fmt: f0 },
    ],
  };
  // แนวโน้ม 5 เดือน: N-1 ใช้ Actual (คนที่มีจริงเดือนก่อน) · N…N+3 ใช้ Current
  const trend: { cats: string[]; series: Series[] } = {
    cats: ms.map((m) => ENS(m.month)),
    series: [
      {
        key: "plan",
        label: metric === "direct" ? "PLAN MANPOWER (DIRECT)" : "PLAN MANPOWER",
        kind: "bar",
        color: C.plan,
        color2: C.plan2,
        values: [table.tot.prevPlan, ...table.tot.plans].map((p) => (metric === "direct" ? p.direct : p.total)),
        fmt: f1,
      },
      {
        key: "have",
        label: metric === "direct" ? "DIRECT ที่มีจริง" : "คนที่มีจริง (TOTAL)",
        kind: "line",
        color: C.act,
        values: [metric === "direct" ? table.tot.prevAct.direct : table.tot.prevAct.total, ...table.tot.plans.map(() => (metric === "direct" ? Cur.direct : Cur.total))],
        fmt: f0,
      },
    ],
  };

  // แถวที่คน Direct ขาด / เกิน (เดือนที่เลือก) เรียงขาดมากสุดก่อน
  const gaps = table.rows
    .filter((x) => x.r.dept && x.r.direct !== false)
    .map((x) => ({ x, plan: planAt(x).direct, have: haveAt(x).direct, d: haveAt(x).direct - planAt(x).direct }))
    .sort((a, b) => a.d - b.d);
  const gapMax = Math.max(1, ...gaps.map((g) => Math.max(g.plan, g.have)));
  const wlHref = `/pp/capacity/workload?month=${curM}`;

  return (
    <PageBody className="pp-page">
      {header}
      <ForecastSection />
      {picker}
      {ms.some((m) => m.workdaySource === "DEFAULT") && (
        <div className="pp-note">
          ⚠ บางเดือนยังไม่ได้ตั้ง <b>Company Workdays</b> ({ms.filter((m) => m.workdaySource === "DEFAULT").map((m) => EN(m.month)).join(", ")}) · ใช้ จันทร์–เสาร์ ไปก่อน · ตั้งได้ที่ MASTER DATA › Company Workdays
        </div>
      )}

      <div className="pp-kpis">
        <Kpi i={0} tone="plan" icon={<PpIcon k="plan" />} label={`PLAN MAN • ${EN(curM).toUpperCase()}`} value={N.total} fmt={f1} unit=" คน" sub={`Direct ${f1(N.direct)} · Ind1 ${f0(N.ind1)} · Ind2 ${f0(N.ind2)}`} />
        <Kpi i={1} tone="act" icon={<PpIcon k="act" />} label={`CURRENT • UPDATE ${upd}`} value={Cur.total} fmt={f0} unit=" คน" sub={`Direct ${f0(Cur.direct)} · Ind1 ${f0(Cur.ind1)} · Ind2 ${f0(Cur.ind2)}`} frac={N.total ? Cur.total / N.total : null} />
        <Kpi
          i={2}
          tone={Math.round(gap) >= 0 ? "ok" : "low"}
          icon={<PpIcon k="eff" />}
          label="DIRECT • CURRENT − PLAN"
          value={gap}
          fmt={signed}
          unit=" คน"
          sub={Math.round(gap) >= 0 ? "คน Direct พอตามแผนเดือนนี้" : `คน Direct ขาด ${Math.abs(Math.round(gap))} คน ตามแผนเดือนนี้`}
        />
        <Kpi
          i={3}
          tone={Math.round(need3) > 0 ? "mid" : "ok"}
          icon={<PpIcon k="target" />}
          label={`OUTLOOK • ${EN(ms[4].month).toUpperCase()} (N+3)`}
          value={last.total}
          fmt={f1}
          unit=" คน"
          sub={Math.round(need3) > 0 ? `ต้องเพิ่มอีก ${Math.round(need3)} คน จากคนที่มีตอนนี้` : `คนที่มีตอนนี้พอ (เกิน ${Math.abs(Math.round(need3))} คน)`}
        />
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={2}>
        <Card
          clip={false}
          title={`PLAN vs CURRENT • BY DEPARTMENT • ${EN(pm).toUpperCase()}`}
          actions={
            <>
              <Seg id="wl-n" value={pick} onChange={setPick} options={(["-1", "0", "1", "2", "3"] as Pick[]).map((v) => ({ v, l: v === "-1" ? "N-1" : v === "0" ? "N" : `N+${v}` }))} />
              <Seg id="wl-m" value={metric} onChange={setMetric} options={[{ v: "direct", l: "DIRECT" }, { v: "total", l: "TOTAL" }]} />
            </>
          }
          bodyClass="px-2 pb-3 pt-2 md:px-4"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={pick + metric} initial={reduce ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: -14 }} transition={{ duration: 0.3, ease: EASE }}>
              <PpChart
                ariaLabel="Man-power plan versus current by department"
                cats={byRow.cats}
                series={byRow.series}
                tipTitle={(k) => `${rows[k].r.name} · ${EN(pm)}`}
                tipExtra={(k) => {
                  const v = val(rows[k]);
                  const d = Math.round(v.have - v.plan);
                  return (
                    <div className="r is-sum">
                      <span>{metric === "direct" ? "DIRECT" : "TOTAL"} ขาด / เกิน</span>
                      <b className={d < 0 ? "wl-neg" : d > 0 ? "wl-pos" : ""}>{signed(d)} คน</b>
                    </div>
                  );
                }}
                onPick={() => router.push(wlHref)}
              />
            </motion.div>
          </AnimatePresence>
        </Card>
      </motion.div>

      <div className="pp-two">
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
          <Card clip={false} title={`MAN-POWER TREND • N-1 → N+3 • ${metric.toUpperCase()}`} bodyClass="px-2 pb-3 pt-2 md:px-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={metric} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
                <PpChart
                  ariaLabel="Man-power trend"
                  height={300}
                  cats={trend.cats}
                  sub={ms.map((m, k) => (k === 0 ? "N-1" : k === 1 ? "N" : `N+${k - 1}`))}
                  series={trend.series}
                  tipTitle={(k) => `${EN(ms[k].month)} · ${ms[k].workdays.length} วันทำงาน`}
                  tipExtra={(k) => {
                    const p = k === 0 ? table.tot.prevPlan : table.tot.plans[k - 1];
                    return (
                      <div className="r is-sum">
                        <span>PDT (Plan Stroke)</span>
                        <b>{f0(p.pdt)}</b>
                      </div>
                    );
                  }}
                />
              </motion.div>
            </AnimatePresence>
            <p className="pp-hint">แท่ง = คนตามแผน · เส้น = คนที่มีจริง (เดือนก่อน = Actual · เดือนนี้เป็นต้นไป = Current)</p>
          </Card>
        </motion.div>
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
          <Card
            title={`DIRECT • SHORT / OVER • ${EN(pm).toUpperCase()}`}
            actions={
              <Link href={wlHref} className="btn-ghost">
                ▦ TABLE
              </Link>
            }
            bodyClass="p-3 md:p-4"
          >
            <div className="pp-eff">
              {gaps.map((g, k) => {
                const tone = Math.round(g.d) >= 0 ? "ok" : g.d >= -g.plan * 0.1 ? "mid" : "low";
                return (
                  <button key={g.x.r.key} type="button" className={`pp-eff-row wl-gap is-${tone}`} onClick={() => router.push(wlHref)} title={`Plan ${f1(g.plan)} · มีจริง ${f0(g.have)}`}>
                    <span className="n">
                      <b>{g.x.r.name}</b>
                      <small>
                        Plan {f1(g.plan)} · มีจริง {f0(g.have)}
                      </small>
                    </span>
                    <span className="bar">
                      <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, g.have / gapMax) }} transition={{ duration: reduce ? 0 : 0.8, ease: EASE, delay: Math.min(k * 0.05, 0.5) }} />
                      <em style={{ left: `${Math.min(100, (g.plan / gapMax) * 100)}%` }} title={`Plan ${f1(g.plan)}`} />
                    </span>
                    <span className="v">{signed(g.d)}</span>
                  </button>
                );
              })}
            </div>
            <p className="pp-hint">เส้นสีส้ม = คน Direct ตามแผน · แถบ = คนที่มีจริง · เขียว = พอ · ส้ม = ขาดไม่เกิน 10% · แดง = ขาดมาก</p>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
        <Card title="SUMMARY • ALL ROWS" actions={<span className="pp-hint m-0">{WL_ROWS.length} แถว · กดที่ TABLE เพื่อกรอกคนที่มีจริง</span>} bodyClass="p-0">
          <div className="pp-scroll">
            <table className="pp-table wl-sum">
              <thead>
                <tr>
                  <th>DEPARTMENT</th>
                  <th>PDT (N)</th>
                  <th>{i < 0 ? "PLAN DIRECT (N-1)" : "PLAN DIRECT"}</th>
                  <th>{i < 0 ? "ACTUAL DIRECT (N-1)" : "ACTUAL DIRECT"}</th>
                  <th>+/−</th>
                  <th>PLAN MANPOWER</th>
                  <th>ACTUAL MANPOWER</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((x, k) => {
                  const d = Math.round(haveAt(x).direct - planAt(x).direct);
                  return (
                    <tr key={x.r.key} className="pp-rise" style={{ "--i": k } as React.CSSProperties}>
                      <td className="t">
                        <b>{x.r.name}</b>
                        <small>{x.r.grp}</small>
                      </td>
                      <td>{f0(planAt(x).pdt)}</td>
                      <td>{f1(planAt(x).direct)}</td>
                      <td>{f0(haveAt(x).direct)}</td>
                      <td className={d < 0 ? "wl-neg" : d > 0 ? "wl-pos" : "wl-zero"}>{signed(d)}</td>
                      <td>{f1(planAt(x).total)}</td>
                      <td>{f0(haveAt(x).total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td>{f0(totPlan.pdt)}</td>
                  <td>{f1(totPlan.direct)}</td>
                  <td>{f0(totHave.direct)}</td>
                  <td className={totHave.direct - totPlan.direct < 0 ? "wl-neg" : "wl-pos"}>{signed(totHave.direct - totPlan.direct)}</td>
                  <td>{f1(totPlan.total)}</td>
                  <td>{f0(totHave.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </motion.div>

      {/* ตาราง WORKLOAD ทั้งหมด (ดูอย่างเดียว · ยอดตามไฟล์ Excel) */}
      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.05 }} custom={0}>
        <WlTableCard table={table} ms={ms} upd={upd} curM={curM} />
      </motion.div>
    </PageBody>
  );
}
