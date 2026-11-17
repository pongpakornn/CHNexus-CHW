"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Empty, PageBody, PageHeader } from "@/components/layout/Page";
import { MonthField } from "@/components/forms/MonthField";
import { CustomerDonut } from "@/components/charts/CustomerDonut";
import { ShareBars } from "@/components/charts/Charts";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { thisMonth } from "@/lib/pp";
import { pctOf, type PcMeta } from "@/lib/pcwof";
import "../wof.css";

type Dash = {
  plans: number;
  parts: number;
  totals: { pl: number; or: number; order: number; prodD: number; prodN: number; del: number };
  achievement: number;
  pending: number;
  byCustomer: { code: string; name: string; order: number; produced: number; delivered: number }[];
  byStatus: unknown;
};

// byStatus may arrive as {STATUS: n} or [{status|name, count|amount}] - normalise to chart rows
function statusRows(v: unknown): { name: string; amount: number }[] {
  if (Array.isArray(v)) return v.map((x: Record<string, unknown>) => ({ name: String(x.status ?? x.name ?? "-"), amount: Number(x.count ?? x.amount ?? x.plans ?? 0) })).filter((r) => r.amount > 0);
  if (v && typeof v === "object") return Object.entries(v as Record<string, number>).map(([name, amount]) => ({ name, amount: Number(amount) || 0 })).filter((r) => r.amount > 0);
  return [];
}
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

// 🗂 PC › WORK ORDER FOLLOW › DASHBOARD : KPI ประจำเดือน + แยกตามลูกค้า + สถานะแผน
export default function WofDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [meta, setMeta] = useState<PcMeta | null>(null);
  const [d, setD] = useState<Dash | null>(null);
  const last = useRef("");

  useEffect(() => {
    api<PcMeta>("/pcwof/meta")
      .then(setMeta)
      .catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  const ready = meta?.ready === true;
  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<Dash>("/pcwof/dashboard", { query: { month } });
        if (quiet && sameData(last, r)) return;
        setD(r);
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
      }
    },
    [month, toast],
  );
  useEffect(() => {
    if (!ready) return;
    last.current = "";
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [ready, load]);
  useLive(["pcwof"], () => (ready ? load(true) : undefined), 60_000);

  const produced = d ? d.totals.prodD + d.totals.prodN : 0;
  const ach = d ? pctOf(produced, d.totals.order) : 0;
  const kpis: [string, string, string][] = d
    ? [
        ["PLANS", n0(d.plans), "#6750a4"],
        ["PARTS", n0(d.parts), "#4f46e5"],
        ["ORDER (สั่งผลิต)", n0(d.totals.order), "#2563eb"],
        ["PRODUCED D+N", n0(produced), "#0d9488"],
        ["DELIVERED", n0(d.totals.del), "#0891b2"],
        ["ACHIEVEMENT", d.totals.order > 0 ? `${ach}%` : "-", ach >= 100 ? "#16a34a" : ach >= 80 ? "#d97706" : "#dc2626"],
        ["PENDING SIGN", n0(d.pending), "#d97706"],
      ]
    : [];
  const st = statusRows(d?.byStatus);

  return (
    <PageBody>
      <PageHeader
        icon="/icons/Dashboard.png"
        title="WORK ORDER FOLLOW • DASHBOARD"
        subtitle="ภาพรวมการผลิตตามแผนรายเดือน"
        actions={<MonthField value={month} onChange={(m) => (setMonth(m), router.replace(`?month=${m}`, { scroll: false }))} />}
      />
      {meta && !ready ? (
        <div className="mr-off">รอติดตั้งฐานข้อมูล</div>
      ) : !d ? (
        <div className="wof-kpis" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="nx-skel h-20 rounded-2xl" />
          ))}
        </div>
      ) : d.plans === 0 ? (
        <Empty>เดือนนี้ยังไม่มีแผน</Empty>
      ) : (
        <>
          <div className="wof-kpis">
            {kpis.map(([l, v, c], i) => (
              <div key={l} className="wof-kpi" style={{ "--i": i, "--k": c } as React.CSSProperties}>
                <span>{l}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
          <div className="wof-dash-grid">
            <Card title="ORDER BY CUSTOMER">
              <div className="p-4">
                <ShareBars rows={d.byCustomer.map((c) => ({ name: c.name || c.code, amount: c.order }))} empty="ไม่มียอดสั่งผลิต" />
              </div>
            </Card>
            <CustomerDonut title={`PLAN STATUS • ${month}`} period={month} rows={st} metric="Plans" subtitle="สัดส่วนสถานะแผนของเดือน" nameHead="Status" empty="ยังไม่มีแผน" />
          </div>
          <Card title="PER CUSTOMER">
            <div className="overflow-x-auto p-2">
              <table className="wof-tbl">
                <thead>
                  <tr>
                    <th>CUSTOMER</th>
                    <th>ORDER</th>
                    <th>PRODUCED</th>
                    <th>%</th>
                    <th>DELIVERED</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byCustomer.map((c) => (
                    <tr key={c.code}>
                      <td>
                        <b>{c.code}</b> {c.name}
                      </td>
                      <td>{n0(c.order)}</td>
                      <td>{n0(c.produced)}</td>
                      <td>{pctOf(c.produced, c.order)}%</td>
                      <td>{n0(c.delivered)}</td>
                      <td>{pctOf(c.delivered, c.order)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </PageBody>
  );
}
