"use client";

import { useCallback, useState } from "react";

// 📂 หมวดที่พับ / กางอยู่ของตาราง (key ของกลุ่ม)
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = useCallback(
    (k: string) =>
      setCollapsed((cur) => {
        const n = new Set(cur);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
      }),
    [],
  );
  return [collapsed, toggle] as const;
}

// 🏷️ แถวหัวหมวดในตาราง (แบบเดียวกับหน้าคลังย่อย): ไอคอนคลัง · ชื่อหมวด : ค่า · ป้ายจำนวน ITEMS · ลูกศรพับ / กาง
//    กดทั้งแถว = พับ / กางรายการของหมวดนี้
export function GroupRow({ colSpan, label, value, count, collapsed, onToggle }: { colSpan: number; label: string; value: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <tr className="cursor-pointer hover:!bg-transparent" onClick={onToggle} aria-expanded={!collapsed}>
      <td colSpan={colSpan} className="!p-0">
        <div className="grp-row flex h-[44px] items-center gap-2 border-y border-[#dfe3fb] bg-[linear-gradient(90deg,#eef1ff,#f7f8ff_55%,#ffffff)] pl-4 text-[#3730a3]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/store/warehouse.webp" alt="" className="size-7" draggable={false} />
          <span className="text-sm font-bold">{label} :</span>
          <span className="text-[15px] font-extrabold">{value || "-"}</span>
          <span className="grp-count ml-3 rounded-full bg-[#4f46e5] px-3 py-1 text-[10px] font-bold text-white shadow-[0_4px_10px_-6px_#4f46e5]">{count.toLocaleString()} ITEMS</span>
          <span className={`group-chev ml-auto mr-4 ${collapsed ? "" : "is-open"}`} aria-hidden>
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3.5L10.5 8 6 12.5" />
            </svg>
          </span>
        </div>
      </td>
    </tr>
  );
}
