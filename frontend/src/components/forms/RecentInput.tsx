"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 🕘 ช่องกรอกที่ "กดแล้วมีค่าที่เคยกรอก" ให้เลือก (เฉพาะของผู้ใช้คนนี้ · ล่าสุดก่อน)
//   พิมพ์ได้ตามปกติ · พิมพ์แล้วรายการกรองตามข้อความ · ↑ ↓ เลือก · Enter ยืนยัน · Esc ปิด
//   รายการเลื่อนลงแบบ Dropdown ของ Product Control (ใช้ class cmb-list ชุดเดียวกัน)
export function RecentInput({
  value,
  onChange,
  recent,
  className = "field",
  inputMode,
  placeholder,
  maxLength,
  ariaLabel,
  hint = "ล่าสุดของคุณ",
}: {
  value: string;
  onChange: (v: string) => void;
  recent: string[];
  className?: string;
  inputMode?: "decimal" | "text" | "numeric";
  placeholder?: string;
  maxLength?: number;
  ariaLabel?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, up: false });
  const box = useRef<HTMLInputElement>(null);
  const lid = useId();
  const q = value.trim().toLowerCase();
  const items = recent.filter((r) => r && r.trim().toLowerCase() !== q && (q === "" || r.toLowerCase().includes(q))).slice(0, 8);
  const show = open && items.length > 0;

  useLayoutEffect(() => {
    if (!show) return;
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
  }, [show]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setHi(-1);
  };

  return (
    <>
      <input
        ref={box}
        className={className}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={show}
        aria-controls={lid}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => (setOpen(true), setHi(-1))}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => (onChange(e.target.value), setOpen(true), setHi(-1))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.max(0, Math.min(items.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
          } else if (e.key === "Enter" && show && items[hi]) {
            e.preventDefault();
            pick(items[hi]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {show &&
        createPortal(
          <ul id={lid} role="listbox" className={`cmb-list ${pos.up ? "is-up" : ""}`} style={{ left: pos.left, top: pos.top, width: pos.width, translate: pos.up ? "0 -100%" : undefined }} onMouseDown={(e) => e.preventDefault()}>
            {items.map((r, i) => (
              <li key={r} role="option" aria-selected={i === hi} className={i === hi ? "is-hi" : ""} style={{ "--i": i } as React.CSSProperties} onMouseEnter={() => setHi(i)} onClick={() => pick(r)}>
                <b>{r}</b>
                <small>{hint}</small>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
