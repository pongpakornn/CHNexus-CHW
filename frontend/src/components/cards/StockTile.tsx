"use client";

import { stockIcon, tileStyle } from "@/lib/stockIcons";

// 🏬 การ์ดเลือกคลังแบบไอคอน (เหมือนปุ่ม STOCK TYPE ใน ADD / EDIT STOCK): ไอคอนประจำคลังในกรอบสี + รหัสคลัง (+ บรรทัดรอง)
//   เลือก = พื้นไล่สีประจำคลัง ตัวอักษรขาว · locked = ล็อก (ดูอย่างเดียว / ไม่มีสิทธิ์) กดไม่ได้
export function StockTile({
  code,
  index,
  type,
  on,
  onClick,
  sub,
  title,
  locked,
  dirty,
  role = "checkbox",
}: {
  code: string;
  index: number;
  type?: string | null;
  on: boolean;
  onClick: () => void;
  sub?: React.ReactNode;
  title?: string;
  locked?: boolean;
  dirty?: boolean;
  role?: "checkbox" | "radio";
}) {
  const [ic, col] = stockIcon(code, index, type);
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      title={title}
      disabled={locked}
      onClick={onClick}
      className={`st-tile group ${on ? "is-on" : ""} ${locked ? "is-locked" : ""}`}
      style={{ "--c": col, "--i": index } as React.CSSProperties}
    >
      <span className="st-tile-ic" style={on ? { background: "rgb(255 255 255 / .22)" } : tileStyle(col)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ic} alt="" className="size-6 object-contain" draggable={false} />
      </span>
      <span className="st-tile-code">
        {code}
        {dirty && <span className="adm-dirty ml-1" title="ยังไม่ได้ SAVE" />}
      </span>
      {sub && <span className="st-tile-sub">{sub}</span>}
      {locked && <span className="st-tile-lock">🔒</span>}
    </button>
  );
}
