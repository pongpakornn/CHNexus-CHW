"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBubbleCorner } from "@/lib/profileCorner";
import type { ManageMode } from "./CoilManageButtons";

// 🧲 MANAGE STOCK แบบลอยติดวงกลมโปรไฟล์ (ไม่ต้องเลื่อนขึ้นไปหัวหน้า)
//   แสดงเฉพาะคลังที่เปิดอยู่ + ผู้ใช้มีสิทธิ์ MANAGE STOCK ของคลังนั้น (StockTable ส่ง meta.canManage มา)
//   ยังไม่เลือก = ปุ่มม่วง "ยังไม่ได้เลือก" · เลือกแล้ว = ปุ่มแดง บอกโหมดที่ใช้อยู่ + ✕ เลิกใช้งาน
//   กดปุ่ม = รายการเลื่อนออกแบบ Dropdown ของ Product Control (ที่เลือกอยู่ = ม่วง + ✓) · Esc / กดนอกกล่อง = ปิด
const SIZE = 52; // วงกลมโปรไฟล์
const GAP = 16;
const TOP = 76;

type Item = { key: "ADD" | "ADJUST" | "HISTORY"; title: string; detail: string; color: string };

function subscribeSize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
// ขอบซ้ายของพื้นที่เนื้อหา (ไม่ทับ Sidebar) - ตำแหน่งเดียวกับที่วงกลมโปรไฟล์ใช้
const leftEdgeNow = () => Math.round(document.querySelector("main")?.getBoundingClientRect().left ?? 0);

export function ManageDock({ stockCode, mode, onPick, onHistory }: { stockCode: string; mode: ManageMode; onPick: (m: "ADD" | "ADJUST") => void; onHistory: () => void }) {
  const corner = useBubbleCorner() ?? "br";
  const leftEdge = useSyncExternalStore(subscribeSize, leftEdgeNow, () => 0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const top = corner[0] === "t";
  const right = corner[1] === "r";

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

  const items: Item[] = [
    { key: "ADD", title: "ADD MASTER COIL", detail: "ปุ่ม ＋ ที่บรรทัด PD CODE · เพิ่ม Master Coil / Coil No", color: "#16a34a" },
    { key: "ADJUST", title: "ADJUST STOCK", detail: "ปุ่ม EDIT / TRANSFER / ADJUST ที่แถว Coil ลูก", color: "#ea580c" },
    { key: "HISTORY", title: "HISTORY", detail: `ประวัติ MANAGE STOCK ของ ${stockCode}`, color: "#6750a4" },
  ];
  const on = mode !== "";
  const label = mode === "ADD" ? "ADD MASTER COIL" : mode === "ADJUST" ? "ADJUST STOCK" : "MANAGE STOCK";

  const style: React.CSSProperties = {
    ...(top ? { top: TOP + SIZE + 12 } : { bottom: GAP + SIZE + 12 }),
    ...(right ? { right: GAP } : { left: leftEdge + GAP }),
  };

  return (
    <div ref={box} className={`mdock ${on ? "is-on" : ""} ${open ? "is-open" : ""} ${top ? "is-top" : ""} ${right ? "is-right" : ""}`} style={style}>
      <div className="mdock-menu" role="menu" aria-hidden={!open}>
        <div className="mdock-cap">MANAGE STOCK · {stockCode}</div>
        {items.map((it, i) => {
          const sel = it.key === mode;
          return (
            <button
              key={it.key}
              type="button"
              role="menuitemradio"
              aria-checked={sel}
              tabIndex={open ? 0 : -1}
              className={`ms-item mdock-item ${sel ? "is-on" : ""}`}
              style={{ "--i": i, "--c": it.color } as React.CSSProperties}
              onClick={() => {
                setOpen(false);
                if (it.key === "HISTORY") onHistory();
                else onPick(it.key);
              }}
            >
              <span className="ms-dot" />
              <span className="min-w-0 flex-1">
                <b className="block truncate">{it.title}</b>
                <small className="block truncate">{sel ? "● กำลังใช้งาน · กดอีกครั้ง = เลิกใช้" : it.detail}</small>
              </span>
              {sel && (
                <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <div className="mdock-pill">
        <button type="button" className="mdock-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={on ? `กำลังใช้ ${label} · กดเพื่อเปลี่ยน` : "เลือกโหมด MANAGE STOCK"}>
          <span className="mdock-ic" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="12" cy="12" r="1.3" />
            </svg>
          </span>
          <span className="mdock-tx">
            <small key={on ? "on" : "off"}>{on ? "● กำลังใช้งาน" : "ยังไม่ได้เลือก"} · {stockCode}</small>
            <b key={label}>{label}</b>
          </span>
          {!on && (
            <span className="ms-bars" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          )}
        </button>
        {on && (
          <button type="button" className="mdock-x" aria-label={`เลิกใช้ ${label}`} title="เลิกใช้งาน (EXIT)" onClick={() => (setOpen(false), onPick(mode as "ADD" | "ADJUST"))}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
