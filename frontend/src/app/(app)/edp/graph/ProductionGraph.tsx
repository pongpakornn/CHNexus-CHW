"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
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
  rounds: { round: number; plan: number; act: number; eff: number }[];
  hgMonths: { label: string; plan: number; act: number }[];
  customers: { name: string; amount: number; percentage: number }[];
};
const NAMES = { forecast: "PLAN HG", order: "ACT HG", compare: "ACT vs PLAN" } as const;

// ตัวเลขนับขึ้นนุ่ม ๆ (ลดการเคลื่อนไหว = แสดงค่าเลย)
function useCount(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function Kpi({ cap, pct, sub, color, i }: { cap: string; pct: number; sub: string; color: string; i: number }) {
  const v = useCount(pct);
  return (
    <div className="edp-kpi" style={{ "--i": i, "--k": color } as React.CSSProperties}>
      <div>
        <small>{cap}</small>
        <b>{v.toFixed(1)}%</b>
        <span>{sub}</span>
      </div>
      <svg viewBox="0 0 80 80" className="edp-ring" style={{ "--p": Math.min(1, pct / 100) } as React.CSSProperties} aria-hidden>
        <circle className="bg" cx="40" cy="40" r="32" />
        <circle className="fg" cx="40" cy="40" r="32" />
      </svg>
    </div>
  );
}

function Bars({ items, max, target }: { items: { label: string; value: number; sub?: string }[]; max: number; target?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  return (
    <div className="edp-bars" style={{ "--n": items.length } as React.CSSProperties}>
      {target != null && (
        <span className="edp-target" style={{ bottom: `${(target / max) * 100}%` }}>
          {target}%
        </span>
      )}
      {items.map((it, i) => (
        <div key={it.label} className={`edp-bar-col ${hi === i ? "is-hi" : ""}`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} title={`${it.label}: ${it.value}%${it.sub ? " · " + it.sub : ""}`}>
          <span className="edp-bar-val">{it.value ? `${it.value}%` : ""}</span>
          <span className="edp-bar-fill" style={{ "--h": `${Math.min(100, (it.value / max) * 100)}%`, "--d": `${i * 45}ms` } as React.CSSProperties} />
          <small>{it.label}</small>
        </div>
      ))}
    </div>
  );
}

const asPoints = (rows: { label: string; plan: number; act: number }[]): MonthPoint[] => rows.map((r) => ({ label: r.label, forecast: r.plan, order: r.act, delivery: 0 }));

export default function ProductionGraph() {
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });
  const [g, setG] = useState<G | null>(null);
  const load = useCallback(async (quiet = false) => {
    try {
      setG(await api<G>("/edp/graph"));
    } catch (e) {
      if (!quiet) toastRef.current.show("ERROR", "โหลดกราฟไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["edp"], () => load(true), 30_000);

  if (!g) return <Loading />;
  const today = g.rounds.reduce((a, r) => ({ plan: a.plan + r.plan, act: a.act + r.act }), { plan: 0, act: 0 });
  const month = g.daily.reduce((a, r) => ({ plan: a.plan + r.plan, act: a.act + r.act }), { plan: 0, act: 0 });
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const best = g.monthly.reduce((a, m) => (m.eff > a.eff ? m : a), { name: "-", eff: 0 });
  return (
    <PageBody>
      <PageHeader icon="/icons/Dashboard.png" title="EDP • DASHBOARD" subtitle="ประสิทธิภาพ HG (ACT ÷ PLAN) · อัพเดทเองเมื่อหน้างาน MARK SUCCESS" />
      <div className="edp-kpis">
        <Kpi i={0} cap="TODAY" pct={pct(today.act, today.plan)} sub={`${today.act.toLocaleString()} / ${today.plan.toLocaleString()} HG`} color="#6750a4" />
        <Kpi i={1} cap={`MONTH ${g.month}`} pct={pct(month.act, month.plan)} sub={`${month.act.toLocaleString()} / ${month.plan.toLocaleString()} HG`} color="#2563eb" />
        <Kpi i={2} cap="BEST MONTH" pct={best.eff} sub={best.name} color="#16a34a" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <CustomerDonut title={`HG ACT BY CUSTOMER • ${g.month}`} period={g.month} rows={g.customers} empty="ยังไม่มียอดผลิตของเดือนนี้" fill />
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
          <MonthChart data={asPoints(g.hgMonths)} year={g.year} fill names={NAMES} hide={["delivery"]} header={{ icon: "/images/dashboard/chart.png", title: `PLAN / ACT HG • ${g.year}` }} />
        </section>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <Card title="⏱ ROUND EFFICIENCY • วันนี้">
          <div className="p-4">
            <Bars max={100} target={100} items={g.rounds.map((r) => ({ label: `R${r.round}`, value: r.eff, sub: `${r.act}/${r.plan} HG` }))} />
          </div>
        </Card>
        <section className="flex flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
          <MonthChart
            data={asPoints(g.daily.map((d) => ({ label: String(+d.day.slice(0, 2)), plan: d.plan, act: d.act })))}
            year={g.month}
            fill
            names={{ ...NAMES, month: "Day" }}
            hide={["delivery"]}
            header={{ icon: "/images/dashboard/chart.png", title: `DAILY HG • ${g.month}` }}
          />
        </section>
      </div>
    </PageBody>
  );
}
