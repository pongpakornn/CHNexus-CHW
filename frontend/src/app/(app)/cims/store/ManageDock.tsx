"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBubbleCorner, type Corner } from "@/lib/profileCorner";
import type { ManageMode } from "./CoilManageButtons";

// 🧲 MANAGE STOCK = ปุ่มวงกลมลอย (ขนาด / การลากย้ายแบบวงกลมโปรไฟล์ · ลากไปมุมไหนก็ได้ 4 มุม จำไว้ในเครื่อง)
//   แสดงเฉพาะคลังที่เปิดอยู่ + ผู้ใช้มีสิทธิ์ MANAGE STOCK ของคลังนั้น (StockTable ส่ง meta.canManage มา)
//   กดวงกลม = รายการเผยออกมา (แบบปุ่ม MIN REPORT) · เลือกแล้ว = วงกลมเป็นสีแดง + ✕ · กด ✕ ที่วงกลมเดิม = เลิกใช้งาน
//   อยู่มุมเดียวกับวงกลมโปรไฟล์ = ซ้อนถัดจากโปรไฟล์ (ไม่ทับกัน) · Esc / กดนอกกล่อง = ปิดรายการ
const SIZE = 52; // เท่าวงกลมโปรไฟล์
const GAP = 16;
const TOP = 76;
const KEY = "nexus.manageCorner";
const EVT = "nexus-manage-corner";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

type Item = { key: "ADD" | "ADJUST" | "HISTORY"; title: string; detail: string; color: string };

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

export function ManageDock({ stockCode, mode, onPick, onHistory }: { stockCode: string; mode: ManageMode; onPick: (m: "ADD" | "ADJUST") => void; onHistory: () => void }) {
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
    { key: "ADD", title: "ADD MASTER COIL", detail: "ปุ่ม ＋ ที่บรรทัด PD CODE · เพิ่ม Master Coil / Coil No", color: "#16a34a" },
    { key: "ADJUST", title: "ADJUST STOCK", detail: "ปุ่ม EDIT / TRANSFER / ADJUST ที่แถว Coil ลูก", color: "#ea580c" },
    { key: "HISTORY", title: "HISTORY", detail: `ประวัติ MANAGE STOCK ของ ${stockCode}`, color: "#6750a4" },
  ];

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
      <div className="mdock-menu mfab-menu" role="menu" aria-hidden={!open}>
        <div className="mdock-cap">MANAGE STOCK · {stockCode}</div>
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            className="ms-item mdock-item"
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
              <small className="block truncate">{it.detail}</small>
            </span>
          </button>
        ))}
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
