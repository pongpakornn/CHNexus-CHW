"use client";

import { useEffect, useRef, useState } from "react";

export type MenuAction = {
  key: string;
  title: string;
  detail: string;
  color: string;
  icon: "export" | "import" | "template" | "coil";
  busy?: boolean;
  onClick: () => void;
};

// ไอคอนในวงกลม (ชุดเดียวกับ Stock Radial Menu): ลูกศร + ถาด / แถบปรับ / ม้วน Coil
function ActionIcon({ icon }: { icon: MenuAction["icon"] }) {
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
      {icon === "template" ? (
        <>
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" />
        </>
      )}
    </svg>
  );
}

// 🎛️ ปุ่มเมนูวงกลม (EXPORT / IMPORT / TEMPLATE / COIL TEMPLATE) แทนแถวปุ่มหัวหน้าคลัง
//    เมนูกางเป็นเสี้ยววงกลมไปทางซ้าย-ล่างของปุ่ม (ไม่ล้นขึ้นไปทับแถบเมนูด้านบน) · ชี้ที่รายการ = การ์ดดำอธิบาย
//    กดนอกเมนู / Esc / เลือกรายการ = ปิด
export function ActionMenu({ actions }: { actions: MenuAction[] }) {
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

  // วางรายการบนเสี้ยววงกลม 180° (ซ้าย) -> 270° (ล่าง) เว้นเท่า ๆ กัน
  const n = actions.length;
  const R = 120;
  const at = (i: number) => {
    const deg = n === 1 ? 225 : 180 + (90 * i) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.round(Math.cos(rad) * R), dy: Math.round(-Math.sin(rad) * R), side: deg < 250 ? "left" : "bottom" };
  };

  return (
    <div ref={box} className={`rm relative z-40 flex items-center gap-3 ${open ? "is-open" : ""}`}>
      <span className="rm-caption hidden text-right text-[11px] font-extrabold leading-tight tracking-wide text-ink-soft sm:block">
        EXCEL
        <br />
        <span className="font-bold text-[#9a95a6]">EXPORT · IMPORT</span>
      </span>
      <div className="relative size-[56px]">
        <button
          type="button"
          className="rm-fab"
          aria-expanded={open}
          aria-label="เมนู Excel ของคลัง"
          title="EXPORT / IMPORT / TEMPLATE"
          onClick={() => setOpen((o) => !o)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/store/excel.png" alt="" className={`rm-fab-ic ${busy ? "animate-pulse" : ""}`} draggable={false} />
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
                disabled={a.busy}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                <ActionIcon icon={a.icon} />
              </button>
              <div className="rm-tip" role="tooltip">
                <b>{a.busy ? "⏳ " : ""}{a.title}</b>
                <p>{a.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
