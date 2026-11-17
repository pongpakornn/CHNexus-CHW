"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBubbleCorner, type Corner } from "@/lib/profileCorner";
import type { ManageMode } from "./CoilManageButtons";

// 🧲 MANAGE STOCK = ปุ่มวงกลมลอย (ขนาด / การลากย้ายแบบวงกลมโปรไฟล์ · ลากไปมุมไหนก็ได้ 4 มุม จำไว้ในเครื่อง)
//   แสดงเฉพาะคลังที่เปิดอยู่ + ผู้ใช้มีสิทธิ์ MANAGE STOCK ของคลังนั้น (StockTable ส่ง meta.canManage มา)
//   กดวงกลม = ปุ่มกลมแยกออกมาเป็นเสี้ยววงกลม (แบบปุ่ม MIN REPORT) กางเข้าหากลางจอตามมุมที่วาง · ชี้ = การ์ดดำอธิบาย
//   เลือกแล้ว = วงกลมเป็นสีแดง + ✕ · กด ✕ ที่วงกลมเดิม = เลิกใช้งาน
//   อยู่มุมเดียวกับวงกลมโปรไฟล์ = ซ้อนถัดจากโปรไฟล์ (ไม่ทับกัน) · Esc / กดนอกกล่อง = ปิดรายการ
const SIZE = 52; // เท่าวงกลมโปรไฟล์
const GAP = 16;
const TOP = 76;
const KEY = "nexus.manageCorner";
const EVT = "nexus-manage-corner";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

type Item = { key: "ADD" | "ADJUST" | "HISTORY" | "HIDE"; title: string; detail: string; color: string; icon: React.ReactNode };
const R = 92; // รัศมีที่ปุ่มกางออก (เท่าเมนู 3 รายการของ MIN REPORT)

function readCorner(): Corner {
  try {
    const v = localStorage.getItem(KEY) as Corner | null;
    if (v && CORNERS.includes(v)) return v;
  } catch {
    /* ใช้มุมเริ่มต้น */
  }
  return "br";
}
function subscribeCorner(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => (window.removeEventListener(EVT, cb), window.removeEventListener("storage", cb));
}
function saveCorner(c: Corner) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* จำไม่ได้ก็ใช้ได้ในหน้านี้ */
  }
  window.dispatchEvent(new Event(EVT));
}
function subscribeSize(cb: () => void) {
  window.addEventListener("resize", cb);
  window.visualViewport?.addEventListener("resize", cb);
  return () => (window.removeEventListener("resize", cb), window.visualViewport?.removeEventListener("resize", cb));
}
const sizeNow = () => `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`;

export function ManageDock({ stockCode, mode, onPick, onHistory, onHide }: { stockCode: string; mode: ManageMode; onPick: (m: "ADD" | "ADJUST") => void; onHistory: () => void; onHide: () => void }) {
  const corner = useSyncExternalStore(subscribeCorner, readCorner, () => "br" as Corner);
  const profile = useBubbleCorner();
  const size = useSyncExternalStore(subscribeSize, sizeNow, () => "0x0");
  const [w, h] = size.split("x").map(Number);
  const [leftEdge, setLeftEdge] = useState(0);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);

  // ขอบซ้ายของพื้นที่เนื้อหา (ไม่ทับ Sidebar) แบบวงกลมโปรไฟล์
  useEffect(() => {
    const el = document.querySelector("main");
    if (!el) return;
    const ro = new ResizeObserver(() => setLeftEdge(el.getBoundingClientRect().left));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => (document.removeEventListener("pointerdown", down), document.removeEventListener("keydown", key));
  }, [open]);

  if (!w) return null;
  const on = mode !== "";
  const label = mode === "ADD" ? "ADD MASTER COIL" : mode === "ADJUST" ? "ADJUST STOCK" : "MANAGE STOCK";
  const top = corner[0] === "t";
  const right = corner[1] === "r";
  // มุมเดียวกับวงกลมโปรไฟล์ = ซ้อนถัดไป (มุมบน = ใต้โปรไฟล์ · มุมล่าง = เหนือโปรไฟล์)
  const stack = profile === corner ? SIZE + 12 : 0;
  const home = {
    left: right ? w - SIZE - GAP : leftEdge + GAP,
    top: top ? TOP + stack : h - SIZE - GAP - stack,
  };
  const pos = drag ?? home;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), max);

  const items: Item[] = [
    {
      key: "ADD",
      title: "ADD MASTER COIL",
      detail: "เปิดปุ่ม ＋ ที่บรรทัด PD CODE · เพิ่ม Master Coil / Number Coil ที่ยังไม่มีในคลัง",
      color: "#16a34a",
      icon: <path d="M12 5v14M5 12h14" />,
    },
    {
      key: "ADJUST",
      title: "ADJUST STOCK",
      detail: "เปิดปุ่ม EDIT / TRANSFER / ADJUST ที่แถว Coil ลูก · แก้ไข · โอนตัดสต็อก · ปรับยอด",
      color: "#ea580c",
      icon: <path d="M12 4v16M7 20h10M5 7h14M5 7 2.5 13a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />,
    },
    {
      key: "HISTORY",
      title: "HISTORY",
      detail: `ประวัติ MANAGE STOCK ของ ${stockCode} (ใคร · ทำอะไร · เมื่อไร)`,
      color: "#6750a4",
      icon: (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      ),
    },
    {
      key: "HIDE",
      title: "HIDE",
      detail: `ซ่อนปุ่ม MANAGE STOCK ของ ${stockCode} ในเครื่องนี้ · เปิดคืนที่เมนู ⋯ › SHOW MANAGE STOCK`,
      color: "#64748b",
      icon: <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.2 6.2C3.9 7.6 2.5 10 2 12c1 2.5 5 7 10 7a9.8 9.8 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
    },
  ];
  // กางเข้าหากลางจอ: มุมขวาล่าง = ขึ้น → ซ้าย · ซ้ายล่าง = ขึ้น → ขวา · ขวาบน = ลง → ซ้าย · ซ้ายบน = ลง → ขวา (90°)
  const base = top ? (right ? 180 : 270) : right ? 90 : 0;
  const at = (i: number) => {
    const deg = base + (90 * i) / (items.length - 1);
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.round(Math.cos(rad) * R), dy: Math.round(-Math.sin(rad) * R) };
  };

  // กด = เปิดรายการ (เลือกอยู่ = เลิกใช้งาน) · ลาก = ย้ายมุม (ปล่อยแล้วเข้ามุมที่ใกล้ที่สุด)
  const tap = () => {
    if (on) {
      setOpen(false);
      onPick(mode as "ADD" | "ADJUST");
    } else setOpen((o) => !o);
  };
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    start.current = { px: e.clientX, py: e.clientY, ox: pos.left, oy: pos.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px,
      dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 6) return;
    if (!s.moved) setOpen(false);
    s.moved = true;
    setDrag({ left: clamp(s.ox + dx, w - SIZE - 4), top: clamp(s.oy + dy, h - SIZE - 4) });
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) return tap();
    const cx = clamp(s.ox + e.clientX - s.px, w - SIZE - 4) + SIZE / 2;
    const cy = clamp(s.oy + e.clientY - s.py, h - SIZE - 4) + SIZE / 2;
    saveCorner(`${cy < h / 2 ? "t" : "b"}${cx < w / 2 ? "l" : "r"}` as Corner);
    setDrag(null);
  };

  return (
    <div
      ref={box}
      className={`mfab ${on ? "is-on" : ""} ${open ? "is-open" : ""} ${top ? "is-top" : ""} ${right ? "is-right" : ""} ${drag ? "is-drag" : ""}`}
      style={{ left: pos.left, top: pos.top, transition: drag ? "none" : undefined }}
    >
      {/* ปุ่มกลมแยกออกมา (แบบ MIN REPORT) · ชี้ = การ์ดดำอธิบาย */}
      <div className={`rm mfab-fan ${open ? "is-open" : ""}`} role="menu" aria-hidden={!open} aria-label={`MANAGE STOCK · ${stockCode}`}>
        {items.map((it, i) => {
          const p = at(i);
          return (
            <div
              key={it.key}
              className={`rm-item ${right ? "is-left" : "is-right"} ${top ? "" : "is-up"}`}
              style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--d": `${i * 45}ms`, "--c": it.color } as React.CSSProperties}
            >
              <button
                type="button"
                role="menuitem"
                className="rm-btn"
                tabIndex={open ? 0 : -1}
                aria-label={it.title}
                onClick={() => {
                  setOpen(false);
                  if (it.key === "HISTORY") onHistory();
                  else if (it.key === "HIDE") onHide();
                  else onPick(it.key);
                }}
              >
                <svg className="rm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {it.icon}
                </svg>
              </button>
              <div className="rm-tip" role="tooltip">
                <b>{it.title}</b>
                <p>{it.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ป้ายโหมดที่ใช้อยู่ (ข้างวงกลม ฝั่งกลางจอ) */}
      {on && !drag && (
        <span key={label} className="mfab-tag" aria-hidden>
          <small>● กำลังใช้งาน · {stockCode}</small>
          <b>{label}</b>
        </span>
      )}

      <button
        type="button"
        className="mfab-btn"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => ((start.current = null), setDrag(null))}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), tap())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={on ? `เลิกใช้ ${label}` : `MANAGE STOCK ${stockCode}`}
        title={on ? `กำลังใช้ ${label} · กด ✕ เพื่อเลิกใช้งาน · ลากเพื่อย้ายมุม` : `MANAGE STOCK · ${stockCode} · กดเพื่อเลือก · ลากเพื่อย้ายมุม`}
        style={{ width: SIZE, height: SIZE }}
      >
        <span key={on ? "x" : "ic"} className="mfab-ic" aria-hidden>
          {on ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="12" cy="12" r="1.3" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
