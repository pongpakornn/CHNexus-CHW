"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { useToast } from "@/components/Toasts";
import { MonthChart, type MonthPoint } from "@/components/ui/Charts";
import { CustomerDonut } from "@/components/ui/CustomerDonut";
import { Icon, type IconName } from "@/components/icons";
import { Card, Loading, PageBody, PageHeader } from "@/components/ui/Page";
import { api } from "@/lib/api";

type StockRow = { stkId: number; code: string; name: string; items: number; maxCount: number; minCount: number };
type Cards = { stocks: StockRow[]; totals: { stocks: number; items: number; max: number; min: number }; time: string; canStore: boolean };
type Charts = { month: string; year: number; customers: { name: string; amount: number; percentage: number }[]; months: (MonthPoint & { month: number })[] };
type Kind = "STOCK" | "PRODUCT" | "MAX" | "MIN";

const CARD: Record<Kind, { title: string; tone: string; icon: IconName; pick: string; art?: string; filter?: string }> = {
  STOCK: { title: "STOCK", tone: "var(--accent)", icon: "home", pick: "Select a stock", art: "/images/dashboard/warehouse.webp" },
  PRODUCT: { title: "PRODUCT ALL", tone: "var(--info)", icon: "cube", pick: "Products by stock", art: "/images/dashboard/box.webp" },
  MAX: { title: "MAX PRODUCT", tone: "var(--success)", icon: "cube", pick: "Over MAX by stock", art: "/images/dashboard/box-green.webp", filter: "OVER_MAX" },
  MIN: { title: "MIN PRODUCT", tone: "var(--danger)", icon: "triangle", pick: "Under MIN by stock", filter: "UNDER_MIN" },
};

// ไอคอน + สีของแต่ละคลัง (ดูจากท้ายรหัสคลัง) - คลังที่ไม่รู้จักใช้กล่อง + สีตามลำดับ
const STOCK_ICON: Record<string, [IconName, string]> = {
  MAT: ["cube", "#8b5cf6"],
  PANTA: ["building", "#3b82f6"],
  PC: ["desktop", "#06b6d4"],
  SP: ["wrench", "#f59e0b"],
  CPN: ["squares", "#14b8a6"],
  SUB: ["storefront", "#ec4899"],
  CONS: ["archive", "#6366f1"],
  MSH: ["document", "#2563eb"],
};
const FALLBACK = ["#8b5cf6", "#3b82f6", "#06b6d4", "#f59e0b", "#14b8a6", "#ec4899"];
const stockIcon = (code: string, i: number): [IconName, string] => STOCK_ICON[code.split("-").pop()!.toUpperCase()] ?? ["cube", FALLBACK[i % FALLBACK.length]];
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;

// เส้นเล็กเทียบจำนวนของแต่ละคลัง (ข้อมูลจริงจากการ์ด เรียงตามคลัง ไม่ใช่แนวโน้มตามเวลา)
function Spark({ values, tone, className = "" }: { values: { code: string; v: number }[]; tone: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const W = 120;
  const H = 40;
  const max = Math.max(1, ...values.map((x) => x.v));
  const pts = values.map((x, i) => [(i / Math.max(1, values.length - 1)) * W, H - 3 - (x.v / max) * (H - 8)] as const);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`pointer-events-auto overflow-visible ${className}`} preserveAspectRatio="none" role="img" aria-label="จำนวนแยกตามคลัง">
      <title>{values.map((x) => `${x.code}: ${x.v.toLocaleString()}`).join("\n")}</title>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={tone} stopOpacity=".22" />
          <stop offset="1" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={tone} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// 📊 DASHBOARD (DashboardView): การ์ด 4 ใบแยกตามคลัง (อัพเดททุก 3 วินาที) + Order ของลูกค้าเดือนนี้ + Forecast / Order / Delivery ทั้งปี
export default function DashboardPage() {
  const toast = useToast();
  const router = useRouter();
  const [cards, setCards] = useState<Cards | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const [folded, setFolded] = useState(false);

  const loadCards = useCallback(async () => {
    try {
      setCards(await api<Cards>("/dashboard/cards"));
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, []);
  const loadCharts = useCallback(() => api<Charts>("/dashboard/charts").then(setCharts), []);

  useEffect(() => {
    loadCharts().catch((e) => toast.show("ERROR", e.message, "error"));
    const t0 = setTimeout(loadCards, 0);
    const t = setInterval(() => !document.hidden && loadCards(), 3000);
    const c = setInterval(() => !document.hidden && loadCharts().catch(() => {}), 60_000);
    return () => (clearTimeout(t0), clearInterval(t), clearInterval(c));
  }, [loadCards, loadCharts, toast]);

  const valueOf = (k: Kind) => (!cards ? "-" : k === "STOCK" ? cards.totals.stocks : k === "PRODUCT" ? cards.totals.items : k === "MAX" ? cards.totals.max : cards.totals.min);
  const rowValue = (k: Kind, s: StockRow) => (k === "MAX" ? s.maxCount : k === "MIN" ? s.minCount : s.items);
  const pct = (n: number) => (cards && cards.totals.items > 0 ? `${((n / cards.totals.items) * 100).toFixed(1)}%` : "-");
  const noteOf = (k: Kind) =>
    !cards || k === "STOCK"
      ? null
      : k === "PRODUCT"
        ? { main: `${cards.totals.stocks} stocks`, sub: "across inventories" }
        : { main: pct(k === "MAX" ? cards.totals.max : cards.totals.min), sub: "of all products" };
  const toggle = (k: Kind) => {
    setFolded(false);
    setOpen((o) => (o === k ? null : k));
  };

  return (
    // จอใหญ่: หน้าสูงเต็มจอ แถวกราฟยืดลงไปจนสุด ไม่เหลือพื้นที่ว่างด้านล่าง
    <PageBody className="xl:min-h-full">
      <PageHeader
        icon="/icons/Dashboard.png"
        title="Dashboard"
        subtitle={`Inventory overview${charts ? ` • ${charts.month}` : ""}`}
        actions={
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <span className={`size-2 rounded-full ${cards ? "bg-success" : "bg-line"}`} />
            {cards ? `Last updated ${cards.time}` : "Loading..."}
            <button
              type="button"
              onClick={() => (loadCards(), loadCharts().catch(() => {}))}
              className="grid size-8 place-items-center rounded-lg text-ink-soft transition hover:bg-surface-2 hover:text-ink active:rotate-180"
              aria-label="Refresh"
              title="Refresh"
            >
              <Icon name="sync" className="size-[18px]" />
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(CARD) as Kind[]).map((k) => {
          const c = CARD[k];
          const on = open === k;
          const v = valueOf(k);
          const n = noteOf(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-expanded={on}
              className="group relative min-h-[152px] overflow-hidden rounded-[22px] border border-[#e2e4f0] bg-surface p-5 shadow-[0_1px_2px_rgb(20_25_60/0.04),0_12px_30px_-20px_rgb(40_45_110/0.28)] hover:shadow-[0_1px_2px_rgb(20_25_60/0.05),0_20px_40px_-22px_rgb(40_45_110/0.38)] text-left transition duration-300 hover:-translate-y-0.5"
              style={
                on
                  ? { borderColor: tint(c.tone, 70), boxShadow: `0 0 0 1px ${tint(c.tone, 55)}, 0 18px 40px -22px ${c.tone}`, background: `linear-gradient(120deg, ${tint(c.tone, 7)} 0%, var(--surface) 45%, ${tint(c.tone, 12)} 100%)` }
                  : undefined
              }
            >
              {/* ภาพประกอบมุมขวา */}
              {c.art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.art}
                  alt=""
                  draggable={false}
                  className={`pointer-events-none absolute select-none transition duration-500 group-hover:scale-105 ${k === "STOCK" ? "-bottom-2 -right-3 w-[52%] max-w-[190px]" : "right-3 top-2 w-[84px] opacity-80"}`}
                />
              ) : (
                <span className="pointer-events-none absolute right-4 top-4 grid size-[60px] place-items-center rounded-full" style={{ background: `radial-gradient(circle, ${tint(c.tone, 14)}, ${tint(c.tone, 4)} 70%, transparent)`, color: tint(c.tone, 60) }}>
                  <Icon name={c.icon} className="size-8" />
                </span>
              )}
              {k === "STOCK" && <Icon name="chevronUp" className={`absolute right-4 top-4 size-4 text-ink-soft transition-transform duration-300 ${on ? "" : "rotate-180"}`} />}

              <div className="relative flex items-start gap-3.5">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px] shadow-sm" style={{ background: `linear-gradient(145deg, ${tint(c.tone, 22)}, ${tint(c.tone, 10)})`, color: c.tone }}>
                  <Icon name={c.icon} className="size-6" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold uppercase tracking-wide text-[#1f2350]">{c.title}</div>
                  <div className="mt-0.5 text-[34px] font-extrabold leading-tight tabular-nums" style={{ color: k === "MAX" || k === "MIN" ? c.tone : "#1f2350" }}>
                    {typeof v === "number" ? v.toLocaleString() : v}
                  </div>
                  {k === "STOCK" ? (
                    <div className="mt-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#1f2350]">
                      {on ? "Hide stocks" : "View by stock"}
                      <Icon name="chevron" className={`size-3 transition-transform ${on ? "-rotate-90" : ""}`} />
                    </div>
                  ) : (
                    n && (
                      <div className="mt-1 leading-tight">
                        <div className="text-[13px] font-extrabold tabular-nums" style={{ color: c.tone }}>
                          {n.main}
                        </div>
                        <div className="text-[11px] font-semibold text-ink-soft">{n.sub}</div>
                      </div>
                    )
                  )}
                </div>
              </div>
              {k !== "STOCK" && cards && cards.stocks.length > 1 && (
                <Spark className="absolute bottom-5 right-4 w-[46%] max-w-[130px]" tone={c.tone} values={cards.stocks.map((s) => ({ code: s.code, v: rowValue(k, s) }))} />
              )}
            </button>
          );
        })}
      </div>

      {open && cards && (
        <section className="menu-pop overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="grid size-9 place-items-center rounded-xl" style={{ background: tint(CARD[open].tone, 14), color: CARD[open].tone }}>
              <Icon name={CARD[open].icon} className="size-5" />
            </span>
            <h3 className="font-extrabold text-ink">{CARD[open].pick}</h3>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: tint(CARD[open].tone, 12), color: CARD[open].tone }}>
              {cards.stocks.length} inventories
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => setFolded((f) => !f)} className="grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-surface-2 hover:text-ink" aria-label={folded ? "Expand" : "Collapse"}>
                <Icon name="chevronUp" className={`size-4 transition-transform ${folded ? "rotate-180" : ""}`} />
              </button>
              <button type="button" onClick={() => setOpen(null)} className="grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-surface-2 hover:text-ink" aria-label="Close">
                <Icon name="xMark" className="size-4" />
              </button>
            </div>
          </div>
          {!folded && (
            <div className="grid gap-3 border-t border-line/60 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.stocks.map((s, i) => {
                const [ic, col] = stockIcon(s.code, i);
                return (
                  <button
                    key={s.stkId}
                    type="button"
                    disabled={!cards.canStore}
                    onClick={() => router.push(`/store?stk=${s.stkId}${CARD[open].filter ? `&f=${CARD[open].filter}` : ""}`)}
                    className="group flex items-center gap-3 rounded-xl border border-line/60 bg-surface px-3.5 py-3 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:border-line enabled:hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: tint(col, 14), color: col }}>
                      <Icon name={ic} className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-extrabold text-ink">{s.code}</div>
                      <div className="truncate text-xs text-ink-soft">{s.name}</div>
                    </div>
                    {open !== "STOCK" && (
                      <span className="text-lg font-extrabold tabular-nums" style={{ color: CARD[open].tone }}>
                        {rowValue(open, s).toLocaleString()}
                      </span>
                    )}
                    {cards.canStore && <Icon name="chevron" className="size-4 shrink-0 text-ink-soft transition group-hover:translate-x-0.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        {!charts ? (
          <Card title="CUSTOMER ORDER">
            <Loading />
          </Card>
        ) : (
          <CustomerDonut title={`CUSTOMER ORDER • ${charts.month}`} period={charts.month} rows={charts.customers} empty="ยังไม่มี Order ของเดือนนี้" fill />
        )}
        <Card title={`FORECAST / ORDER / DELIVERY • ${charts?.year ?? ""}`} className="flex flex-col" bodyClass="flex flex-1 flex-col p-4">
          {!charts ? <Loading /> : <MonthChart data={charts.months} year={charts.year} fill />}
        </Card>
      </div>
    </PageBody>
  );
}
