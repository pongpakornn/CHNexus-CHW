"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { fmt, STATUS_TEXT, type ChemParam, type Status } from "@/lib/chem";

// 📈 แผนภูมิควบคุม (Control Chart · SVG)
//   แถบเขียว = ช่วงควบคุม (LCL – UCL) · แถบแดงจาง = นอกข้อกำหนด · เส้นประแดง = Spec Min / Max · เส้นประส้ม = UCL / LCL · เส้นเขียว = Target
//   จุด = ผลการตรวจวัดเรียงตามเวลา (เขียว / ส้ม / แดง ตามสถานะ) · เปิดหน้า = เส้นลากจากซ้ายไปขวา จุดเด้งทีละจุด
//   ชี้ / แตะ = เส้น crosshair + กล่องค่า · ลดการเคลื่อนไหว = ไม่มีแอนิเมชัน
export type ChartPoint = { key: string; label: string; sub?: string; value: number; status: Status; tip: React.ReactNode };

const COL: Record<Status, string> = { OK: "#16a34a", WARN: "#f59e0b", OUT: "#dc2626", NONE: "#94a3b8" };

export function ControlChart({ p, points, height, compact, ariaLabel }: { p: ChemParam; points: ChartPoint[]; height?: number; compact?: boolean; ariaLabel: string }) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState(-1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height ?? (compact ? 120 : W && W < 560 ? 260 : 340);
  const m = compact ? { t: 8, r: 6, b: 8, l: 6 } : { t: 18, r: 64, b: 34, l: 48 };
  const lim = [p.specMin, p.specMax, p.lcl, p.ucl, p.target].filter((v): v is number => v != null);
  const vals = points.map((x) => x.value);
  const all = [...lim, ...vals];
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  if (p.specMin == null && lo < 0 && Math.min(...(vals.length ? vals : [0])) >= 0) lo = 0;
  const iw = Math.max(0, W - m.l - m.r);
  const n = points.length;
  const sx = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const sy = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const path = useMemo(() => points.map((x, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(x.value).toFixed(1)}`).join(" "), [points, W, H, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = (d: number, delay = 0) => ({ duration: reduce ? 0 : d, ease: EASE, delay });

  const lines: { v: number | null; label: string; cls: string }[] = [
    { v: p.specMax, label: "MAX", cls: "is-spec" },
    { v: p.ucl, label: "UCL", cls: "is-ctl" },
    { v: p.target, label: "TARGET", cls: "is-target" },
    { v: p.lcl, label: "LCL", cls: "is-ctl" },
    { v: p.specMin, label: "MIN", cls: "is-spec" },
  ];
  const ctlLo = p.lcl ?? p.specMin;
  const ctlHi = p.ucl ?? p.specMax;

  function at(clientX: number) {
    if (!n || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = clientX - r.left;
    let best = 0;
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      const dd = Math.abs(sx(i) - x);
      if (dd < d) {
        d = dd;
        best = i;
      }
    }
    setHover(best);
  }

  return (
    <div
      ref={box}
      className={`cc-chart ${compact ? "is-compact" : ""}`}
      style={{ height: H }}
      onPointerMove={(e) => !compact && at(e.clientX)}
      onPointerDown={(e) => !compact && at(e.clientX)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(-1)}
    >
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={ariaLabel}>
          <defs>
            <linearGradient id={`${uid}-ln`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6366f1" />
              <stop offset="1" stopColor="#0891b2" />
            </linearGradient>
            <pattern id={`${uid}-out`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="#fef2f2" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="#fca5a5" strokeWidth="1.2" strokeOpacity="0.5" />
            </pattern>
          </defs>
          {/* โซนนอกข้อกำหนด */}
          {p.specMax != null && sy(p.specMax) > m.t && <rect x={m.l} y={m.t} width={iw} height={sy(p.specMax) - m.t} fill={`url(#${uid}-out)`} />}
          {p.specMin != null && sy(p.specMin) < H - m.b && <rect x={m.l} y={sy(p.specMin)} width={iw} height={H - m.b - sy(p.specMin)} fill={`url(#${uid}-out)`} />}
          {/* ช่วงควบคุม */}
          {ctlLo != null || ctlHi != null ? (
            <motion.rect
              x={m.l}
              width={iw}
              y={sy(ctlHi ?? hi)}
              height={Math.max(0, sy(ctlLo ?? lo) - sy(ctlHi ?? hi))}
              className="cc-zone"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={T(0.6)}
            />
          ) : null}
          {!compact &&
            lines.map((l, i) =>
              l.v == null ? null : (
                <motion.g key={l.label} className={`cc-line ${l.cls}`} initial={reduce ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={T(0.5, 0.1 + i * 0.06)}>
                  <line x1={m.l} x2={W - m.r} y1={sy(l.v)} y2={sy(l.v)} />
                  <text x={W - m.r + 6} y={sy(l.v)} dy="0.33em">
                    {l.label} {fmt(p, l.v)}
                  </text>
                </motion.g>
              ),
            )}
          {compact &&
            lines.map((l) => (l.v == null || l.label === "TARGET" ? null : <line key={l.label} className={`cc-line ${l.cls}`} x1={m.l} x2={W - m.r} y1={sy(l.v)} y2={sy(l.v)} />))}
          {!compact && (
            <>
              <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} className="cc-axis" />
              {[0, 0.25, 0.5, 0.75, 1].map((k) => {
                const v = lo + (hi - lo) * k;
                return (
                  <text key={k} x={m.l - 6} y={sy(v)} dy="0.33em" textAnchor="end" className="cc-ax">
                    {fmt(p, v)}
                  </text>
                );
              })}
              {points.map((x, i) =>
                n <= 16 || i % Math.ceil(n / 16) === 0 || hover === i ? (
                  <text key={x.key} x={sx(i)} y={H - m.b + 14} textAnchor="middle" className={`cc-ax ${hover === i ? "is-on" : ""}`}>
                    {x.label}
                    {x.sub && (
                      <tspan x={sx(i)} dy="11" className="cc-ax-sub">
                        {x.sub}
                      </tspan>
                    )}
                  </text>
                ) : null,
              )}
            </>
          )}
          {hover >= 0 && !compact && <line x1={sx(hover)} x2={sx(hover)} y1={m.t} y2={H - m.b} className="cc-cross" />}
          {n > 1 && (
            <motion.path
              d={path}
              fill="none"
              stroke={`url(#${uid}-ln)`}
              strokeWidth={compact ? 1.8 : 2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="cc-path"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1, d: path }}
              transition={T(compact ? 0.8 : 1.2, 0.2)}
            />
          )}
          {points.map((x, i) =>
            compact && x.status === "OK" && i !== n - 1 ? null : (
              <motion.circle
                key={x.key}
                fill={x.status === "OK" ? "#fff" : COL[x.status]}
                stroke={COL[x.status]}
                strokeWidth={2.2}
                initial={reduce ? false : { r: 0, cx: sx(i), cy: sy(x.value) }}
                animate={{ r: hover === i ? 7 : compact ? 3 : x.status === "OK" ? 4 : 5.5, cx: sx(i), cy: sy(x.value) }}
                transition={{ r: { type: "spring", stiffness: 500, damping: 20, delay: reduce ? 0 : Math.min(0.3 + i * 0.02, 1) }, cx: T(0.5), cy: T(0.5) }}
                className={x.status === "OUT" ? "cc-pulse" : ""}
              />
            ),
          )}
        </svg>
      )}
      {!compact && n === 0 && W > 0 && (
        <div className="cc-empty">
          <span>🧪</span>ยังไม่มีผลการตรวจวัดในช่วงนี้
        </div>
      )}
      <AnimatePresence>
        {!compact && hover >= 0 && points[hover] && (
          <motion.div
            className="cc-tip"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1, x: sx(hover) > W * 0.6 ? sx(hover) - 236 : sx(hover) + 14, y: Math.max(6, Math.min(sy(points[hover].value) - 40, H - 130)) }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <b className={`cc-st is-${points[hover].status.toLowerCase()}`}>{STATUS_TEXT[points[hover].status]}</b>
            {points[hover].tip}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
