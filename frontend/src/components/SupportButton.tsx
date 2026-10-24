"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { openChat, openSupport } from "@/lib/support";
import { Icon } from "./icons";

// 🎧 ปุ่มวงกลมหูฟังข้างกระดิ่ง: ชี้ = หูฟังหมุน + กล่องเบอร์ติดต่อ Admin เลื่อนลงมา · กด = เปิดแชทแจ้ง Admin
type Contact = { fullName: string; phone: string; nickname: string | null };

export function SupportButton() {
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ contacts: Contact[] }>("/support/info")
        .then((i) => setContacts(i.contacts))
        .catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="group relative">
      <button type="button" className="support-btn" onClick={() => openSupport()} aria-label="ติดต่อ / แจ้ง Admin" title="ติดต่อ / แจ้ง Admin">
        <svg viewBox="0 0 16 16" fill="none" width="20" height="20" aria-hidden="true">
          <path
            strokeLinejoin="round"
            strokeLinecap="round"
            stroke="currentColor"
            strokeWidth="1.3"
            d="M1 10V8C1 2.5 6 1 8 1C10 1 15 2.5 15 8V10M1 10C1 10.5552 1 11.1543 1.0984 11.6204C1.24447 12.3122 2 13 3 13C4 13 4.75553 12.3122 4.9016 11.6204C5 11.1543 5 10.5552 5 10C5 9.44485 5 8.84565 4.9016 8.37961C4.75553 7.68776 4 7 3 7C2 7 1.24447 7.68776 1.0984 8.37961C1 8.84565 1 9.44485 1 10ZM15 10C15 10.5552 15 11.1543 14.9016 11.6204C14.7555 12.3122 14 13 13 13C12 13 11.2445 12.3122 11.0984 11.6204C11 11.1543 11 10.5552 11 10C11 9.44485 11 8.84565 11.0984 8.37961C11.2445 7.68776 12 7 13 7C14 7 14.7555 7.68776 14.9016 8.37961C15 8.84565 15 9.44485 15 10ZM15 10C15 15.5 12.5 15 8 15"
          />
        </svg>
      </button>

      {/* กล่องเบอร์ติดต่อ (โผล่ตอนชี้) */}
      <div className="pointer-events-none absolute right-0 top-full z-40 w-64 translate-y-2.5 pt-3 opacity-0 transition duration-300 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
        <span className="absolute right-[15px] top-[5px] size-3 rotate-45 rounded-[2px] border-l border-t border-[#2563eb]/30 bg-white" />
        <div className="glass-panel relative overflow-hidden rounded-2xl border border-[#2563eb]/25 p-1.5">
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[#2563eb]">Support · ติดต่อ Admin</div>
          {contacts.length === 0 && <div className="px-2.5 py-1.5 text-xs font-semibold text-ink-soft">ยังไม่ได้ตั้งเบอร์ (ALERT CONTACT)</div>}
          {contacts.map((c) => (
            <a
              key={c.phone + c.fullName}
              href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-[#2563eb]/10"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2563eb]/10 text-[#2563eb]">
                <Icon name="phone" className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-extrabold tabular-nums text-ink">{c.phone}</span>
                <span className="block truncate text-[11px] font-semibold text-ink-soft">
                  {c.fullName}
                  {c.nickname ? ` (${c.nickname})` : ""}
                </span>
              </span>
            </a>
          ))}
          <button
            type="button"
            onClick={() => openSupport()}
            className="mt-1 flex w-full items-center gap-2.5 rounded-xl bg-[#2563eb] px-2.5 py-2 text-left text-white transition hover:bg-[#1d4ed8]"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15">
              <Icon name="chat" className="size-4" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">แชทแจ้ง Admin</span>
              <span className="block text-[11px] font-semibold text-white/80">ปัญหา · อัพเดทระบบ · ขอสิทธิ์</span>
            </span>
          </button>
          <button type="button" onClick={() => openChat()} className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-[#2563eb]/10">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2563eb]/10 text-[#2563eb]">
              <Icon name="user" className="size-4" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold text-ink">แชทกับเพื่อนร่วมงาน</span>
              <span className="block text-[11px] font-semibold text-ink-soft">คุยหนึ่งต่อหนึ่ง เห็นเฉพาะของตัวเอง</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
