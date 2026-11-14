"use client";

import { useEffect, useRef } from "react";
import { fmtDate } from "@/lib/format";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { openChat, openSupport, refreshNotifications, topicOf } from "@/lib/support";
import { useToast } from "@/components/notifications/Toasts";
import { minTokenOf, openMinSign } from "@/lib/minSign";

// 🔔 ข้อความใหม่ = Toast "ใครส่งอะไรมา" + กระดิ่งอัพเดททันที (ทำงานเบื้องหลังตลอดเวลาที่ Login)
//   ครั้งแรกจำเลขข้อความล่าสุดไว้ก่อน (ไม่เด้งของเก่าย้อนหลัง) · กด Toast = เปิดแชทนั้น
//   ⚡ ทันที: มีคนส่งแชท / แจ้ง Admin = สัญญาณ Realtime ("chat" / "support") -> ดึงข้อความใหม่เลย (เดิมรอรอบ 8 วินาที) · รอบ 8 วินาทียังอยู่เป็นสำรอง
//   Toast แชท = ตัวย่อชื่อ + ชื่อ + แผนก · ข้อความ (3 บรรทัด) · ไฟล์แนบ · เวลา
type Item = { kind: "dm" | "support"; id: number; from: string; fromName: string; body: string; threadId: number | null; topic: string | null; dept?: string; attach?: string | null; at?: string | null };
const hm = (s?: string | null) => (s ? fmtDate(s, "th-TH", { hour: "2-digit", minute: "2-digit" }, "time") : null);
const attachOf = (m: Item) => (m.attach === "IMAGE" ? "📷 รูปภาพ" : m.attach ? "📎 ไฟล์แนบ" : null);
type Feed = { dm: number; sup: number; items: Item[] };
const POLL_MS = 8000;

export function ChatFeed() {
  const toast = useToast();
  const last = useRef<{ dm: number | null; sup: number | null }>({ dm: null, sup: null });
  const tickRef = useRef<() => void>(() => {});
  // ⚡ ข้อความใหม่ = ดึงทันที (ไม่ต้องรอรอบ)
  useLive(["chat", "support"], () => tickRef.current());

  useEffect(() => {
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await run();
      } finally {
        busy = false;
      }
    };
    tickRef.current = () => void tick();
    const run = async () => {
      if (document.visibilityState !== "visible") return;
      const { dm, sup } = last.current;
      const qs = dm === null ? "" : `?dm=${dm}&sup=${sup ?? 0}`;
      try {
        const f = await api<Feed>(`/chat/feed${qs}`);
        if (stop) return;
        last.current = { dm: f.dm, sup: f.sup };
        if (f.items.length === 0) return;
        f.items.slice(-3).forEach((m) => {
          // ✍ เอกสาร MIN REPORT ในแชท: คำขอลงลายเซ็น = MinSignHost แจ้งเอง (ไม่เด้งซ้ำ) · อื่น ๆ = กดแล้วเปิดเอกสาร
          const mr = m.kind === "dm" ? minTokenOf(m.body) : null;
          if (mr) {
            if (!mr.text.startsWith("✍")) toast.show(`💬 ${m.fromName}`, mr.text.slice(0, 120), "chat", { onClick: () => openMinSign(mr.id) });
            return;
          }
          const short = m.body.length > 240 ? m.body.slice(0, 240) + "…" : m.body;
          const att = attachOf(m);
          const text = att && (short === "📷 รูปภาพ" || short.startsWith("📎 ")) ? "" : short;
          const info = { name: m.fromName, attach: att, time: hm(m.at) };
          if (m.kind === "dm") toast.show(`💬 แชทส่วนตัว${m.dept ? ` · ${m.dept}` : ""}`, text, "chat", { onClick: () => openChat(m.from), chat: info, ms: 9000 });
          else {
            const t = topicOf(m.topic ?? "");
            toast.show(`🎧 แจ้ง Admin · ${t.label}${m.dept ? ` · ${m.dept}` : ""}`, text, "chat", { onClick: () => openSupport(m.threadId ?? undefined), chat: info, ms: 9000 });
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
