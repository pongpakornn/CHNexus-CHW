import { STATUS_COLOR } from "./types";

// 🚦 สัญญาณไฟ STATUS: ดวงไฟกลมในกรอบโลหะ · แดง (ต่ำกว่า MIN / หมด) = กะพริบ + วงแสงกระจาย · สีอื่นติดนิ่ง · ยังไม่ตั้ง MAX-MIN = ไฟดับ
export function StatusLamp({ status, size = 26, className = "" }: { status: string; size?: number; className?: string }) {
  const red = status === "UNDER_MIN" || status === "OUT_OF_STOCK";
  const off = STATUS_COLOR(status) === "#d3d3d3";
  return (
    <span
      className={`lamp ${red ? "is-blink" : ""} ${off ? "is-off" : ""} ${className}`}
      style={{ width: size, height: size, "--c": STATUS_COLOR(status) } as React.CSSProperties}
      title={status}
      role="img"
      aria-label={status}
    >
      <i />
    </span>
  );
}
