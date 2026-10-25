"use client";

import { useEffect, useRef, useState } from "react";

export type MenuIcon = "export" | "import" | "template" | "coil" | "qr" | "approve" | "delete" | "alert" | "contact" | "setup" | "user" | "formula" | "calendar" | "calc" | "admin";

export type MenuAction = {
  key: string;
  title: string;
  detail: string;
  color: string;
  icon: MenuIcon;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

// เส้นไอคอนแบบ stroke (ชุดเดียวกัน) ของแต่ละรายการ
const PATHS: Partial<Record<MenuIcon, React.ReactNode>> = {
  template: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  coil: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5" />
    </>
  ),
  approve: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.6 2.6L16.2 9.5" />
    </>
  ),
  delete: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  alert: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  contact: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16.2a3.4 3.4 0 0 1 6.4 0M14.5 10h3.5M14.5 13.5h3.5" />
    </>
  ),
  setup: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" />
    </>
  ),
  formula: <path d="M15 4.5h-2.5a2 2 0 0 0-2 2V18a2 2 0 0 1-2 2H6M7.5 10.5h7M15 13.5l5 5M20 13.5l-5 5" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h2M14 13.5h2M8 16.5h2" />
    </>
  ),
  admin: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a1.5 1.5 0 0 0 2.1 2.1l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.3-.5-.5-2.3z" />,
  calc: <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" />,
  user: (
    <>
      <circle cx="10" cy="8" r="3.6" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0M18.5 8v6M15.5 11h6" />
    </>
  ),
};

// ไอคอนในวงกลม: ลูกศร + ถาด (EXPORT / IMPORT) หรือเส้นไอคอนตามรายการ
function ActionIcon({ icon }: { icon: MenuIcon }) {
  if (icon === "export" || icon === "import")
    return (
      <>
        <svg className={`rm-ic ${icon === "export" ? "rotate-180" : ""}`} viewBox="0 0 384 512" aria-hidden>
          <path d="M169.4 470.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 370.8 224 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 306.7L54.6 265.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z" fill="currentColor" />
        </svg>
        <span className="rm-tray" />
      </>
    );
  return (
    <svg className="rm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[icon]}
    </svg>
  );
}

// 🎛️ ปุ่มเมนูวงกลม (เช่น EXCEL: EXPORT / IMPORT / TEMPLATE) แทนแถวปุ่ม
//    กางเป็นเสี้ยววงกลมลงล่าง: dir="left" (ปุ่มชิดขวา) = ซ้าย -> ล่าง · dir="right" (ปุ่มชิดซ้าย) = ขวา -> ล่าง
//    ชี้ที่รายการ = การ์ดดำอธิบาย · กดนอกเมนู / Esc / เลือกรายการ = ปิด
export function ActionMenu({
  actions,
  caption = ["EXCEL", "EXPORT · IMPORT"],
  fab = "/images/store/excel.png",
  fabColor,
  label = "เมนู Excel",
  dir = "left",
}: {
  actions: MenuAction[];
  caption?: [string, string] | null;
  fab?: string | React.ReactNode;
  fabColor?: string;
  label?: string;
  dir?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const busy = actions.some((a) => a.busy);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (actions.length === 0) return null;

  // วางรายการบนเสี้ยววงกลมรอบมุมซ้าย-ล่าง (225°) / ขวา-ล่าง (315°) ระยะห่างระหว่างปุ่มเท่ากันทุกเมนู
  //   2 รายการ = ชิดกัน (ไม่กางกว้างจนดูห่าง) · 3-4 รายการ = กางเต็มเสี้ยว 90° · รัศมีเล็กลงพอให้ปุ่มไม่ชนกัน
  const n = actions.length;
  const R = n >= 4 ? 108 : n === 3 ? 92 : 84;
  const span = Math.min(90, (n - 1) * 42);
  const at = (i: number) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const deg = dir === "left" ? 225 - span / 2 + span * t : 315 + span / 2 - span * t;
    const rad = (deg * Math.PI) / 180;
    const side = dir === "left" ? (deg < 250 ? "left" : "bottom") : deg > 290 ? "right" : "bottom-r";
    return { dx: Math.round(Math.cos(rad) * R), dy: Math.round(-Math.sin(rad) * R), side };
  };
  const capEl = caption && (
    <span className={`rm-caption hidden text-[11px] font-extrabold leading-tight tracking-wide text-ink-soft sm:block ${dir === "left" ? "text-right" : "text-left"}`}>
      {caption[0]}
      <br />
      <span className="font-bold text-[#9a95a6]">{caption[1]}</span>
    </span>
  );

  return (
    <div ref={box} className={`rm rm-${dir} relative z-40 flex items-center gap-3 ${open ? "is-open" : ""}`}>
      {dir === "left" && capEl}
      <div className="relative size-[56px] shrink-0">
        <button
          type="button"
          className="rm-fab"
          style={fabColor ? ({ background: fabColor } as React.CSSProperties) : undefined}
          aria-expanded={open}
          aria-label={label}
          title={actions.map((a) => a.title).join(" / ")}
          onClick={() => setOpen((o) => !o)}
        >
          {typeof fab === "string" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fab} alt="" className={`rm-fab-ic ${busy ? "animate-pulse" : ""}`} draggable={false} />
          ) : (
            <span className={`rm-fab-ic grid place-items-center text-white ${busy ? "animate-pulse" : ""}`}>{fab}</span>
          )}
        </button>
        {actions.map((a, i) => {
          const p = at(i);
          return (
            <div
              key={a.key}
              className={`rm-item is-${p.side}`}
              style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--d": `${i * 45}ms`, "--c": a.color } as React.CSSProperties}
            >
              <button
                type="button"
                className="rm-btn"
                tabIndex={open ? 0 : -1}
                aria-label={a.title}
                disabled={a.busy || a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                <ActionIcon icon={a.icon} />
              </button>
              <div className="rm-tip" role="tooltip">
                <b>
                  {a.busy ? "⏳ " : ""}
                  {a.title}
                </b>
                <p>{a.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
      {dir === "right" && capEl}
    </div>
  );
}
