"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import "../edp.css";

// 🏭 EDP › PRODUCTION GRAPH - ประสิทธิภาพ HG (ACT ÷ PLAN) · การ์ด KPI วันนี้ / เดือนนี้ (วงแหวน + ตัวเลขนับขึ้น)
//   แท่งรายรอบวันนี้ · แท่งรายเดือน · เส้น PLAN เทียบ ACT รายวัน (ชี้ = เส้นนำสายตา + ป้ายค่า) · อัพเดทเองเมื่อหน้างาน MARK
type G = {
  month: string;
  monthly: { name: string; eff: number }[];
  daily: { day: string; plan: number; act: number }[];
  rounds: { round: number; plan: number; act: number; eff: number }[];
};

const PLAN = "#71717a";
const ACT = "#a78bfa";

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
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (target - a) * e);
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

function Bars({ items, max, unit = "%", target }: { items: { label: string; value: number; sub?: string }[]; max: number; unit?: string; target?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  return (
    <div className="edp-bars" style={{ "--n": items.length } as React.CSSProperties}>
      {target != null && (
        <span className="edp-target" style={{ bottom: `${(target / max) * 100}%` }}>
          {target}%
        </span>
      )}
      {items.map((it, i) => (
        <div key={it.label} className={`edp-bar-col ${hi === i ? "is-hi" : ""}`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} title={`${it.label}: ${it.value}${unit}${it.sub ? " · " + it.sub : ""}`}>
          <span className="edp-bar-val">{it.value ? `${it.value}${unit}` : ""}</span>
          <span className="edp-bar-fill" style={{ "--h": `${Math.min(100, (it.value / max) * 100)}%`, "--d": `${i * 45}ms` } as React.CSSProperties} />
          <small>{it.label}</small>
        </div>
      ))}
    </div>
  );
}

function Lines({ rows }: { rows: G["daily"] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 760,
    H = 240,
    P = 30;
  const max = Math.max(10, ...rows.flatMap((r) => [r.plan, r.act]));
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(1, rows.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = (k: "plan" | "act") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  const area = `${path("act")} L${x(rows.length - 1).toFixed(1)},${H - P} L${P},${H - P} Z`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="edp-line w-full" role="img" aria-label="HG PLAN เทียบ ACT รายวัน">
        <defs>
          <linearGradient id="edp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACT} stopOpacity="0.35" />
            <stop offset="100%" stopColor={ACT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} className="edp-grid" />
            <text x={4} y={y(max * f) + 4} className="edp-axis">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#edp-area)" className="edp-area" />
        <path d={path("plan")} fill="none" stroke={PLAN} strokeWidth={2} className="edp-draw is-plan" />
        <path d={path("act")} fill="none" stroke={ACT} strokeWidth={2.5} className="edp-draw" style={{ filter: `drop-shadow(0 0 6px ${ACT})` }} />
        {rows.map((r, i) => (
          <g key={r.day} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <rect x={x(i) - 10} y={0} width={20} height={H} fill="transparent" />
            {hi === i && <line x1={x(i)} x2={x(i)} y1={P} y2={H - P} className="edp-cross" />}
            {(r.act > 0 || hi === i) && <circle cx={x(i)} cy={y(r.act)} r={hi === i ? 5.5 : 3.5} fill={ACT} stroke="#17171a" strokeWidth={2} />}
            {i % 5 === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="edp-axis">
                {r.day}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hi != null && (
        <div className="edp-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <b>{rows[hi].day}</b>
          <span>PLAN {rows[hi].plan.toLocaleString()} HG</span>
          <span>ACT {rows[hi].act.toLocaleString()} HG</span>
          <span>{rows[hi].plan ? Math.round((rows[hi].act / rows[hi].plan) * 100) : 0}%</span>
        </div>
      )}
    </div>
  );
}

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
    <PageBody className="edp-dark">
      <PageHeader icon="/icons/Dashboard.png" title="EDP • PRODUCTION GRAPH" subtitle="ประสิทธิภาพ HG (ACT ÷ PLAN) · อัพเดทเองเมื่อหน้างาน MARK SUCCESS" />
      <div className="edp-kpis">
        <Kpi i={0} cap="TODAY" pct={pct(today.act, today.plan)} sub={`${today.act.toLocaleString()} / ${today.plan.toLocaleString()} HG`} color="#a78bfa" />
        <Kpi i={1} cap={`MONTH ${g.month}`} pct={pct(month.act, month.plan)} sub={`${month.act.toLocaleString()} / ${month.plan.toLocaleString()} HG`} color="#60a5fa" />
        <Kpi i={2} cap="BEST MONTH" pct={best.eff} sub={best.name} color="#4ade80" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="⏱ ROUND EFFICIENCY · วันนี้">
          <div className="p-4">
            <Bars max={100} target={100} items={g.rounds.map((r) => ({ label: `R${r.round}`, value: r.eff, sub: `${r.act}/${r.plan} HG` }))} />
          </div>
        </Card>
        <Card title={`📅 MONTHLY EFFICIENCY · ${g.month.slice(3)}`}>
          <div className="p-4">
            <Bars max={Math.max(100, ...g.monthly.map((m) => m.eff))} target={100} items={g.monthly.map((m) => ({ label: m.name, value: m.eff }))} />
          </div>
        </Card>
      </div>
      <Card
        title={`📈 DAILY HG · ${g.month}`}
        actions={
          <span className="edp-legend">
            <i style={{ background: PLAN }} /> PLAN <i style={{ background: ACT }} /> ACT
          </span>
        }
      >
        <div className="p-4">
          <Lines rows={g.daily} />
        </div>
      </Card>
    </PageBody>
  );
}
