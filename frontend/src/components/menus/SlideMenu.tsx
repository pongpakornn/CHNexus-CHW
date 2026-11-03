"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icons";

// 📜 รายการในเมนูกระดิ่ง / โปรไฟล์ (พื้นใส กลืนกับระบบ): ชี้ / กด = พื้นจางๆ ขึ้นมา · มีรายละเอียด = กดแล้วเลื่อนลงมา
export type Tone = "danger" | "warning" | "info" | "success" | "neutral" | "accent";

export type SlideItem = {
  key: string;
  icon: IconName;
  label: string;
  hint?: string; // บรรทัดเล็กใต้ชื่อ
  tone?: Tone;
  badge?: number;
  detail?: React.ReactNode; // มี = กดแล้วเลื่อนรายละเอียดลงมา
  onSelect?: () => void; // ไม่มี detail = กดแล้วทำงานทันที
};

const TONE: Record<Tone, string> = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
  success: "var(--success)",
  neutral: "var(--primary)",
  accent: "var(--accent)",
};

// side = ฝั่งที่เมนูชิด: "right" = ไอคอนชิดขวา ข้อความชิดขวา (เปิดจากฝั่งขวาของจอ)
export function SlideMenu({ items, empty, side = "left" }: { items: SlideItem[]; empty?: string; side?: "left" | "right" }) {
  const [open, setOpen] = useState<string | null>(null);
  const r = side === "right";

  if (items.length === 0) return <div className="px-3 py-4 text-center text-sm font-semibold text-ink-soft">{empty ?? "ไม่มีรายการ"}</div>;

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <li
            key={it.key}
            style={{ "--tone": TONE[it.tone ?? "neutral"] } as React.CSSProperties}
            className={`overflow-hidden rounded-xl transition-colors duration-300 ${isOpen ? "bg-[color-mix(in_srgb,var(--tone)_7%,transparent)]" : ""}`}
          >
            <button
              type="button"
              onClick={() => (it.detail ? setOpen(isOpen ? null : it.key) : it.onSelect?.())}
              aria-expanded={it.detail ? isOpen : undefined}
              className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-all outline-none hover:bg-[color-mix(in_srgb,var(--tone)_9%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--tone)_9%,transparent)] active:scale-[0.98] ${
                r ? "flex-row-reverse text-right" : "text-left"
              }`}
            >
              <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--tone)_12%,transparent)] text-[var(--tone)] transition-transform duration-300 group-hover:scale-105">
                <Icon name={it.icon} className="size-5" />
                {!!it.badge && (
                  <span className={`absolute -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--tone)] px-1 text-[10px] font-extrabold text-white ring-2 ring-white/80 ${r ? "-left-1.5" : "-right-1.5"}`}>
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{it.label}</span>
                {it.hint && <span className="block truncate text-[11px] font-semibold text-ink-soft">{it.hint}</span>}
              </span>
              {it.detail && (
                <span className={`shrink-0 text-ink-soft/70 transition-transform duration-300 ${isOpen ? "rotate-90" : r ? "rotate-180" : ""}`}>
                  <Icon name="chevron" className="size-4" />
                </span>
              )}
            </button>
            {it.detail && (
              <div className={`grid transition-all duration-500 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden">{it.detail}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// แถวในรายละเอียด: หัวข้อ + ค่าทางขวา + คำอธิบายบรรทัดล่าง (กดได้ถ้ามี onClick)
export function SlideRow({ title, value, sub, onClick }: { title: string; value?: React.ReactNode; sub?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] font-bold text-ink">{title}</span>
        {value !== undefined && <span className="shrink-0 text-[13px] font-extrabold text-ink-soft tabular-nums">{value}</span>}
      </span>
      {sub && <span className="block truncate text-[11px] font-semibold text-ink-soft/80">{sub}</span>}
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className="block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left transition hover:bg-[color-mix(in_srgb,var(--tone)_10%,transparent)] active:scale-[0.98]">
          {body}
        </button>
      ) : (
        <div className="px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}

// กล่องของรายละเอียด (เว้นด้านเดียวกับไอคอน ให้ข้อความตรงกับชื่อรายการ)
export function SlideDetail({ children, side = "left" }: { children: React.ReactNode; side?: "left" | "right" }) {
  return <ul className={`flex flex-col gap-0.5 pb-2 pt-0.5 ${side === "right" ? "pl-2 pr-12" : "pl-12 pr-2"}`}>{children}</ul>;
}
