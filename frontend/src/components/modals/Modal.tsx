"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isTopOverlay, pushOverlay } from "@/lib/overlayStack";

// หน้าต่างกลางจอ (แทน Window.ShowDialog ของ WPF) - Esc = ปิด
//   พื้นหลังเบลอ · การ์ดเด้งเข้า / จางออกตอนปิด · หัวไล่สีเข้ม + เส้นม่วง · มือถือ = แผ่นเลื่อนขึ้นจากล่าง
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  size,
  flush,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** xl = กว้างเกือบเต็มจอ (ตารางหลายคอลัมน์) */
  size?: "xl";
  /** เนื้อหาชิดขอบ (ไม่มีระยะขอบ / ไม่เลื่อนเอง) - หน้าต่างที่มี Sidebar จัดวางเอง */
  flush?: boolean;
}) {
  // ปิดแล้วยังวาดค้างไว้ 180 ms ให้เล่นอนิเมชันจางออก (เนื้อหาเดิมจำไว้ระหว่างนั้น)
  const [shown, setShown] = useState(open);
  const [last, setLast] = useState({ title, children, footer });
  if (open && !shown) setShown(true);
  if (open && (last.title !== title || last.children !== children || last.footer !== footer)) setLast({ title, children, footer });

  useEffect(() => {
    if (open || !shown) return;
    const t = setTimeout(() => setShown(false), 180);
    return () => clearTimeout(t);
  }, [open, shown]);

  // Esc closes only the topmost overlay (a confirm box or a second Modal on top keeps this one open)
  const ovId = useRef<symbol | null>(null);
  useEffect(() => {
    if (!open) return;
    const ov = pushOverlay();
    ovId.current = ov.id;
    return () => ov.pop();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && ovId.current && isTopOverlay(ovId.current) && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  // Keyboard focus: move into the window when it opens (the window itself, so no on-screen keyboard pops up),
  // keep Tab inside the topmost window, and give focus back to the button that opened it when it closes.
  const dlg = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      if (dlg.current && !dlg.current.contains(document.activeElement)) dlg.current.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, [open]);
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ovId.current || !isTopOverlay(ovId.current) || !dlg.current) return;
    const items = Array.from(dlg.current.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
    if (items.length === 0) return void e.preventDefault();
    const first = items[0];
    const lastEl = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === dlg.current)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && at === lastEl) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!shown) return null;
  const view = open ? { title, children, footer } : last;
  return (
    <div className={`modal-bg fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4 ${open ? "" : "is-leaving pointer-events-none"}`} onMouseDown={onClose}>
      <div
        ref={dlg}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        onMouseDown={(e) => e.stopPropagation()}
        className={`modal-in flex max-h-[92dvh] w-full outline-none flex-col overflow-hidden rounded-t-[22px] bg-surface sm:rounded-[22px] ${size === "xl" ? "sm:max-w-[min(1680px,96vw)]" : wide ? "sm:max-w-6xl" : "sm:max-w-lg"}`}
      >
        <div className="modal-head flex items-center justify-between gap-3 px-5 py-3.5 text-white">
          <div id={titleId} className="min-w-0 truncate text-base font-extrabold uppercase tracking-wide">{view.title}</div>
          <button onClick={onClose} className="modal-x shrink-0" aria-label="ปิด">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>
        <div className={`modal-body min-h-0 flex-1 ${flush ? "flex overflow-hidden" : "overflow-auto p-4 sm:p-5"}`}>{view.children}</div>
        {view.footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eeecf3] bg-[#faf9fd] px-4 py-3 sm:px-5">{view.footer}</div>}
      </div>
    </div>
  );
}
