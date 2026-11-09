"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import "../edp.css";

// 🏭 EDP › PRODUCTION GRAPH - ประสิทธิภาพ HG (ACT ÷ PLAN) รายเดือน · รายวันของเดือนนี้ (PLAN เทียบ ACT) · รายรอบของวันนี้
//   อัพเดทเองเมื่อมีการ MARK / บันทึกแผน (เฉพาะการ์ดที่ SHOW)
type G = {
  month: string;
  monthly: { name: string; eff: number }[];
  daily: { day: string; plan: number; act: number }[];
  rounds: { round: number; plan: number; act: number; eff: number }[];
};

const PLAN = "#a1a1aa";
const ACT = "#2563eb";

function Bars({ items, max, unit = "%", target }: { items: { label: string; value: number; sub?: string }[]; max: number; unit?: string; target?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  return (
    <div className="edp-bars" style={{ "--n": items.length } as React.CSSProperties}>
      {target != null && <span className="edp-target" style={{ bottom: `${(target / max) * 100}%` }}>{target}%</span>}
      {items.map((it, i) => (
        <div key={it.label} className={`edp-bar-col ${hi === i ? "is-hi" : ""}`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} title={`${it.label}: ${it.value}${unit}${it.sub ? " · " + it.sub : ""}`}>
          <span className="edp-bar-val">{it.value ? `${it.value}${unit}` : ""}</span>
          <span className="edp-bar-fill" style={{ "--h": `${Math.min(100, (it.value / max) * 100)}%`, "--d": `${i * 40}ms` } as React.CSSProperties} />
          <small>{it.label}</small>
        </div>
      ))}
    </div>
  );
}

function Lines({ rows }: { rows: G["daily"] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 720,
    H = 220,
    P = 28;
  const max = Math.max(10, ...rows.flatMap((r) => [r.plan, r.act]));
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(1, rows.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = (k: "plan" | "act") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="edp-line w-full" role="img" aria-label="HG PLAN เทียบ ACT รายวัน">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} className="edp-grid" />
            <text x={4} y={y(max * f) + 4} className="edp-axis">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <path d={path("plan")} fill="none" stroke={PLAN} strokeWidth={2} strokeDasharray="5 4" className="edp-draw" />
        <path d={path("act")} fill="none" stroke={ACT} strokeWidth={2.5} className="edp-draw is-act" />
        {rows.map((r, i) => (
          <g key={r.day} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <rect x={x(i) - 9} y={0} width={18} height={H} fill="transparent" />
            {hi === i && <line x1={x(i)} x2={x(i)} y1={P} y2={H - P} className="edp-cross" />}
            {(r.act > 0 || hi === i) && <circle cx={x(i)} cy={y(r.act)} r={hi === i ? 5 : 3.5} fill={ACT} stroke="#fff" strokeWidth={2} />}
            {i % 5 === 0 && (
              <text x={x(i)} y={H - 6} textAnchor="middle" className="edp-axis">
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
  const [g, setG] = useState<G | null>(null);
  const load = useCallback(
    async (quiet = false) => {
      try {
        setG(await api<G>("/edp/graph"));
      } catch (e) {
        if (!quiet) toast.show("ERROR", "โหลดกราฟไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["edp"], () => load(true), 30_000);

  if (!g) return <Loading />;
  const today = g.rounds.reduce((a, r) => ({ plan: a.plan + r.plan, act: a.act + r.act }), { plan: 0, act: 0 });
  const month = g.daily.reduce((a, r) => ({ plan: a.plan + r.plan, act: a.act + r.act }), { plan: 0, act: 0 });
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return (
    <PageBody>
      <PageHeader icon="/icons/Dashboard.png" title="EDP • PRODUCTION GRAPH" subtitle="ประสิทธิภาพ HG (ACT ÷ PLAN) · อัพเดทเองเมื่อหน้างาน MARK SUCCESS" />
      <div className="edp-kpis">
        {[
          { cap: "TODAY", v: pct(today.act, today.plan), sub: `${today.act.toLocaleString()} / ${today.plan.toLocaleString()} HG` },
          { cap: `MONTH ${g.month}`, v: pct(month.act, month.plan), sub: `${month.act.toLocaleString()} / ${month.plan.toLocaleString()} HG` },
        ].map((k, i) => (
          <div key={k.cap} className="edp-kpi" style={{ "--i": i } as React.CSSProperties}>
            <small>{k.cap}</small>
            <b>{k.v}%</b>
            <span>{k.sub}</span>
            <i style={{ "--p": Math.min(1, k.v / 100) } as React.CSSProperties} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="⏱ ROUND EFFICIENCY · วันนี้">
          <Bars max={100} target={100} items={g.rounds.map((r) => ({ label: `R${r.round}`, value: r.eff, sub: `${r.act}/${r.plan} HG` }))} />
        </Card>
        <Card title={`📅 MONTHLY EFFICIENCY · ${g.month.slice(3)}`}>
          <Bars max={Math.max(100, ...g.monthly.map((m) => m.eff))} target={100} items={g.monthly.map((m) => ({ label: m.name, value: m.eff }))} />
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
        <Lines rows={g.daily} />
      </Card>
    </PageBody>
  );
}
