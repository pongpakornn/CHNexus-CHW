"use client";

import { useState } from "react";
import { DotsMenu, type DotsItem } from "@/components/menus/DotsMenu";
import { Icon } from "@/components/icons";
import { wofTokenOf } from "@/lib/pcwof";
import { LOCKS_TOKEN, LOCKS_URL, minTokenOf, openMinSign } from "@/lib/minSign";

// 💬 กล่องข้อความของแชท (แบบ IG)
//   ⋯ ทุกข้อความ = กดอีโมจิตอบ · ข้อความของฉันเพิ่ม แก้ไข / ลบ · แก้ไขในกล่องเดิม (Enter = บันทึก, Esc = ยกเลิก)
//   แนบรูป = แสดงรูปในแชท (กด = เปิดเต็ม) · แนบไฟล์ = การ์ดไฟล์ + ปุ่มดาวน์โหลด
export const EMOJIS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

export type Attach = { name: string; size: number; kind: string };
export type Reaction = { emoji: string; userId: string; name: string };

const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function ChatBubble({
  side,
  body,
  meta,
  edited,
  deleted,
  tone,
  attach,
  fileUrl,
  reactions,
  me,
  onEdit,
  onDelete,
  onReact,
}: {
  side: "me" | "other" | "bot";
  body: React.ReactNode;
  meta?: string;
  edited?: boolean;
  deleted?: boolean;
  tone?: string;
  attach?: Attach | null;
  fileUrl?: string;
  reactions?: Reaction[];
  me?: string;
  onEdit?: (text: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onReact?: (emoji: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = side !== "bot" && !deleted;
  const text = typeof body === "string" ? body : "";
  // ✍ เอกสาร MIN REPORT ที่ส่งมาในแชท ([[MINREPORT:id]]) = ปุ่มเปิดเอกสาร / ลงลายเซ็น
  const minDoc = text ? minTokenOf(text) : null;
  const wofDoc = text ? wofTokenOf(text) : null; // [[WOF:id]] = WORK ORDER FOLLOW sign request

  async function save() {
    if (editing === null || !onEdit) return;
    const t = editing.trim();
    if (!t) return;
    setBusy(true);
    try {
      await onEdit(t);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  // ⋯ เมนู: อีโมจิด้านบน + แก้ไข / ลบ / ดาวน์โหลด
  const items: DotsItem[] = [];
  if (live && attach && fileUrl) items.push({ label: "ดาวน์โหลด", icon: "download", onSelect: () => window.open(`${fileUrl}?download=true`, "_blank") });
  if (live && side === "me" && onEdit && text) items.push({ label: "แก้ไข", icon: "pencil", onSelect: () => setEditing(text) });
  if (live && side === "me" && onDelete) items.push({ label: "ลบ", icon: "trash", danger: true, onSelect: () => onDelete() });
  const mine = reactions?.find((r) => r.userId === me)?.emoji;
  const top = live && onReact
    ? (close: () => void) => (
        <div className="flex items-center gap-0.5 px-1 py-0.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => (close(), onReact(e))}
              className={`grid size-9 place-items-center rounded-full text-[20px] transition hover:-translate-y-1 hover:scale-125 ${mine === e ? "bg-[#eaf1ff]" : "hover:bg-surface-2"}`}
              aria-label={`React ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )
    : undefined;

  // รวมอีโมจิ: 😂 2
  const groups = Object.entries(
    (reactions ?? []).reduce<Record<string, Reaction[]>>((a, r) => ((a[r.emoji] ??= []).push(r), a), {}),
  );

  const bubbleClass =
    side === "me"
      ? "rounded-br-md bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white"
      : side === "bot"
        ? "rounded-bl-md border border-[#dbe4f5] bg-[#f4f8ff] text-ink"
        : "rounded-bl-md bg-[#eef0f4] text-ink";

  return (
    <div className={`group flex flex-col ${side === "me" ? "items-end" : "items-start"}`}>
      <div className={`relative flex max-w-[82%] items-center gap-1 ${side === "me" ? "flex-row-reverse" : ""}`}>
        {editing !== null ? (
          <div className="flex w-[min(420px,70vw)] flex-col gap-1.5 rounded-2xl border border-[#2563eb] bg-white p-2 shadow-[0_6px_18px_-8px_rgba(37,99,235,.6)]">
            <textarea
              autoFocus
              value={editing}
              maxLength={2000}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(null);
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
              }}
              className="min-h-[40px] resize-none bg-transparent text-[13px] text-ink outline-none [field-sizing:content]"
            />
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setEditing(null)} className="rounded-full px-3 py-1 text-[11px] font-extrabold text-ink-soft hover:bg-surface-2">
                ยกเลิก
              </button>
              <button type="button" disabled={busy || !editing.trim()} onClick={save} className="rounded-full bg-[#2563eb] px-3 py-1 text-[11px] font-extrabold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                บันทึก
              </button>
            </div>
          </div>
        ) : deleted ? (
          <div className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-[13px] italic text-ink-soft">ข้อความถูกลบ</div>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            {/* 📷 รูป / 📎 ไฟล์ */}
            {attach && fileUrl && attach.kind === "IMAGE" && (
              <a href={fileUrl} target="_blank" rel="noreferrer" className={`block overflow-hidden rounded-2xl border border-line/60 bg-surface-2 ${side === "me" ? "rounded-br-md" : "rounded-bl-md"}`} title={attach.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl} alt={attach.name} loading="lazy" className="block max-h-64 max-w-[min(280px,60vw)] object-cover transition hover:opacity-90" />
              </a>
            )}
            {attach && fileUrl && attach.kind !== "IMAGE" && (
              <a
                href={`${fileUrl}?download=true`}
                className={`flex min-w-[220px] items-center gap-2.5 rounded-2xl px-3 py-2.5 transition ${side === "me" ? "rounded-br-md bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white hover:brightness-110" : "rounded-bl-md bg-[#eef0f4] text-ink hover:bg-[#e3e7ee]"}`}
                title="ดาวน์โหลด"
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${side === "me" ? "bg-white/20" : "bg-white text-[#2563eb]"}`}>
                  <Icon name="document" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-extrabold">{attach.name}</span>
                  <span className={`block text-[10.5px] font-semibold ${side === "me" ? "text-white/80" : "text-ink-soft"}`}>{sizeText(attach.size)} · กดเพื่อดาวน์โหลด</span>
                </span>
                <Icon name="download" className="size-4 shrink-0" />
              </a>
            )}
            {(text || !attach) && (
              <div
                className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${bubbleClass}`}
                style={side === "bot" && tone ? { borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` } : undefined}
              >
                {text.includes(LOCKS_TOKEN) ? (
                  <>
                    {text.replace(LOCKS_TOKEN, "").trim()}
                    <a href={LOCKS_URL} className="mr-chat-doc mt-1.5 block text-center">
                      🔓 เปิดหน้าปลดล็อก (USER MANAGEMENT)
                    </a>
                  </>
                ) : wofDoc ? (
                  <>
                    {wofDoc.text}
                    <a href={`/pc/wof/${wofDoc.id}`} className="mr-chat-doc mt-1.5 block text-center">
                      ✍ เปิดแผ่นงาน WORK ORDER FOLLOW
                    </a>
                  </>
                ) : minDoc ? (
                  <>
                    {minDoc.text}
                    <button type="button" className="mr-chat-doc" onClick={() => openMinSign(minDoc.id)}>
                      👁 เปิดเอกสาร MIN REPORT #{minDoc.id} · ✍ ลงลายเซ็น
                    </button>
                  </>
                ) : (
                  body
                )}
              </div>
            )}
          </div>
        )}

        {editing === null && (items.length > 0 || top) && <DotsMenu reveal align={side === "me" ? "right" : "left"} label="Message actions" items={items} top={top} />}
      </div>

      {/* อีโมจิที่กดตอบ (กด = กด / ยกเลิกอีโมจินั้นของฉัน) */}
      {groups.length > 0 && !deleted && (
        <div className={`-mt-1.5 flex gap-1 ${side === "me" ? "mr-2" : "ml-2"}`}>
          {groups.map(([e, rs]) => (
            <button
              key={e}
              type="button"
              onClick={() => onReact?.(e)}
              title={rs.map((r) => r.name).join(", ")}
              className={`relative z-[1] inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[12px] shadow-sm transition hover:scale-110 ${rs.some((r) => r.userId === me) ? "border-[#93c5fd] bg-[#eaf1ff]" : "border-line bg-surface"}`}
            >
              {e}
              {rs.length > 1 && <span className="text-[10px] font-extrabold text-ink-soft">{rs.length}</span>}
            </button>
          ))}
        </div>
      )}

      {meta && (
        <span className="mt-0.5 px-1 text-[10px] font-semibold text-ink-soft">
          {meta}
          {edited && !deleted ? " · แก้ไขแล้ว" : ""}
        </span>
      )}
    </div>
  );
}
