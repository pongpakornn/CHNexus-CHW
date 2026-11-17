"use client";

import { useEffect, useRef, useState } from "react";

// 🔎 แถบเครื่องมือหน้าคลัง: ช่องค้นหา + ปุ่มเลือกหมวด (กดแล้วรายการเลื่อนลงมา · เปิด / เลือกอยู่ = สีฟ้า)

export type Suggestion = { text: string; kind: string; sub: string };

export function SearchField({ value, onChange, placeholder, suggestions = [] }: { value: string; onChange: (v: string) => void; placeholder: string; suggestions?: Suggestion[] }) {
  const [focus, setFocus] = useState(false);
  const shown = focus && value.trim().length >= 2 && suggestions.length > 0;
  return (
    <div className="relative flex min-w-[260px] flex-1" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
    <label className="group relative flex h-10 w-full items-center rounded-xl border border-[#e2e4f0] bg-surface-2/60 transition focus-within:border-accent focus-within:bg-surface focus-within:shadow-[0_0_0_4px_rgb(103_80_164/0.12)] hover:border-accent/50">
      <svg viewBox="0 0 24 24" className="pointer-events-none ml-3 size-[18px] shrink-0 text-ink-soft transition-colors group-focus-within:text-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-soft/70"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
      />
      <button
        type="button"
        onClick={() => onChange("")}
        className={`mr-2 grid size-6 place-items-center rounded-full text-ink-soft transition hover:bg-danger/10 hover:text-danger ${value ? "scale-100 opacity-100" : "pointer-events-none scale-50 opacity-0"}`}
        aria-label="Clear"
        tabIndex={value ? 0 : -1}
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </label>
    {shown && (
      <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-line/60 bg-surface p-1 shadow-lg" role="listbox" aria-label="SUGGESTIONS">
        {suggestions.map((x) => (
          <li key={x.kind + x.text + x.sub} role="option" aria-selected={false}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(x.text)} className="flex w-full flex-wrap items-center gap-x-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-surface-2">
              <b className="break-all font-extrabold text-ink">{x.text}</b>
              <span className="rounded bg-surface-2 px-1.5 text-[10px] font-extrabold text-ink-soft">{x.kind}</span>
              <span className="min-w-0 break-words text-xs font-semibold text-ink-soft">{x.sub}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
    </div>
  );
}

// ไอคอนกรวยกรอง (ขีดซ้อนกันแคบลง)
function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M4 5h16" />
      <path d="M7 10h10" />
      <path d="M10 15h4" />
      <path d="M12 15v4" />
    </svg>
  );
}

export function CategoryPicker({ label, allLabel, options, value, onChange }: { label: string; allLabel: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // คลิกนอกกล่อง / Esc = ปิด
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("pointerdown", away), document.removeEventListener("keydown", esc));
  }, [open]);

  // เปิดแล้วเลื่อนให้เห็นรายการที่เลือกอยู่
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const pick = (v: string) => (onChange(v), setOpen(false));
  // ลูกศรขึ้น / ลง เลื่อนระหว่างรายการ
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  const items = [{ v: "", t: allLabel }, ...options.map((o) => ({ v: o, t: o }))];
  return (
    <div ref={box} className={`ms relative shrink-0 ${open ? "is-open" : ""}`} onKeyDown={move}>
      <button
        type="button"
        onClick={(e) => {
          // ปุ่มชิดขวาจอ (จอแคบ / iPad) = กางรายการชิดขวาแทน ไม่ให้ล้นจอ
          setRight(e.currentTarget.getBoundingClientRect().left + 280 > window.innerWidth - 12);
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-10 max-w-[260px] items-center gap-2 rounded-xl border-2 px-4 text-sm font-extrabold uppercase tracking-wide outline-none transition focus-visible:ring-4 focus-visible:ring-[#2563eb]/20 ${
          open || value
            ? "border-[#3b82f6] bg-[#eff6ff] text-[#1d4ed8] shadow-[0_6px_16px_-10px_rgb(37_99_235/0.9)]"
            : "border-accent/25 bg-surface text-accent hover:border-accent/50 hover:bg-accent/[.04]"
        }`}
      >
        <FunnelIcon />
        <span className="truncate">{value || label}</span>
        {value && <span className="size-1.5 shrink-0 rounded-full bg-[#2563eb]" />}
        <svg viewBox="0 0 24 24" className={`size-4 shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* รายการที่เลื่อนลง: แบบเดียวกับ Dropdown ของระบบ (MenuSelect) - เผยจากกลางแล้วทยอยขึ้นทีละแถว */}
      <div ref={list} role="listbox" className={`ms-menu is-long !min-w-[220px] ${right ? "" : "!left-0 !right-auto"}`} inert={!open}>
        {items.map((x, i) => {
          const on = x.v === value;
          return (
            <button
              key={x.v || "__all"}
              type="button"
              role="option"
              aria-selected={on}
              tabIndex={open ? 0 : -1}
              onClick={() => pick(x.v)}
              className={`ms-item ${on ? "is-on" : ""}`}
              style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
            >
              <span className="truncate">{x.t}</span>
              {on && (
                <svg viewBox="0 0 24 24" className="ml-auto size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { Pager } from "@/components/tables/Pager";
