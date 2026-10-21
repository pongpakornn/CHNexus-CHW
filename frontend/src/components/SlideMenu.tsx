"use client";

import { useState } from "react";
import { Icon, type IconName } from "./icons";

// 📜 รายการแบบสไลด์ (โทนเทาเข้มเกือบดำ): แต่ละรายการเป็นไอคอน -> ชี้ / กด แล้วขยายออกเป็นชื่อ -> กดอีกครั้งเลื่อนรายละเอียดลงมา
export type Tone = "danger" | "warning" | "info" | "success" | "neutral";

export type SlideItem = {
  key: string;
  icon: IconName;
  label: string;
  tone?: Tone;
  badge?: number;
  detail?: React.ReactNode; // มี = กดแล้วเลื่อนรายละเอียดลงมา
  onSelect?: () => void; // ไม่มี detail = กดแล้วทำงานทันที
};

const TONE: Record<Tone, string> = {
  danger: "#f87171",
  warning: "#fbbf24",
  info: "#60a5fa",
  success: "#4ade80",
  neutral: "#d4d4d8",
};

export function SlideMenu({ items, empty }: { items: SlideItem[]; empty?: string }) {
  const [open, setOpen] = useState<string | null>(null);

  if (items.length === 0) return <div className="px-4 py-3 text-sm font-semibold text-white/60">{empty ?? "ไม่มีรายการ"}</div>;

  return (
    <ul className="flex w-64 flex-col gap-1 border-l border-white/10 pl-1">
      {items.map((it) => {
        const isOpen = open === it.key;
        const tone = TONE[it.tone ?? "neutral"];
        return (
          <li
            key={it.key}
            style={{ "--tone": tone } as React.CSSProperties}
            className={`group overflow-hidden rounded-lg border-l border-transparent bg-[#232326] transition-all duration-500 hover:w-64 hover:border-white/10 hover:shadow-lg hover:shadow-black/40 ${
              isOpen ? "w-64 border-white/10 shadow-lg shadow-black/40" : "w-14"
            }`}
          >
            <button
              type="button"
              onClick={() => (it.detail ? setOpen(isOpen ? null : it.key) : it.onSelect?.())}
              aria-expanded={it.detail ? isOpen : undefined}
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[var(--tone)] transition-all outline-none focus-visible:bg-white/5 active:scale-95"
            >
              <div className="relative shrink-0 rounded-lg border-2 border-[color-mix(in_srgb,var(--tone)_45%,transparent)] bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] p-1">
                <Icon name={it.icon} />
                {!!it.badge && (
                  <span className="absolute -right-2 -top-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--tone)] px-1 text-[10px] font-extrabold text-[#141416]">
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                )}
              </div>
              <div className="truncate whitespace-nowrap font-semibold text-white">{it.label}</div>
              {it.detail && (
                <span className={`ml-auto text-white/40 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}>
                  <Icon name="chevron" className="size-4" />
                </span>
              )}
            </button>
            {it.detail && (
              <div className={`grid overflow-hidden transition-all duration-500 ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">{it.detail}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// แถวในรายละเอียด: หัวข้อ + ค่าทางขวา + คำอธิบายบรรทัดล่าง
export function SlideRow({ title, value, sub, onClick }: { title: string; value?: React.ReactNode; sub?: string; onClick?: () => void }) {
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3">
        {onClick ? (
          <button type="button" onClick={onClick} className="peer min-w-0 cursor-pointer truncate text-left font-semibold text-white/90 hover:text-[var(--tone)]">
            {title}
          </button>
        ) : (
          <div className="min-w-0 truncate font-semibold text-white/90">{title}</div>
        )}
        {value !== undefined && <div className="shrink-0 text-sm font-bold text-white/55 transition-all peer-hover:translate-x-1">{value}</div>}
      </div>
      {sub && <div className="truncate text-xs text-white/45">{sub}</div>}
    </li>
  );
}
