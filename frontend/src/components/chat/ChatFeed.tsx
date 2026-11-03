"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { openChat, openSupport, refreshNotifications, topicOf } from "@/lib/support";
import { useToast } from "@/components/notifications/Toasts";

// 🔔 ข้อความใหม่ = Toast "ใครส่งอะไรมา" + กระดิ่งอัพเดททันที (ทำงานเบื้องหลังตลอดเวลาที่ Login)
//   ครั้งแรกจำเลขข้อความล่าสุดไว้ก่อน (ไม่เด้งของเก่าย้อนหลัง) · กด Toast = เปิดแชทนั้น
type Item = { kind: "dm" | "support"; id: number; from: string; fromName: string; body: string; threadId: number | null; topic: string | null };
type Feed = { dm: number; sup: number; items: Item[] };
const POLL_MS = 8000;

export function ChatFeed() {
  const toast = useToast();
  const last = useRef<{ dm: number | null; sup: number | null }>({ dm: null, sup: null });

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const { dm, sup } = last.current;
      const qs = dm === null ? "" : `?dm=${dm}&sup=${sup ?? 0}`;
      try {
        const f = await api<Feed>(`/chat/feed${qs}`);
        if (stop) return;
        last.current = { dm: f.dm, sup: f.sup };
        if (f.items.length === 0) return;
        f.items.slice(-3).forEach((m) => {
          const short = m.body.length > 90 ? m.body.slice(0, 90) + "…" : m.body;
          if (m.kind === "dm") toast.show(`💬 ${m.fromName}`, short, "chat", { onClick: () => openChat(m.from) });
          else {
            const t = topicOf(m.topic ?? "");
            toast.show(`🎧 ${m.fromName} · ${t.label}`, short, "chat", { onClick: () => openSupport(m.threadId ?? undefined) });
          }
        });
        if (f.items.length > 3) toast.show("ข้อความใหม่", `และอีก ${f.items.length - 3} ข้อความ`, "chat");
        refreshNotifications();
      } catch {
        /* รอบหน้าลองใหม่ */
      }
    };
    const first = setTimeout(tick, 1500);
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [toast]);

  return null;
}
