"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

// ⏰ ช่องเวลา แบบ DateField ของ CIMS (แทน <input type="time"> ของเบราว์เซอร์)
//    กดตรงไหนของกล่องก็เปิด · เลือก "ชั่วโมง" แล้ว "นาที" (ทีละ 5 นาที) = ปิดเอง · พิมพ์ตัวเลขได้ที่ช่องด้านบน (0830 / 8:30 / 830)
//    NOW = เวลาปัจจุบัน · CLEAR = ล้าง (ไม่บังคับ) · Esc / กดนอกกล่อง = ปิด · value = "HH:mm" หรือ "" (ว่าง)
export function ClockField({
  label = "TIME",
  value,
  onChange,
  clearable = true,
  disabled,
  className = "",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState("");
  const [typed, setTyped] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({
    top: -9999,
    left: -9999,
    up: false,
  });
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [vh, vm] = /^\d{2}:\d{2}$/.test(value) ? value.split(":") : ["", ""];

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) =>
      !box.current?.contains(e.target as Node) &&
      !pop.current?.contains(e.target as Node) &&
      setOpen(false);
    const away = (e: Event) =>
      !(e.target instanceof Node && pop.current?.contains(e.target)) &&
      setOpen(false); // resize: target = window (not a Node)
    const key = (e: KeyboardEvent) =>
      e.key === "Escape" && (e.stopPropagation(), setOpen(false));
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
    if (disabled) return;
    if (!open && box.current) {
      const r = box.current.getBoundingClientRect();
      const W = 300,
        H = 360;
      const below = window.innerHeight - r.bottom;
      const up = below < H + 12 && r.top > below;
      setPos({
        top: up ? Math.max(8, r.top - 8 - H) : r.bottom + 8,
        left: Math.min(
          Math.max(
            8,
            r.left + W > window.innerWidth - 8 ? r.right - W : r.left,
          ),
          window.innerWidth - W - 8,
        ),
        up,
      });
    }
    setH(vh);
    setTyped("");
    setOpen((o) => !o);
  };
  const done = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  // พิมพ์เอง: 0830 / 8:30 / 830 / 8
  const norm = (t: string) => {
    const s = t.replace(/[^\d:]/g, "");
    const m = /^(\d{1,2}):?(\d{2})$/.exec(
      s.includes(":")
        ? s
        : s.length <= 2
          ? `${s}:00`
          : `${s.slice(0, -2)}:${s.slice(-2)}`,
    );
    return m && +m[1] < 24 && +m[2] < 60
      ? `${m[1].padStart(2, "0")}:${m[2]}`
      : null;
  };
  const now = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div ref={box} className={`dp ${open ? "is-open" : ""} ${className}`}>
      <button
        type="button"
        className="df"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="df-ic">
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="df-cap">{label}</span>
          <span key={value} className="df-val mf-val">
            {value || "--:--"}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          className="dp-chev ml-auto size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={pop}
            className={`dp-pop is-float ck-pop ${open ? "is-open" : ""} ${pos.up ? "is-up" : ""}`}
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={label}
          >
            <div className="ck-head">
              <span className={`ck-big ${h ? "" : "is-dim"}`}>
                <b className={h ? "" : "is-now"}>{h || vh || "--"}</b>:
                <b className={h ? "is-now" : ""}>{h ? "--" : vm || "--"}</b>
              </span>
              <input
                className="ck-type"
                inputMode="numeric"
                placeholder="พิมพ์ เช่น 0830"
                tabIndex={open ? 0 : -1}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const v = norm(typed);
                  if (v) done(v);
                }}
              />
            </div>
            <div className="ck-cap">
              {h ? `เลือกนาที (ชั่วโมง ${h})` : "เลือกชั่วโมง"}
            </div>
            {!h ? (
              <div key="h" className="dp-pick ck-grid is-h">
                {HOURS.map((x, i) => (
                  <button
                    type="button"
                    key={x}
                    tabIndex={open ? 0 : -1}
                    className={`dp-cell ${x === vh ? "is-on" : ""}`}
                    style={{ "--r": Math.floor(i / 6) } as React.CSSProperties}
                    onClick={() => setH(x)}
                  >
                    {x}
                  </button>
                ))}
              </div>
            ) : (
              <div key="m" className="dp-pick ck-grid is-m">
                {MINS.map((x, i) => (
                  <button
                    type="button"
                    key={x}
                    tabIndex={open ? 0 : -1}
                    className={`dp-cell ${h === vh && x === vm ? "is-on" : ""}`}
                    style={{ "--r": Math.floor(i / 4) } as React.CSSProperties}
                    onClick={() => done(`${h}:${x}`)}
                  >
                    :{x}
                  </button>
                ))}
              </div>
            )}
            <div className="dp-foot">
              {h ? (
                <button
                  type="button"
                  className="dp-link is-muted"
                  tabIndex={open ? 0 : -1}
                  onClick={() => setH("")}
                >
                  ‹ ชั่วโมง
                </button>
              ) : (
                <button
                  type="button"
                  className="dp-link"
                  tabIndex={open ? 0 : -1}
                  onClick={() => done(now())}
                >
                  NOW
                </button>
              )}
              {clearable && value && (
                <button
                  type="button"
                  className="dp-link is-muted"
                  tabIndex={open ? 0 : -1}
                  onClick={() => done("")}
                >
                  CLEAR
                </button>
              )}
              <button
                type="button"
                className="dp-link is-muted"
                tabIndex={open ? 0 : -1}
                onClick={() => setOpen(false)}
              >
                CLOSE
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
