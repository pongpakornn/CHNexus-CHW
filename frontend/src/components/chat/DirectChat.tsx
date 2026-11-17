"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { api } from "@/lib/api";
import { pollGuard } from "@/lib/pollGuard";
import { chatView, refreshNotifications } from "@/lib/support";
import { MIN_TOKEN } from "@/lib/minSign";
import { useTyping } from "@/lib/useTyping";
import { ChatBubble, type Attach, type Reaction } from "@/components/chat/ChatBubble";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { DotsMenu, TypingDots } from "@/components/menus/DotsMenu";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";

// 💬 แชทระหว่างผู้ใช้ (หนึ่งต่อหนึ่ง): ซ้าย = ห้องแชทของฉัน / เลือกคนใหม่ · ขวา = ข้อความ
//   API ใช้ UserID ของผู้ที่ Login เสมอ = เห็นเฉพาะแชทของตัวเอง
type User = { userId: string; name: string; department: string; online: boolean };
type Conv = { userId: string; name: string; department: string; online: boolean; last: string; lastMine: boolean; at: string; unread: number };
type Msg = { messageId: number; from: string; to: string; body: string; createdAt: string; readAt: string | null; editedAt: string | null; deleted: boolean; attach: Attach | null; reactions: Reaction[] };

const pad = (n: number) => String(n).padStart(2, "0");
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Date().toDateString() === d.toDateString() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const initials = (s: string) => s.trim().slice(0, 1).toUpperCase() || "?";
const HUES = ["#2563eb", "#8b5cf6", "#06b6d4", "#f59e0b", "#14b8a6", "#ec4899", "#6366f1", "#ef4444"];
const hue = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

function Avatar({ id, name, online, size = 36 }: { id: string; name: string; online?: boolean; size?: number }) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full font-extrabold text-white" style={{ width: size, height: size, background: `linear-gradient(145deg, color-mix(in srgb, ${hue(id)} 60%, white), ${hue(id)})`, fontSize: size * 0.4 }}>
      {initials(name)}
      {online !== undefined && <span className={`absolute bottom-0 right-0 size-2.5 rounded-full ring-2 ring-white ${online ? "bg-[#22c55e]" : "bg-[#cbd5e1]"}`} />}
    </span>
  );
}

export function DirectChat({ me, initialWith }: { me: string; initialWith: string | null }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [users, setUsers] = useState<User[] | null>(null);
  const [withId, setWithId] = useState<string | null>(initialWith);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const { typing, notify: notifyTyping } = useTyping(withId ? `/chat/typing/${encodeURIComponent(withId)}` : null);

  const loadConvs = useCallback(() => api<Conv[]>("/chat/conversations").then(setConvs).catch(() => {}), []);
  const guard = useRef<ReturnType<typeof pollGuard> | null>(null);
  guard.current ??= pollGuard();
  const withRef = useRef(withId);
  useEffect(() => {
    withRef.current = withId;
    chatView.dm = withId;
    return () => {
      chatView.dm = null;
    };
  }, [withId]);
  // poll = true: timer tick (skips while a request is running / server is down; one notice per outage)
  const loadMsgs = useCallback(
    (id: string, poll = false) => {
      if (poll && !guard.current!.shouldRun()) return Promise.resolve();
      guard.current!.begin();
      return api<Msg[]>(`/chat/with/${encodeURIComponent(id)}`)
        .then((m) => {
          guard.current!.ok();
          if (withRef.current === id) setMsgs(m); // late reply of a chat the user already left = ignored
        })
        .catch((e) => {
          if (guard.current!.fail()) toast.show("ERROR", e.message, "error");
        });
    },
    [toast],
  );

  useEffect(() => {
    const first = setTimeout(() => {
      loadConvs();
      api<User[]>("/chat/users").then(setUsers).catch(() => setUsers([]));
    }, 0);
    const t = setInterval(() => document.visibilityState === "visible" && loadConvs(), 6000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [loadConvs]);

  useEffect(() => {
    if (!withId) return;
    const first = setTimeout(() => loadMsgs(withId).then(() => (loadConvs(), refreshNotifications())), 0);
    const t = setInterval(() => document.visibilityState === "visible" && loadMsgs(withId, true), 4000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [withId, loadMsgs, loadConvs]);

  const count = msgs?.length ?? 0;
  useEffect(() => {
    if (count !== lastCount.current || typing) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    lastCount.current = count;
  }, [count, typing]);

  const open = (id: string) => {
    setWithId(id);
    setMsgs(null);
    setPicking(false);
  };

  // ส่งข้อความ / ไฟล์ (true = ส่งแล้ว ล้างช่องพิมพ์)
  async function send(body: string, file: File | null) {
    if (!withId) return false;
    try {
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("body", body);
        await api(`/chat/with/${encodeURIComponent(withId)}/file`, { method: "POST", body: fd });
      } else await api(`/chat/with/${encodeURIComponent(withId)}`, { method: "POST", body: { body } });
      await Promise.all([loadMsgs(withId), loadConvs()]);
      return true;
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      return false;
    }
  }

  // ✏ แก้ไข / 🗑 ลบข้อความ · ลบแชททั้งหมด (ซ่อนจากฝั่งตัวเองเท่านั้น)
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      if (withId) await Promise.all([loadMsgs(withId), loadConvs()]);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  };
  const editMsg = (id: number, body: string) => act(() => api(`/chat/messages/${id}`, { method: "PUT", body: { body } }));
  const react = (id: number, emoji: string) => act(() => api(`/chat/messages/${id}/react`, { method: "POST", body: { emoji } }));
  const deleteMsg = async (id: number) => {
    if (await dlg.confirm({ title: "DELETE MESSAGE", danger: true, message: "ลบข้อความนี้ใช่หรือไม่?\nทั้งสองฝั่งจะเห็นเป็น “ข้อความถูกลบ”" })) await act(() => api(`/chat/messages/${id}`, { method: "DELETE" }));
  };
  async function clearAll(id: string, name: string) {
    if (!(await dlg.confirm({ title: "DELETE CHAT", danger: true, message: `ลบแชททั้งหมดกับ ${name} ใช่หรือไม่?\nแชทจะหายจากฝั่งของคุณ (อีกฝั่งยังเห็นแชทของเขา)` }))) return;
    try {
      await api(`/chat/with/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.show("CHAT", "ลบแชทแล้ว", "ok");
      if (withId === id) {
        setWithId(null);
        setMsgs(null);
      }
      await loadConvs();
      refreshNotifications();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const partner = withId ? (convs.find((c) => c.userId === withId) ?? users?.find((u) => u.userId === withId)) : null;
  const partnerName = partner?.name ?? withId ?? "";
  const found = (users ?? []).filter((u) => `${u.name} ${u.userId} ${u.department}`.toLowerCase().includes(q.trim().toLowerCase()));
  const showList = !withId && !picking;

  return (
    <div className="flex min-h-0 flex-1">
      {/* ห้องแชทของฉัน */}
      <aside className={`${showList ? "flex" : "hidden"} w-full shrink-0 flex-col border-r border-line/70 bg-[#f7f9fd] sm:flex sm:w-[250px]`}>
        <div className="p-3">
          <button type="button" onClick={() => (setPicking(true), setWithId(null))} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-[0_6px_16px_-8px_rgba(37,99,235,.9)] transition hover:bg-[#1d4ed8] active:scale-95">
            <Icon name="user" className="size-4" />
            แชทใหม่
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {convs.length === 0 && <div className="px-3 py-6 text-center text-xs font-semibold text-ink-soft">ยังไม่มีแชท กด “แชทใหม่” เพื่อเริ่มคุย</div>}
          {convs.map((c) => (
            <div
              key={c.userId}
              role="button"
              tabIndex={0}
              onClick={() => open(c.userId)}
              onKeyDown={(e) => e.key === "Enter" && open(c.userId)}
              className={`group mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#2563eb]/30 ${withId === c.userId ? "bg-white shadow-[0_2px_10px_-4px_rgba(20,40,100,.25)]" : "hover:bg-white/70"}`}
            >
              <Avatar id={c.userId} name={c.name} online={c.online} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`truncate text-[12.5px] ${c.unread ? "font-extrabold" : "font-bold"} text-ink`}>{c.name}</span>
                  <span className="shrink-0 rounded bg-[#eaf1ff] px-1 font-mono text-[9.5px] font-bold text-[#2563eb]">{c.userId}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-semibold text-ink-soft">{when(c.at)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`truncate text-[11.5px] ${c.unread ? "font-bold text-ink" : "text-ink-soft"}`}>
                    {c.lastMine ? "คุณ: " : ""}
                    {c.last.replace(MIN_TOKEN, "").trim()}
                  </span>
                  {c.unread > 0 && <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-[#2563eb] px-1 text-[9px] font-extrabold text-white">{c.unread}</span>}
                </span>
              </span>
              <DotsMenu reveal label="Chat actions" items={[{ label: "ลบแชททั้งหมด", icon: "trash", danger: true, onSelect: () => clearAll(c.userId, c.name) }]} />
            </div>
          ))}
        </div>
      </aside>

      <section className={`${showList ? "hidden sm:flex" : "flex"} min-w-0 flex-1 flex-col`}>
        {picking ? (
          // เลือกคนที่จะคุยด้วย
          <>
            <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2.5">
              <button type="button" onClick={() => setPicking(false)} className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-surface-2 sm:hidden" aria-label="Back">
                <Icon name="arrowLeft" className="size-4" />
              </button>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="เลือกผู้ใช้: ค้นหาชื่อ / UserID / หน่วยงาน..." className="flex-1 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-semibold outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15" />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!users && <Loading compact />}
              {users && found.length === 0 && <div className="py-6 text-center text-xs font-semibold text-ink-soft">ไม่พบผู้ใช้</div>}
              {found.map((u) => (
                <button key={u.userId} type="button" onClick={() => open(u.userId)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#eaf1ff]">
                  <Avatar id={u.userId} name={u.name} online={u.online} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-extrabold text-ink">{u.name}</span>
                      <span className="shrink-0 rounded-md bg-[#eaf1ff] px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[#2563eb]">{u.userId}</span>
                    </span>
                    <span className="block truncate text-[11px] font-semibold text-ink-soft">
                      {u.department || "-"}
                      {u.online ? " · ออนไลน์" : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : !withId ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div>
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-[#eaf1ff] text-[#2563eb]">
                <Icon name="chat" className="size-7" />
              </div>
              <div className="text-sm font-extrabold text-ink">เลือกแชททางซ้าย หรือกด “แชทใหม่”</div>
              <div className="mt-1 text-xs font-semibold text-ink-soft">ข้อความเห็นเฉพาะคุณกับคู่สนทนาเท่านั้น</div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b border-line/70 px-3 py-2.5">
              <button type="button" onClick={() => setWithId(null)} className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-surface-2 sm:hidden" aria-label="Back">
                <Icon name="arrowLeft" className="size-4" />
              </button>
              <Avatar id={withId} name={partnerName} online={partner?.online} size={32} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-extrabold text-ink">{partnerName}</div>
                <div className="truncate text-[11px] font-semibold text-ink-soft">
                  {withId}
                  {partner?.department ? ` · ${partner.department}` : ""}
                  {partner ? ` · ${partner.online ? "ออนไลน์" : "ออฟไลน์"}` : ""}
                </div>
              </div>
              <div className="ml-auto">
                <DotsMenu label="Chat actions" items={[{ label: "ลบแชททั้งหมด", icon: "trash", danger: true, onSelect: () => clearAll(withId, partnerName) }]} />
              </div>
            </div>
            <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(37,99,235,.06)_1px,transparent_0)] bg-[length:18px_18px] p-4">
              <div className="flex min-h-full flex-col justify-end gap-2">
              {!msgs && <Loading compact />}
              {msgs && msgs.length === 0 && <div className="py-6 text-center text-xs font-semibold text-ink-soft">เริ่มคุยกับ {partnerName} ได้เลย 👋</div>}
              {msgs?.map((m, i) => {
                const mine = m.from === me;
                const lastMine = mine && !msgs.slice(i + 1).some((x) => x.from === me);
                return (
                  <ChatBubble
                    key={m.messageId}
                    side={mine ? "me" : "other"}
                    body={m.body}
                    deleted={m.deleted}
                    edited={!!m.editedAt}
                    meta={`${when(m.createdAt)}${lastMine ? (m.readAt ? " · อ่านแล้ว" : " · ส่งแล้ว") : ""}`}
                    attach={m.attach}
                    fileUrl={m.attach ? `/api/chat/files/${m.messageId}` : undefined}
                    reactions={m.reactions}
                    me={me}
                    onEdit={mine ? (t) => editMsg(m.messageId, t) : undefined}
                    onDelete={mine ? () => deleteMsg(m.messageId) : undefined}
                    onReact={(e) => react(m.messageId, e)}
                  />
                );
              })}
              {typing && <TypingDots name={partnerName} />}
              </div>
            </div>
            <ChatComposer placeholder={`ส่งข้อความถึง ${partnerName}... (Enter = ส่ง)`} onTyping={notifyTyping} onSend={send} />
          </>
        )}
      </section>
    </div>
  );
}
