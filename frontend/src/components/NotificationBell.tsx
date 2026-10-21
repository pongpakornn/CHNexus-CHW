"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Icon, type IconName } from "./icons";
import { SlideMenu, SlideRow, type Tone } from "./SlideMenu";

// 🔔 กระดิ่งมุมขวาบน: สินค้าต่ำกว่า MIN / PR รออนุมัติ / NOT DEDUCTED (ข้อมูลจริงตามสิทธิ์) - กดแล้วเมนูสไลด์ลงมา
type Row = { label: string; sub?: string; count: number; href: string };
type Item = { key: string; tone: Tone; title: string; count: number; detail: string; rows: Row[] };
type Data = { total: number; items: Item[]; time: string };

const ICON: Record<string, IconName> = { MIN: "triangle", PR: "docCheck", DEDUCT: "sync" };
const POLL_MS = 30000;

export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<Data>("/notifications").then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  // ปิดเมื่อกดนอกกล่อง / Esc
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const total = data?.items.reduce((s, i) => s + i.count, 0) ?? 0;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className="bell-btn"
        onClick={() => {
          if (!open) load();
          setOpen((o) => !o);
        }}
        aria-label={total ? `การแจ้งเตือน ${total} รายการ` : "การแจ้งเตือน"}
        aria-expanded={open}
      >
        <Icon name="bell" className="size-5" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-extrabold text-white ring-2 ring-surface">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="menu-pop absolute right-0 top-[52px] z-50 max-h-[calc(100dvh-80px)] w-max max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#141416] p-2 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between gap-6 px-2 pb-2 pt-1">
            <div className="text-sm font-extrabold text-white">การแจ้งเตือน</div>
            {data && <div className="text-[11px] font-semibold text-white/40">อัพเดท {data.time}</div>}
          </div>
          <SlideMenu
            side="right"
            empty="ไม่มีเรื่องที่ต้องจัดการ"
            items={(data?.items ?? []).map((n) => ({
              key: n.key,
              icon: ICON[n.key] ?? "bell",
              label: n.title,
              tone: n.tone,
              badge: n.count,
              detail: (
                <ul className="divide-y divide-white/10 p-4 pt-0">
                  <li className="py-1.5 text-xs font-semibold text-white/45">{n.detail}</li>
                  {n.rows.map((r) => (
                    <SlideRow key={r.label} title={r.label} sub={r.sub} value={r.count.toLocaleString()} onClick={() => go(r.href)} />
                  ))}
                </ul>
              ),
            }))}
          />
        </div>
      )}
    </div>
  );
}
