"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useBubbleCorner } from "@/lib/profileCorner";
import { Icon, type IconName } from "@/components/icons";

// 🔔 แจ้งเตือนมุมขวาล่าง + เสียง (แทน NotificationManager + SystemSounds ของ WPF) - ไม่เด้ง Popup ค้าง สแกนต่อได้เลย
//    หลอดเวลาแนวนอนติดขอบล่างค่อยๆ หดลง หมดแล้วค่อยๆ จางหาย · ชี้ค้าง = หยุดเวลา · กด = ปิด (หรือทำตาม onClick เช่น เปิดแชท)
type Kind = "ok" | "error" | "warn" | "info" | "chat";
type Opts = { onClick?: () => void; ms?: number };
type Toast = { id: number; title: string; message: string; kind: Kind; ms: number; leaving: boolean; onClick?: () => void };
type Ctx = { show: (title: string, message: string, kind?: Kind, opts?: Opts) => void };

const ToastCtx = createContext<Ctx | null>(null);

function beep(kind: Kind) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const tones = kind === "error" ? [220, 180] : kind === "warn" ? [520, 420] : kind === "chat" ? [660, 990] : [880];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === "error" ? "square" : "sine";
      o.frequency.value = f;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.16);
      o.stop(ctx.currentTime + i * 0.16 + 0.14);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* ไม่มีเสียงก็ไม่เป็นไร */
  }
}

const TONE: Record<Kind, string> = { ok: "#4ade80", error: "#d65563", warn: "#f0b04a", info: "#6aa6f8", chat: "#60a5fa" };
const ICON: Record<Kind, IconName> = { ok: "check", error: "error", warn: "triangle", info: "info", chat: "chat" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const bubble = useBubbleCorner();

  const show = useCallback((title: string, message: string, kind: Kind = "info", opts?: Opts) => {
    const id = ++seq.current;
    if (kind !== "info") beep(kind);
    const ms = opts?.ms ?? (kind === "error" || kind === "warn" ? 9000 : kind === "chat" ? 7000 : 4500);
    setList((l) => [{ id, title, message, kind, ms, leaving: false, onClick: opts?.onClick }, ...l].slice(0, 4));
  }, []);

  const leave = (id: number) => setList((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  const remove = (id: number) => setList((l) => l.filter((t) => t.id !== id));

  // ค่าเดิมทุกครั้ง: แจ้งเตือนขึ้น / หาย ไม่ทำให้หน้าที่ใช้ toast โหลดข้อมูลใหม่ / วาดตารางใหม่ทั้งชุด
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-80"
        style={{ bottom: bubble === "br" ? 84 : 16 }}
      >
        {list.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            onClick={() => (t.onClick?.(), leave(t.id))}
            onTransitionEnd={(e) => e.propertyName === "opacity" && t.leaving && remove(t.id)}
            className={`toast-card pointer-events-auto relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg bg-[#232531] px-2.5 pb-3 pt-2 shadow-xl shadow-black/30 transition-[opacity,transform] duration-300 ${
              t.leaving ? "translate-x-4 opacity-0" : "opacity-100"
            }`}
          >
            <div className="shrink-0 rounded-lg bg-white/5 p-1 backdrop-blur-xl" style={{ color: TONE[t.kind] }}>
              <Icon name={ICON[t.kind]} />
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <p className="text-xs font-semibold text-white sm:text-sm">{t.title}</p>
              {t.message && <p className="whitespace-pre-line break-words text-[11px] text-gray-400 sm:text-xs">{t.message}</p>}
            </div>
            {/* หลอดเวลาแนวนอนติดขอบล่าง */}
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10" aria-hidden="true">
              <div
                className="toast-tube absolute inset-0"
                style={{ background: TONE[t.kind], boxShadow: `0 0 8px ${TONE[t.kind]}`, animationDuration: `${t.ms}ms` }}
                onAnimationEnd={() => leave(t.id)}
              />
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be inside ToastProvider");
  return c;
}
