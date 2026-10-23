"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

// 📈 FORECAST / ORDER / DELIVERY รายเดือน (SVG + React ไม่มี library)
//   ORDER / DELIVERY = แท่งไล่สีคู่ · FORECAST = เส้นโค้ง + พื้นใต้เส้น (แกนเดียว หน่วยเดียวกัน)
//   ปุ่ม Chip เปิด/ปิดแต่ละชุด (แท่งยืด/หดนุ่มๆ) · CHART / TABLE · ชี้ / แตะ / ลูกศรซ้ายขวา = ไฮไลต์เดือน + Tooltip
//   เดือนที่ยังไม่มีข้อมูล (0 ทั้งหมด) = ไม่วาดแท่ง และเส้น FORECAST หยุดที่เดือนล่าสุด ไม่ดิ่งลง 0
export type MonthPoint = { label: string; order: number; delivery: number; forecast: number };
type Key = "order" | "delivery" | "forecast";
type Vis = Record<Key, boolean>;
type Frame = { intro: number; vf: Record<Key, number>; disp: (MonthPoint | null)[] };

export const SERIES = {
  order: { label: "ORDER", a: "#4f8dff", b: "#1b3fae" },
  delivery: { label: "DELIVERY", a: "#8fe3ff", b: "#1597e6" },
  forecast: { label: "FORECAST", a: "#0a1f5c", b: "#0a1f5c" },
} as const;

const fmt = new Intl.NumberFormat("en-US");
const short = (v: number) =>
  v === 0 ? "0" : v >= 1e6 ? `${Number((v / 1e6).toFixed(2))}M` : v >= 1e3 ? `${Number((v / 1e3).toFixed(1))}K` : `${Math.round(v)}`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const hasData = (d: MonthPoint) => d.order > 0 || d.delivery > 0 || d.forecast > 0;

// แกน Y 4 ช่องเป็นเลขกลม (1 / 2 / 2.5 / 5 x 10^n)
function niceTop(v: number) {
  if (v <= 0) return 4;
  const raw = (v * 1.08) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return ([1, 2, 2.5, 5, 10].find((f) => f * p >= raw) ?? 10) * p * 4;
}

function barPath(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// เส้นโค้งผ่านทุกจุด (Catmull-Rom แบบนุ่ม)
function curve(p: [number, number][]) {
  let d = `M${p[0][0]},${p[0][1]}`;
  const t = 0.18;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i], b = p[i], c = p[i + 1], e = p[i + 2] ?? c;
    d += `C${b[0] + (c[0] - a[0]) * t},${b[1] + (c[1] - a[1]) * t} ${c[0] - (e[0] - b[0]) * t},${c[1] - (e[1] - b[1]) * t} ${c[0]},${c[1]}`;
  }
  return d;
}

const toDisp = (data: MonthPoint[]) => data.map((d) => (hasData(d) ? { ...d } : null));

// fill = สูงเต็มกล่อง (ให้สูงเท่าการ์ดข้างๆ ในแถวเดียวกัน)
export function MonthChart({ data, year, fill = false }: { data: MonthPoint[]; year?: number | string; fill?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const [vis, setVis] = useState<Vis>({ order: true, delivery: true, forecast: true });
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState(-1);
  const [tipY, setTipY] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [frame, setFrame] = useState<Frame>(() => ({ intro: 0, vf: { order: 1, delivery: 1, forecast: 1 }, disp: toDisp(data).map(() => null) }));
  const stage = useRef<HTMLDivElement>(null);

  // ---- แอนิเมชัน: วนเฟรมเดียว ค่าค่อยๆ วิ่งเข้าหาเป้าหมาย หยุดเองเมื่อนิ่ง
  const work = useRef<{ intro: number; t0: number | null; vf: Record<Key, number>; disp: (MonthPoint | null)[]; raf: number; last: number }>({
    intro: 0, t0: null, vf: { order: 1, delivery: 1, forecast: 1 }, disp: [], raf: 0, last: 0,
  });
  const target = useRef<{ vis: Vis; data: MonthPoint[] }>({ vis, data });

  const kick = useCallback(() => {
    const w = work.current;
    if (w.raf) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const loop = (now: number) => {
      w.raf = 0;
      const dt = Math.min(0.05, w.last ? (now - w.last) / 1000 : 0.016);
      w.last = now;
      let busy = false;
      if (w.intro < 1) {
        w.t0 ??= now;
        w.intro = reduce ? 1 : Math.min(1, (now - w.t0) / 1600);
        busy = w.intro < 1;
      }
      const k = reduce ? 1 : 1 - Math.exp(-dt / 0.28);
      const kv = reduce ? 1 : 1 - Math.exp(-dt / 0.09);
      const { vis: tv, data: td } = target.current;
      w.disp = td.map((t, i) => {
        if (!hasData(t)) return null;
        const cur = w.disp[i] ?? { ...t, order: 0, delivery: 0, forecast: t.forecast };
        const next = { ...t };
        (["order", "delivery", "forecast"] as Key[]).forEach((key) => {
          const df = t[key] - cur[key];
          if (Math.abs(df) > 0.5) {
            next[key] = cur[key] + df * k;
            busy = true;
          }
        });
        return next;
      });
      (["order", "delivery", "forecast"] as Key[]).forEach((key) => {
        const df = (tv[key] ? 1 : 0) - w.vf[key];
        if (Math.abs(df) > 0.002) {
          w.vf[key] += df * kv;
          busy = true;
        } else w.vf[key] = tv[key] ? 1 : 0;
      });
      setFrame({ intro: w.intro, vf: { ...w.vf }, disp: w.disp });
      if (busy) w.raf = requestAnimationFrame(loop);
      else w.last = 0;
    };
    w.raf = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    target.current = { vis, data };
    if (!work.current.disp.length) work.current.disp = toDisp(data);
    kick();
  }, [vis, data, kick]);

  useEffect(() => {
    const w = work.current;
    return () => {
      cancelAnimationFrame(w.raf);
      w.raf = 0; // Strict Mode เรียก Effect ซ้ำ: ล้างค่าไว้ให้เริ่มวนใหม่ได้
    };
  }, []);

  // ---- ขนาดตามกล่อง (Responsive)
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (setWidth(el.clientWidth), setHeight(el.clientHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const W = Math.max(300, width || 760);
  const H = fill && height > 0 ? Math.max(260, height) : W < 520 ? 280 : W < 800 ? 320 : 360;
  const m = { t: 22, r: W < 520 ? 10 : 18, b: 34, l: W < 520 ? 44 : 56 };
  const n = Math.max(1, data.length);
  const ih = H - m.t - m.b;
  const band = (W - m.l - m.r) / n;
  const top = useMemo(() => niceTop(Math.max(0, ...data.flatMap((d) => [d.order, d.delivery, d.forecast]))), [data]);
  const sx = (i: number) => m.l + (i + 0.5) * band;
  const sy = (v: number) => m.t + ih * (1 - v / top);
  const bw = clamp(band * 0.3, 8, 30);
  const gap = clamp(band * 0.05, 3, 6);
  const { intro, vf, disp } = frame;

  const pts: [number, number, number][] = [];
  disp.forEach((d, i) => d && d.forecast > 0 && pts.push([sx(i), sy(d.forecast), i]));
  const line = pts.length > 1 ? curve(pts.map((p) => [p[0], p[1]])) : "";
  const last = pts[pts.length - 1];

  const pick = (clientX: number) => {
    const r = stage.current?.querySelector("svg")?.getBoundingClientRect();
    if (!r) return -1;
    const x = (clientX - r.left) * (W / r.width);
    const i = Math.floor((x - m.l) / band);
    return i < 0 || i >= n ? -1 : i;
  };
  const onMove = (e: React.PointerEvent) => {
    const i = pick(e.clientX);
    setHover(i);
    const sr = stage.current!.getBoundingClientRect();
    setTipY(e.clientY - sr.top);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowRight: hover < 0 ? 0 : Math.min(n - 1, hover + 1),
      ArrowLeft: hover < 0 ? n - 1 : Math.max(0, hover - 1),
      Home: 0,
      End: n - 1,
    };
    if (e.key === "Escape") return setHover(-1);
    if (!(e.key in map)) return;
    e.preventDefault();
    setHover(map[e.key]);
    setTipY(m.t + ih * 0.35);
  };

  // ---- Tooltip
  // แสดงเฉพาะชุดที่เปิดอยู่ (ปุ่ม Filter) - อัตราส่วนแสดงเมื่อเปิดทั้ง 2 ชุดที่ใช้คำนวณ
  const shown = (["forecast", "order", "delivery"] as Key[]).filter((k) => vis[k]);
  const hd = hover >= 0 && shown.length ? data[hover] : null;
  const showVsFc = !!hd && vis.order && vis.forecast && hd.forecast > 0;
  const showRate = !!hd && vis.order && vis.delivery && hd.order > 0;
  const tipLeftSide = hover >= 0 && sx(hover) + band / 2 + 236 > W;
  const tip = hd && (
    <div
      className="fc-tip pointer-events-none absolute z-10 min-w-[220px] rounded-2xl border border-white/15 px-3.5 py-3 text-[#f3f7ff] shadow-[0_18px_40px_-10px_rgba(0,5,25,.45)]"
      style={{
        left: tipLeftSide ? sx(hover) - band / 2 - 8 : sx(hover) + band / 2 + 8,
        top: clamp(tipY - 80, 8, H - 170),
        translate: tipLeftSide ? "-100% 0" : "0 0",
      }}
    >
      <div className="mb-2 flex justify-between gap-3 text-[13px] font-extrabold">
        {hd.label}
        <span className="font-semibold opacity-60">{year ?? ""}</span>
      </div>
      {!hasData(hd) ? (
        <div className="text-xs font-semibold opacity-75">ยังไม่มีข้อมูล</div>
      ) : (
        <>
          {shown.map((k) => (
            <div key={k} className="flex items-center gap-2 py-0.5 text-[12.5px]">
              <i className="inline-block size-2.5 rounded-[3px]" style={{ background: k === "forecast" ? "#9cc4ff" : SERIES[k].a }} />
              <span className="font-semibold opacity-75">{SERIES[k].label}</span>
              <b className="ml-auto font-extrabold tabular-nums">{fmt.format(Math.round(hd[k]))}</b>
            </div>
          ))}
          {(showVsFc || showRate) && <hr className="my-2 border-white/15" />}
          {showVsFc && (
            <div className="flex justify-between gap-3 text-xs">
              <span>Order vs Forecast</span>
              <b className={hd.order >= hd.forecast ? "text-[#3fe3ae]" : "text-[#ff8aa0]"}>
                {hd.order >= hd.forecast ? "+" : ""}
                {(((hd.order - hd.forecast) / hd.forecast) * 100).toFixed(1)}%
              </b>
            </div>
          )}
          {showRate && (
            <div className="flex justify-between gap-3 text-xs">
              <span>Delivery rate</span>
              <b className="tabular-nums">{((hd.delivery / hd.order) * 100).toFixed(1)}%</b>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-3" : "grid gap-3"}>
      {/* ปุ่ม Filter + CHART / TABLE */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`flex flex-wrap gap-2 transition-opacity ${view === "table" ? "invisible" : ""}`}>
          {(Object.keys(SERIES) as Key[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={vis[k]}
              onClick={() => setVis((v) => ({ ...v, [k]: !v[k] }))}
              className={`fc-chip inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:-translate-y-px hover:bg-[#e8f0ff] active:scale-95 ${vis[k] ? "" : "opacity-45 grayscale"}`}
            >
              {k === "forecast" ? (
                <span className="relative inline-block h-0 w-[18px] rounded border-t-[3px] border-[#0a1f5c]">
                  <span className="absolute left-[5px] top-[-6.5px] size-2 rounded-full border-2 border-white bg-[#0a1f5c]" />
                </span>
              ) : (
                <span className="inline-block size-[9px] rounded-[3px]" style={{ background: `linear-gradient(${SERIES[k].a},${SERIES[k].b})` }} />
              )}
              {SERIES[k].label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-full bg-[#e8f0ff] p-[3px]" role="group" aria-label="View">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => (setView(v), setHover(-1))}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-all duration-300 active:scale-95 ${
                view === v ? "bg-surface text-[#1f5eff] shadow-[0_2px_8px_rgba(20,60,160,.18)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-soft">
                {["Month", "Forecast", "Order", "Delivery", "Order vs Forecast"].map((h, i) => (
                  <th key={h} className={`border-b border-line px-3 py-2.5 font-bold ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const p = d.forecast > 0 ? ((d.order - d.forecast) / d.forecast) * 100 : null;
                return (
                  <tr key={d.label} className="transition-colors hover:bg-[#e8f0ff]">
                    <td className="border-b border-line px-3 py-2.5 font-bold">{d.label}</td>
                    {hasData(d) ? (
                      <>
                        <td className="border-b border-line px-3 py-2.5 text-right font-semibold">{fmt.format(d.forecast)}</td>
                        <td className="border-b border-line px-3 py-2.5 text-right font-semibold">{fmt.format(d.order)}</td>
                        <td className="border-b border-line px-3 py-2.5 text-right font-semibold">{fmt.format(d.delivery)}</td>
                        <td className={`border-b border-line px-3 py-2.5 text-right font-bold ${p === null ? "text-ink-soft" : p >= 0 ? "text-success" : "text-danger"}`}>
                          {p === null ? "-" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="border-b border-line px-3 py-2.5 text-right font-medium text-ink-soft">
                        ยังไม่มีข้อมูล
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={stage} className={`fc-chart relative ${fill ? "min-h-[300px] flex-1" : ""}`}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            role="img"
            aria-label={`Forecast, order and delivery by month ${year ?? ""}`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHover(-1)}
            className={`block overflow-visible outline-none ${fill ? "absolute inset-x-0 top-0" : ""}`}
          >
            <defs>
              <linearGradient id={`o${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES.order.a} />
                <stop offset="1" stopColor={SERIES.order.b} />
              </linearGradient>
              <linearGradient id={`d${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES.delivery.a} />
                <stop offset="1" stopColor={SERIES.delivery.b} />
              </linearGradient>
              <linearGradient id={`a${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES.forecast.a} stopOpacity=".16" />
                <stop offset="1" stopColor={SERIES.forecast.a} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* เส้นตาราง + แกน */}
            {[0, 1, 2, 3, 4].map((s) => {
              const v = (top / 4) * s;
              return (
                <g key={s}>
                  <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className="stroke-[#e6ecf7]" />
                  <text x={m.l - 10} y={sy(v) + 4} textAnchor="end" className="fill-ink-soft text-[12px] font-semibold">
                    {short(v)}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => (
              <text key={d.label} x={sx(i)} y={H - 10} textAnchor="middle" className={`text-[12.5px] transition-[fill] ${hover === i ? "fill-ink font-extrabold" : "fill-ink-soft font-semibold"}`}>
                {d.label}
              </text>
            ))}

            {/* แถบไฮไลต์เดือนที่ชี้ (เลื่อนตามนุ่มๆ) */}
            <rect
              x={0}
              y={m.t}
              width={band}
              height={ih}
              rx={10}
              className="fc-band fill-[rgba(31,94,255,.07)]"
              style={{ transform: `translateX(${sx(Math.max(0, hover)) - band / 2}px)`, opacity: hover >= 0 ? 1 : 0 }}
            />

            {/* แท่ง ORDER / DELIVERY */}
            {disp.map((d, i) => {
              if (!d) return null;
              const e = ease(clamp(intro * 1.6 - i * 0.07, 0, 1));
              const wO = bw * vf.order, wD = bw * vf.delivery, g = gap * Math.min(vf.order, vf.delivery);
              const x0 = sx(i) - (wO + wD + g) / 2;
              const hO = (ih * d.order) / top * e * vf.order, hD = (ih * d.delivery) / top * e * vf.delivery;
              const dim = hover >= 0 && hover !== i ? 0.35 : 1;
              return (
                <g key={i} style={{ opacity: dim }} className="transition-opacity duration-300">
                  {wO > 0.6 && hO > 0.6 && <path d={barPath(x0, m.t + ih - hO, wO, hO, Math.min(7, wO / 2.2))} fill={`url(#o${uid})`} />}
                  {wD > 0.6 && hD > 0.6 && <path d={barPath(x0 + wO + g, m.t + ih - hD, wD, hD, Math.min(7, wD / 2.2))} fill={`url(#d${uid})`} />}
                </g>
              );
            })}
            <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} className="stroke-[#cfd8ea]" />

            {/* เส้น FORECAST */}
            {line && (
              <g pointerEvents="none" style={{ opacity: vf.forecast }}>
                <path d={`${line}L${last[0]},${m.t + ih}L${pts[0][0]},${m.t + ih}Z`} fill={`url(#a${uid})`} style={{ opacity: ease(clamp(intro * 1.4 - 0.3, 0, 1)) }} />
                <path d={line} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ease(intro)} fill="none" stroke="#fff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
                <path d={line} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ease(intro)} fill="none" stroke={SERIES.forecast.a} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" />
                {pts.map(([x, y, i], j) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={4.5 * ease(clamp(intro * (pts.length + 1) - j - 0.5, 0, 1))}
                    fill={SERIES.forecast.a}
                    stroke="#fff"
                    strokeWidth={2.5}
                    className={`fc-mark ${hover === i ? "is-hover" : ""}`}
                  />
                ))}
                {last && intro > 0.95 && (
                  <text
                    x={last[0] + 80 > W ? Math.min(W - m.r, last[0] + 6) : last[0] + 14}
                    y={last[1] - 14}
                    textAnchor={last[0] + 80 > W ? "end" : "start"}
                    className="fill-ink text-[12px] font-extrabold tracking-wider"
                  >
                    FORECAST
                  </text>
                )}
              </g>
            )}

            {/* พื้นที่รับเมาส์ / นิ้ว */}
            <rect
              x={m.l}
              y={m.t}
              width={W - m.l - m.r}
              height={ih}
              fill="transparent"
              className="touch-pan-y"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={(e) => e.pointerType === "mouse" && setHover(-1)}
            />
          </svg>
          {tip}
        </div>
      )}
    </div>
  );
}
