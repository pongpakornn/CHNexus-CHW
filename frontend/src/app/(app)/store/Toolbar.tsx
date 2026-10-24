"use client";

import { useEffect, useRef, useState } from "react";

// 🔎 แถบเครื่องมือหน้าคลัง: ช่องค้นหา + ปุ่มเลือกหมวด (กดแล้วรายการเลื่อนลงมา · เปิด / เลือกอยู่ = สีฟ้า)

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="group relative flex h-10 min-w-[260px] flex-1 items-center rounded-xl border border-[#e2e4f0] bg-surface-2/60 transition focus-within:border-accent focus-within:bg-surface focus-within:shadow-[0_0_0_4px_rgb(103_80_164/0.12)] hover:border-accent/50">
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
    <div ref={box} className="relative shrink-0" onKeyDown={move}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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

      <div className={`cat-drop absolute left-0 top-[calc(100%+8px)] z-40 w-[280px] ${open ? "is-open" : ""}`} inert={!open}>
        <div className="overflow-hidden rounded-2xl border border-[#e2e4f0] bg-surface shadow-[0_24px_48px_-20px_rgb(40_45_110/0.45)]">
          <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">
            {label}
            <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[#1d4ed8]">{options.length}</span>
          </div>
          <div ref={list} role="listbox" className="max-h-[320px] overflow-y-auto p-1.5">
            {items.map((x, i) => {
              const on = x.v === value;
              return (
                <button
                  key={x.v || "__all"}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => pick(x.v)}
                  className={`cat-item flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold outline-none transition ${
                    on
                      ? "bg-gradient-to-r from-[#3b82f6] to-[#2563eb] text-white shadow-[0_6px_14px_-8px_rgb(37_99_235)]"
                      : "text-ink hover:bg-[#eff6ff] hover:text-[#1d4ed8] focus-visible:bg-[#eff6ff] focus-visible:text-[#1d4ed8]"
                  }`}
                  style={{ "--d": `${Math.min(i, 10) * 22}ms` } as React.CSSProperties}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${on ? "bg-white" : x.v ? "bg-[#93c5fd]" : "bg-ink-soft/40"}`} />
                  <span className="truncate">{x.t}</span>
                  {on && (
                    <svg viewBox="0 0 24 24" className="ml-auto size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// 📄 ปุ่มเปลี่ยนหน้า (ดีไซน์ tabs: ช่องสี่เหลี่ยมมน · หน้าที่เลือก = พื้นน้ำเงินเด้งขึ้น + จุดใต้ปุ่ม)
//    หน้าเยอะ = แสดงหน้าแรก / สุดท้าย / รอบ ๆ หน้าปัจจุบัน คั่นด้วย … · ‹ › = หน้าก่อน / ถัดไป
export function Pager({ page, pages, total, size, onPage }: { page: number; pages: number; total: number; size: number; onPage: (p: number) => void }) {
  const near = new Set([0, pages - 1, page - 1, page, page + 1]);
  if (page <= 2) [1, 2, 3].forEach((x) => near.add(x));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((x) => near.add(x));
  const list = [...near].filter((x) => x >= 0 && x < pages).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  list.forEach((x, i) => {
    if (i > 0 && x - list[i - 1] > 1) items.push("gap");
    items.push(x);
  });
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <nav className="flex flex-col items-center gap-3 pb-6 pt-1" aria-label="เปลี่ยนหน้า">
      <div className="pg-tabs">
        <button type="button" className="pg-btn pg-nav" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="หน้าก่อน">
          ‹
        </button>
        {items.map((x, i) =>
          x === "gap" ? (
            <span key={"g" + i} className="pg-gap" aria-hidden>
              …
            </span>
          ) : (
            <button type="button" key={x} className={`pg-btn ${x === page ? "is-on" : ""}`} aria-current={x === page ? "page" : undefined} onClick={() => x !== page && onPage(x)}>
              <span>{x + 1}</span>
            </button>
          ),
        )}
        <button type="button" className="pg-btn pg-nav" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="หน้าถัดไป">
          ›
        </button>
      </div>
      <div className="text-[11.5px] font-bold text-ink-soft">
        แสดง {from.toLocaleString()}–{to.toLocaleString()} จาก {total.toLocaleString()} รายการ · หน้า {page + 1} / {pages}
      </div>
    </nav>
  );
}
