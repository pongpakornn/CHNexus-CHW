"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { refreshNotifications, SUPPORT_EVENT, TOPICS, topicOf, type SupportOpen, type SupportTopic } from "@/lib/support";
import { useTyping } from "@/lib/useTyping";
import { useBubbleCorner } from "@/lib/profileCorner";
import { ChatBubble, type Attach, type Reaction } from "@/components/chat/ChatBubble";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { DotsMenu, TypingDots, type DotsItem } from "@/components/menus/DotsMenu";
import { DirectChat } from "@/components/chat/DirectChat";
import { useDialogs } from "@/components/modals/Dialogs";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/notifications/Toasts";

// 💬 กล่องแชทมุมขวาล่าง 2 แท็บ: "แจ้ง Admin" (เรื่องของฉัน / Admin เห็นร่วมกันทุกเรื่อง) · "แชท" (คุยกันหนึ่งต่อหนึ่ง เห็นเฉพาะของตัวเอง)
//   ผู้ใช้: เลือกเรื่อง (ปัญหา / อัพเดท / ขอสิทธิ์) -> ระบบแจ้งขั้นตอน -> พิมพ์รายละเอียดแล้วส่ง
//   Admin: เห็นทุกเรื่อง ตอบกลับ และปิด / เปิดเรื่องได้
type Contact = { fullName: string; phone: string; nickname: string | null };
type Info = { enabled: boolean; isAdmin: boolean; me: string; contacts: Contact[] };
type ThreadRow = { threadId: number; userId: string; userName: string; topic: string; status: string; lastSender: string; updatedAt: string; mine: boolean; unread: boolean; last: string };
type Msg = { messageId: number; senderUserId: string; senderName: string; isAdmin: boolean; body: string; createdAt: string; editedAt: string | null; deleted: boolean; attach: Attach | null; reactions: Reaction[] };
type ThreadData = { thread: { threadId: number; userId: string; userName: string; topic: string; status: string; createdAt: string }; mine: boolean; messages: Msg[] };

const pad = (n: number) => String(n).padStart(2, "0");
const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ข้อความจากระบบตามเรื่องที่เลือก
function botLines(topic: string, phones: string): string[] {
  switch (topic) {
    case "PROBLEM":
      return [
        "กรุณารอสักครู่ เมื่อ Admin เห็นข้อความแล้วจะติดต่อกลับโดยเร็ว",
        `หากไม่มีการติดต่อกลับ กรุณาโทรแจ้งที่ ${phones || "เบอร์ Admin ด้านบน"}`,
        "พิมพ์รายละเอียดของปัญหา (เมนูที่ใช้ / สิ่งที่เกิดขึ้น / ข้อความ Error ถ้ามี) แล้วกดส่งได้เลย",
      ];
    case "UPDATE":
      return [
        "คำขออัพเดทระบบจะถูกรวบรวมให้ Admin พิจารณา ประเมินความเหมาะสม แล้วแจ้งผลและกำหนดการอัพเดทกลับในแชทนี้",
        "กรุณาบอกว่าต้องการให้อัพเดทอะไร (เมนู / หน้าจอ / การทำงานที่อยากให้เพิ่มหรือปรับ) และเหตุผลที่ต้องการ",
      ];
    case "PERMISSION":
      return [
        "คำขอสิทธิ์จะได้รับการประเมินจาก Admin ก่อน แล้วจะอัพเดทสิทธิ์ให้พร้อมติดต่อกลับ",
        "กรุณาระบุว่าต้องการเพิ่มสิทธิ์เรื่องอะไร เช่น เมนู คลัง หรือการทำงาน (ดู / เพิ่ม / แก้ไข / ลบ / อนุมัติ) และเหตุผลที่ต้องใช้",
      ];
    default:
      return [];
  }
}

function Bubble({ side, children, meta, tone }: { side: "me" | "other" | "bot"; children: React.ReactNode; meta?: string; tone?: string }) {
  return (
    <div className={`flex flex-col ${side === "me" ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
          side === "me" ? "rounded-br-md bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white" : side === "bot" ? "rounded-bl-md border border-[#dbe4f5] bg-[#f4f8ff] text-ink" : "rounded-bl-md bg-[#eef0f4] text-ink"
        }`}
        style={side === "bot" && tone ? { borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` } : undefined}
      >
        {children}
      </div>
      {meta && <span className="mt-0.5 px-1 text-[10px] font-semibold text-ink-soft">{meta}</span>}
    </div>
  );
}

export function SupportChat() {
  const toast = useToast();
  const dlg = useDialogs();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"support" | "chat">("support");
  const [chatWith, setChatWith] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [info, setInfo] = useState<Info | null>(null);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [active, setActive] = useState<number | "new" | null>(null);
  const [data, setData] = useState<ThreadData | null>(null);
  const [topic, setTopic] = useState<SupportTopic | null>(null);
  const bubble = useBubbleCorner();
  const scroller = useRef<HTMLDivElement>(null);
  const { typing, notify: notifyTyping } = useTyping(open && typeof active === "number" ? `/support/threads/${active}/typing` : null);
  const lastCount = useRef(0);

  const loadThreads = useCallback(() => api<ThreadRow[]>("/support/threads").then(setThreads).catch(() => {}), []);
  const loadThread = useCallback(
    (id: number) =>
      api<ThreadData>(`/support/threads/${id}`)
        .then(setData)
        .catch((e) => toast.show("ERROR", e.message, "error")),
    [toast],
  );

  // เปิดจากปุ่มหูฟัง / เมนูโปรไฟล์ / กระดิ่ง
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<SupportOpen>).detail ?? {};
      setOpen(true);
      if (d.tab === "chat") {
        setTab("chat");
        setChatWith(d.chatWith ?? null);
        setChatKey((k) => k + 1);
        return;
      }
      setTab("support");
      setActive(d.threadId ?? null);
      setData(null);
      if (!d.threadId) setTopic(null);
    };
    window.addEventListener(SUPPORT_EVENT, on);
    return () => window.removeEventListener(SUPPORT_EVENT, on);
  }, []);

  // โหลดข้อมูลเมื่อเปิด + อัพเดทเองระหว่างเปิด
  useEffect(() => {
    if (!open) return;
    const first = setTimeout(() => {
      api<Info>("/support/info")
        .then((i) => {
          setInfo(i);
          // ผู้ใช้ทั่วไปที่ยังไม่มีเรื่อง = เริ่มเรื่องใหม่ทันที
          api<ThreadRow[]>("/support/threads")
            .then((l) => {
              setThreads(l);
              setActive((a) => a ?? (l.length === 0 && !i.isAdmin ? "new" : a));
            })
            .catch(() => {});
        })
        .catch((e) => toast.show("ERROR", e.message, "error"));
    }, 0);
    const t = setInterval(() => document.visibilityState === "visible" && loadThreads(), 6000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [open, loadThreads, toast]);

  useEffect(() => {
    if (!open || typeof active !== "number") return;
    const first = setTimeout(() => loadThread(active), 0);
    const t = setInterval(() => document.visibilityState === "visible" && loadThread(active), 4000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [open, active, loadThread]);

  // ข้อความใหม่ = เลื่อนลงล่างสุด
  const msgCount = data?.messages.length ?? 0;
  useEffect(() => {
    if (msgCount !== lastCount.current || active === "new" || typing) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    lastCount.current = msgCount;
  }, [msgCount, active, topic, typing]);

  if (!open) return null;

  const phones = (info?.contacts ?? []).map((c) => `${c.nickname || c.fullName} ${c.phone}`).join(" / ");
  const isAdmin = !!info?.isAdmin;
  const current = typeof active === "number" ? threads.find((t) => t.threadId === active) : null;
  const curTopic = active === "new" ? topic : (data?.thread.topic ?? current?.topic ?? null);

  // ส่งข้อความ / ไฟล์ (true = ส่งแล้ว ล้างช่องพิมพ์) · เรื่องใหม่ + ไฟล์ = สร้างเรื่องก่อนแล้วแนบไฟล์ต่อ
  const upload = (id: number, body: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("body", body);
    return api(`/support/threads/${id}/file`, { method: "POST", body: fd });
  };
  async function send(body: string, file: File | null) {
    try {
      if (active === "new") {
        if (!topic) {
          toast.show("WARNING", "กรุณาเลือกเรื่องที่ต้องการแจ้งก่อน", "warn");
          return false;
        }
        const r = await api<{ threadId: number }>("/support/threads", { method: "POST", body: { topic, body: body || `แนบไฟล์ ${file?.name ?? ""}` } });
        if (file) await upload(r.threadId, "", file);
        setActive(r.threadId);
        await loadThreads();
        refreshNotifications();
        toast.show("SENT", "ส่งเรื่องถึง Admin แล้ว", "ok");
      } else if (typeof active === "number") {
        if (file) await upload(active, body, file);
        else await api(`/support/threads/${active}/messages`, { method: "POST", body: { body } });
        await Promise.all([loadThread(active), loadThreads()]);
      }
      return true;
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      return false;
    }
  }

  async function setStatus(id: number, close: boolean) {
    try {
      await api(`/support/threads/${id}/status`, { method: "POST", body: { close } });
      await Promise.all([active === id ? loadThread(id) : Promise.resolve(), loadThreads()]);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  // ✏ แก้ไข / 🗑 ลบข้อความของตัวเอง · 🗑 ลบทั้งเรื่อง (เจ้าของเรื่อง / Admin)
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      if (typeof active === "number") await Promise.all([loadThread(active), loadThreads()]);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  };
  const editMsg = (id: number, body: string) => act(() => api(`/support/messages/${id}`, { method: "PUT", body: { body } }));
  const react = (id: number, emoji: string) => act(() => api(`/support/messages/${id}/react`, { method: "POST", body: { emoji } }));
  const deleteMsg = async (id: number) => {
    if (await dlg.confirm({ title: "DELETE MESSAGE", danger: true, message: "ลบข้อความนี้ใช่หรือไม่?" })) await act(() => api(`/support/messages/${id}`, { method: "DELETE" }));
  };
  async function deleteThread(id: number) {
    if (!(await dlg.confirm({ title: "DELETE CHAT", danger: true, message: "ลบเรื่องนี้และข้อความทั้งหมดใช่หรือไม่?\nไม่สามารถกู้คืนได้" }))) return;
    try {
      await api(`/support/threads/${id}`, { method: "DELETE" });
      toast.show("SUPPORT", "ลบเรื่องแล้ว", "ok");
      if (active === id) {
        setActive(null);
        setData(null);
      }
      await loadThreads();
      refreshNotifications();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  // ⋯ เมนูของเรื่อง: ลบ (เจ้าของ / Admin) · ปิด / เปิดเรื่อง (Admin)
  const threadMenu = (id: number, mine: boolean, status: string): DotsItem[] => [
    ...(isAdmin ? [{ label: status === "CLOSED" ? "เปิดเรื่องอีกครั้ง" : "ปิดเรื่อง", icon: "check" as const, onSelect: () => setStatus(id, status !== "CLOSED") }] : []),
    ...(mine || isAdmin ? [{ label: "ลบเรื่องนี้", icon: "trash" as const, danger: true, onSelect: () => deleteThread(id) }] : []),
  ];

  const startNew = () => {
    setActive("new");
    setTopic(null);
    setData(null);
  };
  const showList = active === null;
  const t = curTopic ? topicOf(curTopic) : null;

  return (
    <div
      className="chat-in fixed right-3 z-[85] flex w-[min(780px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-white/60 bg-surface shadow-[0_30px_80px_-20px_rgba(15,30,80,.55)] sm:right-5"
      style={{ bottom: bubble === "br" ? 84 : 20, height: `min(600px, calc(100dvh - ${bubble === "br" ? 160 : 96}px))` }}
    >
      {/* หัวแชท: ไอคอน + ชื่อ + เบอร์ติดต่อ Admin */}
      <div className="flex items-center gap-3 bg-gradient-to-r from-[#1e3a8a] via-[#2563eb] to-[#3b82f6] px-4 py-3 text-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15 ring-2 ring-white/30">
          <svg viewBox="0 0 16 16" fill="none" className="size-5" aria-hidden="true">
            <path strokeLinejoin="round" strokeLinecap="round" stroke="currentColor" strokeWidth="1.3" d="M1 10V8C1 2.5 6 1 8 1C10 1 15 2.5 15 8V10M1 10C1 10.5552 1 11.1543 1.0984 11.6204C1.24447 12.3122 2 13 3 13C4 13 4.75553 12.3122 4.9016 11.6204C5 11.1543 5 10.5552 5 10C5 9.44485 5 8.84565 4.9016 8.37961C4.75553 7.68776 4 7 3 7C2 7 1.24447 7.68776 1.0984 8.37961C1 8.84565 1 9.44485 1 10ZM15 10C15 10.5552 15 11.1543 14.9016 11.6204C14.7555 12.3122 14 13 13 13C12 13 11.2445 12.3122 11.0984 11.6204C11 11.1543 11 10.5552 11 10C11 9.44485 11 8.84565 11.0984 8.37961C11.2445 7.68776 12 7 13 7C14 7 14.7555 7.68776 14.9016 8.37961C15 8.84565 15 9.44485 15 10ZM15 10C15 15.5 12.5 15 8 15" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold leading-tight">{tab === "chat" ? "แชท" : isAdmin ? "แชทแจ้ง Admin · กล่องข้อความ" : "ติดต่อ / แจ้ง Admin"}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {(info?.contacts ?? []).length === 0 ? (
              <span className="text-[11px] font-semibold text-white/75">ยังไม่ได้ตั้งเบอร์ติดต่อ (User Management · ALERT CONTACT)</span>
            ) : (
              info!.contacts.map((c) => (
                <a key={c.phone + c.fullName} href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold transition hover:bg-white/25">
                  <Icon name="phone" className="size-3" />
                  {c.nickname || c.fullName} · {c.phone}
                </a>
              ))
            )}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="grid size-8 shrink-0 place-items-center rounded-full text-white/85 transition hover:rotate-90 hover:bg-white/15" aria-label="Close chat">
          <Icon name="xMark" className="size-5" />
        </button>
      </div>

      {/* แท็บ: แจ้ง Admin / แชท */}
      <div className="flex gap-1 border-b border-line/70 bg-[#f7f9fd] px-3 py-2">
        {(
          [
            ["support", "🎧 แจ้ง Admin"],
            ["chat", "💬 แชท"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 text-xs font-extrabold transition ${tab === k ? "bg-[#2563eb] text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,.8)]" : "text-ink-soft hover:bg-white hover:text-ink"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        info ? (
          <DirectChat key={chatKey} me={info.me} initialWith={chatWith} />
        ) : (
          <div className="grid flex-1 place-items-center text-xs font-semibold text-ink-soft">กำลังโหลด...</div>
        )
      ) : info && !info.enabled ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm font-semibold text-ink-soft">
          ระบบแชทยังไม่พร้อมใช้งาน (ต้องรัน database/nexus/03_Add_Support.sql)
          <br />
          {phones && `ติดต่อ Admin: ${phones}`}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* รายการเรื่อง */}
          <aside className={`${showList ? "flex" : "hidden"} w-full shrink-0 flex-col border-r border-line/70 bg-[#f7f9fd] sm:flex sm:w-[250px]`}>
            <div className="p-3">
              <button type="button" onClick={startNew} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-[0_6px_16px_-8px_rgba(37,99,235,.9)] transition hover:bg-[#1d4ed8] active:scale-95">
                <Icon name="chat" className="size-4" />
                เรื่องใหม่
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              {threads.length === 0 && <div className="px-3 py-6 text-center text-xs font-semibold text-ink-soft">ยังไม่มีเรื่องที่แจ้ง</div>}
              {threads.map((r) => {
                const tp = topicOf(r.topic);
                return (
                  <div
                    key={r.threadId}
                    role="button"
                    tabIndex={0}
                    onClick={() => (setActive(r.threadId), setData(null))}
                    onKeyDown={(e) => e.key === "Enter" && (setActive(r.threadId), setData(null))}
                    className={`group mb-1 flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#2563eb]/30 ${active === r.threadId ? "bg-white shadow-[0_2px_10px_-4px_rgba(20,40,100,.25)]" : "hover:bg-white/70"}`}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-base" style={{ background: `color-mix(in srgb, ${tp.color} 14%, transparent)` }}>
                      {tp.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`truncate text-[12.5px] ${r.unread ? "font-extrabold text-ink" : "font-bold text-ink"}`}>{isAdmin && !r.mine ? r.userName : tp.label}</span>
                        <span className="ml-auto shrink-0 text-[10px] font-semibold text-ink-soft">{when(r.updatedAt)}</span>
                      </span>
                      {isAdmin && !r.mine && <span className="block truncate text-[10.5px] font-bold" style={{ color: tp.color }}>{tp.label}</span>}
                      <span className="flex items-center gap-1.5">
                        <span className={`truncate text-[11.5px] ${r.unread ? "font-bold text-ink" : "text-ink-soft"}`}>
                          {r.lastSender === "ADMIN" ? "Admin: " : ""}
                          {r.last}
                        </span>
                        {r.status === "CLOSED" && <span className="ml-auto shrink-0 rounded bg-black/[.06] px-1 text-[9px] font-extrabold text-ink-soft">ปิดแล้ว</span>}
                        {r.unread && <span className="ml-auto size-2.5 shrink-0 rounded-full bg-[#2563eb]" />}
                      </span>
                    </span>
                    <DotsMenu reveal label="Topic actions" items={threadMenu(r.threadId, r.mine, r.status)} />
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ห้องแชท */}
          <section className={`${showList ? "hidden sm:flex" : "flex"} min-w-0 flex-1 flex-col`}>
            {active === null ? (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div>
                  <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-[#eaf1ff] text-[#2563eb]">
                    <Icon name="chat" className="size-7" />
                  </div>
                  <div className="text-sm font-extrabold text-ink">เลือกเรื่องทางซ้าย หรือกด “เรื่องใหม่”</div>
                  <div className="mt-1 text-xs font-semibold text-ink-soft">แจ้งปัญหา · แจ้งอัพเดทระบบ · ขอสิทธิ์การใช้งาน</div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2.5">
                  <button type="button" onClick={() => setActive(null)} className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-surface-2 sm:hidden" aria-label="Back">
                    <Icon name="arrowLeft" className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-extrabold text-ink">{t ? `${t.emoji} ${t.label}` : "เรื่องใหม่"}</div>
                    {data && (
                      <div className="truncate text-[11px] font-semibold text-ink-soft">
                        #{data.thread.threadId} · {data.thread.userName} · {when(data.thread.createdAt)} · {data.thread.status === "CLOSED" ? "ปิดเรื่องแล้ว" : "กำลังดำเนินการ"}
                      </div>
                    )}
                  </div>
                  {data && <DotsMenu label="Topic actions" items={threadMenu(data.thread.threadId, data.mine, data.thread.status)} />}
                </div>

                <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(37,99,235,.06)_1px,transparent_0)] bg-[length:18px_18px] p-4">
                  <div className="flex min-h-full flex-col justify-end gap-2.5">
                  {active === "new" && (
                    <>
                      <Bubble side="bot" meta="CHR-Nexus">
                        สวัสดีครับ 👋 ต้องการแจ้งเรื่องอะไรถึง Admin?
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {TOPICS.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              onClick={() => setTopic(o.value)}
                              className={`rounded-full border px-3 py-1.5 text-[12px] font-bold transition hover:-translate-y-0.5 ${topic === o.value ? "border-transparent text-white" : "border-[#cfdbf3] bg-white text-ink hover:border-[#2563eb]"}`}
                              style={topic === o.value ? { background: o.color } : undefined}
                            >
                              {o.emoji} {o.label}
                            </button>
                          ))}
                        </div>
                      </Bubble>
                      {topic && <Bubble side="me">{topicOf(topic).label}</Bubble>}
                    </>
                  )}
                  {curTopic &&
                    botLines(curTopic, phones).map((l, i) => (
                      <Bubble key={i} side="bot" tone={t?.color} meta={i === botLines(curTopic, phones).length - 1 ? "CHR-Nexus" : undefined}>
                        {l}
                      </Bubble>
                    ))}
                  {data?.messages.map((m) => {
                    const mineMsg = data.mine ? !m.isAdmin : m.isAdmin;
                    return (
                      <ChatBubble
                        key={m.messageId}
                        side={mineMsg ? "me" : "other"}
                        body={m.body}
                        deleted={m.deleted}
                        edited={!!m.editedAt}
                        meta={`${m.isAdmin ? `Admin · ${m.senderName}` : m.senderName} · ${when(m.createdAt)}`}
                        attach={m.attach}
                        fileUrl={m.attach ? `/api/support/files/${m.messageId}` : undefined}
                        reactions={m.reactions}
                        me={info?.me}
                        onEdit={m.senderUserId === info?.me ? (t) => editMsg(m.messageId, t) : undefined}
                        onDelete={m.senderUserId === info?.me ? () => deleteMsg(m.messageId) : undefined}
                        onReact={(e) => react(m.messageId, e)}
                      />
                    );
                  })}
                  {typeof active === "number" && !data && <div className="py-6 text-center text-xs font-semibold text-ink-soft">กำลังโหลด...</div>}
                  {typing && <TypingDots name={data && !data.mine ? data.thread.userName : "Admin"} />}
                  </div>
                </div>

                {/* ช่องพิมพ์ + แนบไฟล์ */}
                <ChatComposer
                  disabled={active === "new" && !topic}
                  onTyping={notifyTyping}
                  onSend={send}
                  placeholder={active === "new" && !topic ? "เลือกเรื่องด้านบนก่อน" : isAdmin && data && !data.mine ? "พิมพ์ตอบกลับผู้แจ้ง..." : "พิมพ์รายละเอียด แล้วกด Enter เพื่อส่ง (Shift+Enter ขึ้นบรรทัดใหม่)"}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
