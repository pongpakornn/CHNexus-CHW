"use client";

// 🗂 การ์ดตัวเลือกในหน้าต่าง (แบบการ์ดคลังหน้า Store / Max-Min): แถบสี · ไอคอนในกรอบไล่สี · หัวข้อ / คำอธิบาย / ป้าย · ลูกศรเลื่อนเข้าตอนชี้
//   ใช้กับ TEMPLATE EXCEL / EXPORT QR / EXPORT PR / ตัวเลือก IMPORT ฯลฯ
export function ChoiceCard({
  color,
  icon,
  title,
  detail,
  meta,
  on,
  disabled,
  onClick,
  delay = 0,
}: {
  color: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  meta?: React.ReactNode;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** ลำดับการ์ด (หน่วงอนิเมชันตอนเปิด) */
  delay?: number;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`adm-card ch-card ${on ? "is-on" : ""}`} style={{ "--c": color, animationDelay: `${delay * 60}ms` } as React.CSSProperties}>
      <span className="adm-bar" />
      <span className="adm-ic" style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${color} 62%, white), ${color})`, boxShadow: `0 6px 14px -7px ${color}, inset 0 1px 0 rgb(255 255 255 / .35)` }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-extrabold leading-snug text-[#1f2350]">{title}</span>
        {detail && <span className="mt-1 block text-xs font-semibold leading-relaxed text-ink-soft">{detail}</span>}
        {meta && (
          <span className="mt-2 inline-block rounded-lg px-2 py-0.5 text-[11px] font-extrabold" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
            {meta}
          </span>
        )}
      </span>
      <span className="ch-go" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

// ไอคอนเส้นสีขาวในกรอบการ์ด
export function Glyph({ d, children }: { d?: string; children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const GLYPH = {
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5",
  check: "M4 4h16v16H4zM8 12.3l2.8 2.8L16.5 9.3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  sheet: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  calc: "M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z",
  upload: "M12 16V4M7 9l5-5 5 5M4 17v3h16v-3",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  days: "M4 5h16v15H4zM4 9.5h16M8 3v4M16 3v4M8 13.5h2M14 13.5h2M8 16.5h2",
  download: "M12 4v12M7 11l5 5 5-5M4 17v3h16v-3",
};
