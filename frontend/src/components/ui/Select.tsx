"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";

export type SelectOption = { value: string; label: React.ReactNode };

// ▾ Dropdown สีขาว: ชี้ = ขอบฟ้า · กด = รายการเลื่อนลงมา · ชี้รายการหนึ่ง = รายการอื่นเบลอ + ย่อ · รายการที่เลือกมีแถบฟ้าด้านซ้าย
//   คีย์บอร์ด: Enter / Space / ↓ เปิด · ↑ ↓ เลือก · Enter ยืนยัน · Esc ปิด
export function Select({ value, onChange, options, ariaLabel }: { value: string; onChange: (v: string) => void; options: SelectOption[]; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const idx = options.findIndex((o) => o.value === value);
  const current = options[idx];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const toggle = () => {
    setHi(idx);
    setOpen((o) => !o);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === "Escape") return (e.preventDefault(), setOpen(false));
    if (e.key === "ArrowDown") return (e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1)));
    if (e.key === "ArrowUp") return (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hi >= 0) pick(options[hi].value);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={toggle}
        onKeyDown={onKey}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-surface px-3 py-2 text-left text-sm font-bold text-ink shadow-[0_1px_2px_rgb(20_25_60/0.05)] outline-none transition duration-200 hover:border-[#2563eb] hover:text-[#2563eb] focus-visible:ring-2 focus-visible:ring-[#2563eb]/30 ${
          open ? "border-[#2563eb] text-[#2563eb] ring-2 ring-[#2563eb]/20" : "border-line"
        }`}
      >
        <span className="truncate">{current?.label ?? "-"}</span>
        <Icon name="chevron" className={`size-4 shrink-0 transition-transform duration-300 ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      <div className={`fold absolute inset-x-0 top-[calc(100%+6px)] z-30 ${open ? "" : "is-closed pointer-events-none"}`}>
        <div>
          <div id={listId} role="listbox" className="dd-list grid gap-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-[0_18px_40px_-14px_rgb(20_40_100/0.35)]">
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                tabIndex={-1}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o.value)}
                className={`dd-opt relative rounded-lg py-2 pl-4 pr-3 text-left text-sm font-bold ${
                  i === hi ? "bg-[#2563eb] text-white" : o.value === value ? "bg-[#eaf1ff] text-[#2563eb]" : "text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
