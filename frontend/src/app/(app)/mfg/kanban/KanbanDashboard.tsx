"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { NumberTicker } from "@/components/ui/number-ticker";
import { CardStack, FlowChips, isReady, n0, Rise, useKanbanData, when, type Order } from "./shared";

// 📊 KANBAN CONTROL › DASHBOARD: Kanban / flow readiness · cards queue-running-done · cards per customer / zone · flow readiness per zone · latest orders
type Bar = { label: string; value: number; sub?: string };

function Bars({ rows, color, unit = "ใบ" }: { rows: Bar[]; color?: string; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <Empty>ยังไม่มีข้อมูล</Empty>;
  return (
    <div className="kb-bars p-4">
      {rows.map((r, i) => (
        <div key={r.label} className="kb-bar" title={`${r.label}: ${n0(r.value)} ${unit}`}>
          <span>{r.label}</span>
          <span className="kb-track">
            <span className="kb-fill block" style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 60}ms`, ...(color ? ({ "--c": color } as React.CSSProperties) : {}) }} />
          </span>
          <span className="font-mono">{r.sub ?? `${n0(r.value)} ${unit}`}</span>
        </div>
      ))}
    </div>
  );
}

const sumBy = (orders: Order[], key: (o: Order) => string) => {
  const m = new Map<string, number>();
  for (const o of orders) m.set(key(o), (m.get(key(o)) ?? 0) + o.cards);
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
};

export default function KanbanDashboard() {
  const { data } = useKanbanData();
  const s = useMemo(() => {
    if (!data) return null;
    const { kanbans, orders, receipts } = data;
    const ready = kanbans.filter(isReady).length;
    const cards = orders.reduce((a, o) => a + o.cards, 0);
    const queue = orders.reduce((a, o) => a + o.queue, 0);
    const running = orders.reduce((a, o) => a + o.running, 0);
    const done = orders.reduce((a, o) => a + o.done, 0);
    const waiting = receipts.filter((r) => r.status === "WAITING");
    const zones = new Map<string, { total: number; ready: number }>();
    for (const k of kanbans) {
      const z = zones.get(k.zone || "-") ?? { total: 0, ready: 0 };
      z.total++;
      if (isReady(k)) z.ready++;
      zones.set(k.zone || "-", z);
    }
    return {
      total: kanbans.length,
      ready,
      cards,
      queue,
      running,
      done,
      orders: orders.length,
      waitingQty: waiting.reduce((a, r) => a + r.qty, 0),
      waitingN: waiting.length,
      byCustomer: sumBy(orders, (o) => o.customer || "-"),
      byZone: sumBy(orders, (o) => o.zone || "-"),
      readiness: [...zones.entries()].map(([label, v]) => ({ label, value: Math.round((v.ready / v.total) * 100), sub: `${v.ready}/${v.total} พร้อม` })),
    };
  }, [data]);

  const tiles: { label: string; value: number; hint: string; color: string; href?: string }[] = s
    ? [
        { label: "KANBAN ทั้งหมด", value: s.total, hint: "รายการที่สร้างไว้", color: "#2563eb", href: "/mfg/kanban/set" },
        { label: "พร้อมใช้งาน", value: s.ready, hint: "ตั้งค่า FLOW แล้ว", color: "#15803d", href: "/mfg/kanban/set" },
        { label: "ยังไม่พร้อม", value: s.total - s.ready, hint: "รอ SET FLOW", color: "#b45309", href: "/mfg/kanban/set" },
        { label: "ยอดรอสั่งผลิต", value: s.waitingQty, hint: `${n0(s.waitingN)} รายการที่รับยอดไว้`, color: "#7c3aed", href: "/mfg/kanban/stock" },
        { label: "ใบ KANBAN รวม", value: s.cards, hint: `จาก ${n0(s.orders)} ใบสั่งผลิต`, color: "#0891b2", href: "/mfg/kanban/orders" },
      ]
    : [];

  return (
    <PageBody className="md-gray kb">
      <PageHeader icon="/icons/Dashboard.png" title="KANBAN DASHBOARD" subtitle="MANUFACTURING · KANBAN CONTROL · ภาพรวม Kanban / FLOW / ใบสั่งผลิต" />
      {!data || !s ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="kb-stats">
            {tiles.map((t, i) => (
              <Rise key={t.label} i={i}>
                <Link href={t.href ?? "#"} className="kb-stat h-full" style={{ "--c": t.color } as React.CSSProperties}>
                  <small>{t.label}</small>
                  <b>
                    <NumberTicker value={t.value} className="text-inherit tracking-normal dark:text-inherit" />
                  </b>
                  <i>{t.hint}</i>
                </Link>
              </Rise>
            ))}
          </div>

          <Rise i={5}>
            <Card title="สถานะใบ KANBAN">
              <Bars
                rows={[
                  { label: "รอคิว (QUEUE)", value: s.queue },
                  { label: "กำลังผลิต (RUNNING)", value: s.running },
                  { label: "เสร็จแล้ว (DONE)", value: s.done },
                ]}
              />
            </Card>
          </Rise>

          <div className="grid gap-4 lg:grid-cols-3">
            <Rise i={6}>
              <Card title="ใบ KANBAN ตามลูกค้า" className="h-full">
                <Bars rows={s.byCustomer} />
              </Card>
            </Rise>
            <Rise i={7}>
              <Card title="ใบ KANBAN ต่อ ZONE" className="h-full">
                <Bars rows={s.byZone} color="#0891b2" />
              </Card>
            </Rise>
            <Rise i={8}>
              <Card title="ความพร้อมของ FLOW ต่อ ZONE" className="h-full">
                <Bars rows={s.readiness} color="#15803d" unit="%" />
              </Card>
            </Rise>
          </div>

          <Rise i={9}>
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
                            <b className="font-mono">{o.code}</b>
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
