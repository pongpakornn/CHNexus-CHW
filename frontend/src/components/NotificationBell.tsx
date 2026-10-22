"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Icon, type IconName } from "./icons";
import { SlideDetail, SlideMenu, SlideRow, type Tone } from "./SlideMenu";

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
        <div className="menu-pop glass-panel absolute right-0 top-[52px] z-50 max-h-[calc(100dvh-80px)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain p-2">
          <div className="flex items-baseline justify-between gap-6 px-2.5 pb-1.5 pt-1">
            {data && <div className="text-[11px] font-semibold text-ink-soft">อัพเดท {data.time}</div>}
            <div className="ml-auto text-sm font-extrabold text-ink">การแจ้งเตือน</div>
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
              hint: n.detail,
              detail: (
                <SlideDetail side="right">
                  {n.rows.map((r) => (
                    <SlideRow key={r.label} title={r.label} sub={r.sub} value={r.count.toLocaleString()} onClick={() => go(r.href)} />
                  ))}
                </SlideDetail>
              ),
            }))}
          />
        </div>
      )}
    </div>
  );
}
