"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deviceName } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setBubbleMounted, setCorner, useCorner, type Corner } from "@/lib/profileCorner";
import { SlideMenu, SlideRow, type SlideItem } from "./SlideMenu";

// 👤 วงกลมโปรไฟล์ลอยมุมจอ: ลากไปมุมไหนก็ได้ ปล่อยแล้วเด้งเข้ามุมที่ใกล้ที่สุด (จำไว้ในเครื่อง) - กดแล้วเมนูสไลด์ออกมา
const SIZE = 52;
const GAP = 16;
const TOP = 76; // ใต้แถบหัวหน้า (60px)

function subscribeSize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const sizeNow = () => `${window.innerWidth}x${window.innerHeight}`;

// มุมซ้ายเริ่มที่ขอบพื้นที่เนื้อหา (ไม่ทับ Sidebar)
function cornerPos(c: Corner, w: number, h: number, leftEdge: number) {
  return { left: c[1] === "l" ? leftEdge + GAP : w - SIZE - GAP, top: c[0] === "t" ? TOP : h - SIZE - GAP };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}

const CORNER_LABEL: Record<Corner, string> = { tl: "ซ้ายบน", tr: "ขวาบน", bl: "ซ้ายล่าง", br: "ขวาล่าง" };

export function ProfileBubble() {
  const { me, logout } = useAuth();
  const router = useRouter();
  const corner = useCorner();
  const size = useSyncExternalStore(subscribeSize, sizeNow, () => "0x0");
  const [w, h] = size.split("x").map(Number);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [leftEdge, setLeftEdge] = useState(0);
  const start = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBubbleMounted(true);
    return () => setBubbleMounted(false);
  }, []);

  // ขอบซ้ายของพื้นที่เนื้อหา: เปลี่ยนตาม Sidebar กาง / พับ / ซ่อน (มือถือ)
  useEffect(() => {
    const el = document.querySelector("main");
    if (!el) return;
    const ro = new ResizeObserver(() => setLeftEdge(el.getBoundingClientRect().left));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!me || !w) return null;

  const home = cornerPos(corner, w, h, leftEdge);
  const pos = drag ?? home;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), max);

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    start.current = { px: e.clientX, py: e.clientY, ox: pos.left, oy: pos.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px, dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 6) return;
    if (!s.moved) setOpen(false);
    s.moved = true;
    setDrag({ left: clamp(s.ox + dx, w - SIZE - 4), top: clamp(s.oy + dy, h - SIZE - 4) });
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) {
      setOpen((o) => !o);
      return;
    }
    const cx = clamp(s.ox + e.clientX - s.px, w - SIZE - 4) + SIZE / 2;
    const cy = clamp(s.oy + e.clientY - s.py, h - SIZE - 4) + SIZE / 2;
    setCorner(`${cy < h / 2 ? "t" : "b"}${cx < w / 2 ? "l" : "r"}` as Corner);
    setDrag(null);
  };

  const right = corner[1] === "r", top = corner[0] === "t";
  const items: SlideItem[] = [
    {
      key: "profile",
      icon: "user",
      label: "ข้อมูลผู้ใช้",
      tone: "neutral",
      detail: (
        <ul className="divide-y divide-white/10 p-4 pt-0">
          <SlideRow title="รหัสผู้ใช้" value={me.userId} />
          <SlideRow title="ระดับ" value={`LEVEL ${me.userLevel}${me.isMasterAdmin ? " · MASTER" : ""}`} />
          <SlideRow title="แผนก" value={me.department || "-"} />
          <SlideRow title="เครื่องนี้" value={deviceName() || "-"} />
        </ul>
      ),
    },
    ...(me.can.activityLog
      ? [{ key: "log", icon: "document", label: "Activity Log", tone: "info", onSelect: () => (setOpen(false), router.push("/activity-log")) } as SlideItem]
      : []),
    {
      key: "corner",
      icon: "corners",
      label: "ย้ายมุมวงกลมนี้",
      tone: "success",
      detail: (
        <div className="grid grid-cols-2 gap-1.5 p-3 pt-0">
          {(["tl", "tr", "bl", "br"] as Corner[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCorner(c)}
              className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${c === corner ? "bg-[var(--tone)] text-[#141416]" : "bg-white/5 text-white/75 hover:bg-white/10"}`}
            >
              {CORNER_LABEL[c]}
            </button>
          ))}
        </div>
      ),
    },
    { key: "logout", icon: "logout", label: "ออกจากระบบ", tone: "danger", onSelect: () => logout() },
  ];

  return (
    <div
      ref={box}
      className="fixed z-[90]"
      style={{ left: pos.left, top: pos.top, transition: drag ? "none" : "left .45s cubic-bezier(.2,.9,.25,1.15), top .45s cubic-bezier(.2,.9,.25,1.15)" }}
    >
      <button
        type="button"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => ((start.current = null), setDrag(null))}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((o) => !o))}
        aria-label={`โปรไฟล์ ${me.userName || me.userId}`}
        aria-expanded={open}
        title="กดเพื่อเปิดเมนู · ลากเพื่อย้ายมุม"
        className={`profile-bubble relative grid touch-none select-none place-items-center rounded-full border border-white/15 bg-[#1c1c1e] text-sm font-extrabold tracking-wide text-white shadow-xl shadow-black/40 ${drag ? "scale-110 cursor-grabbing" : "cursor-pointer"}`}
        style={{ width: SIZE, height: SIZE }}
      >
        {initials(me.userName || me.userId)}
        <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-[#1c1c1e] bg-[#4ade80]" />
      </button>

      {open && (
        <div
          className={`menu-pop absolute max-h-[min(70dvh,520px)] w-max overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#141416] p-2 shadow-2xl shadow-black/50 ${right ? "right-0" : "left-0"}`}
          style={top ? { top: SIZE + 10 } : { bottom: SIZE + 10 }}
        >
          <div className="px-2 pb-2 pt-1">
            <div className="max-w-60 truncate text-sm font-extrabold text-white">{me.userName || me.userId}</div>
            <div className="text-[11px] font-semibold text-white/45">
              {me.userId} · LEVEL {me.userLevel}
            </div>
          </div>
          <SlideMenu items={items} />
        </div>
      )}
    </div>
  );
}
