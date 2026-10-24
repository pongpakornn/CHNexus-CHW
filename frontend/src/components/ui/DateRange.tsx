"use client";

import { daysAgo, monthStart, today } from "@/lib/format";

// FROM / TO + ปุ่มด่วน TODAY / 7 DAYS / THIS MONTH / ALL (แบบหน้า DEDUCTED เดิม)
export function DateRange({ from, to, onChange, quick = true }: { from: string; to: string; onChange: (from: string, to: string) => void; quick?: boolean }) {
  const t = today();
  const btn = (label: string, f: string) => (
    <button type="button" className={`dr-chip ${from === f && to === t ? "is-on" : ""}`} onClick={() => onChange(f, t)}>
      {label}
    </button>
  );
  // ช่วงวันที่: กล่องเดียว [ปฏิทิน | จาก → ถึง] + ปุ่มลัด (เลือกอยู่ = ม่วง)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="dr-box">
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="17" rx="3" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
        <input type="date" className="dr-input" value={from} onChange={(e) => onChange(e.target.value, to)} aria-label="From" />
        <span className="text-xs font-black text-ink-soft">→</span>
        <input type="date" className="dr-input" value={to} onChange={(e) => onChange(from, e.target.value)} aria-label="To" />
      </div>
      {quick && (
        <div className="dr-chips">
          {btn("TODAY", t)}
          {btn("7 DAYS", daysAgo(6))}
          {btn("THIS MONTH", monthStart())}
          {btn("ALL", "2000-01-01")}
        </div>
      )}
    </div>
  );
}
