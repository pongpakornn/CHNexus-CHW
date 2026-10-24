"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STOCK_TYPES, stockIcon } from "@/lib/stockIcons";
import { StatusLamp } from "./StatusLamp";
import { STATUS_COLOR, cardTone, type Product, type Stock } from "./types";

type Kind = "MAX" | "MIN" | "BOX" | "QTY" | "PCS";
type Stat = { kind: Kind; label: string; get: (p: Product) => string };

// ค่าบนการ์ดตามคอลัมน์ที่คลังเลือกแสดง เรียงแบบตาราง
function statsOf(s: Stock): Stat[] {
  const list: Stat[] = [];
  let box = false;
  const order = (s.columnOrder ?? "").split(",").map((x) => x.trim().toUpperCase());
  for (const k of [...order, "NO", "IMAGE", "CUSTOMER", "CODE", "PARTA", "PARTB", "PARTNO", "MODEL", "NAME", "MAXMIN", "QTY", "BOX", "COIL", "PCS", "REMARK"].filter((x, i, a) => x && a.indexOf(x) === i)) {
    if (k === "MAXMIN" && s.useMaxMin) list.push({ kind: "MAX", label: s.maxHeader, get: (p) => p.max }, { kind: "MIN", label: s.minHeader, get: (p) => p.min });
    else if (k === "QTY" && s.colQty) list.push({ kind: "QTY", label: s.qtyHeader, get: (p) => p.qty });
    else if ((k === "BOX" || k === "COIL") && (s.colStockBox || s.countCoil) && !box) {
      list.push({ kind: "BOX", label: s.boxHeader, get: (p) => p.stockBox });
      box = true;
    } else if (k === "PCS" && s.colStockPcs) list.push({ kind: "PCS", label: "STOCK (PCS)", get: (p) => p.stockPcs });
  }
  return list;
}

const num = (v: string) => Number((v ?? "").replace(/,/g, "")) || 0;
const IMG = "/images/store/";

// สี / ไอคอนของช่องตัวเลข: คลัง Material = ไอคอนม้วน Coil ลูกศรขึ้น / ลง + ตุ้มน้ำหนัก KG · คลังอื่น = ไอคอนเส้นสีตามช่อง
const TILE: Record<Kind, { color: string; soft: string }> = {
  MAX: { color: "#0552aa", soft: "#e8f0fc" },
  MIN: { color: "#10785c", soft: "#e6f5ef" },
  BOX: { color: "#6d4fd1", soft: "#f0ebfd" },
  QTY: { color: "#e46c12", soft: "#fff1e5" },
  PCS: { color: "#0e7490", soft: "#e4f6fa" },
};

function TileIcon({ kind, coil, unit }: { kind: Kind; coil: boolean; unit: string }) {
  const img = coil && kind === "MAX" ? "coil-max" : coil && kind === "MIN" ? "coil-min" : kind === "QTY" && unit === "KG" ? "kg" : "";
  // eslint-disable-next-line @next/next/no-img-element
  if (img) return <img src={IMG + img + ".webp"} alt="" className="tile-ic h-[26px] w-[26px] shrink-0 object-contain" draggable={false} />;
  const d: Record<Kind, React.ReactNode> = {
    MAX: <path d="M4 17l6-6 4 4 6-7M14 8h6v6" />,
    MIN: <path d="M4 7l6 6 4-4 6 7M14 16h6v-6" />,
    BOX: (
      <>
        <path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
        <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.2l8.4 4.6" />
      </>
    ),
    QTY: (
      <>
        <path d="M12 3l9 5-9 5-9-5z" />
        <path d="M3 13l9 5 9-5" />
      </>
    ),
    PCS: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="tile-ic h-[24px] w-[24px] shrink-0" fill="none" stroke={TILE[kind].color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d[kind]}
    </svg>
  );
}

// "MAX (COIL)" -> ["MAX", "(COIL)"]
const splitLabel = (l: string) => {
  const m = /^(.*?)\s*(\(.*\))$/.exec(l ?? "");
  return m ? [m[1], m[2]] : [l, ""];
};

type Look = {
  stats: Stat[];
  coil: boolean;
  pic: boolean;
  art: string;
  artTile: string | null;
  tint: string;
  unit: string;
  basis: Kind | null;
  width: number;
  title: (p: Product) => string;
  custLine: boolean;
  pdLine: boolean;
  useMaxMin: boolean;
  colName: boolean;
};

// หน้าตาการ์ดตามประเภทคลัง (STOCK TYPE) - Material = ภาพม้วน Coil + ไอคอน Coil · ประเภทอื่น = ไอคอนประเภทในกรอบสีประจำคลัง
function lookOf(s: Stock): Look {
  const stats = statsOf(s);
  const coil = s.stockType === "MATERIAL" || (!s.stockType && s.countCoil);
  const [typeIcon, tint] = stockIcon(s.code, 0, s.stockType);
  const type = STOCK_TYPES.find((t) => t.value === s.stockType);
  const unit = (s.unitDisplay ?? "").replace(/\./g, "").trim().toUpperCase();
  const basis = !s.useMaxMin ? null : ["COIL", "BOX"].includes(s.maxMinBasis) && stats.some((x) => x.kind === "BOX") ? "BOX" : s.maxMinBasis === "PCS" && stats.some((x) => x.kind === "PCS") ? "PCS" : "QTY";
  return {
    stats,
    coil,
    pic: s.cardStyle === "IMAGE",
    art: coil ? IMG + "coil-art.webp" : (type?.icon ?? typeIcon),
    artTile: coil ? null : tint,
    tint,
    unit,
    basis,
    width: Math.max(440, stats.length * 118 + 40),
    title: (p) => (s.colPartNo ? p.partNo : s.colCode ? p.partCode : s.colPartA ? p.partA : s.colPartB ? p.partB : p.partCode),
    custLine: s.colCustomer && s.groupBy !== "CUSTOMER",
    pdLine: s.colCode && s.colPartNo, // หัวข้อใหญ่เป็น PART NO -> PD CODE แสดงบรรทัดแยก
    useMaxMin: s.useMaxMin,
    colName: s.colName,
  };
}

// 📊 แถบระดับสต็อก: ยอดคงเหลือเทียบ MAX + ขีด MIN (หน่วยเดียวกับ MAX-MIN ของคลัง)
function Gauge({ p, look }: { p: Product; look: Look }) {
  const max = num(p.max);
  if (!look.basis || max <= 0) return null;
  const st = look.stats.find((x) => x.kind === look.basis);
  const cur = num(st ? st.get(p) : p.qty);
  const min = num(p.min);
  const pct = Math.min(100, (cur / max) * 100);
  const c = STATUS_COLOR(p.stockStatus);
  return (
    <div className="mt-2 pr-[118px]" title={`STOCK ${cur.toLocaleString()} / MIN ${min.toLocaleString()} / MAX ${max.toLocaleString()}`}>
      <div className="relative h-2 overflow-hidden rounded-full bg-[#ebe6f3]">
        <div className="gauge-fill absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, cur > 0 ? 3 : 0)}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${c} 55%, white), ${c})` }} />
        {min > 0 && min < max && <span className="absolute inset-y-0 w-0.5 bg-[#2d2a32]/45" style={{ left: `${(min / max) * 100}%` }} />}
      </div>
      <div className="mt-0.5 flex justify-between text-[9.5px] font-bold tracking-wide text-[#8a8490]">
        <span>STOCK {Math.round(pct)}%</span>
        <span>MIN {p.min || "0"} · MAX {p.max}</span>
      </div>
    </div>
  );
}

// 🃏 การ์ดสินค้า 1 ใบ (memo: เลื่อนแถบแล้วการ์ดเดิมไม่วาดใหม่)
const ShowCard = memo(function ShowCard({ p, look }: { p: Product; look: Look }) {
  const tone = cardTone(p.stockStatus);
  const photo = look.pic && p.imageUrl;
  return (
    <div
      className="show-card relative flex h-[244px] shrink-0 flex-col overflow-hidden rounded-[22px] p-4"
      style={{
        width: look.width,
        background: `linear-gradient(135deg, #ffffff 0%, color-mix(in srgb, ${look.tint} 9%, white) 52%, color-mix(in srgb, #ec4899 7%, white) 100%)`,
        borderColor: `color-mix(in srgb, ${tone.line} 30%, #ece6f5)`,
      }}
    >
      {/* ภาพประจำการ์ด: รูปสินค้า (แบบ IMAGE) หรือภาพตามประเภทคลัง */}
      <div className="show-art pointer-events-none absolute right-3 top-6 grid h-[112px] w-[112px] place-items-center">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl!} alt="" loading="lazy" decoding="async" className="h-[104px] w-[104px] rounded-2xl bg-white object-contain p-1 shadow-[0_8px_20px_-12px_rgb(60_40_120/0.5)]" draggable={false} />
        ) : look.artTile ? (
          <span className="grid h-[84px] w-[84px] place-items-center rounded-[24px] opacity-90" style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${look.artTile} 55%, white), ${look.artTile})`, boxShadow: `0 14px 26px -14px ${look.artTile}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={look.art} alt="" className="h-[52px] w-[52px] object-contain" draggable={false} />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={look.art} alt="" className="h-[112px] w-[112px] object-contain opacity-80" draggable={false} />
        )}
      </div>
      {look.useMaxMin && <StatusLamp status={p.stockStatus} size={22} className="!absolute right-3 top-3 z-[1]" />}

      <div className="relative min-w-0 pr-[118px]">
        <div className="flex items-center gap-1.5">
          <span className="max-w-[45%] truncate rounded-full bg-[#4c8df6] px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-[0_4px_10px_-6px_#4c8df6]">{p.groupKey || "-"}</span>
          {look.useMaxMin && (
            <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wide text-white" style={{ background: tone.line, boxShadow: `0 4px 10px -6px ${tone.line}` }}>
              {tone.label}
            </span>
          )}
        </div>
        {look.custLine && <div className="mt-1 truncate text-[11px] font-bold text-[#6f6976]">{p.customer}</div>}
        {look.pdLine && <div className="mt-1 truncate text-[12px] font-bold text-accent">{p.partCode}</div>}
        <div className="mt-1 truncate text-[22px] font-black leading-tight text-[#1e2a5a]">{look.title(p) || "-"}</div>
        {look.colName && <div className="truncate text-[13px] font-semibold text-[#6f7590]">{p.partName}</div>}
      </div>
      <Gauge p={p} look={look} />

      {look.stats.length > 0 && (
        <div className="mt-auto grid gap-2 pt-2" style={{ gridTemplateColumns: `repeat(${look.stats.length}, minmax(0, 1fr))` }}>
          {look.stats.map((st) => {
            const [main, sub] = splitLabel(st.label);
            const t = TILE[st.kind];
            return (
              <div key={st.kind} className="show-tile min-w-0 rounded-[14px] bg-white/90 px-2 pb-1.5 pt-2 shadow-[0_6px_16px_-12px_rgb(60_40_120/0.45)]">
                <div className="flex items-center gap-1.5">
                  <TileIcon kind={st.kind} coil={look.coil} unit={look.unit} />
                  <span className="flex min-w-0 flex-col text-[10.5px] font-extrabold leading-[1.15]" style={{ color: t.color }} title={st.label}>
                    <span className="truncate">{main}</span>
                    {sub && <span className="truncate text-[9px] font-bold opacity-75">{sub}</span>}
                  </span>
                </div>
                <div className="mt-1 truncate text-center text-[21px] font-black tabular-nums leading-none" style={{ color: t.color }}>
                  {st.get(p) || "-"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// 🃏 แถบการ์ดสินค้าเลื่อนซ้ายวน (SHOW CARD): วางการ์ดพอเต็มความกว้าง + 1 ใบ ใบซ้ายสุดพ้นขอบ -> ต่อท้ายด้วยสินค้าถัดไป
//    วนครบทุกสินค้า · สินค้าน้อยจนแสดงครบในแถบเดียว = หยุดนิ่ง · ความเร็ว = SPEED x 2.5
//    เมาส์ชี้ = ค่อย ๆ ชะลอจนหยุด (ออก = ค่อย ๆ เร่งกลับ) · พ้นจอ / แท็บซ่อน = ไม่คำนวณ (ไม่กินเครื่องตอนทำงานอื่น)
export const ShowCards = memo(function ShowCards({ rows, stock: s, speed }: { rows: Product[]; stock: Stock; speed: number }) {
  const look = useMemo(() => lookOf(s), [s]);
  const slot = look.width + 14;

  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const shift = useRef(0);
  const hover = useRef(false);
  const visible = useRef(true);
  const startRef = useRef(0);
  const [start, setStart] = useState(0);
  const [w, setW] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    ro.observe(el);
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const still = rows.length * slot <= w;
  const count = still ? rows.length : Math.min(rows.length + 1, Math.ceil(w / slot) + 1);

  useEffect(() => {
    if (still) return;
    let raf = 0;
    let last = performance.now();
    let vel = 1; // 0..1 ของความเร็วเต็ม (ไว้ชะลอ / เร่งแบบนุ่ม ๆ)
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible.current) {
        vel += ((hover.current ? 0 : 1) - vel) * Math.min(1, dt * 5);
        if (vel > 0.002) {
          shift.current -= speed * 2.5 * vel * dt;
          if (shift.current <= -slot) {
            shift.current += slot;
            startRef.current = (startRef.current + 1) % rows.length;
            setStart(startRef.current); // ย้ายใบซ้ายสุดไปต่อท้าย (ตั้งตำแหน่งหลังวาดใหม่)
          } else if (track.current) track.current.style.transform = `translate3d(${shift.current}px,0,0)`;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [still, speed, slot, rows.length]);

  useLayoutEffect(() => {
    if (track.current) track.current.style.transform = `translate3d(${still ? 0 : shift.current}px,0,0)`;
  }, [start, still]);

  const items = Array.from({ length: count }, (_, i) => ({ n: start + i, p: rows[(start + i) % rows.length] }));

  return (
    <div
      ref={wrap}
      className="show-strip relative h-[262px] overflow-hidden"
      onPointerEnter={(e) => e.pointerType === "mouse" && (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
    >
      <div ref={track} className="absolute top-2 flex gap-[14px] will-change-transform">
        {items.map(({ n, p }) => (
          <ShowCard key={n} p={p} look={look} />
        ))}
      </div>
    </div>
  );
});
