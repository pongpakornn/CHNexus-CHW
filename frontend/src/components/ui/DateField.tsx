"use client";

import { useRef } from "react";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// 📅 ช่องวันที่: ป้าย (FROM / TO) + ไอคอนปฏิทินในกรอบสี + วันที่อ่านง่าย "01 OCT 2026 · WED" · กดตรงไหนก็เปิดปฏิทินของเครื่อง
export function DateField({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const d = value ? new Date(value + "T00:00:00") : null;
  const ok = d && !Number.isNaN(d.getTime());
  const open = () => {
    try {
      ref.current?.showPicker();
    } catch {
      ref.current?.focus();
    }
  };
  return (
    <div className={`df ${className}`} onClick={open} role="button" tabIndex={-1}>
      <span className="df-ic">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="17" rx="3" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="df-cap">{label}</span>
        <span className="df-val">
          {ok ? (
            <>
              {String(d!.getDate()).padStart(2, "0")} {MONTHS[d!.getMonth()]} {d!.getFullYear()}
              <span className="df-day">{DAYS[d!.getDay()]}</span>
            </>
          ) : (
            "-"
          )}
        </span>
      </span>
      <input ref={ref} type="date" className="df-input" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={label} />
    </div>
  );
}
