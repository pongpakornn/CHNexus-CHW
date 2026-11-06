"use client";

import { Fragment, useEffect, useRef, useState } from "react";

// 🃏 การ์ดตัวเลขบนหน้าคลัง (หน้าตาเดียวกับการ์ด Dashboard): MAX / MIN / ยังไม่ตั้ง (NO ORDER) / SHOW ALL
//   กดการ์ด = กรองตารางเหมือนปุ่มเดิมของ WPF (เปลี่ยนแค่หน้าตา) · ด้านล่าง: คลังที่นับ Coil = MASTER COIL / COIL NO ของสินค้าในการ์ดนั้น (COIL | KG | TON) · คลังอื่น = จำนวนสินค้า

// ยอด Coil: จำนวน / KG / TON ของ MASTER COIL และ COIL NO - ทั้งคลัง + แยกตามการ์ด (max / min / noSet = null ถ้าคลังไม่มีสถานะ)
export type CoilPart = { masterCount: number; masterKg: string; masterTon: string; childCount: number; childKg: string; childTon: string };
export type CoilSum = (CoilPart & { max: CoilPart | null; min: CoilPart | null; noSet: CoilPart | null }) | null;
type Kind = "MAX" | "MIN" | "NOSET" | "ALL";

const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;

const CARD: Record<Kind, { tone: string; value: string; text: string; soft: string; soft2: string; badge: [string, string]; icon?: string; art: string }> = {
  MAX: { tone: "var(--success)", value: "var(--success)", text: "#1b5e20", soft: "#e8f5e9", soft2: "#f3faf3", badge: ["#4ade80", "#15803d"], icon: "/images/dashboard/ic-max.png", art: "/images/dashboard/box-green.webp" },
  MIN: { tone: "var(--danger)", value: "var(--danger)", text: "#b71c1c", soft: "#ffebee", soft2: "#fff6f7", badge: ["#fb7185", "#e11d48"], icon: "/images/dashboard/ic-min.png", art: "/images/dashboard/warning.webp" },
  NOSET: { tone: "var(--warning)", value: "var(--warning)", text: "#c2410c", soft: "#fff3e0", soft2: "#fff9f0", badge: ["#fbbf24", "#f97316"], art: "/images/dashboard/notset.webp" },
  ALL: { tone: "var(--info)", value: "#1f2350", text: "#0d47a1", soft: "#e3f2fd", soft2: "#f1f8fe", badge: ["#38bdf8", "#2563eb"], icon: "/images/dashboard/ic-product.png", art: "/images/dashboard/boxes.webp" },
};

// ตัวเลขวิ่งจากค่าเดิมไปค่าใหม่ (0.7 วินาที) - ค่าไม่เปลี่ยนก็ไม่วิ่ง
function useCountUp(target: number) {
  const [shown, setShown] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = still ? 1 : Math.min(1, (t - t0) / 700);
      cur.current = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

// ไอคอนเส้นขาว "เอกสาร + !" ของการ์ดยังไม่ตั้ง MAX-MIN (ชุดเดียวกับ ic-*.png)
function NoSetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
      <path d="M13.5 3 19 8.5V11" />
      <path d="M13.5 3v5.5H19" />
      <path d="M8.5 12.5h5M8.5 16h2.5" />
      <circle cx="17.5" cy="17.5" r="4" />
      <path d="M17.5 15.6v2.2M17.5 19.4v.01" />
    </svg>
  );
}

function StatCard({
  kind,
  title,
  value,
  total,
  hint,
  line = "",
  coil,
  active,
  onClick,
  delay,
  children,
}: {
  kind: Kind;
  title: string;
  value: number;
  total: number;
  hint: string;
  line?: string;
  coil?: CoilPart | null;
  active: boolean;
  onClick: () => void;
  delay: number;
  children?: React.ReactNode;
}) {
  const c = CARD[kind];
  const shown = useCountUp(value);
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="stat-card card-in group @container relative flex min-h-[148px] flex-col overflow-hidden rounded-[22px] border border-[#e2e4f0] bg-surface p-5 text-left shadow-[0_1px_2px_rgb(20_25_60/0.04),0_12px_30px_-20px_rgb(40_45_110/0.28)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgb(20_25_60/0.05),0_20px_40px_-22px_rgb(40_45_110/0.38)]"
      style={{
        animationDelay: `${delay}ms`,
        ...(active
          ? { borderColor: tint(c.tone, 70), boxShadow: `0 0 0 1px ${tint(c.tone, 55)}, 0 18px 40px -22px ${c.tone}`, background: `linear-gradient(120deg, ${tint(c.tone, 7)} 0%, var(--surface) 45%, ${tint(c.tone, 12)} 100%)` }
          : {}),
      }}
    >
      {/* ภาพประกอบมุมขวา: ลอยขึ้นลงช้าๆ ชี้แล้วขยาย */}
      <span className="pointer-events-none absolute right-3 top-2 w-[84px] transition duration-500 group-hover:-rotate-3 group-hover:scale-110">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.art} alt="" draggable={false} className="stat-art w-full select-none opacity-80" />
      </span>

      <div className="relative flex items-start gap-3.5">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-[15px] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-6"
          style={{ background: `linear-gradient(145deg, ${c.badge[0]}, ${c.badge[1]})`, boxShadow: `0 8px 18px -8px ${c.badge[1]}, inset 0 1px 0 rgb(255 255 255 / .35)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.icon ? <img src={c.icon} alt="" draggable={false} className="size-7 object-contain" /> : <NoSetIcon />}
        </span>
        <div className="min-w-0 pr-16">
          <div className="truncate text-[13px] font-extrabold uppercase tracking-wide text-[#1f2350]" title={title}>
            {title}
          </div>
          <div className="mt-0.5 text-[34px] font-extrabold leading-tight tabular-nums" style={{ color: c.value }}>
            {shown.toLocaleString()}
          </div>
        </div>
      </div>

      {children ?? (coil ? (
        <CoilLines sum={coil} kind={kind} />
      ) : (
        <div className="relative mt-auto flex flex-col gap-1.5 pt-2">
          <Line label={line} parts={[`${value.toLocaleString()} ITEMS`]} tone={c.text} bg={c.soft} delay={250} tip={hint} />
          <Line label="📦 ALL ITEMS" parts={[`${total.toLocaleString()} ITEMS`, total > 0 ? `${share.toFixed(1)}%` : "-"]} tone={c.text} bg={c.soft2} delay={330} tip="สินค้าทั้งหมดในคลัง และสัดส่วนของการ์ดนี้" />
        </div>
      ))}
    </button>
  );
}

// แถวจำนวนบนการ์ด: ชื่อ ซ้าย / ตัวเลขขวา (คั่นด้วยขีด) - ใช้ทั้งแถว Coil ของ SHOW ALL และจำนวนสินค้าของการ์ดอื่น
function Line({ label, parts, tone, bg, delay, tip }: { label: string; parts: string[]; tone: string; bg: string; delay: number; tip: string }) {
  const cut = label.indexOf(" ");
  const [icon, text] = cut > 0 ? [label.slice(0, cut), label.slice(cut + 1)] : ["", label];
  return (
    <div className="coil-line flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold" style={{ background: bg, color: tone, animationDelay: `${delay}ms` }} title={`${label}\n${tip}`}>
      {/* การ์ดแคบ (ต่ำกว่า 340px) เหลือแค่ไอคอนหน้าชื่อ · ตัวเลขไม่พอบรรทัดก็ตัดลงบรรทัดใหม่ (ชิดขวา) ไม่ล้นการ์ด */}
      <span className="flex min-w-0 shrink-0 items-center gap-1">
        <span className="shrink-0">{icon}</span>
        <span className="hidden truncate @min-[340px]:inline">{text}</span>
      </span>
      <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2">
        {parts.map((x, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="h-3 w-px shrink-0" style={{ background: tint(tone, 35) }} />}
            <span className="shrink-0 whitespace-nowrap tabular-nums">{x}</span>
          </Fragment>
        ))}
      </span>
    </div>
  );
}

// 🧲 MASTER COIL / 🌀 COIL NO : จำนวน | KG | TON
// สีแถวตามการ์ด: MASTER COIL = สีอ่อน / COIL NO = อ่อนกว่า
function CoilLines({ sum, kind }: { sum: CoilPart; kind: Kind }) {
  const c = CARD[kind];
  return (
    <div className="relative mt-auto flex flex-col gap-1.5 pt-2">
      <Line
        label="🧲 MASTER COIL"
        parts={[`${sum.masterCount.toLocaleString()} COIL`, `${sum.masterKg} KG`, `${sum.masterTon} TON`]}
        tone={c.text}
        bg={c.soft}
        delay={250}
        tip="Master coils in stock (not cut from another coil): number of coils, total weight (KG / TON)"
      />
      <Line
        label="🌀 COIL NO"
        parts={[`${sum.childCount.toLocaleString()} COIL`, `${sum.childKg} KG`, `${sum.childTon} TON`]}
        tone={c.text}
        bg={c.soft2}
        delay={330}
        tip="Coils cut from a master coil: number of coils, total weight (KG / TON)"
      />
    </div>
  );
}

export function StatCards({
  useMaxMin,
  notSet,
  thirdText,
  counts,
  coilSum,
  filter,
  showAllActive,
  onFilter,
  onShowAll,
}: {
  useMaxMin: boolean;
  notSet: boolean;
  thirdText: string;
  counts: { total: number; max: number; min: number; noOrder: number };
  coilSum: CoilSum;
  filter: string;
  showAllActive: boolean;
  onFilter: (f: string) => void;
  onShowAll: () => void;
}) {
  const c = counts;
  let i = 0;
  return (
    // คลังที่มี Coil แถวตัวเลขยาวกว่า -> 4 ใบในแถวเดียวเฉพาะจอกว้าง (2xl) จอเล็กกว่านั้น 2 ใบต่อแถว
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${useMaxMin ? (coilSum ? "2xl:grid-cols-4" : "xl:grid-cols-4") : ""}`}>
      {useMaxMin && <StatCard kind="MAX" title="MAX" value={c.max} total={c.total} hint="ถึง MAX / เกิน" line="📈 ถึง MAX / เกิน" coil={coilSum?.max} active={filter === "OVER_MAX"} onClick={() => onFilter("OVER_MAX")} delay={i++ * 70} />}
      {useMaxMin && <StatCard kind="MIN" title="MIN" value={c.min} total={c.total} hint="ต่ำกว่า MIN / หมด" line="📉 ต่ำกว่า MIN / หมด" coil={coilSum?.min} active={filter === "UNDER_MIN"} onClick={() => onFilter("UNDER_MIN")} delay={i++ * 70} />}
      <StatCard
        kind="NOSET"
        title={thirdText}
        value={c.noOrder}
        total={c.total}
        hint={notSet ? "ยังไม่ตั้ง MAX / MIN (ไม่อยู่ทั้ง MAX และ MIN)" : "ไม่อยู่ทั้ง MAX และ MIN"}
        line={notSet ? "⚪ ยังไม่ตั้ง MAX / MIN" : "⚪ ไม่อยู่ทั้ง MAX และ MIN"}
        coil={coilSum?.noSet}
        active={filter === "NO_ORDER"}
        onClick={() => onFilter("NO_ORDER")}
        delay={i++ * 70}
      />
      <StatCard kind="ALL" title="SHOW ALL" value={c.total} total={c.total} hint="สินค้าทั้งหมดในคลัง" active={showAllActive} onClick={onShowAll} delay={i++ * 70}>
        {coilSum ? (
          <CoilLines sum={coilSum} kind="ALL" />
        ) : (
          <div className="relative mt-auto pt-2 leading-tight">
            <div className="text-[13px] font-extrabold" style={{ color: "var(--info)" }}>
              ALL ITEMS
            </div>
            <div className="text-[11px] font-semibold text-ink-soft">ล้างตัวกรอง / หมวด / คำค้นหา</div>
          </div>
        )}
      </StatCard>
    </div>
  );
}
