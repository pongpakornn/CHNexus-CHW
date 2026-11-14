"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuOption = {
  value: string;
  label: string;
  color?: string;
  title?: string;
};

// 🍔 Dropdown แบบปุ่มม่วง + ขีดสามขีดหมุนเป็นกากบาท (ดีไซน์ event-wrapper): กด = รายการเผยจากกลางปุ่มแล้วทยอยเลื่อนขึ้นทีละแถว
//    กดอีกครั้ง / เลือก / กดนอกกล่อง / Esc = พับกลับแบบนุ่ม ๆ · ลูกศรขึ้น-ลง = เลื่อนตัวเลือก
//    compact = ปุ่มเล็กพื้นขาวขอบม่วง (ในแถว / หน้าต่าง) - รายการที่เลื่อนลงมาเหมือนเดิม · tone="blue" = โทนสีฟ้าทั้งปุ่มและรายการ
//    รายการลอยอยู่บน body (fixed) - ไม่ถูกหน้าต่าง / การ์ดตัด · ด้านล่างไม่พอ = กางขึ้นบน · เลื่อนหน้า / ย่อจอ = ปิด
export function MenuSelect({
  value,
  options,
  onChange,
  className = "",
  label,
  disabled = false,
  compact = false,
  tone,
}: {
  value: string;
  options: MenuOption[];
  onChange: (v: string) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
  tone?: "blue";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    right: number;
    width: number;
    up: boolean;
  }>({ top: -9999, right: 0, width: 0, up: false });
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) =>
      !box.current?.contains(e.target as Node) &&
      !menu.current?.contains(e.target as Node) &&
      setOpen(false);
    const key = (e: KeyboardEvent) =>
      e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    const away = (e: Event) =>
      !(e.target instanceof Node && menu.current?.contains(e.target)) &&
      setOpen(false); // resize: target = window (not a Node)
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
      const H = Math.min(
        options.length > 7 ? 332 : options.length * 42 + 12,
        332,
      );
      const below = window.innerHeight - r.bottom;
      const up = below < H + 16 && r.top > below;
      setPos({
        top: up ? Math.max(8, r.top - 8 - H) : r.bottom + 8,
        right: Math.max(8, window.innerWidth - r.right),
        width: r.width,
        up,
      });
    }
    setOpen((o) => !o);
  };

  const move = (d: number) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(".ms-item") ?? []),
    ];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[Math.max(0, Math.min(items.length - 1, i + d))]?.focus();
  };

  return (
    <div
      ref={box}
      className={`ms ${compact ? "ms-compact" : ""} ${tone ? `ms-${tone}` : ""} ${open ? "is-open" : ""} ${className}`}
    >
      <button
        type="button"
        className="ms-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={(e) =>
          e.key === "ArrowDown" &&
          (e.preventDefault(), !open && toggle(), setTimeout(() => move(1), 30))
        }
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
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menu}
            className={`ms-menu is-float ${tone ? `ms-${tone}` : ""} ${open ? "is-open" : ""} ${pos.up ? "is-up" : ""} ${options.length > 7 ? "is-long" : ""}`}
            style={{ top: pos.top, right: pos.right, minWidth: pos.width }}
            role="listbox"
            onKeyDown={(e) =>
              (e.key === "ArrowDown" || e.key === "ArrowUp") &&
              (e.preventDefault(), move(e.key === "ArrowDown" ? 1 : -1))
            }
          >
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
                  <svg
                    viewBox="0 0 24 24"
                    className="ml-auto size-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
