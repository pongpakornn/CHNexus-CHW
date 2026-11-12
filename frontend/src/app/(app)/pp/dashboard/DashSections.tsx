"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading } from "@/components/layout/Page";
import { MonthChart, type MonthPoint } from "@/components/charts/Charts";
import { CustomerDonut } from "@/components/charts/CustomerDonut";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { f0, f1 } from "@/lib/pp";
import { PpChart, type Series } from "../PpChart";
import { Seg } from "../Seg";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { EN, buildTable, deptTotals, refMap, savedHeads, signed, updOf, useWorkload, type WlRes, type WlTable, type WlTableRow } from "../capacity/workload/wl";
import { WlGrid, WlLegend } from "../capacity/workload/WlGrid";

// 📊 PRODUCTION PLAN › DASHBOARD: ส่วนที่ใช้ทุกแท็บ
//   ForecastSection = กราฟ Forecast / Order ของ CIMS (Order ลูกค้าเดือนนี้ + Forecast / Order / Delivery ทั้งปี) แสดงแบบเดียวกับ CIMS › Dashboard
//   WorkloadSection = กราฟคนตามแผน vs คนที่มีจริงรายหน่วยงาน + ตาราง WORKLOAD (ยอดตามไฟล์ Excel Work load)

type Charts = { month: string; year: number; customers: { name: string; amount: number; percentage: number }[]; months: (MonthPoint & { month: number })[] };

export function ForecastSection() {
  const reduce = useReducedMotion();
  const [charts, setCharts] = useState<Charts | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(
    () =>
      api<Charts>("/dashboard/charts")
        .then((r) => (setCharts(r), setErr("")))
        .catch((e) => setErr((e as Error).message)),
    [],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["forecast"], load, 60_000);

  if (err && !charts) return null; // ไม่มีสิทธิ์ / โหลดไม่ได้ = ไม่แสดงส่วนนี้ (Dashboard ส่วนอื่นใช้ได้ตามปกติ)
  return (
    <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={0} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      {!charts ? (
        <Card title="CUSTOMER ORDER">
          <Loading />
        </Card>
      ) : (
        <CustomerDonut title={`CUSTOMER ORDER • ${charts.month}`} period={charts.month} rows={charts.customers} empty="ยังไม่มี Order ของเดือนนี้" fill />
      )}
      {!charts ? (
        <Card title="FORECAST / ORDER / DELIVERY">
          <Loading />
        </Card>
      ) : (
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
          <MonthChart data={charts.months} year={charts.year} fill header={{ icon: "/images/dashboard/chart.png", title: `FORECAST / ORDER / DELIVERY • ${charts.year}` }} />
        </section>
      )}
    </motion.div>
  );
}

// ตาราง WORKLOAD ตามไฟล์ Excel (ยอดที่ Import) · เดือนที่ยังไม่ได้ Import = ยอดที่ระบบคำนวณ
export function useWlTable(res: WlRes | null) {
  const data = res?.data;
  const totals = useMemo(() => (data ? data.months.map((m) => deptTotals(m, data.shifts, data.settings)) : []), [data]);
  const saved = useMemo(() => savedHeads(data?.heads ?? []), [data]);
  const refs = useMemo(() => refMap(res?.refs), [res]);
  const headOf = useCallback(
    (m: string, row: string) => {
      const h = saved.get(`${m}|${row}`);
      return { direct: h?.direct ?? 0, ind1: h?.ind1 ?? 0, ind2: h?.ind2 ?? 0 };
    },
    [saved],
  );
  const refOf = useCallback((m: string, row: string) => refs.get(`${m}|${row}`), [refs]);
  const table = useMemo(() => (data ? buildTable(data, totals, headOf, refOf) : null), [data, totals, headOf, refOf]);
  const upd = useMemo(() => updOf(data?.heads ?? [], data?.months[1]?.month ?? ""), [data]);
  return { table, upd };
}

const C = { plan: "#4f46e5", plan2: "#818cf8", act: "#0891b2", act2: "#67e8f9" };
type Pick = "-1" | "0" | "1" | "2" | "3"; // -1 = เดือน N-1 (แผน vs คนที่มีจริงเดือนก่อน)
type Metric = "direct" | "total";

// 👥 กราฟ WORKLOAD: เลือกหน่วยงานได้แบบ Capacity
//   ALL = ทุกหน่วยงานของเดือนที่เลือก (N-1 … N+3) · เลือกหน่วยงาน = หน่วยงานนั้นทุกเดือน N-1 → N+3
//   PLAN MANPOWER (ยอดตามไฟล์ Excel) vs ACTUAL MANPOWER (N-1 = Actual เดือนก่อน · N ขึ้นไป = คนที่มีจริงตอนนี้) · DIRECT / TOTAL · กดกราฟ = ไปหน้าตาราง
function WlByDept({ table, months, curM, dept }: { table: WlTable; months: string[]; curM: string; dept?: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [pick, setPick] = useState<Pick>("0");
  const [metric, setMetric] = useState<Metric>("direct");
  const [unit, setUnit] = useState<string>(() => (dept && table.rows.some((x) => x.r.key === dept) ? dept : "ALL"));
  const i = Number(pick);
  const pm = months[i + 1] ?? curM;
  const pv = (p: { direct: number; total: number }) => (metric === "direct" ? p.direct : p.total);
  const found = unit === "ALL" ? null : (table.rows.find((x) => x.r.key === unit) ?? null);
  const one = found && (metric === "total" || (found.r.dept && found.r.direct !== false)) ? found : null; // DIRECT = เฉพาะแถวที่ดึงจาก Capacity
  const lbl = { plan: metric === "direct" ? "PLAN MANPOWER (DIRECT)" : "PLAN MANPOWER", have: metric === "direct" ? "ACTUAL MANPOWER (DIRECT)" : "ACTUAL MANPOWER" };

  // ทุกหน่วยงาน (เดือนที่เลือก)
  const rows = metric === "total" ? table.rows : table.rows.filter((x) => x.r.dept && x.r.direct !== false);
  const val = (x: WlTableRow) => ({ plan: pv(i < 0 ? x.prevPlan : x.plans[i]), have: pv(i < 0 ? x.prevAct : x.cur) });
  // หน่วยงานเดียว (ทุกเดือน)
  const trend = one ? [{ plan: pv(one.prevPlan), have: pv(one.prevAct) }, ...one.plans.map((p) => ({ plan: pv(p), have: pv(one.cur) }))] : [];
  const tag = (k: number) => (k === 0 ? "N-1" : k === 1 ? "N" : `N+${k - 1}`);

  const cats = one ? months.map((m, k) => `${EN(m).slice(0, 3).toUpperCase()} (${tag(k)})`) : rows.map((x) => x.r.short);
  const pts = one ? trend : rows.map(val);
  const series: Series[] = [
    { key: "plan", label: lbl.plan, kind: "bar", color: C.plan, color2: C.plan2, values: pts.map((x) => x.plan), fmt: f1 },
    { key: "have", label: lbl.have, kind: "bar", color: C.act, color2: C.act2, values: pts.map((x) => x.have), fmt: f0 },
  ];
  const units = [{ value: "ALL", label: "ALL • ทุกหน่วยงาน" }, ...table.rows.filter((x) => metric === "total" || (x.r.dept && x.r.direct !== false)).map((x) => ({ value: x.r.key, label: `${x.r.short} • ${x.r.name}` }))];
  return (
    <Card
      clip={false}
      title={one ? `👥 WORKLOAD • ${one.r.short} • ${EN(months[0]).toUpperCase()} → ${EN(months[4]).toUpperCase()}` : `👥 WORKLOAD • PLAN vs ACTUAL • ${EN(pm).toUpperCase()}`}
      actions={
        <>
          <MenuSelect compact className="w-[230px]" value={units.some((u) => u.value === unit) ? unit : "ALL"} options={units} onChange={setUnit} label="หน่วยงาน" />
          {!one && <Seg id="dwl-n" value={pick} onChange={setPick} options={(["-1", "0", "1", "2", "3"] as Pick[]).map((v) => ({ v, l: v === "-1" ? "N-1" : v === "0" ? "N" : `N+${v}` }))} />}
          <Seg id="dwl-m" value={metric} onChange={setMetric} options={[{ v: "direct", l: "DIRECT" }, { v: "total", l: "TOTAL" }]} />
        </>
      }
      bodyClass="px-2 pb-3 pt-2 md:px-4"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={unit + pick + metric} initial={reduce ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: -14 }} transition={{ duration: 0.3, ease: EASE }}>
          <PpChart
            ariaLabel={one ? `Workload ${one.r.short} by month` : "Workload plan versus actual by department"}
            height={300}
            cats={cats}
            series={series}
            tipTitle={(k) => (one ? `${one.r.name} · ${EN(months[k])} (${tag(k)})` : `${rows[k].r.name} · ${EN(pm)}`)}
            tipExtra={(k) => {
              const v = pts[k];
              const d = Math.round(v.have - v.plan);
              return (
                <div className="r is-sum">
                  <span>{metric === "direct" ? "DIRECT" : "TOTAL"} ขาด / เกิน</span>
                  <b className={d < 0 ? "wl-neg" : d > 0 ? "wl-pos" : ""}>{signed(d)} คน</b>
                </div>
              );
            }}
            onPick={() => router.push(`/pp/capacity/workload?month=${curM}`)}
          />
        </motion.div>
      </AnimatePresence>
      <p className="pp-hint">แท่งม่วง = PLAN MANPOWER (ยอดตามไฟล์ Excel Work load) · แท่งฟ้า = ACTUAL MANPOWER (N-1 = Actual เดือนก่อน · N ขึ้นไป = คนที่มีจริงตอนนี้) · เลือกหน่วยงานเพื่อดูทุกเดือน · กดกราฟเพื่อไปหน้าตาราง WORKLOAD</p>
    </Card>
  );
}

// ตาราง WORKLOAD (ดูอย่างเดียว) ใต้ Dashboard
export function WlTableCard({ table, ms, upd, curM }: { table: WlTable; ms: WlRes["data"]["months"]; upd: string; curM: string }) {
  return (
    <Card
      title="9. MONTHLY MAN-POWER PLAN & ACTUAL"
      actions={
        <Link href={`/pp/capacity/workload?month=${curM}`} className="btn-ghost">
          ✏ แก้คนที่มีจริง / IMPORT
        </Link>
      }
      bodyClass="p-0"
    >
      <WlGrid table={table} ms={ms} upd={upd} />
      <WlLegend />
    </Card>
  );
}

export function WorkloadSection({ month, dept }: { month: string; dept?: string }) {
  const reduce = useReducedMotion();
  const { res, err } = useWorkload(month);
  const { table, upd } = useWlTable(res);
  const ms = res?.data.months ?? [];
  const curM = ms[1]?.month ?? "";
  if (err && !res) return null; // ไม่มีสิทธิ์ / ยังไม่มีตาราง Workload = ไม่แสดงส่วนนี้
  if (!table || ms.length < 5)
    return (
      <Card title="👥 WORKLOAD">
        <Loading />
      </Card>
    );
  return (
    <>
      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
        <WlByDept key={dept ?? "ALL"} table={table} months={ms.map((m) => m.month)} curM={curM} dept={dept} />
      </motion.div>
      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.05 }} custom={0}>
        <WlTableCard table={table} ms={ms} upd={upd} curM={curM} />
      </motion.div>
    </>
  );
}
