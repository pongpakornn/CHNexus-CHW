"use client";

import { RowAction } from "@/components/button-action/RowAction";

// 🧲 ปุ่มของ MANAGE STOCK ที่อยู่ในแถวตาราง / การ์ด (แยกไฟล์ ไม่ให้ TableRows <-> CoilManage อ้างกันวน)
//   ADD    = ปุ่ม ＋ ที่บรรทัด PD CODE · ADJUST = EDIT / TRANSFER / ADJUST ที่แถว Coil ลูก
export type ManageMode = "" | "ADD" | "ADJUST";

// ปุ่ม ＋ ที่บรรทัด PD CODE
export function AddCoilButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="ra mng-add"
      title="ADD MASTER COIL / NUMBER COIL"
      aria-label="ADD MASTER COIL / NUMBER COIL"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

export type CoilAct = "edit" | "transfer" | "adjust";

// ปุ่ม ACTION ของ Coil ลูก 1 แถว
export function CoilActions({ onAct }: { onAct: (a: CoilAct) => void }) {
  return (
    <span className="ra-row">
      <RowAction kind="edit" title="EDIT" onClick={() => onAct("edit")} />
      <button
        type="button"
        className="ra mng-move"
        title="TRANSFER (สแกนออก)"
        aria-label="TRANSFER"
        onClick={(e) => {
          e.stopPropagation();
          onAct("transfer");
        }}
      >
        <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <g className="mng-truck">
            <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
            <circle cx="6.5" cy="17.5" r="1.7" />
            <circle cx="17" cy="17.5" r="1.7" />
          </g>
        </svg>
      </button>
      <button
        type="button"
        className="ra mng-adj"
        title="ADJUST (คืนยอด / ลบออก)"
        aria-label="ADJUST"
        onClick={(e) => {
          e.stopPropagation();
          onAct("adjust");
        }}
      >
        <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <g className="mng-scale">
            <path d="M12 4v16M7 20h10M5 7h14" />
            <path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />
          </g>
        </svg>
      </button>
    </span>
  );
}
