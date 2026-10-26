"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!shown) return null;
  const view = open ? { title, children, footer } : last;
  return (
    <div className={`modal-bg fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4 ${open ? "" : "is-leaving pointer-events-none"}`} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={`modal-in flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[22px] bg-surface sm:rounded-[22px] ${size === "xl" ? "sm:max-w-[min(1680px,96vw)]" : wide ? "sm:max-w-6xl" : "sm:max-w-lg"}`}
      >
        <div className="modal-head flex items-center justify-between gap-3 px-5 py-3.5 text-white">
          <div className="min-w-0 truncate text-base font-extrabold uppercase tracking-wide">{view.title}</div>
          <button onClick={onClose} className="modal-x shrink-0" aria-label="Close">
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
