"use client";

// 🎯 ปุ่ม Action ในตาราง แบบไอคอนไม่มีพื้นหลัง (จาก ProjectDevHub buttonv2) + อนิเมชันตอนชี้
//   view   = ตา: ม่านตาขยาย-หด
//   edit   = ดินสอเขียนจริง: ดินสอเลื่อนไปพร้อมลากเส้นหมึกใต้ปลายดินสอ
//   hide   = ตา + ขีดฆ่า: ชี้แล้วขีดเส้นทับ (shown=false = ซ่อนอยู่ ชี้แล้วเส้นหาย ตาเปิด)
//   delete = ถังขยะ: ฝาเปิดพลิกขึ้น
//   reset  = ลูกศรวน: หมุน 1 รอบ
export type RowActionKind = "view" | "edit" | "hide" | "delete" | "reset";

const TITLE: Record<RowActionKind, string> = { view: "VIEW", edit: "EDIT", hide: "HIDE", delete: "DELETE", reset: "RESET" };

export function RowAction({
  kind,
  onClick,
  title,
  disabled,
  active,
  shown = true,
}: {
  kind: RowActionKind;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  /** กำลังดู / กำลังแก้แถวนี้อยู่ = ไอคอนเป็นสีของปุ่มค้างไว้ */
  active?: boolean;
  /** hide: true = แสดงอยู่ (กดเพื่อซ่อน) / false = ซ่อนอยู่ (กดเพื่อแสดง) */
  shown?: boolean;
}) {
  // active = the row's form/modal is open: same button becomes a red X that cancels
  const t = active ? "CANCEL" : title ?? (kind === "hide" ? (shown ? "HIDE" : "SHOW") : TITLE[kind]);
  return (
    <button
      type="button"
      className={`ra ra-${active ? "cancel" : kind} ${active ? "is-active" : ""} ${kind === "hide" && !shown ? "is-off" : ""}`}
      title={t}
      aria-label={t}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : !!active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {active && (
        <svg viewBox="0 0 24 24" className="ra-ic ra-x" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      )}
      {!active && kind === "view" && (
        <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" className="ra-pupil" />
        </svg>
      )}
      {!active && kind === "edit" && (
        <svg viewBox="0 0 24 26" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.6 24.4q1.7-2 3.4 0t3.4 0 3.4 0" className="ra-ink" pathLength={1} />
          <g className="ra-pencil">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </g>
        </svg>
      )}
      {!active && kind === "hide" && (
        <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <g className="ra-eye">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" className="ra-pupil" />
          </g>
          <path d="M3.5 3.5 20.5 20.5" className="ra-slash" pathLength={1} />
        </svg>
      )}
      {!active && kind === "delete" && (
        <span className="ra-bin" aria-hidden>
          <svg viewBox="0 0 69 14" className="ra-bin-top" fill="currentColor">
            <path d="M20.8232 2.62734L19.9948 4.21304C19.8224 4.54309 19.4808 4.75 19.1085 4.75H4.92857C2.20246 4.75 0 6.87266 0 9.5C0 12.1273 2.20246 14.25 4.92857 14.25H64.0714C66.7975 14.25 69 12.1273 69 9.5C69 6.87266 66.7975 4.75 64.0714 4.75H49.8915C49.5192 4.75 49.1776 4.54309 49.0052 4.21305L48.1768 2.62734C47.3451 1.00938 45.6355 0 43.7719 0H25.2281C23.3645 0 21.6549 1.00938 20.8232 2.62734Z" />
          </svg>
          <svg viewBox="0 0 69 57" className="ra-bin-body" fill="currentColor">
            <path d="M64.0023 1.0648C64.0397 0.4882 63.5822 0 63.0044 0H5.99556C5.4178 0 4.96025 0.4882 4.99766 1.0648L8.19375 50.3203C8.44018 54.0758 11.6746 57 15.5712 57H53.4288C57.3254 57 60.5598 54.0758 60.8062 50.3203L64.0023 1.0648Z" />
          </svg>
        </span>
      )}
      {!active && kind === "reset" && (
        <svg viewBox="0 0 24 24" className="ra-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <g className="ra-spin">
            <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
            <path d="M3.5 3.5v4.2h4.2" />
          </g>
        </svg>
      )}
    </button>
  );
}

// แถวปุ่ม Action (ชิดกัน ไม่มีพื้นหลัง)
export function RowActions({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`ra-row ${className}`}>{children}</div>;
}
