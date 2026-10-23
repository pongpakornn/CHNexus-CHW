"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// 🍩 สัดส่วน Order ของลูกค้า: วงแหวนแสดงทุกลูกค้า (ชี้ดูได้ทุกชิ้น) · รายชื่อค้นหาได้ · CHART / TABLE
export type CustomerRow = { name: string; amount: number; percentage?: number };

// สีตามลำดับลูกค้า (มากไปน้อย) - เกินจำนวนสีจะวนซ้ำ
const COLORS = [
  "#2563eb", "#38bdf8", "#0f2f8f", "#60a5fa", "#0891b2", "#818cf8", "#14b8a6", "#93c5fd", "#64748b", "#a78bfa", "#22a6b3", "#f59e0b", "#10b981",
  "#6366f1", "#0ea5e9", "#8b5cf6", "#06b6d4", "#94a3b8", "#3b82f6", "#2dd4bf", "#a3a3a3", "#7c3aed", "#f97316", "#0d9488", "#cbd5e1",
];
// ชิ้นเล็กมากยังต้องชี้ได้: ทุกชิ้นได้มุมขั้นต่ำ แล้วแบ่งส่วนที่เหลือตามสัดส่วนจริง (ตัวเลข / % ที่แสดงเป็นค่าจริงเสมอ)
const MIN_DEG = 0.9;
const fmt = new Intl.NumberFormat("en-US");
// % จากระบบปัดทศนิยมไว้: ลูกค้าที่มียอดแต่ % ปัดเหลือ 0 แสดงเป็น <0.01%
const pctText = (v: number, amount: number, d = 1) => (amount > 0 && v < 0.005 ? "<0.01%" : `${v < 1 ? v.toFixed(2) : v.toFixed(d)}%`);
const C = 180;
const R2 = 146;
const R1 = 98;

const polar = (r: number, a: number) => {
  const rad = ((a - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
};
function arc(a0: number, a1: number) {
  const span = Math.min(a1 - a0, 359.99);
  const e = a0 + span;
  const [x1, y1] = polar(R2, a0), [x2, y2] = polar(R2, e), [x3, y3] = polar(R1, e), [x4, y4] = polar(R1, a0);
  const large = span > 180 ? 1 : 0;
  return `M${x1},${y1} A${R2},${R2} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${R1},${R1} 0 ${large} 0 ${x4},${y4} Z`;
}

// fill = จอใหญ่ (xl) ยืดวงแหวน + รายชื่อให้เต็มความสูงของการ์ด
export function CustomerDonut({ title, period, rows, empty = "ไม่มีข้อมูล", fill = false }: { title: React.ReactNode; period?: string; rows: CustomerRow[]; empty?: string; fill?: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1); // ลำดับลูกค้าที่ชี้อยู่
  const listRef = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);

  const total = rows.reduce((a, r) => a + r.amount, 0);
  const pctOf = (r: CustomerRow) => r.percentage ?? (total > 0 ? (r.amount / total) * 100 : 0);
  const slices = useMemo(() => rows.map((r, i) => ({ name: r.name, value: r.amount, color: COLORS[i % COLORS.length] })), [rows]);
  const minDeg = Math.min(MIN_DEG, 180 / Math.max(1, slices.length));
  const pointSlice = (i: number) => {
    setActive(i);
    listRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // วงแหวนค่อยๆ วาดรอบตอนเปิด
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const t = requestAnimationFrame(() => setP(1));
      return () => cancelAnimationFrame(t);
    }
    let raf = 0;
    let t0 = 0;
    const loop = (now: number) => {
      t0 ||= now;
      const k = Math.min(1, (now - t0) / 900);
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rows.length]);

  const list = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const act = active >= 0 ? slices[active] : null;

  const spans = slices.map((s) => (total > 0 ? (minDeg + (s.value / total) * (360 - minDeg * slices.length)) * p : 0));
  const segs = slices.map((s, i) => {
    const span = spans[i];
    const a0 = spans.slice(0, i).reduce((a, x) => a + x, 0);
    const mid = ((a0 + span / 2 - 90) * Math.PI) / 180;
    return { ...s, i, d: span > 0.05 ? arc(a0, a0 + span) : "", dx: Math.cos(mid) * 7, dy: Math.sin(mid) * 7 };
  });

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-primary">{title}</h3>
          <div className="text-xs font-semibold text-ink-soft">สัดส่วนยอด Order แยกตามลูกค้า</div>
        </div>
        <div className="ml-auto inline-flex rounded-full bg-[#e8f0ff] p-[3px]" role="group" aria-label="View">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => (setView(v), setActive(-1))}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-all duration-300 active:scale-95 ${
                view === v ? "bg-surface text-[#1f5eff] shadow-[0_2px_8px_rgba(20,60,160,.18)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm font-semibold text-ink-soft">{empty}</div>
      ) : view === "table" ? (
        <div className={fill ? "relative flex-1 xl:min-h-[380px]" : ""}>
          <div className={`view-in max-h-[520px] overflow-auto px-4 pb-4 ${fill ? "xl:absolute xl:inset-0 xl:max-h-none" : ""}`}>
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="text-[11px] uppercase tracking-wider text-ink-soft">
                  {["Customer", "Order", "Share"].map((h, i) => (
                    <th key={h} className={`border-b border-line px-3 py-2.5 font-bold ${i ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="transition-colors hover:bg-[#e8f0ff]">
                    <td className="border-b border-line px-3 py-2 font-bold">{r.name}</td>
                    <td className="border-b border-line px-3 py-2 text-right font-semibold">{fmt.format(r.amount)}</td>
                    <td className="border-b border-line px-3 py-2 text-right font-semibold">{pctText(pctOf(r), r.amount, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className={`view-in @container flex-1 ${fill ? "relative xl:min-h-[380px]" : ""}`}>
            <div className={`grid items-center gap-4 p-4 @[540px]:grid-cols-[minmax(220px,.9fr)_minmax(0,1.1fr)] ${fill ? "xl:absolute xl:inset-0 xl:grid-rows-[minmax(0,1fr)] xl:@[540px]:grid-cols-[minmax(240px,1.15fr)_minmax(250px,.85fr)]" : ""}`}>
              {/* วงแหวน */}
              <div className={`relative mx-auto aspect-square w-full max-w-[320px] ${fill ? "xl:max-h-full xl:max-w-[400px]" : ""}`}>
                <svg viewBox="0 0 360 360" className="size-full overflow-visible" role="img" aria-label="Customer order share" onMouseLeave={() => setActive(-1)}>
                  {segs.map((s) => (
                    <path
                      key={s.name}
                      d={s.d}
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={slices.length > 12 ? 1.25 : 2}
                      tabIndex={0}
                      aria-label={`${s.name}: ${fmt.format(s.value)}`}
                      onMouseEnter={() => pointSlice(s.i)}
                      onFocus={() => setActive(s.i)}
                      onBlur={() => setActive(-1)}
                      className="cursor-pointer outline-none transition-[opacity,transform] duration-200"
                      style={{ opacity: active < 0 || active === s.i ? 1 : 0.35, transform: active === s.i ? `translate(${s.dx}px,${s.dy}px)` : undefined }}
                    />
                  ))}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[30%] text-center">
                  <div className="max-w-full truncate text-[11px] font-extrabold uppercase tracking-[.08em] text-ink-soft">{act ? act.name : "Total Order"}</div>
                  <div className="text-[clamp(20px,3vw,28px)] font-extrabold tabular-nums tracking-tight text-[#0a1a3a]">{fmt.format(act ? act.value : total)}</div>
                  <div className="text-[11px] font-semibold text-ink-soft">{act ? pctText(pctOf(rows[active]), rows[active].amount) : period}</div>
                </div>
              </div>

              {/* รายชื่อลูกค้า */}
              <div ref={listRef} className={`grid h-[320px] content-start gap-1 overflow-auto pr-1 ${fill ? "xl:h-full" : ""}`}>
                {list.map(({ r, i }) => {
                  return (
                    <div
                      key={r.name}
                      data-i={i}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(-1)}
                      className={`grid grid-cols-[10px_minmax(60px,1fr)_auto_44px] items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 transition-colors ${active === i ? "bg-[#e8f0ff]" : "hover:bg-[#e8f0ff]"}`}
                    >
                      <span className="size-[9px] rounded-[3px]" style={{ background: slices[i]?.color }} />
                      <span className="truncate text-xs font-extrabold text-ink">{r.name}</span>
                      <span className="text-xs font-extrabold tabular-nums text-ink">{fmt.format(r.amount)}</span>
                      <span className="text-right text-[11px] font-semibold tabular-nums text-ink-soft">{pctText(pctOf(r), r.amount)}</span>
                    </div>
                  );
                })}
                {list.length === 0 && <div className="px-3 py-3 text-xs font-semibold text-ink-soft">ไม่พบลูกค้าที่ค้นหา</div>}
              </div>
            </div>
          </div>
          <div className="view-in flex flex-wrap items-center justify-between gap-2.5 px-4 pb-4 text-[11px] font-semibold text-ink-soft">
            <span>
              <b className="text-ink">{rows.length} ลูกค้า</b> · ชี้ที่วงแหวนหรือรายชื่อเพื่อดูยอดของแต่ละลูกค้า
            </span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาลูกค้า…"
              aria-label="Search customers"
              className="min-w-[150px] rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink outline-none focus:border-[#1f5eff] focus:ring-2 focus:ring-[#e8f0ff]"
            />
          </div>
        </>
      )}
    </section>
  );
}
