"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { shortN } from "@/lib/pp";

// 📊 กราฟ Plan vs Actual (SVG): แท่ง = ค่าจริง / แผน · เส้น = แผน / สะสม / เป้า
//   เปิดหน้า = แท่งโตขึ้นจากฐานทีละแท่ง + เส้นลากจากซ้ายไปขวา · เปลี่ยนโหมด = แท่ง / เส้นเลื่อนไปค่าใหม่นุ่ม ๆ (ไม่วาดใหม่กระตุก)
//   ชี้ / แตะ = แถบไฮไลต์ + กล่องค่าลอยตามจุด (ลากนิ้วบนมือถือได้) · กด Legend = ซ่อน / แสดงชุดข้อมูล · ลดการเคลื่อนไหว = ไม่มีแอนิเมชัน
export type Series = { key: string; label: string; kind: "bar" | "line"; color: string; color2?: string; values: (number | null)[]; dashed?: boolean; fmt?: (v: number) => string };

type Props = {
  cats: string[];
  sub?: string[];
  off?: boolean[]; // คอลัมน์วันหยุด (พื้นสีอ่อน)
  series: Series[];
  height?: number;
  tipTitle?: (i: number) => React.ReactNode;
  tipExtra?: (i: number) => React.ReactNode;
  onPick?: (i: number) => void;
  ariaLabel: string;
};

function nice(max: number) {
  const raw = (Math.max(max, 1e-9) * 1.08) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const st = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { step: st, top: Math.max(st, Math.ceil((max * 1.08) / st) * st) };
}

// เส้นโค้งนุ่ม (Catmull-Rom -> Bezier) ข้ามจุดที่ไม่มีค่า
function curve(pts: [number, number][]) {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  const t = 0.16;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] ?? pts[i],
      b = pts[i],
      c = pts[i + 1],
      e = pts[i + 2] ?? c;
    d += ` C${b[0] + (c[0] - a[0]) * t},${b[1] + (c[1] - a[1]) * t} ${c[0] - (e[0] - b[0]) * t},${c[1] - (e[1] - b[1]) * t} ${c[0]},${c[1]}`;
  }
  return d;
}

export function PpChart({ cats, sub, off, series, height, tipTitle, tipExtra, onPick, ariaLabel }: Props) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hide, setHide] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState(-1);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0, flip: false });
  const tapSkip = useRef(false); // มือถือ: แตะครั้งแรก = ดูค่า · แตะซ้ำแท่งเดิม = เปิด (onPick)

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height ?? (W && W < 560 ? 250 : 320);
  const m = { t: 14, r: 10, b: sub ? 40 : 30, l: W && W < 560 ? 40 : 52 };
  const shown = series.filter((s) => !hide[s.key]);
  const max = Math.max(0, ...shown.flatMap((s) => s.values.map((v) => v ?? 0)));
  const { step, top } = nice(max);
  const n = cats.length;
  const iw = Math.max(0, W - m.l - m.r);
  const band = n ? iw / n : 0;
  const sx = (i: number) => m.l + (i + 0.5) * band;
  const sy = (v: number) => m.t + (H - m.t - m.b) * (1 - v / top);
  const base = H - m.b;
  const bars = shown.filter((s) => s.kind === "bar");
  const lines = shown.filter((s) => s.kind === "line");
  const bw = Math.max(2, Math.min(30, (band * 0.74) / Math.max(1, bars.length)));
  const labelEvery = Math.max(1, Math.ceil((n * (sub ? 30 : 38)) / Math.max(1, iw)));
  const ticks = useMemo(() => Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step), [top, step]);
  const dl = (i: number) => (reduce ? 0 : Math.min(i * 0.018, 0.45));

  function at(clientX: number, clientY: number) {
    const r = box.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const i = Math.floor((x - m.l) / band);
    if (i < 0 || i >= n || !band) return setHover(-1);
    setHover(i);
    setTipPos({ x: sx(i), y: Math.max(8, Math.min(clientY - r.top, H - 60)), flip: sx(i) > W * 0.62 });
  }

  return (
    <div className="pp-chart">
      <div className="pp-legend" role="group" aria-label="Series">
        {series.map((s) => (
          <button key={s.key} type="button" aria-pressed={!hide[s.key]} onClick={() => setHide((h) => ({ ...h, [s.key]: !h[s.key] }))}>
            <i className={s.kind === "line" ? (s.dashed ? "is-dash" : "is-line") : ""} style={{ "--c": s.color, "--c2": s.color2 ?? s.color } as React.CSSProperties} />
            {s.label}
          </button>
        ))}
      </div>
      <div
        ref={box}
        className="pp-stage"
        style={{ height: H }}
        onPointerMove={(e) => at(e.clientX, e.clientY)}
        onPointerDown={(e) => {
          const before = hover;
          at(e.clientX, e.clientY);
          const r = box.current!.getBoundingClientRect();
          const i = band ? Math.floor((e.clientX - r.left - m.l) / band) : -1;
          tapSkip.current = e.pointerType !== "mouse" && i !== before;
        }}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(-1)}
        onClick={() => {
          if (tapSkip.current) return void (tapSkip.current = false);
          if (hover >= 0) onPick?.(hover);
        }}
      >
        {W > 0 && (
          <svg width={W} height={H} role="img" aria-label={ariaLabel}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`ppg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color2 ?? s.color} />
                  <stop offset="1" stopColor={s.color} />
                </linearGradient>
              ))}
            </defs>
            {off?.map((o, i) => (o ? <rect key={"o" + i} x={m.l + i * band} y={m.t} width={band} height={base - m.t} className="pp-off" /> : null))}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="pp-grid" />
                <text x={m.l - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="pp-ax">
                  {shortN(t)}
                </text>
              </g>
            ))}
            {hover >= 0 && <rect x={m.l + hover * band} y={m.t} width={band} height={base - m.t} rx={6} className="pp-band" />}
            {cats.map((c, i) =>
              i % labelEvery === 0 || hover === i ? (
                <text key={"x" + i} x={sx(i)} y={base + 14} textAnchor="middle" className={`pp-ax ${hover === i ? "is-on" : ""} ${off?.[i] ? "is-off" : ""}`}>
                  {c}
                  {sub && (
                    <tspan x={sx(i)} dy="12" className="pp-ax-sub">
                      {sub[i]}
                    </tspan>
                  )}
                </text>
              ) : null,
            )}
            {bars.map((s, k) =>
              s.values.map((v, i) => {
                if (v == null || v <= 0) return null;
                const x = sx(i) - (bw * bars.length) / 2 + k * bw + 1;
                const y = sy(v);
                return (
                  <motion.rect
                    key={`${s.key}-${i}`}
                    x={x}
                    width={Math.max(1, bw - 2)}
                    rx={Math.min(5, bw / 3)}
                    fill={`url(#ppg-${s.key})`}
                    initial={{ y: base, height: 0 }}
                    animate={{ y, height: base - y, opacity: hover < 0 || hover === i ? 1 : 0.45 }}
                    transition={{ duration: reduce ? 0 : 0.6, ease: EASE, delay: dl(i), opacity: { duration: 0.2, delay: 0 } }}
                  />
                );
              }),
            )}
            <AnimatePresence>
              {lines.map((s) => {
                const pts = s.values.map((v, i) => (v == null ? null : ([sx(i), sy(v)] as [number, number]))).filter((p): p is [number, number] => !!p);
                return (
                  <motion.g key={s.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <motion.path
                      d={curve(pts)}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeDasharray={s.dashed ? "6 5" : undefined}
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1, d: curve(pts) }}
                      transition={{ duration: reduce ? 0 : 0.9, ease: EASE }}
                    />
                    {!s.dashed &&
                      pts.length <= 40 &&
                      s.values.map((v, i) =>
                        v == null ? null : (
                          <motion.circle
                            key={i}
                            r={hover === i ? 5 : 3}
                            fill="#fff"
                            stroke={s.color}
                            strokeWidth={2}
                            initial={{ cx: sx(i), cy: base, opacity: 0 }}
                            animate={{ cx: sx(i), cy: sy(v), opacity: 1 }}
                            transition={{ duration: reduce ? 0 : 0.6, ease: EASE, delay: dl(i) }}
                          />
                        ),
                      )}
                  </motion.g>
                );
              })}
            </AnimatePresence>
            <line x1={m.l} x2={W - m.r} y1={base} y2={base} className="pp-base" />
          </svg>
        )}
        <AnimatePresence>
          {hover >= 0 && (
            <motion.div
              className="pp-tip"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, x: tipPos.flip ? tipPos.x - 16 - 220 : tipPos.x + 16, y: tipPos.y - 20 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <h4>{tipTitle ? tipTitle(hover) : cats[hover]}</h4>
              {series.map((s) => {
                const v = s.values[hover];
                return (
                  <div key={s.key} className={`r ${hide[s.key] ? "is-hidden" : ""}`}>
                    <i style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <b>{v == null ? "–" : s.fmt ? s.fmt(v) : v.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b>
                  </div>
                );
              })}
              {tipExtra?.(hover)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// 🔢 ตัวเลขนับขึ้นนุ่ม ๆ (ลดการเคลื่อนไหว = แสดงค่าเลย)
export function useCount(target: number, ms = 900) {
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
