"use client";

import Link from "next/link";
import type { MenuItem } from "@/lib/menu";

// 🧭 ชิ้นส่วน Sidebar (โลโก้ / เมนู / ท้าย) - Shell วางทั้งแบบ Desktop (กาง 260 / พับ 80) และ Drawer มือถือ
//   แถบเมนูที่เลือก (.sb-glider) Shell เป็นคนเลื่อนตามเมนูที่ active

// ตัวหนังสือในเมนู: วาดไว้ตลอด แค่จาง / เลื่อนออกตอนพับ = กาง-พับลื่น ไม่กระตุกจากการสร้าง / ลบ element
const hide = (compact: boolean) => (compact ? "pointer-events-none -translate-x-2 opacity-0" : "translate-x-0 opacity-100");

export function SidebarNav({ items, current, compact }: { items: MenuItem[]; current?: MenuItem; compact: boolean }) {
  return (
    <nav className="sb-nav relative flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-2">
      <span className="sb-glider" aria-hidden />
      {items.map((m) => {
        const active = current?.href === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            data-active={active}
            title={compact ? m.label : undefined}
            className={`group relative z-[1] flex items-center gap-3 overflow-hidden py-2.5 pl-[26px] pr-4 text-sm font-bold transition-all duration-300 ${
              active ? "sb-sheen text-white" : `text-white/65 hover:bg-white/[.06] hover:text-white ${compact ? "" : "hover:pl-[30px]"}`
            }`}
          >
            {/* ขีดซ้ายชิดขอบ: โผล่ตอนชี้ (เมนูที่เลือกใช้ขีดของแถบ glider) */}
            {!active && <span className="absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-white opacity-0 transition-all duration-300 group-hover:h-4 group-hover:opacity-70" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.icon}
              alt=""
              className={`h-7 w-7 shrink-0 object-contain brightness-0 invert transition-transform duration-300 ${
                active ? "scale-110 drop-shadow-[0_2px_6px_rgba(0,0,0,.35)]" : "group-hover:-rotate-6 group-hover:scale-110"
              }`}
            />
            <span className={`sb-text truncate ${hide(compact)}`}>{m.label}</span>
            {!m.ready && <span className={`sb-text ml-auto rounded bg-white/15 px-1.5 text-[10px] font-bold ${hide(compact)}`}>SOON</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-[92px] shrink-0 items-center gap-2.5 px-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/logo.png" alt="CHR-Nexus" className="h-10 w-10 shrink-0 object-contain" />
      <div className={`sb-text min-w-0 leading-tight ${hide(compact)}`}>
        <div className="whitespace-nowrap text-lg font-extrabold text-white">CHR-Nexus</div>
        <div className="whitespace-nowrap text-[9.5px] font-semibold text-white/75">CH.RADIATORS COMPANY LIMITED</div>
        <div className="whitespace-nowrap text-[10px] font-medium text-white/55">บริษัท ซีเอช เรดิเอเตอร์ จำกัด</div>
      </div>
    </div>
  );
}

// ท้าย Sidebar: "P.U." (กลาง 80) กับข้อความเต็ม (กลาง 260) จางสลับกัน
export function SidebarFooter({ compact }: { compact: boolean }) {
  return (
    <div className="relative h-9 shrink-0 whitespace-nowrap text-[10px] text-white/45">
      <span className={`sb-text absolute left-0 top-1 w-20 text-center ${compact ? "opacity-100" : "opacity-0"}`}>P.U.</span>
      <span className={`sb-text absolute inset-x-0 top-1 text-center ${hide(compact)}`}>© 2026 CHR-Nexus • Pongpakorn Urang</span>
    </div>
  );
}

