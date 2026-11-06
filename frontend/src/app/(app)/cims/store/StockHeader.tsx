"use client";

import { stockIcon, tileStyle } from "@/lib/stockIcons";
import type { Stock } from "./types";

// 🏷️ หัวหน้าคลังย่อย: ปุ่มย้อนกลับ (ALL STOCKS) + ไอคอนประจำคลัง + รหัสคลัง / ป้าย + ชิปชื่อคลัง / หน่วย · ขวา = เมนู (actions)
//    ปุ่มย้อนกลับ: ชี้ = พื้นม่วง ลูกศรขยับไปซ้าย-กลับ · กด = ยุบ · หัวทั้งแถบเลื่อนเข้าตอนเปิดหน้า
export function StockHeader({ stock: s, readOnlyNote, onBack, actions }: { stock: Stock; readOnlyNote?: string; onBack: () => void; actions?: React.ReactNode }) {
  const [ic, col] = stockIcon(s.code, 0, s.stockType);
  return (
    <div className="stk-head flex flex-wrap items-center gap-3">
      <button type="button" className="back-btn" onClick={onBack} title="กลับไปหน้ารวมคลัง (ALL STOCKS)" aria-label="Back to all stocks">
        <span className="back-ic">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </span>
        <span className="back-txt hidden sm:inline">ALL STOCKS</span>
      </button>

      <span className="stk-tile grid size-12 shrink-0 place-items-center rounded-[16px]" style={tileStyle(col)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ic} alt="" className="size-7 object-contain" draggable={false} />
      </span>

      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight text-primary md:text-2xl">
          {s.code}
          {s.isMain && (
            <span className="rounded-md px-2 py-0.5 text-[10px] font-black tracking-wider text-white" style={{ background: col }}>
              MAIN
            </span>
          )}
          {s.isLiveView && <span className="rounded-md bg-danger px-2 py-0.5 text-[10px] font-black tracking-wider text-white">🔴 LIVE (READ ONLY)</span>}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold">
          <span className="stk-chip" style={{ color: col, background: `color-mix(in srgb, ${col} 10%, transparent)` }}>
            {s.name}
          </span>
          <span className="stk-chip bg-surface-2 text-ink-soft">UNIT : {s.unitDisplay}</span>
          {readOnlyNote && <span className="stk-chip bg-[#fff4e5] text-[#b45309]">{readOnlyNote}</span>}
        </div>
      </div>

      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
