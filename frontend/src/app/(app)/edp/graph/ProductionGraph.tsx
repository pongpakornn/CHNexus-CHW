"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { motion, useReducedMotion } from "framer-motion";
import { fadeOnly, panelIn } from "@/lib/motion";
import { MonthChart, type MonthPoint } from "@/components/charts/Charts";
import { CustomerDonut } from "@/components/charts/CustomerDonut";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import "../edp.css";

// 🏭 EDP › DASHBOARD (หน้าแรกของระบบ EDP) - กราฟชุดเดียวกับ Dashboard ของ CIMS
//   KPI วันนี้ / เดือนนี้ / เดือนที่ดีที่สุด (วงแหวน + ตัวเลขนับขึ้น) · วงแหวนลูกค้า (HG ACT เดือนนี้)
//   HG รายเดือน (แท่ง ACT + เส้น PLAN) · ประสิทธิภาพรายรอบวันนี้ · HG รายวันของเดือนนี้ · อัพเดทเองเมื่อหน้างาน MARK
type G = {
  month: string;
  year: number;
  monthly: { name: string; eff: number }[];
  daily: { day: string; plan: number; act: number }[];
  rounds: {
    round: number;
    start: number;
    end: number;
    plan: number;
    act: number;
    eff: number;
  }[];
  hgMonths: { label: string; plan: number; act: number }[];
  customers: { name: string; amount: number; percentage: number }[];
};
const NAMES = {
  forecast: "PLAN HG",
  order: "ACT HG",
  compare: "ACT vs PLAN",
} as const;

// ตัวเลขนับขึ้นนุ่ม ๆ (ลดการเคลื่อนไหว = แสดงค่าเลย)
function useCount(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const a = from.current;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = reduce ? 1 : Math.min(1, (t - t0) / ms);
      setV(a + (target - a) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Kpi({
  cap,
  pct,
  sub,
  color,
  i,
}: {
  cap: string;
  pct: number;
  sub: string;
  color: string;
  i: number;
}) {
  const v = useCount(pct);
  return (
    <div
      className="edp-kpi"
      style={{ "--i": i, "--k": color } as React.CSSProperties}
    >
      <div>
        <small>{cap}</small>
        <b>{v.toFixed(1)}%</b>
        <span>{sub}</span>
      </div>
      <svg
        viewBox="0 0 80 80"
        className="edp-ring"
        shapeRendering="geometricPrecision"
        style={{ "--p": Math.min(1, pct / 100) } as React.CSSProperties}
        aria-hidden
      >
        <circle className="bg" cx="40" cy="40" r="32" />
        <circle className="fg" cx="40" cy="40" r="32" transform="rotate(-90 40 40)" />
      </svg>
    </div>
  );
}

// การ์ด 1 ใบของหน้า Dashboard: เปิดเข้ามาตามลำดับ (i) · ชี้ = ยกขึ้นเล็กน้อย
function Panel({ i, reduce, children, className }: { i: number; reduce: boolean; children: React.ReactNode; className?: string }) {
  return (
    <motion.div custom={i} variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" className={`edp-panel ${className ?? ""}`}>
      {children}
    </motion.div>
  );
}

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const asPoints = (
  rows: { label: string; plan: number; act: number }[],
): MonthPoint[] =>
  rows.map((r) => ({
    label: r.label,
    forecast: r.plan,
    order: r.act,
    delivery: 0,
  }));

export default function ProductionGraph() {
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });
  const [g, setG] = useState<G | null>(null);
  const reduce = useReducedMotion();
  const load = useCallback(async (quiet = false) => {
    try {
      setG(await api<G>("/edp/graph"));
    } catch (e) {
      if (!quiet)
        toastRef.current.show(
          "ERROR",
          "โหลดกราฟไม่สำเร็จ\n" + (e as Error).message,
          "error",
        );
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["edp"], () => load(true), 30_000);

  // 🎬 ลำดับการเปิดหน้า: หัวหน้า (0) -> KPI 3 ใบ (1-3) -> กราฟ 4 ใบ (4-7) ห่างกันทีละ 0.08 วินาที
  const V = reduce ? fadeOnly : panelIn;
  // โหลดอยู่ = โครงการ์ดวิบวับ (skeleton) ตามรูปทรงจริง
  if (!g)
    return (
      <PageBody>
        <div className="edp-skel" style={{ height: 56, width: 360 }} />
        <div className="edp-kpis">
          {[0, 1, 2].map((i) => (
            <div key={i} className="edp-skel" style={{ height: 112 }} />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
          <div className="edp-skel" style={{ height: 420 }} />
          <div className="edp-skel" style={{ height: 420 }} />
        </div>
      </PageBody>
    );
  const today = g.rounds.reduce(
    (a, r) => ({ plan: a.plan + r.plan, act: a.act + r.act }),
    { plan: 0, act: 0 },
  );
  const month = g.daily.reduce(
    (a, r) => ({ plan: a.plan + r.plan, act: a.act + r.act }),
    { plan: 0, act: 0 },
  );
  const pct = (a: number, b: number) =>
    b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
  const best = g.monthly.reduce((a, m) => (m.eff > a.eff ? m : a), {
    name: "-",
    eff: 0,
  });
  return (
    <PageBody>
      <motion.div custom={0} variants={V} initial="hidden" animate="show">
        <PageHeader
          icon="/icons/Dashboard.png"
          title="EDP • DASHBOARD"
          subtitle="ประสิทธิภาพ HG (ACT ÷ PLAN) · อัพเดทเองเมื่อหน้างาน MARK SUCCESS"
        />
      </motion.div>
      <div className="edp-kpis">
        <Panel reduce={!!reduce} i={1}>
        <Kpi
          i={0}
          cap="TODAY"
          pct={pct(today.act, today.plan)}
          sub={`${today.act.toLocaleString()} / ${today.plan.toLocaleString()} HG`}
          color="#6750a4"
        />
        </Panel>
        <Panel reduce={!!reduce} i={2}>
        <Kpi
          i={1}
          cap={`MONTH ${g.month}`}
          pct={pct(month.act, month.plan)}
          sub={`${month.act.toLocaleString()} / ${month.plan.toLocaleString()} HG`}
          color="#2563eb"
        />
        </Panel>
        <Panel reduce={!!reduce} i={3}>
        <Kpi
          i={2}
          cap="BEST MONTH"
          pct={best.eff}
          sub={best.name}
          color="#16a34a"
        />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <Panel reduce={!!reduce} i={4} className="flex">
        <CustomerDonut
          title={`HG ACT BY CUSTOMER • ${g.month}`}
          period={g.month}
          rows={g.customers}
          empty="ยังไม่มียอดผลิตของเดือนนี้"
          metric="HG ACT"
          subtitle="สัดส่วนยอดผลิตจริง (HG) แยกตามลูกค้า"
          fill
        />
        </Panel>
        <Panel reduce={!!reduce} i={5} className="flex">
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
          <MonthChart
            data={asPoints(g.hgMonths)}
            year={g.year}
            fill
            names={NAMES}
            hide={["delivery"]}
            header={{
              icon: "/images/dashboard/chart.png",
              title: `PLAN / ACT HG • ${g.year}`,
            }}
          />
        </section>
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        {/* รายรอบวันนี้: วงแหวนตามรอบเวลา (ชิ้นวงแหวน = HG ACT ของรอบ · รายการบอก % ประสิทธิภาพ) แบบหน้า Graph ของ EDP เดิม */}
        <Panel reduce={!!reduce} i={6} className="flex">
        <CustomerDonut
          title={`ROUND EFFICIENCY • วันนี้ ${pct(today.act, today.plan)}%`}
          period="TODAY"
          rows={g.rounds
            .filter((r) => r.act > 0)
            .map((r) => ({
              name: `R${r.round} · ${hh(r.start)}-${hh(r.end)} · ${r.eff}%`,
              amount: r.act,
              percentage: today.act
                ? Math.round((r.act * 1000) / today.act) / 10
                : 0,
            }))}
          empty="วันนี้ยังไม่มียอดผลิต"
          metric="HG ACT"
          nameHead="Round"
          subtitle="ยอดผลิตจริง (HG) ตามรอบเวลา · % = ACT ÷ PLAN ของรอบ"
          fill
        />
        </Panel>
        <Panel reduce={!!reduce} i={7} className="flex">
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
          <MonthChart
            data={asPoints(
              g.daily.map((d) => ({
                label: String(+d.day.slice(0, 2)),
                plan: d.plan,
                act: d.act,
              })),
            )}
            year={g.month}
            fill
            names={{ ...NAMES, month: "Day" }}
            hide={["delivery"]}
            header={{
              icon: "/images/dashboard/chart.png",
              title: `DAILY HG • ${g.month}`,
            }}
          />
        </section>
        </Panel>
      </div>
    </PageBody>
  );
}
