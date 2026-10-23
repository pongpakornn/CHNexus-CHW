"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { MonthChart, ShareBars, type MonthPoint } from "@/components/ui/Charts";
import { Icon, type IconName } from "@/components/icons";
import { Card, Loading, PageBody, PageHeader } from "@/components/ui/Page";
import { api } from "@/lib/api";

type StockRow = { stkId: number; code: string; name: string; items: number; maxCount: number; minCount: number };
type Cards = { stocks: StockRow[]; totals: { stocks: number; items: number; max: number; min: number }; time: string; canStore: boolean };
type Charts = { month: string; year: number; customers: { name: string; amount: number; percentage: number }[]; months: (MonthPoint & { month: number })[] };
type Kind = "STOCK" | "PRODUCT" | "MAX" | "MIN";

const CARD: Record<Kind, { title: string; tone: string; icon: IconName; pick: string; filter?: string }> = {
  STOCK: { title: "STOCK", tone: "var(--accent)", icon: "warehouse", pick: "Select a stock" },
  PRODUCT: { title: "PRODUCT ALL", tone: "var(--info)", icon: "cube", pick: "Products by stock" },
  MAX: { title: "MAX PRODUCT", tone: "var(--success)", icon: "trendUp", pick: "Over MAX by stock", filter: "OVER_MAX" },
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

// แท่งเล็กแสดงจำนวนของแต่ละคลัง (ข้อมูลจริงจากการ์ด ไม่ใช่แนวโน้มตามเวลา)
function StockBars({ values, tone }: { values: { code: string; v: number }[]; tone: string }) {
  const max = Math.max(1, ...values.map((x) => x.v));
  return (
    <div className="flex h-11 shrink-0 items-end gap-[3px]" aria-hidden="true">
      {values.map((x) => (
        <span
          key={x.code}
          title={`${x.code}: ${x.v.toLocaleString()}`}
          className="w-2 rounded-t-[3px] transition-[height] duration-500"
          style={{ height: `${Math.max(8, (x.v / max) * 100)}%`, background: `linear-gradient(${tone}, ${tint(tone, 45)})` }}
        />
      ))}
    </div>
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
  const note = (k: Kind) =>
    !cards ? "" : k === "PRODUCT" ? `in ${cards.totals.stocks} stocks` : k === "MAX" ? `${pct(cards.totals.max)} of products` : k === "MIN" ? `${pct(cards.totals.min)} of products` : "";
  const toggle = (k: Kind) => {
    setFolded(false);
    setOpen((o) => (o === k ? null : k));
  };

  return (
    <PageBody>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(CARD) as Kind[]).map((k) => {
          const c = CARD[k];
          const on = open === k;
          const v = valueOf(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-expanded={on}
              className={`group relative min-h-[148px] overflow-hidden rounded-2xl border bg-surface p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${on ? "" : "border-line/60"}`}
              style={on ? { borderColor: c.tone, boxShadow: `0 0 0 1px ${c.tone}, 0 12px 28px -14px ${c.tone}`, background: `linear-gradient(135deg, ${tint(c.tone, 9)}, var(--surface) 60%)` } : undefined}
            >
              {k === "STOCK" ? (
                <span className="pointer-events-none absolute -bottom-4 -right-3 transition group-hover:scale-105" style={{ color: tint(c.tone, 22) }}>
                  <Icon name="warehouse" className="size-32" />
                </span>
              ) : (
                <span className="pointer-events-none absolute right-4 top-4 grid size-14 place-items-center rounded-2xl" style={{ background: tint(c.tone, 8), color: tint(c.tone, 45) }}>
                  <Icon name={c.icon} className="size-8" />
                </span>
              )}
              <div className="relative flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: tint(c.tone, 14), color: c.tone }}>
                  <Icon name={c.icon} className="size-[22px]" />
                </span>
                <span className="text-[12px] font-extrabold uppercase tracking-wide text-ink">{c.title}</span>
              </div>
              <div className="relative mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-3xl font-extrabold tabular-nums md:text-[34px]" style={{ color: k === "STOCK" ? "var(--ink)" : c.tone }}>
                    {typeof v === "number" ? v.toLocaleString() : v}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                    {k === "STOCK" ? (
                      <>
                        {on ? "Hide stocks" : "View by stock"}
                        <Icon name="chevron" className={`size-3 transition-transform ${on ? "-rotate-90" : ""}`} />
                      </>
                    ) : (
                      <span className="normal-case tracking-normal">{note(k)}</span>
                    )}
                  </div>
                </div>
                {k !== "STOCK" && cards && cards.stocks.length > 1 && <StockBars values={cards.stocks.map((s) => ({ code: s.code, v: rowValue(k, s) }))} tone={c.tone} />}
              </div>
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

      <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
        <Card title={`CUSTOMER ORDER • ${charts?.month ?? ""}`} bodyClass="p-4">
          {!charts ? <Loading /> : <ShareBars rows={charts.customers} empty="ยังไม่มี Order ของเดือนนี้" />}
        </Card>
        <Card title={`FORECAST / ORDER / DELIVERY • ${charts?.year ?? ""}`} bodyClass="p-4">
          {!charts ? <Loading /> : <MonthChart data={charts.months} year={charts.year} />}
        </Card>
      </div>
    </PageBody>
  );
}
