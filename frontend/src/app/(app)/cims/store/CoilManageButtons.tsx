"use client";

import { RowAction } from "@/components/button-action/RowAction";

// 🧲 ปุ่มของ MANAGE STOCK ที่อยู่ในแถวตาราง / การ์ด (แยกไฟล์ ไม่ให้ TableRows <-> CoilManage อ้างกันวน)
//   ADD    = ปุ่ม ＋ ที่บรรทัด PD CODE · ADJUST = EDIT / TRANSFER / ADJUST ที่แถว Coil ลูก
export type ManageMode = "" | "ADD" | "ADJUST" | "HIDE";

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

// HIDE mode: eye toggle at the right end of a product row / card (click = hide, or show again when already hidden)
export function HideButton({ hidden, busy, onClick }: { hidden: boolean; busy: boolean; onClick: () => void }) {
  const label = hidden ? "SHOW PRODUCT" : "HIDE PRODUCT";
  return (
    <button
      type="button"
      className="ra"
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {hidden ? (
          <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.2 6.2C3.9 7.6 2.5 10 2 12c1 2.5 5 7 10 7a9.8 9.8 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        ) : (
          <>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}

export type CoilAct = "edit" | "transfer" | "adjust";

// ปุ่ม ACTION ของ Coil ลูก 1 แถว
// open = the modal of this row is open: its button shows the red X (click = cancel)
export function CoilActions({ onAct, open }: { onAct: (a: CoilAct) => void; open?: CoilAct | null }) {
  return (
    <span className="ra-row">
      <RowAction kind="edit" title="EDIT" active={open === "edit"} onClick={() => onAct("edit")} />
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
        className={`ra mng-adj ${open === "adjust" ? "ra-cancel is-active" : ""}`}
        title={open === "adjust" ? "CANCEL" : "ADJUST (คืนยอด / ลบออก)"}
        aria-label={open === "adjust" ? "CANCEL" : "ADJUST"}
        aria-pressed={open === "adjust"}
        onClick={(e) => {
          e.stopPropagation();
          onAct("adjust");
        }}
      >
        {open === "adjust" ? (
          <svg viewBox="0 0 24 24" className="ra-ic ra-x" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        ) : (
        <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <g className="mng-scale">
            <path d="M12 4v16M7 20h10M5 7h14" />
            <path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />
          </g>
        </svg>
        )}
      </button>
    </span>
  );
}
