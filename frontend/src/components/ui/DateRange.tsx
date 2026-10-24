"use client";

import { useLayoutEffect, useRef } from "react";
import { daysAgo, monthStart, today } from "@/lib/format";
import { DateField } from "./DateField";

// ช่วงวันที่: ปฏิทินของระบบ FROM / TO (แบบหน้าต่าง HISTORY) + ปุ่มลัด TODAY / 7 DAYS / THIS MONTH / ALL
//   ปุ่มลัดที่ตรงกับช่วงที่เลือกอยู่ = แถบม่วงเลื่อนไหลไปหา (glider) · กด = ตัวหนังสือเด้ง
export function DateRange({ from, to, onChange, quick = true }: { from: string; to: string; onChange: (from: string, to: string) => void; quick?: boolean }) {
  const t = today();
  const box = useRef<HTMLDivElement>(null);
  const chips: [string, string][] = [
    ["TODAY", t],
    ["7 DAYS", daysAgo(6)],
    ["THIS MONTH", monthStart()],
    ["ALL", "2000-01-01"],
  ];
  const active = to === t ? chips.findIndex(([, f]) => f === from) : -1;

  useLayoutEffect(() => {
    const g = box.current?.querySelector<HTMLElement>(".dr-glide");
    const a = box.current?.querySelectorAll<HTMLElement>(".dr-chip")[active];
    if (!g) return;
    if (!a) return void (g.style.opacity = "0");
    g.style.width = `${a.offsetWidth}px`;
    g.style.transform = `translateX(${a.offsetLeft - 3}px)`;
    g.style.opacity = "1";
  }, [active]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateField label="FROM" value={from} onChange={(v) => onChange(v, to)} className="w-[190px]" />
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      <DateField label="TO" value={to} onChange={(v) => onChange(from, v)} className="w-[190px]" />
      {quick && (
        <div ref={box} className="dr-chips">
          <span className="dr-glide" aria-hidden />
          {chips.map(([label, f], i) => (
            <button type="button" key={label} className={`dr-chip ${i === active ? "is-on" : ""}`} onClick={() => onChange(f, t)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
