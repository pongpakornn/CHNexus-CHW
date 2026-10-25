"use client";

import { useEffect, useRef, useState } from "react";

export type MenuOption = { value: string; label: string; color?: string; title?: string };

// 🍔 Dropdown แบบปุ่มม่วง + ขีดสามขีดหมุนเป็นกากบาท (ดีไซน์ event-wrapper): กด = รายการเผยจากกลางปุ่มแล้วทยอยเลื่อนขึ้นทีละแถว
//    กดอีกครั้ง / เลือก / กดนอกกล่อง / Esc = พับกลับแบบนุ่ม ๆ · ลูกศรขึ้น-ลง = เลื่อนตัวเลือก
export function MenuSelect({ value, options, onChange, className = "", label, disabled = false }: { value: string; options: MenuOption[]; onChange: (v: string) => void; className?: string; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const move = (d: number) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>(".ms-item") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[Math.max(0, Math.min(items.length - 1, i + d))]?.focus();
  };

  return (
    <div ref={box} className={`ms ${open ? "is-open" : ""} ${className}`}>
      <button
        type="button"
        className="ms-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "ArrowDown" && (e.preventDefault(), setOpen(true), setTimeout(() => move(1), 30))}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {label && <span className="ms-cap">{label}</span>}
          {current?.label}
        </span>
        <span className="ms-bars" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </button>
      <div className={`ms-menu ${options.length > 7 ? "is-long" : ""}`} role="listbox" onKeyDown={(e) => (e.key === "ArrowDown" || e.key === "ArrowUp") && (e.preventDefault(), move(e.key === "ArrowDown" ? 1 : -1))}>
        {options.map((o, i) => (
          <button
            type="button"
            key={o.value}
            role="option"
            aria-selected={o.value === value}
            tabIndex={open ? 0 : -1}
            title={o.title}
            className={`ms-item ${o.value === value ? "is-on" : ""}`}
            style={{ "--i": i, "--c": o.color } as React.CSSProperties}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.color && <span className="ms-dot" />}
            <span className="truncate">{o.label}</span>
            {o.value === value && (
              <svg viewBox="0 0 24 24" className="ml-auto size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
