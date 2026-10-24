"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

// ⋯ เมนูจุดสามจุด (แบบ IG): ลอยเหนือทุกอย่าง (ไม่ถูกกล่องเลื่อนบัง) · ที่ด้านล่างไม่พอ = เปิดขึ้นด้านบน
//   top = แถวด้านบนของเมนู เช่น อีโมจิ · กดนอกกล่อง / Esc / เลื่อนหน้า = ปิด
export type DotsItem = { label: string; icon: IconName; danger?: boolean; onSelect: () => void };

export function DotsMenu({
  items,
  top,
  align = "right",
  reveal = false,
  label = "More",
}: {
  items: DotsItem[];
  top?: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  reveal?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // วางเมนูตามตำแหน่งปุ่ม (fixed) แล้วกลับด้านถ้าล้นจอ
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const b = btn.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 160;
    const w = menu.current?.offsetWidth ?? 180;
    const up = b.bottom + h + 8 > window.innerHeight && b.top - h - 8 > 0;
    const left = Math.min(Math.max(8, align === "right" ? b.right - w : b.left), window.innerWidth - w - 8);
    setPos({ left, top: up ? b.top - h - 4 : b.bottom + 4, up });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !btn.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const scroll = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (items.length === 0 && !top) return null;
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
        className={`grid size-7 place-items-center rounded-full text-ink-soft transition hover:bg-black/[.06] hover:text-ink ${reveal && !open ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""} ${open ? "bg-black/[.06] text-ink" : ""}`}
      >
        <Icon name="dots" className="size-[18px]" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="menu-pop fixed z-[120] min-w-44 overflow-hidden rounded-2xl border border-line bg-surface p-1 shadow-[0_18px_40px_-14px_rgba(20,40,100,.45)]"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.up ? "bottom" : "top" }}
          >
            {top && <div className={items.length ? "border-b border-line/70 pb-1" : ""}>{top(close)}</div>}
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => (close(), it.onSelect())}
                className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-2.5 py-2 text-left text-[12.5px] font-bold transition ${it.danger ? "text-danger hover:bg-[#fdecec]" : "text-ink hover:bg-[#eaf1ff] hover:text-[#2563eb]"}`}
              >
                <Icon name={it.icon} className="size-4" />
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ⌨ จุดสามจุดเด้งขึ้นลง = อีกฝ่ายกำลังพิมพ์
export function TypingDots({ name }: { name?: string }) {
  return (
    <div className="flex flex-col items-start" aria-live="polite">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-[#eef0f4] px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot size-1.5 rounded-full bg-[#7b8597]" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </div>
      {name && <span className="mt-0.5 px-1 text-[10px] font-semibold text-ink-soft">{name} กำลังพิมพ์...</span>}
    </div>
  );
}
