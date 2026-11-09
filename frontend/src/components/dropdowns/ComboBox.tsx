"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ComboOption = { value: string; label: string; sub?: string };

// 🔎 Dropdown ที่พิมพ์ค้นหาได้: พิมพ์ = กรองรายการทันที · ↑ ↓ เลือก · Enter ยืนยัน · Esc ปิด · รายการสไลด์ลงนุ่ม ๆ
//   รายการลอยเหนือทุกอย่าง (portal) ไม่โดนการ์ด / ตารางตัดขอบ · free = รับค่าที่พิมพ์เองได้ (เช่น เวลา) ผ่านตัวแปลงค่า
export function ComboBox({
  value,
  options,
  onChange,
  placeholder = "พิมพ์เพื่อค้นหา...",
  ariaLabel,
  disabled,
  free,
  mono,
  className = "",
}: {
  value: string;
  options: ComboOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** รับข้อความที่พิมพ์เอง: คืนค่าที่ใช้ได้ / null = ไม่รับ */
  free?: (text: string) => string | null;
  mono?: boolean;
  className?: string;
}) {
  const cur = options.find((o) => o.value === value);
  const shownText = cur?.label ?? value;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, up: false });
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const items = useMemo(() => {
    const q = typing ? text.trim().toLowerCase() : "";
    const r = q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q)) : options;
    return r.slice(0, 300);
  }, [options, text, typing]);

  // วางรายการใต้ช่อง (ไม่พอ = ขึ้นด้านบน) · ตามตอนเลื่อนหน้า / ย่อขยายจอ
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < 260 && r.top > 260;
      setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 180), up });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !list.current?.contains(t)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  });
  // เปิดรายการ = ไฮไลต์ + เลื่อนไปที่ค่าปัจจุบัน
  function show() {
    if (open) return;
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setHi(i);
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => list.current?.children[i]?.scrollIntoView({ block: "center" })));
  }

  function close(commit = true) {
    if (commit && typing && free) {
      const v = free(text);
      if (v != null) onChange(v);
    }
    setOpen(false);
    setTyping(false);
    setText("");
  }
  function pick(o: ComboOption) {
    onChange(o.value);
    setOpen(false);
    setTyping(false);
    setText("");
  }
  function key(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      const n = Math.max(0, Math.min(items.length - 1, hi + (e.key === "ArrowDown" ? 1 : -1)));
      setHi(n);
      list.current?.children[n]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (typing && free && free(text) != null && !items.some((o) => o.label.toLowerCase() === text.trim().toLowerCase())) return close();
      if (open && items[hi]) pick(items[hi]);
      else show();
    } else if (e.key === "Escape") {
      close(false);
    } else if (e.key === "Tab") {
      close();
    }
  }

  return (
    <div ref={box} className={`cbx ${open ? "is-open" : ""} ${disabled ? "is-off" : ""} ${className}`}>
      <input
        className={`field cbx-in ${mono ? "font-mono" : ""}`}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        value={typing ? text : shownText}
        placeholder={placeholder}
        onFocus={(e) => (show(), e.currentTarget.select())}
        onClick={show}
        onChange={(e) => (setTyping(true), setText(e.target.value), setOpen(true), setHi(0))}
        onKeyDown={key}
        onBlur={() => setTimeout(() => document.activeElement !== box.current?.querySelector("input") && open && close(), 120)}
      />
      <span className="cbx-chev" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={id}
            role="listbox"
            className={`cbx-list ${pos.up ? "is-up" : ""}`}
            style={{ left: pos.left, top: pos.top, width: pos.width, translate: pos.up ? "0 -100%" : undefined }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.length === 0 ? (
              <li className="cbx-none">{free && free(text) != null ? `ใช้ค่า "${free(text)}" (Enter)` : "ไม่พบรายการ"}</li>
            ) : (
              items.map((o, i) => (
                <li key={o.value} role="option" aria-selected={o.value === value} className={`${i === hi ? "is-hi" : ""} ${o.value === value ? "is-on" : ""} ${mono ? "font-mono" : ""}`} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                  <b>{o.label}</b>
                  {o.sub && <small>{o.sub}</small>}
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}

// ⏱ ช่องเวลา HH:mm: พิมพ์ตัวเลขได้เลย (0830 / 8:30 / 830) หรือเลือกจากรายการทุก 5 นาที (เริ่ม 07:00 ไล่ครบ 24 ชม.)
const TIMES: ComboOption[] = Array.from({ length: 288 }, (_, i) => {
  const m = (7 * 60 + i * 5) % 1440;
  const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { value: v, label: v };
});
export function normTime(t: string): string | null {
  const s = t.replace(/[^\d:]/g, "");
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s.includes(":") ? s : s.length <= 2 ? `${s}:00` : `${s.slice(0, -2)}:${s.slice(-2)}`);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}
export function TimeField({ value, onChange, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; disabled?: boolean; ariaLabel?: string }) {
  const opts = TIMES.some((o) => o.value === value) ? TIMES : [{ value, label: value }, ...TIMES];
  return <ComboBox value={value} options={opts} onChange={onChange} free={normTime} disabled={disabled} ariaLabel={ariaLabel} placeholder="HH:mm" mono className="cbx-time" />;
}
