"use client";

import { useState } from "react";

// 📈 กราฟของระบบ (SVG ล้วน ไม่มี library) - MonthChart อยู่ใน MonthChart.tsx
export { MonthChart, SERIES, type MonthPoint } from "@/components/charts/MonthChart";

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

// สัดส่วน (part-to-whole) เป็นแท่งแนวนอนเรียงมากไปน้อย - 1 สี (ไม่ต้องมี legend) + ตัวเลข / % ข้างแท่ง
export function ShareBars({ rows, empty = "ไม่มีข้อมูล" }: { rows: { name: string; amount: number; percentage?: number }[]; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (rows.length === 0) return <div className="py-10 text-center text-sm font-semibold text-ink-soft">{empty}</div>;
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => {
        const pct = r.percentage ?? (total > 0 ? (r.amount / total) * 100 : 0);
        return (
          <div key={r.name} className={`grid grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-3 rounded-lg px-1 ${hover === i ? "bg-surface-2" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${r.name}: ${fmt(r.amount)} (${pct.toFixed(1)}%)`}>
            <span className="truncate text-xs font-bold text-ink">{r.name}</span>
            <span className="h-3.5 rounded-r-[4px] bg-[#2a78d6]" style={{ width: `${Math.max(1.5, (r.amount / max) * 100)}%` }} />
            <span className="whitespace-nowrap text-right text-xs font-extrabold text-ink">
              {fmt(r.amount)} <span className="font-semibold text-ink-soft">{pct.toFixed(0)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
