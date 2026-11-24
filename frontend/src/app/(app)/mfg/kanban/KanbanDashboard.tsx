"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { NumberTicker } from "@/components/ui/number-ticker";
import { CardStack, FlowChips, isReady, n0, PartImg, ReadyPill, Rise, useKanbanData, when, type Order } from "./shared";

// 📊 KANBAN › DASHBOARD (layout of flow-master /dashboard in the CHR-Nexus white-card style)
//   tiles · Andon (waits for the shop-floor page) · cards stuck 30+ min · card status summary
//   cards by customer (donut) · cards per zone (columns) · flow readiness per zone · Top 5 Kanban · Kanban status list · latest orders
type Slice = { label: string; value: number };
// fixed categorical order (never cycled): customers past 6 fold into "อื่น ๆ"
const PALETTE = ["#2563eb", "#0891b2", "#15803d", "#b45309", "#7c3aed", "#db2777"];
const OTHER = "#94a3b8";

const sumBy = (orders: Order[], key: (o: Order) => string): Slice[] => {
  const m = new Map<string, number>();
  for (const o of orders) m.set(key(o), (m.get(key(o)) ?? 0) + o.cards);
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};
const fold = (rows: Slice[], max = 6): Slice[] => (rows.length <= max ? rows : [...rows.slice(0, max - 1), { label: "อื่น ๆ", value: rows.slice(max - 1).reduce((a, r) => a + r.value, 0) }]);
const colorOf = (i: number, label: string) => (label === "อื่น ๆ" ? OTHER : PALETTE[i % PALETTE.length]);

/** crisp SVG donut (vector, any size) · 2px gap between slices · total in the middle */
function Donut({ parts }: { parts: Slice[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  // start of each slice (share of the total before it)
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + p.value, 0) / (total || 1));
  if (total === 0) return <Empty>ยังไม่มีข้อมูล</Empty>;
  return (
    <div className="flex flex-col items-center gap-4 p-4 sm:flex-row">
      <svg viewBox="0 0 140 140" className="kb-donut size-36 shrink-0" role="img" aria-label={`ใบ Kanban รวม ${n0(total)} ใบ`}>
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="18" className="kb-donut-bg" />
        <g transform="rotate(-90 70 70)">
          {parts.map((p, i) => {
            const frac = p.value / total;
            return (
              <circle
                key={p.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={colorOf(i, p.label)}
                strokeWidth="18"
                strokeDasharray={`${Math.max(frac * C - (parts.length > 1 ? 2 : 0), 0.01)} ${C}`}
                strokeDashoffset={-starts[i] * C}
                className="kb-donut-seg"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <title>{`${p.label}: ${n0(p.value)} ใบ (${Math.round(frac * 100)}%)`}</title>
              </circle>
            );
          })}
        </g>
        <text x="70" y="68" textAnchor="middle" className="kb-donut-n">
          {n0(total)}
        </text>
        <text x="70" y="86" textAnchor="middle" className="kb-donut-l">
          ใบ KANBAN
        </text>
      </svg>
      <ul className="grid w-full min-w-0 gap-1.5">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2 text-xs font-bold">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colorOf(i, p.label) }} />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{p.label}</span>
            <span className="font-mono text-ink">{n0(p.value)}</span>
            <span className="w-9 text-right font-mono text-[11px] text-ink-soft">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** vertical columns (cards per zone) · grow up from the baseline */
function Columns({ bars }: { bars: Slice[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0) return <Empty>ยังไม่มีข้อมูล</Empty>;
  return (
    <div className="p-4">
      <div className="kb-cols">
        {bars.map((b, i) => (
          <div key={b.label} className="kb-col" title={`${b.label}: ${n0(b.value)} ใบ`}>
            <span className="font-mono text-[11px] font-bold text-ink-soft">{n0(b.value)}</span>
            <span className="kb-col-bar" style={{ height: `${Math.max((b.value / max) * 100, 3)}%`, animationDelay: `${i * 60}ms` }} />
          </div>
        ))}
      </div>
      <div className="kb-cols-x">
        {bars.map((b) => (
          <span key={b.label} className="truncate" title={b.label}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** horizontal % rows (flow readiness per zone) */
function Meter({ rows }: { rows: { label: string; pct: number; sub: string }[] }) {
  if (rows.length === 0) return <Empty>ยังไม่มีข้อมูล</Empty>;
  return (
    <ul className="grid gap-3.5 p-4">
      {rows.map((z, i) => (
        <li key={z.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs font-bold">
            <span className="truncate text-ink-soft">{z.label}</span>
            <span className="font-mono text-ink">
              {z.pct}% <span className="text-ink-soft">· {z.sub}</span>
            </span>
          </div>
          <span className="kb-track block">
            <span className={`kb-fill block ${z.pct === 100 ? "is-ok" : ""}`} style={{ width: `${z.pct}%`, animationDelay: `${i * 60}ms` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function KanbanDashboard() {
  const { data } = useKanbanData();
  const s = useMemo(() => {
    if (!data) return null;
    const { kanbans, orders, receipts } = data;
    const ready = kanbans.filter(isReady).length;
    const cards = orders.reduce((a, o) => a + o.cards, 0);
    const waiting = receipts.filter((r) => r.status === "WAITING");
    const zones = new Map<string, { total: number; ready: number }>();
    for (const k of kanbans) {
      const z = zones.get(k.zone || "-") ?? { total: 0, ready: 0 };
      z.total++;
      if (isReady(k)) z.ready++;
      zones.set(k.zone || "-", z);
    }
    const top = new Map<number, { id: number; code: string; partA: string | null; partId: number | null; name: string; cards: number }>();
    for (const o of orders) {
      const t = top.get(o.kanbanId) ?? { id: o.kanbanId, code: o.code, partA: o.partA, partId: o.partId, name: o.name, cards: 0 };
      t.cards += o.cards;
      top.set(o.kanbanId, t);
    }
    return {
      total: kanbans.length,
      ready,
      cards,
      queue: orders.reduce((a, o) => a + o.queue, 0),
      running: orders.reduce((a, o) => a + o.running, 0),
      done: orders.reduce((a, o) => a + o.done, 0),
      orders: orders.length,
      waitingQty: waiting.reduce((a, r) => a + r.qty, 0),
      waitingN: waiting.length,
      byCustomer: fold(sumBy(orders, (o) => o.customer || "-")),
      byZone: sumBy(orders, (o) => o.zone || "-").slice(0, 10),
      readiness: [...zones.entries()].map(([label, v]) => ({ label, pct: Math.round((v.ready / v.total) * 100), sub: `${v.ready}/${v.total} พร้อม` })).sort((a, b) => a.label.localeCompare(b.label)),
      top5: [...top.values()].sort((a, b) => b.cards - a.cards).slice(0, 5),
    };
  }, [data]);

  const tiles: { label: string; value: number; hint: string; color: string; href: string }[] = s
    ? [
        { label: "KANBAN ทั้งหมด", value: s.total, hint: "รายการที่สร้างไว้", color: "#2563eb", href: "/mfg/kanban/set" },
        { label: "พร้อมใช้งาน", value: s.ready, hint: "ตั้งค่า FLOW แล้ว", color: "#15803d", href: "/mfg/kanban/set" },
        { label: "ยังไม่พร้อม", value: s.total - s.ready, hint: "รอ SET FLOW", color: "#b45309", href: "/mfg/kanban/set" },
        { label: "ยอดรอสั่งผลิต", value: s.waitingQty, hint: `${n0(s.waitingN)} รายการที่รับยอดไว้`, color: "#7c3aed", href: "/mfg/kanban/stock" },
        { label: "ใบ KANBAN รวม", value: s.cards, hint: `จาก ${n0(s.orders)} ใบสั่งผลิต`, color: "#0891b2", href: "/mfg/kanban/orders" },
      ]
    : [];
  const all = s ? s.queue + s.running + s.done : 0;
  const status = s
    ? [
        { label: "รอคิว (QUEUE)", v: s.queue, c: "#94a3b8" },
        { label: "กำลังผลิต (RUNNING)", v: s.running, c: "#2563eb" },
        { label: "เสร็จแล้ว (DONE)", v: s.done, c: "#15803d" },
      ]
    : [];
  const donePct = all ? Math.round(((s?.done ?? 0) / all) * 100) : 0;

  return (
    <PageBody className="md-gray kb">
      <PageHeader icon="/icons/Dashboard.png" title="KANBAN DASHBOARD" subtitle="MANUFACTURING · KANBAN · ภาพรวม Kanban / FLOW / ใบสั่งผลิต" />
      {!data || !s ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="kb-stats">
            {tiles.map((t, i) => (
              <Rise key={t.label} i={i}>
                <Link href={t.href} className="kb-stat h-full" style={{ "--c": t.color } as React.CSSProperties}>
                  <small>{t.label}</small>
                  <b>
                    <NumberTicker value={t.value} className="text-inherit tracking-normal dark:text-inherit" />
                  </b>
                  <i>{t.hint}</i>
                </Link>
              </Rise>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Rise i={5}>
              <Card title={<span className="inline-flex items-center gap-2"><span className="kb-dot is-ok" />ANDON · แจ้งเตือนเครื่องจักร</span>} className="h-full">
                <div className="grid place-items-center gap-1 px-4 py-8 text-center">
                  <p className="text-sm font-extrabold text-success">เครื่องจักรทำงานปกติทุกจุด</p>
                  <p className="text-xs font-bold text-ink-soft">ยังไม่มีการแจ้งซ่อมจากหน้างาน · เริ่มแสดงเมื่อเปิดใช้หน้างาน (Workstation)</p>
                </div>
              </Card>
            </Rise>
            <Rise i={6}>
              <Card title={`การ์ดค้างจุดเดิม เกิน 30 นาที • ${n0(data.stuck.length)}`} className="h-full">
                {data.stuck.length === 0 ? (
                  <Empty>ไม่มีการ์ดค้างจุด</Empty>
                ) : (
                  <ul className="grid gap-2 p-4">
                    {data.stuck.map((c) => (
                      <li key={c.id} className="kb-alert">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-extrabold">
                            {c.partA || c.code} · #{c.seq}/{c.total}
                          </p>
                          <p className="truncate text-[11px] font-bold text-ink-soft">
                            {c.point}
                            {c.zone && ` · ${c.zone}`}
                          </p>
                        </div>
                        <b className="font-mono text-xs">{n0(c.minutes)} นาที</b>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
            <Rise i={7}>
              <Card title="สรุปสถานะใบ KANBAN" className="h-full">
                <div className="grid gap-3 p-4">
                  <div className="kb-split" aria-label={`ปิดงานแล้ว ${donePct}%`}>
                    {status.map((r) => (
                      <span key={r.label} title={`${r.label}: ${n0(r.v)} ใบ`} style={{ flexGrow: r.v, background: r.c }} />
                    ))}
                  </div>
                  {status.map((r) => (
                    <div key={r.label} className="flex items-center gap-2 text-xs font-bold">
                      <span className="size-2.5 rounded-sm" style={{ background: r.c }} />
                      <span className="flex-1 text-ink-soft">{r.label}</span>
                      <span className="font-mono text-ink">{n0(r.v)} ใบ</span>
                      <span className="w-9 text-right font-mono text-[11px] text-ink-soft">{all ? Math.round((r.v / all) * 100) : 0}%</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-baseline justify-between border-t border-line/60 pt-2 text-xs font-bold">
                    <span className="text-ink-soft">ใบ Kanban ที่ปิดงานแล้ว</span>
                    <span className="font-mono text-ink">
                      {n0(s.done)}/{n0(all)} · {donePct}%
                    </span>
                  </div>
                  <span className="kb-track block">
                    <span className="kb-fill is-ok block" style={{ width: `${donePct}%` }} />
                  </span>
                </div>
              </Card>
            </Rise>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Rise i={8}>
              <Card title="สัดส่วนใบ KANBAN ตามลูกค้า" className="h-full">
                <Donut parts={s.byCustomer} />
              </Card>
            </Rise>
            <Rise i={9}>
              <Card title="ใบ KANBAN ต่อ ZONE" className="h-full">
                <Columns bars={s.byZone} />
              </Card>
            </Rise>
            <Rise i={10}>
              <Card title="ความพร้อมของ FLOW ต่อ ZONE" className="h-full">
                <Meter rows={s.readiness} />
              </Card>
            </Rise>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Rise i={11}>
              <Card title="TOP 5 งานที่ใช้ KANBAN มากที่สุด" className="h-full">
                {s.top5.length === 0 ? (
                  <Empty>ยังไม่มีใบสั่งผลิต</Empty>
                ) : (
                  <ul className="grid gap-3 p-4">
                    {s.top5.map((t, i) => (
                      <li key={t.id} className="flex items-center gap-3">
                        <span className="kb-rank">{i + 1}</span>
                        <span className="size-9 shrink-0 overflow-hidden rounded-lg border border-line/70 bg-white p-0.5">
                          <PartImg partId={t.partId} className="size-full !text-lg" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline gap-2">
                            <b className="font-mono text-xs">{t.partA || t.code}</b>
                            <span className="truncate text-[11px] font-bold text-ink-soft">{t.name}</span>
                          </p>
                          <span className="kb-track mt-1 block !h-1.5">
                            <span className="kb-fill block" style={{ width: `${Math.round((t.cards / s.top5[0].cards) * 100)}%`, animationDelay: `${i * 60}ms` }} />
                          </span>
                        </div>
                        <b className="font-mono text-sm text-primary">{n0(t.cards)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
            <Rise i={12}>
              <Card title={`สถานะ KANBAN ทั้งระบบ • ${n0(data.kanbans.length)}`} className="h-full" actions={<Link href="/mfg/kanban/set" className="btn-ghost">KANBAN MANAGEMENT ↗</Link>}>
                {data.kanbans.length === 0 ? (
                  <Empty>ยังไม่มีรายการ Kanban</Empty>
                ) : (
                  <ul className="max-h-[340px] divide-y divide-line/60 overflow-auto px-4">
                    {data.kanbans.map((k) => (
                      <li key={k.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-extrabold">
                            {k.partA || k.code} <span className="font-sans font-bold text-ink-soft">· {k.code}</span>
                          </p>
                          <p className="truncate text-[11px] font-bold text-ink-soft">
                            {k.name}
                            {k.zone && ` · ${k.zone}`}
                          </p>
                        </div>
                        <span className="font-mono text-xs font-bold text-ink-soft" title={k.formulaName ? `สูตรคำนวณ: ${k.formulaName}` : undefined}>
                          PACKING {n0(k.perBox)}
                        </span>
                        <ReadyPill ready={isReady(k)} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
          </div>

          <Rise i={13}>
            <Card title={`ใบสั่งผลิตล่าสุด • ${n0(data.orders.length)}`} actions={<Link href="/mfg/kanban/orders" className="btn-ghost">ไปหน้าสั่งผลิต ↗</Link>}>
              {data.orders.length === 0 ? (
                <Empty>ยังไม่มีใบสั่งผลิต</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead>
                      <tr>
                        <th>ORDER</th>
                        <th>KANBAN</th>
                        <th>CUSTOMER</th>
                        <th>QTY</th>
                        <th>ใบ KANBAN</th>
                        <th>FLOW</th>
                        <th>DONE</th>
                        <th>สั่งเมื่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.slice(0, 10).map((o) => (
                        <tr key={o.id}>
                          <td data-l="ORDER" className="font-mono font-bold">
                            #{o.id}
                          </td>
                          <td data-l="KANBAN" className="text-left">
                            <b className="font-mono">{o.partA || o.code}</b>
                            <div className="text-xs text-ink-soft">{o.name}</div>
                          </td>
                          <td data-l="CUSTOMER">{o.customer || "-"}</td>
                          <td data-l="QTY" className="font-mono">
                            {n0(o.qty)}
                          </td>
                          <td data-l="ใบ KANBAN">
                            <CardStack count={o.cards} />
                          </td>
                          <td data-l="FLOW" className="text-left">
                            <FlowChips steps={o.steps} />
                          </td>
                          <td data-l="DONE" className="font-mono">
                            {n0(o.done)}/{n0(o.cards)}
                          </td>
                          <td data-l="สั่งเมื่อ" className="whitespace-nowrap text-xs">
                            {when(o.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </Rise>
        </div>
      )}
    </PageBody>
  );
}
