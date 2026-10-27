"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import type { User } from "./types";

const LEVELS: [number, string, string, string][] = [
  [1, "ADMIN", "LEVEL 1 • ทุกระบบ + ตั้งค่า", "#e11d48"],
  [2, "MANAGER", "LEVEL 2 • ตามสิทธิ์ที่กำหนด", "#2563eb"],
  [3, "STAFF", "LEVEL 3 • ตามสิทธิ์ที่กำหนด", "#16a34a"],
];

// ความยาก-ง่ายของรหัสผ่าน 0-4 (ความยาว / ตัวเล็ก-ใหญ่ / ตัวเลข / สัญลักษณ์) - แค่บอกให้รู้ ไม่บังคับ
const strength = (p: string) => (p ? Math.min(4, (p.length >= 8 ? 1 : 0) + (/[a-z]/.test(p) && /[A-Z]/.test(p) ? 1 : 0) + (/\d/.test(p) ? 1 : 0) + (/[^A-Za-z0-9]/.test(p) ? 1 : 0)) : 0);
const STRENGTH = ["", "WEAK", "FAIR", "GOOD", "STRONG"];

// ＋ ADD USER / ✏ EDIT USER (UserEditWindow) - รหัสผ่านว่างตอนแก้ไข = ใช้รหัสเดิม / ล็อก-ลดระดับบัญชีตัวเองไม่ได้
//   แบ่งเป็นกลุ่ม ACCOUNT / ORGANIZATION / ACCESS / PASSWORD ทยอยแสดง · การ์ดผู้ใช้ด้านบนอัพเดทตามที่พิมพ์
export function UserEditModal({ user, isSelf, onClose, onSaved }: { user: User | null; isSelf: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [f, setF] = useState({
    userId: user?.userId ?? "",
    name: user?.name ?? "",
    position: user?.position ?? "",
    department: user?.department ?? "",
    section: user?.section ?? "",
    division: user?.division ?? "",
    level: user?.level ?? 2,
    isLocked: user?.isLocked ?? false,
  });
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const id = f.userId.trim();
    if (!id) return setErr("กรุณากรอก USER ID");
    if (id.includes(" ")) return setErr("USER ID ห้ามมีช่องว่าง");
    if (!f.name.trim()) return setErr("กรุณากรอก NAME");
    if (!user && !p1) return setErr("กรุณากรอก PASSWORD");
    if (p1 !== p2) return setErr("PASSWORD และ CONFIRM PASSWORD ไม่ตรงกัน");
    setBusy(true);
    setErr("");
    try {
      const body = { ...f, userId: id, password: p1 || null };
      const r = user
        ? await api<{ message: string }>(`/users/${encodeURIComponent(user.userId)}`, { method: "PUT", body })
        : await api<{ message: string }>("/users", { method: "POST", body });
      onSaved(r.message);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lv = LEVELS.find((l) => l[0] === f.level) ?? LEVELS[1];
  const initials = (f.name.trim() || f.userId.trim() || "?").slice(0, 2).toUpperCase();
  const st = strength(p1);
  const match = p2.length > 0 ? p1 === p2 : null;
  const input = (label: string, k: "userId" | "name" | "position" | "department" | "section" | "division", opt: { auto?: boolean; ro?: boolean } = {}) => (
    <label className="fx">
      <span className="fx-cap">{label}</span>
      <input className="field fx-in" autoFocus={opt.auto} readOnly={opt.ro} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <Modal
      open
      wide
      title={user ? "✏ EDIT USER" : "＋ ADD USER"}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" disabled={busy} onClick={save}>
            {busy ? "⏳ SAVING..." : user ? "💾 SAVE" : "＋ ADD USER"}
          </button>
        </>
      }
    >
      <form
        className="grid gap-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {/* การ์ดผู้ใช้ (อัพเดทตามที่พิมพ์) */}
        <div className="ue-hero" style={{ "--c": lv[3] } as React.CSSProperties}>
          <span className="ue-avatar">{initials}</span>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-base font-black text-primary">{f.name.trim() || "NEW USER"}</b>
            <span className="block truncate text-xs font-bold text-ink-soft">
              {f.userId.trim() || "USER ID"} {f.position.trim() ? `• ${f.position.trim()}` : ""}
            </span>
          </span>
          <span className="ue-badge">{lv[1]}</span>
          {f.isLocked && <span className="ue-badge is-lock">🔒 LOCKED</span>}
        </div>
        <p className="-mt-1 text-xs font-bold text-ink-soft">{user ? "Leave the password empty to keep the current password" : "Fill in the user profile - set the permissions afterwards"}</p>

        <section className="fm-group" style={{ "--d": "0ms" } as React.CSSProperties}>
          <div className="fm-group-head">
            <span className="fm-no">1</span>
            <b>ACCOUNT</b>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {input("USER ID *", "userId", { auto: !user, ro: !!user })}
            {input("NAME *", "name", { auto: !!user })}
          </div>
        </section>

        <section className="fm-group" style={{ "--d": "70ms" } as React.CSSProperties}>
          <div className="fm-group-head">
            <span className="fm-no">2</span>
            <b>ORGANIZATION</b>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {input("POSITION (ตำแหน่ง)", "position")}
            {input("UNIT (หน่วยงาน)", "department")}
            {input("SECTION (แผนก)", "section")}
            {input("DIVISION (ฝ่าย)", "division")}
          </div>
        </section>

        <section className="fm-group" style={{ "--d": "140ms" } as React.CSSProperties}>
          <div className="fm-group-head">
            <span className="fm-no">3</span>
            <b>ACCESS LEVEL</b>
            {isSelf && <span className="text-[11px] font-semibold text-ink-soft">เปลี่ยนระดับ / ล็อกบัญชีตัวเองไม่ได้</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Level">
            {LEVELS.map(([v, t, hint, c]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={f.level === v}
                disabled={isSelf}
                onClick={() => set("level", v)}
                className={`ue-lv ${f.level === v ? "is-on" : ""}`}
                style={{ "--c": c } as React.CSSProperties}
              >
                <span className="ue-lv-dot" />
                <span className="min-w-0 text-left">
                  <b className="block text-sm font-black">{t}</b>
                  <span className="block truncate text-[11px] font-bold opacity-75">{hint}</span>
                </span>
              </button>
            ))}
          </div>
          <label className={`sw mt-3 ${f.isLocked ? "is-on ue-lock" : ""}`}>
            <input type="checkbox" className="sr-only" disabled={isSelf} checked={f.isLocked} onChange={(e) => set("isLocked", e.target.checked)} />
            <span className="sw-track" />
            LOCKED (cannot log in)
          </label>
        </section>

        <section className="fm-group" style={{ "--d": "210ms" } as React.CSSProperties}>
          <div className="fm-group-head">
            <span className="fm-no">4</span>
            <b>PASSWORD</b>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="fx">
              <span className="fx-cap">{user ? "NEW PASSWORD (optional)" : "PASSWORD *"}</span>
              <input className="field fx-in" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
              <span className="ue-meter" data-s={st} aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="text-[10.5px] font-extrabold text-ink-soft">{p1 ? STRENGTH[st] || "WEAK" : " "}</span>
            </label>
            <label className="fx">
              <span className="fx-cap">CONFIRM PASSWORD</span>
              <input className={`field fx-in ${match === false ? "is-bad" : ""}`} type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
              <span className={`text-[10.5px] font-extrabold ${match ? "text-success" : "text-danger"}`}>{match === null ? " " : match ? "✓ MATCH" : "✕ NOT MATCH"}</span>
            </label>
          </div>
        </section>

        {err && <p className="ue-err whitespace-pre-line rounded-xl bg-[#ffebee] px-3 py-2 text-sm font-bold text-danger">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
