"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_FULL = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;

// 📅 ช่องเลือกเดือน แบบ DateField ของ CIMS (แทน <input type="month"> ของเบราว์เซอร์ที่ต้องกดให้โดนจุดเล็ก ๆ)
//    กดตรงไหนของกล่องก็เปิด · ตารางเดือนกางลงจากช่อง (อนิเมชันเดียวกับ Dropdown) · กดหัวปี = เลือกปี
//    ‹ › ด้านข้าง (steppers) = เดือนก่อน / ถัดไปโดยไม่ต้องเปิด · THIS MONTH = เดือนนี้ · Esc / กดนอกกล่อง = ปิด
export function MonthField({ value, onChange, label = "MONTH", steppers = true, className = "" }: { value: string; onChange: (v: string) => void; label?: string; steppers?: boolean; className?: string }) {
  const [y0, m0] = value.split("-").map(Number);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(y0);
  const [mode, setMode] = useState<"month" | "year">("month");
  const [dir, setDir] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: -9999, left: -9999, up: false });
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const away = (e: Event) => !pop.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  const toggle = () => {
    if (!open && box.current) {
      const r = box.current.getBoundingClientRect();
      const W = 300, H = 300;
      const below = window.innerHeight - r.bottom;
      const up = below < H + 12 && r.top > below;
      setPos({ top: up ? Math.max(8, r.top - 8 - H) : r.bottom + 8, left: Math.min(Math.max(8, r.right - W > 8 && r.left + W > window.innerWidth - 8 ? r.right - W : r.left), window.innerWidth - W - 8), up });
      setYear(y0);
    }
    setDir(0);
    setMode("month");
    setOpen((o) => !o);
  };
  const step = (k: number) => {
    const d = new Date(y0, m0 - 1 + k, 1);
    onChange(ym(d.getFullYear(), d.getMonth()));
  };
  const pick = (y: number, m: number) => {
    onChange(ym(y, m));
    setOpen(false);
  };
  const shift = (n: number) => (setDir(n), setYear((y) => y + n * (mode === "year" ? 12 : 1)));
  const yearStart = year - (year % 12);
  const now = new Date();

  return (
    <div className={`mf ${className}`}>
      {steppers && (
        <button type="button" className="pk-step" aria-label="Previous month" onClick={() => step(-1)}>
          ‹
        </button>
      )}
      <div ref={box} className={`dp ${open ? "is-open" : ""}`}>
        <button type="button" className="df mf-btn" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
          <span className="df-ic">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="17" rx="3" />
              <path d="M3 9h18M8 2v4M16 2v4" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="df-cap">{label}</span>
            <span key={value} className="df-val mf-val">
              {MONTHS[m0 - 1]} {y0}
            </span>
          </span>
          <svg viewBox="0 0 24 24" className="dp-chev ml-auto size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {typeof document !== "undefined" &&
          createPortal(
            <div ref={pop} className={`dp-pop is-float mf-pop ${open ? "is-open" : ""} ${pos.up ? "is-up" : ""}`} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={label}>
              <div className="dp-head">
                <button type="button" className="dp-nav" onClick={() => shift(-1)} aria-label="Previous year" tabIndex={open ? 0 : -1}>
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m15 6-6 6 6 6" />
                  </svg>
                </button>
                <button type="button" key={`${mode}-${year}`} className="dp-title" style={{ "--dir": dir } as React.CSSProperties} tabIndex={open ? 0 : -1} title={mode === "month" ? "เลือกปี" : undefined} onClick={() => mode === "month" && (setDir(0), setMode("year"))}>
                  {mode === "month" ? year : `${yearStart} – ${yearStart + 11}`}
                  {mode === "month" && (
                    <svg viewBox="0 0 24 24" className="ml-1 inline size-3.5 align-[-2px]" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  )}
                </button>
                <button type="button" className="dp-nav" onClick={() => shift(1)} aria-label="Next year" tabIndex={open ? 0 : -1}>
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </div>
              {mode === "month" ? (
                <div key={`m-${year}-${open}`} className="dp-pick" style={{ "--dir": dir } as React.CSSProperties}>
                  {MONTHS.map((m, i) => (
                    <button
                      type="button"
                      key={m}
                      tabIndex={open ? 0 : -1}
                      title={`${MONTHS_FULL[i]} ${year}`}
                      className={`dp-cell ${year === y0 && i === m0 - 1 ? "is-on" : ""} ${now.getFullYear() === year && now.getMonth() === i ? "is-today" : ""}`}
                      style={{ "--r": Math.floor(i / 3) } as React.CSSProperties}
                      onClick={() => pick(year, i)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : (
                <div key={`y-${yearStart}`} className="dp-pick" style={{ "--dir": dir } as React.CSSProperties}>
                  {Array.from({ length: 12 }, (_, i) => yearStart + i).map((yy, i) => (
                    <button
                      type="button"
                      key={yy}
                      tabIndex={open ? 0 : -1}
                      className={`dp-cell ${yy === y0 ? "is-on" : ""} ${now.getFullYear() === yy ? "is-today" : ""}`}
                      style={{ "--r": Math.floor(i / 3) } as React.CSSProperties}
                      onClick={() => (setDir(0), setYear(yy), setMode("month"))}
                    >
                      {yy}
                    </button>
                  ))}
                </div>
              )}
              <div className="dp-foot">
                <button type="button" className="dp-link" tabIndex={open ? 0 : -1} onClick={() => pick(now.getFullYear(), now.getMonth())}>
                  THIS MONTH
                </button>
                <button type="button" className="dp-link is-muted" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
                  CLOSE
                </button>
              </div>
            </div>,
            document.body,
          )}
      </div>
      {steppers && (
        <button type="button" className="pk-step" aria-label="Next month" onClick={() => step(1)}>
          ›
        </button>
      )}
    </div>
  );
}
