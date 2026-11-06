"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { Loading } from "@/components/layout/Page";
import { api } from "@/lib/api";
import type { Contact } from "./types";

const blank = (c: Contact) => !c.fullName.trim() && !c.phone.trim() && !c.nickname.trim();
const line = (c: Contact) => `☎ ${c.fullName.trim()} - ${c.phone.trim()}` + (c.nickname.trim() ? ` (${c.nickname.trim()})` : "");

// 🔔 ผู้ติดต่อ Admin (AdminContactWindow) - แสดงให้ผู้ใช้ที่ยังไม่ได้กำหนดคลังสแกน / ไม่มีสิทธิ์
export function ContactModal({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Contact[]>("/users/contacts")
      .then((l) => setRows(l.length ? l.map((c) => ({ fullName: c.fullName ?? "", phone: c.phone ?? "", nickname: c.nickname ?? "" })) : [{ fullName: "", phone: "", nickname: "" }]))
      .catch((e) => setErr("โหลดข้อมูลผู้ติดต่อไม่สำเร็จ\n" + e.message));
  }, []);

  const set = (i: number, k: keyof Contact, v: string) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const list = (rows ?? []).filter((r) => !blank(r));

  async function save() {
    if (!rows) return;
    const bad = rows.map((r, i) => (!blank(r) && (!r.fullName.trim() || !r.phone.trim()) ? i + 1 : 0)).filter(Boolean);
    if (bad.length) return setErr(`แถวที่ ${bad.join(", ")}: กรุณากรอกชื่อและเบอร์ติดต่อ`);
    if (list.length === 0) return setErr("กรุณาใส่ผู้ติดต่ออย่างน้อย 1 คน");
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/users/contacts", { method: "POST", body: list });
      onSaved(r.message);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="🔔 ALERT CONTACT"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" disabled={busy || !rows} onClick={save}>
            💾 SAVE
          </button>
        </>
      }
    >
      {!rows ? (
        err ? <p className="whitespace-pre-line text-sm font-bold text-danger">{err}</p> : <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid content-start gap-3">
          {rows.map((r, i) => (
            <div key={i} className="ct-row grid items-center gap-2 sm:grid-cols-[36px_2fr_1.3fr_1fr_auto]" style={{ animationDelay: `${i * 40}ms` }}>
              <span className="ct-no">{i + 1}</span>
              <input className="field" placeholder="FULL NAME *" value={r.fullName} onChange={(e) => set(i, "fullName", e.target.value)} />
              <input className="field" placeholder="PHONE *" inputMode="tel" value={r.phone} onChange={(e) => set(i, "phone", e.target.value)} />
              <input className="field" placeholder="NICKNAME" value={r.nickname} onChange={(e) => set(i, "nickname", e.target.value)} />
              <div className="flex gap-1.5">
                <button
                  className="fill-btn is-xs"
                  disabled={i === 0}
                  aria-label="Move up"
                  onClick={() => setRows((rs) => (rs ? [...rs.slice(0, i - 1), rs[i], rs[i - 1], ...rs.slice(i + 1)] : rs))}
                >
                  ▲
                </button>
                <button className="fill-btn is-xs is-danger" aria-label="Remove" onClick={() => setRows((rs) => rs!.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button className="fill-btn is-add w-fit" onClick={() => setRows((rs) => [...(rs ?? []), { fullName: "", phone: "", nickname: "" }])}>
            ＋ ADD CONTACT
          </button>
          {err && <p className="whitespace-pre-line rounded-lg bg-[#ffebee] px-3 py-2 text-sm font-bold text-danger">{err}</p>}
          </div>
          {/* ตัวอย่างที่ผู้ใช้เห็นในหน้าสแกน */}
          <div className="ct-preview">
            <div className="mb-2 text-[11px] font-extrabold tracking-wide text-white/70">PREVIEW (scan page)</div>
            <div className="ct-bubble">
              <span className="ct-bell">🔔</span>
              <div className="whitespace-pre-line text-sm font-bold text-[#1f2350]">{"กรุณาติดต่อ Admin เพื่อขอความช่วยเหลือ\n" + (list.length ? list.map(line).join("\n") : "☎ Admin")}</div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
