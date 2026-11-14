"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { shortN } from "@/lib/pp";

// 📊 กราฟ Plan vs Actual (SVG)
//   แท่ง = ไล่สี + มุมบนมน โตขึ้นจากฐานทีละแท่ง · เส้น = ลากจากซ้ายไปขวา + เงาเรือง + พื้นไล่สีใต้เส้น (area)
//   วันหยุด = ลายเส้นทแยงจาง ๆ · วันนี้ = เส้นประ TODAY · ชี้ / แตะ = เส้น crosshair + จุดขยาย + กล่องค่าลอยแบบกระจกฝ้า
//   เปลี่ยนโหมด / ข้อมูล = แท่ง / เส้น / แกน Y เลื่อนไปค่าใหม่นุ่ม ๆ · กด Legend = ซ่อน / แสดง · ลดการเคลื่อนไหว = ไม่มีแอนิเมชัน
// kind "mark" = ขีดแนวนอนเหนือแต่ละคอลัมน์ (เช่น MAX CAPACITY ของเครื่อง) ไม่ลากเส้นต่อกันข้ามเครื่อง
export type Series = { key: string; label: string; kind: "bar" | "line" | "mark"; color: string; color2?: string; values: (number | null)[]; alert?: boolean[]; dashed?: boolean; area?: boolean; fmt?: (v: number) => string; unit?: string };

// ป้ายแกน X ยาว (เช่น "Group 1.7.2- POLISH(PL21) Auto") = ตัดเป็นหลายบรรทัดตามความกว้างของแท่ง ไม่ซ้อนกัน · ยาวเกิน = … (ชื่อเต็มอยู่ในป้ายตอนชี้)
const CH = 6.2; // ความกว้างโดยประมาณต่อ 1 ตัวอักษร (ตัว 11px)
function wrapText(t: string, max: number, maxLines: number): string[] {
  const words = t.replace(/-\s*/g, "- ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > max) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      out.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!w) continue;
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length <= maxLines) return out;
  const keep = out.slice(0, maxLines);
  keep[maxLines - 1] = keep[maxLines - 1].slice(0, Math.max(1, max - 1)) + "…";
  return keep;
}

type Props = {
  cats: string[];
  sub?: string[];
  off?: boolean[]; // คอลัมน์วันหยุด
  today?: number; // index ของวันนี้ (เส้น TODAY)
  series: Series[];
  height?: number;
  tipTitle?: (i: number) => React.ReactNode;
  tipExtra?: (i: number) => React.ReactNode;
  onPick?: (i: number) => void;
  empty?: string; // ข้อความเมื่อไม่มีข้อมูลเลย
  ariaLabel: string;
};

function nice(max: number) {
  const raw = (Math.max(max, 1e-9) * 1.1) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const st = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { step: st, top: Math.max(st, Math.ceil((max * 1.1) / st) * st) };
}

// เส้นโค้งนุ่ม (Catmull-Rom -> Bezier)
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

// แท่งมุมบนมน ฐานตรง
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(6, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function PpChart({ cats, sub, off, today, series, height, tipTitle, tipExtra, onPick, empty, ariaLabel }: Props) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hide, setHide] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState(-1);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0, flip: false });
  const tapSkip = useRef(false); // มือถือ: แตะครั้งแรก = ดูค่า · แตะซ้ำแท่งเดิม = เปิด (onPick)
  const lastY = useRef(-999); // ป้ายตามเมาส์แนวตั้งแบบหยาบ (ไม่ render กราฟใหม่ทุกพิกเซลที่ขยับ)

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = cats.length;
  const ml = W && W < 560 ? 40 : 54;
  const iw = Math.max(0, W - ml - 12);
  const band = n ? iw / n : 0;
  // ป้ายแกน X: พอดีแท่ง = บรรทัดเดียว · ยาวกว่าแท่ง = ตัดหลายบรรทัด (ไม่เกิน 3) · แท่งแคบมาก = เว้นป้ายเป็นช่วง ๆ + ตัดท้าย
  const longest = Math.max(0, ...cats.map((c) => c.length));
  const fit = Math.floor((band * 0.94) / CH);
  const wrap = !sub && n > 0 && longest > fit && fit >= 5;
  const labels = useMemo(() => (wrap ? cats.map((c) => wrapText(c, fit, 3)) : null), [wrap, cats, fit]);
  const nl = labels ? Math.max(1, ...labels.map((l) => l.length)) : 1;
  const H = (height ?? (W && W < 560 ? 260 : 340)) + (nl - 1) * 12;
  const m = { t: 18, r: 12, b: sub ? 42 : 20 + nl * 12, l: ml };
  const shown = series.filter((s) => !hide[s.key]);
  const max = Math.max(0, ...shown.flatMap((s) => s.values.map((v) => v ?? 0)));
  const hasData = series.some((s) => s.values.some((v) => (v ?? 0) > 0));
  const { step, top } = nice(max);
  const sx = (i: number) => m.l + (i + 0.5) * band;
  const sy = (v: number) => m.t + (H - m.t - m.b) * (1 - v / top);
  const base = H - m.b;
  const bars = shown.filter((s) => s.kind === "bar");
  const lines = shown.filter((s) => s.kind === "line");
  const marks = shown.filter((s) => s.kind === "mark");
  const bw = Math.max(2, Math.min(28, (band * 0.72) / Math.max(1, bars.length)));
  const short = 14; // แท่งแคบมาก: ป้ายตัดเหลือ 14 ตัวอักษร แล้วเว้นป้ายเป็นช่วงให้ไม่ชนกัน
  const labelEvery = wrap ? 1 : Math.max(1, Math.ceil((n * (sub ? 30 : Math.max(40, Math.min(longest, short) * CH + 10))) / Math.max(1, iw)));
  const cut = (c: string) => (sub || c.length <= short || longest * CH <= band * 0.94 ? c : c.slice(0, short - 1) + "…");
  const ticks = useMemo(() => Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step), [top, step]);
  const dl = (i: number) => (reduce ? 0 : Math.min(i * 0.02, 0.5));
  const T = (d: number, delay = 0) => ({ duration: reduce ? 0 : d, ease: EASE, delay });

  function at(clientX: number, clientY: number) {
    const r = box.current!.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - m.l) / band);
    if (i < 0 || i >= n || !band) return hover !== -1 && setHover(-1);
    const y = Math.max(8, Math.min(clientY - r.top - 30, H - 120));
    // แท่งเดิม + เมาส์ขยับนิดเดียว = ไม่ต้องวาดใหม่ (เดิมวาดกราฟทั้งชุดทุกครั้งที่ขยับเมาส์ = กระตุก)
    if (i === hover && Math.abs(y - lastY.current) < 28) return;
    lastY.current = y;
    setHover(i);
    setTipPos({ x: sx(i), y, flip: sx(i) > W * 0.6 });
  }

  return (
    <div className="pp-chart">
      <div className="pp-legend" role="group" aria-label="Series">
        {series.map((s, i) => (
          <motion.button
            key={s.key}
            type="button"
            aria-pressed={!hide[s.key]}
            onClick={() => setHide((h) => ({ ...h, [s.key]: !h[s.key] }))}
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={T(0.35, 0.1 + i * 0.06)}
            whileTap={{ scale: 0.95 }}
          >
            <i className={s.kind === "mark" ? "is-mark" : s.kind === "line" ? (s.dashed ? "is-dash" : "is-line") : ""} style={{ "--c": s.color, "--c2": s.color2 ?? s.color } as React.CSSProperties} />
            {s.label}
          </motion.button>
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
                <linearGradient key={s.key} id={`${uid}-g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color2 ?? s.color} />
                  <stop offset="1" stopColor={s.color} />
                </linearGradient>
              ))}
              {series.map((s) =>
                s.kind === "mark" ? (
                  <linearGradient key={"m" + s.key} id={`${uid}-m-${s.key}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={s.color} stopOpacity={0.75} />
                    <stop offset="0.5" stopColor={s.color2 ?? s.color} />
                    <stop offset="1" stopColor={s.color} stopOpacity={0.75} />
                  </linearGradient>
                ) : null,
              )}
              {series.map((s) => (
                <linearGradient key={"a" + s.key} id={`${uid}-a-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="1" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
              <linearGradient id={`${uid}-g-alert`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f87171" />
                <stop offset="1" stopColor="#dc2626" />
              </linearGradient>
              <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#fff7ed" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#fdba74" strokeWidth="1.2" strokeOpacity="0.45" />
              </pattern>
            </defs>

            {off?.map((o, i) => (o ? <rect key={"o" + i} x={m.l + i * band + 1} y={m.t} width={Math.max(0, band - 2)} height={base - m.t} rx={4} fill={`url(#${uid}-hatch)`} opacity={0.75} /> : null))}

            {ticks.map((t, i) => (
              <motion.g key={t} initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} transition={T(0.4, i * 0.04)}>
                <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className={t === 0 ? "pp-base" : "pp-grid"} />
                <text x={m.l - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="pp-ax">
                  {shortN(t)}
                </text>
              </motion.g>
            ))}

            {/* แถบ / เส้น crosshair ตามจุดที่ชี้ */}
            <AnimatePresence>
              {hover >= 0 && (
                <motion.g key="hv" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <motion.rect y={m.t} height={base - m.t} rx={8} className="pp-band" animate={{ x: m.l + hover * band, width: band }} initial={false} transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                  <motion.line y1={m.t} y2={base} className="pp-cross" animate={{ x1: sx(hover), x2: sx(hover) }} initial={false} transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                </motion.g>
              )}
            </AnimatePresence>

            {today != null && today >= 0 && today < n && (
              <g className="pp-today">
                <line x1={sx(today)} x2={sx(today)} y1={m.t - 4} y2={base} />
                <rect x={sx(today) - 22} y={m.t - 16} width={44} height={14} rx={7} />
                <text x={sx(today)} y={m.t - 6} textAnchor="middle">
                  TODAY
                </text>
              </g>
            )}

            {cats.map((c, i) =>
              i % labelEvery === 0 || hover === i ? (
                <text key={"x" + i} x={sx(i)} y={base + 15} textAnchor="middle" className={`pp-ax ${hover === i ? "is-on" : ""} ${off?.[i] ? "is-off" : ""} ${today === i ? "is-today" : ""}`}>
                  <title>{c}</title>
                  {labels
                    ? labels[i].map((l, k) => (
                        <tspan key={k} x={sx(i)} dy={k ? 12 : 0}>
                          {l}
                        </tspan>
                      ))
                    : cut(c)}
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
                const w = Math.max(1, bw - 2);
                return (
                  <motion.path
                    key={`${s.key}-${i}`}
                    fill={`url(#${uid}-g-${s.alert?.[i] ? "alert" : s.key})`}
                    className="pp-bar"
                    initial={reduce ? false : { d: barPath(x, base, w, 0) }}
                    animate={{ d: barPath(x, y, w, base - y), opacity: hover < 0 || hover === i ? 1 : 0.4 }}
                    transition={{ ...T(0.7, dl(i)), opacity: { duration: 0.2 } }}
                  />
                );
              }),
            )}

            {/* 🔶 ขีดเพดาน (MAX CAPACITY) : กว้างกว่ากลุ่มแท่งเล็กน้อย · แท่งแผนสูงเกินขีด = เกินกำลังเครื่อง */}
            {/* ⚠ แท่งเกินกำลัง (alert) = ป้าย OVER เหนือแท่ง ไม่ใช้สีอย่างเดียว */}
            {bars.map((s, k) =>
              s.alert?.map((on, i) => {
                const v = s.values[i];
                if (!on || v == null || v <= 0) return null;
                const x = sx(i) - (bw * bars.length) / 2 + k * bw + bw / 2;
                return (
                  <motion.text key={`ov-${s.key}-${i}`} x={x} textAnchor="middle" className="pp-over" initial={reduce ? false : { y: base, opacity: 0 }} animate={{ y: sy(v) - 7, opacity: 1 }} transition={T(0.7, 0.3 + dl(i))}>
                    OVER
                  </motion.text>
                );
              }),
            )}

            {/*   ขีด = แคปซูลไล่สี ขอบขาว · เส้นประจางจากยอดแท่งแรก (แผน) ขึ้นไปถึงขีด = กำลังที่ยังเหลือ */}
            {marks.map((s) =>
              s.values.map((v, i) => {
                if (v == null || v <= 0) return null;
                const half = Math.min(band * 0.42, (bw * Math.max(1, bars.length)) / 2 + 6);
                const pv = bars[0]?.values[i] ?? null;
                const on = hover < 0 || hover === i;
                return (
                  <g key={`${s.key}-${i}`} className="pp-mark">
                    {pv != null && pv > 0 && pv < v && (
                      <motion.line
                        x1={sx(i)}
                        x2={sx(i)}
                        stroke={s.color}
                        strokeWidth={1.5}
                        strokeDasharray="2 4"
                        strokeLinecap="round"
                        initial={reduce ? false : { y1: sy(pv), y2: sy(pv), opacity: 0 }}
                        animate={{ y1: sy(pv) - 3, y2: sy(v) + 4, opacity: on ? 0.55 : 0.2 }}
                        transition={{ ...T(0.8, 0.35 + dl(i)), opacity: { duration: 0.2 } }}
                      />
                    )}
                    <motion.g initial={reduce ? false : { x: sx(i), y: base, opacity: 0 }} animate={{ x: sx(i), y: sy(v), opacity: on ? 1 : 0.5 }} transition={{ ...T(0.8, 0.15 + dl(i)), opacity: { duration: 0.2 } }}>
                      <rect x={-half} y={-3.5} width={half * 2} height={7} rx={3.5} fill={`url(#${uid}-m-${s.key})`} className="pp-mark-cap" />
                      {hover === i && <circle r={4.5} fill="#fff" stroke={s.color} strokeWidth={2.2} />}
                    </motion.g>
                  </g>
                );
              }),
            )}

            {lines.map((s) => {
              const pts = s.values.map((v, i) => (v == null ? null : ([sx(i), sy(v)] as [number, number]))).filter((p): p is [number, number] => !!p);
              if (!pts.length) return null;
              const d = curve(pts);
              const area = `${d} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`;
              return (
                <g key={s.key}>
                  {s.area && <motion.path d={area} fill={`url(#${uid}-a-${s.key})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1, d: area }} transition={T(0.9, 0.35)} />}
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.dashed ? 2 : 2.6}
                    strokeLinecap="round"
                    strokeDasharray={s.dashed ? "6 6" : undefined}
                    className={s.dashed ? "" : "pp-glow"}
                    style={{ "--c": s.color } as React.CSSProperties}
                    // เส้นประ: pathLength จะทับ strokeDasharray -> ใช้จางเข้าแทน
                    initial={reduce ? false : s.dashed ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
                    animate={s.dashed ? { opacity: 1, d } : { pathLength: 1, opacity: 1, d }}
                    transition={T(1.1)}
                  />
                  {!s.dashed &&
                    s.values.map((v, i) =>
                      v == null || (pts.length > 16 && hover !== i && i !== pts.length - 1) ? null : (
                        <motion.circle
                          key={i}
                          fill="#fff"
                          stroke={s.color}
                          strokeWidth={2.4}
                          initial={reduce ? false : { r: 0 }}
                          animate={{ cx: sx(i), cy: sy(v), r: hover === i ? 6 : 3.5 }}
                          transition={{ cx: T(0.6), cy: T(0.6), r: { type: "spring", stiffness: 500, damping: 22 } }}
                        />
                      ),
                    )}
                </g>
              );
            })}
          </svg>
        )}

        <AnimatePresence>
          {W > 0 && !hasData && empty && (
            <motion.div className="pp-chart-empty" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={T(0.4, 0.3)}>
              <span>📭</span>
              {empty}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hover >= 0 && (
            <motion.div
              className="pp-tip"
              initial={{ opacity: 0, scale: 0.94, x: tipPos.flip ? tipPos.x - 236 : tipPos.x + 16, y: tipPos.y }}
              animate={{ opacity: 1, scale: 1, x: tipPos.flip ? tipPos.x - 236 : tipPos.x + 16, y: tipPos.y }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <h4>{tipTitle ? tipTitle(hover) : cats[hover]}</h4>
              {series.map((s) => {
                const v = s.values[hover];
                return (
                  <div key={s.key} className={`r ${hide[s.key] ? "is-hidden" : ""}`}>
                    <i style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <b>
                      {v == null ? "–" : s.fmt ? s.fmt(v) : v.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      {v != null && s.unit ? <small className="u"> {s.unit}</small> : null}
                    </b>
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

// 🍩 วงแหวนความคืบหน้า (0-1 · เกิน 1 = วงเต็ม + สีเดิม)
export function Ring({ frac, color, color2, size = 64, stroke = 7, label }: { frac: number; color: string; color2?: string; size?: number; stroke?: number; label?: React.ReactNode }) {
  const reduce = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac || 0));
  return (
    <div className="pp-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color2 ?? color} />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.12} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={reduce ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - f) }}
          transition={{ duration: reduce ? 0 : 1.2, ease: EASE, delay: 0.2 }}
        />
      </svg>
      {label != null && <span>{label}</span>}
    </div>
  );
}

// 〰 กราฟเส้นเล็ก (sparkline) พื้นไล่สี
export function Spark({ values, color, w = 120, h = 34 }: { values: (number | null)[]; color: string; w?: number; h?: number }) {
  const reduce = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const v = values.map((x) => x ?? 0);
  const mx = Math.max(1, ...v);
  if (!v.some((x) => x > 0)) return <svg width={w} height={h} className="pp-spark" aria-hidden />;
  const pts = v.map((x, i) => [(i / Math.max(1, v.length - 1)) * (w - 4) + 2, h - 3 - (x / mx) * (h - 8)] as [number, number]);
  const d = curve(pts);
  return (
    <svg width={w} height={h} className="pp-spark" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.3} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path d={`${d} L${w - 2},${h} L2,${h} Z`} fill={`url(#${id})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1.2, ease: EASE, delay: 0.2 }} />
    </svg>
  );
}
