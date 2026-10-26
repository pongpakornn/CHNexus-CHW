"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_FULL = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (v: string) => {
  const d = v ? new Date(v + "T00:00:00") : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// 📅 ช่องวันที่ + ปฏิทินของระบบ (แทนปฏิทินของเบราว์เซอร์ที่แต่งไม่ได้)
//    กด = ปฏิทินกางลงจากช่อง (อนิเมชันเดียวกับ Dropdown) แถววันที่ทยอยขึ้น · เลือกวัน = พับกลับนุ่ม ๆ
//    ‹ › = เดือนก่อน / ถัดไป (ตารางเลื่อนตามทิศ) · กดหัว เดือน ปี = เลือกเดือน -> กดปีอีกครั้ง = เลือกปี · TODAY = วันนี้ · Esc / กดนอกกล่อง = ปิด
export function DateField({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  const sel = parse(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const b = sel ?? new Date();
    return new Date(b.getFullYear(), b.getMonth(), 1);
  });
  const [dir, setDir] = useState(0); // ทิศเลื่อนเดือน (-1 ก่อน / 1 ถัดไป) สำหรับอนิเมชัน
  const [mode, setMode] = useState<"day" | "month" | "year">("day"); // หน้าที่แสดงในปฏิทิน
  const [right, setRight] = useState(false); // ชิดขวาจอ / หน้าต่าง = กางปฏิทินไปทางซ้ายแทน (ไม่ถูกตัด)
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // ตำแหน่งปฏิทิน (fixed บน body) - ไม่ถูกตัดโดยหน้าต่าง / การ์ด · ด้านล่างไม่พอ = กางขึ้นบน
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: -9999, left: -9999, up: false });

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    // เลื่อนหน้า / หน้าต่าง (นอกปฏิทิน) หรือย่อขยายจอ = ปิด (ปฏิทินลอยอยู่กับที่)
    const away = (e: Event) => !pop.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  const toggle = () => {
    if (!open && box.current) {
      // ขอบขวาที่ปฏิทินห้ามเกิน: กล่องที่ตัดเนื้อหา (หน้าต่าง / การ์ด) ที่ใกล้ที่สุด หรือขอบจอ
      const r = box.current.getBoundingClientRect();
      let limit = window.innerWidth - 8;
      for (let el = box.current.parentElement; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          limit = Math.min(limit, el.getBoundingClientRect().right - 8);
          break;
        }
      }
      const toRight = r.left + 300 > limit && r.right - 300 >= 8;
      setRight(toRight);
      const H = 390;
      const below = window.innerHeight - r.bottom;
      const up = below < H + 12 && r.top > below;
      setPos({
        top: up ? Math.max(8, r.top - 8 - H) : r.bottom + 8,
        left: Math.min(Math.max(8, toRight ? r.right - 300 : r.left), window.innerWidth - 308),
        up,
      });
    }
    if (!open && sel) setView(new Date(sel.getFullYear(), sel.getMonth(), 1)); // เปิด = ไปเดือนของวันที่เลือกอยู่
    setDir(0);
    setMode("day");
    setOpen((o) => !o);
  };
  // ‹ › : หน้าวัน = ทีละเดือน · หน้าเดือน = ทีละปี · หน้าปี = ทีละ 12 ปี
  const shift = (n: number) => {
    setDir(n);
    setView((v) => (mode === "day" ? new Date(v.getFullYear(), v.getMonth() + n, 1) : new Date(v.getFullYear() + n * (mode === "year" ? 12 : 1), v.getMonth(), 1)));
  };
  const yearStart = view.getFullYear() - (view.getFullYear() % 12);
  const pick = (d: Date) => {
    onChange(iso(d));
    setOpen(false);
  };

  // 6 แถว x 7 วัน เริ่มวันอาทิตย์ (รวมวันท้ายเดือนก่อน / ต้นเดือนถัดไปแบบจาง)
  const start = new Date(view.getFullYear(), view.getMonth(), 1 - view.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const todayIso = iso(new Date());

  return (
    <div ref={box} className={`dp ${open ? "is-open" : ""} ${right ? "is-right" : ""} ${className}`}>
      <button type="button" className="df" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <span className="df-ic">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="17" rx="3" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="df-cap">{label}</span>
          <span className="df-val">
            {sel ? (
              <>
                {String(sel.getDate()).padStart(2, "0")} {MONTHS[sel.getMonth()]} {sel.getFullYear()}
                <span className="df-day">{DAYS[sel.getDay()]}</span>
              </>
            ) : (
              "-"
            )}
          </span>
        </span>
        <svg viewBox="0 0 24 24" className="dp-chev ml-auto size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {typeof document !== "undefined" &&
        createPortal(
      <div ref={pop} className={`dp-pop is-float ${open ? "is-open" : ""} ${pos.up ? "is-up" : ""}`} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={label}>
        <div className="dp-head">
          <button type="button" className="dp-nav" onClick={() => shift(-1)} aria-label="Previous month" tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            key={`${mode}-${view.getFullYear()}-${view.getMonth()}`}
            className="dp-title"
            style={{ "--dir": dir } as React.CSSProperties}
            tabIndex={open ? 0 : -1}
            title={mode === "day" ? "เลือกเดือน / ปี" : mode === "month" ? "เลือกปี" : undefined}
            onClick={() => (setDir(0), setMode(mode === "day" ? "month" : "year"))}
          >
            {mode === "day" && (
              <>
                {MONTHS_FULL[view.getMonth()]} <span>{view.getFullYear()}</span>
              </>
            )}
            {mode === "month" && view.getFullYear()}
            {mode === "year" && `${yearStart} – ${yearStart + 11}`}
            {mode !== "year" && (
              <svg viewBox="0 0 24 24" className="ml-1 inline size-3.5 align-[-2px]" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            )}
          </button>
          <button type="button" className="dp-nav" onClick={() => shift(1)} aria-label="Next month" tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        {mode === "day" && (
          <>
            <div className="dp-week">
              {DAYS.map((d) => (
                <span key={d} className={d === "SUN" ? "is-sun" : ""}>
                  {d.slice(0, 2)}
                </span>
              ))}
            </div>
            <div key={`${view.getFullYear()}-${view.getMonth()}-${open}`} className="dp-grid" style={{ "--dir": dir } as React.CSSProperties}>
              {cells.map((d, i) => {
                const v = iso(d);
                const other = d.getMonth() !== view.getMonth();
                return (
                  <button
                    type="button"
                    key={v}
                    tabIndex={open ? 0 : -1}
                    className={`dp-day ${other ? "is-other" : ""} ${v === value ? "is-on" : ""} ${v === todayIso ? "is-today" : ""} ${d.getDay() === 0 ? "is-sun" : ""}`}
                    style={{ "--r": Math.floor(i / 7) } as React.CSSProperties}
                    onClick={() => pick(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {mode === "month" && (
          <div key={`m-${view.getFullYear()}`} className="dp-pick" style={{ "--dir": dir } as React.CSSProperties}>
            {MONTHS.map((m, i) => {
              const on = sel && sel.getFullYear() === view.getFullYear() && sel.getMonth() === i;
              const now = new Date();
              return (
                <button
                  type="button"
                  key={m}
                  tabIndex={open ? 0 : -1}
                  className={`dp-cell ${on ? "is-on" : ""} ${now.getFullYear() === view.getFullYear() && now.getMonth() === i ? "is-today" : ""}`}
                  style={{ "--r": Math.floor(i / 3) } as React.CSSProperties}
                  onClick={() => (setDir(0), setView(new Date(view.getFullYear(), i, 1)), setMode("day"))}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
        {mode === "year" && (
          <div key={`y-${yearStart}`} className="dp-pick" style={{ "--dir": dir } as React.CSSProperties}>
            {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y, i) => (
              <button
                type="button"
                key={y}
                tabIndex={open ? 0 : -1}
                className={`dp-cell ${sel?.getFullYear() === y ? "is-on" : ""} ${new Date().getFullYear() === y ? "is-today" : ""}`}
                style={{ "--r": Math.floor(i / 3) } as React.CSSProperties}
                onClick={() => (setDir(0), setView(new Date(y, view.getMonth(), 1)), setMode("month"))}
              >
                {y}
              </button>
            ))}
          </div>
        )}
        <div className="dp-foot">
          <button type="button" className="dp-link" tabIndex={open ? 0 : -1} onClick={() => pick(new Date())}>
            TODAY
          </button>
          <button type="button" className="dp-link is-muted" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
            CLOSE
          </button>
        </div>
      </div>,
          document.body,
        )}
    </div>
  );
}
