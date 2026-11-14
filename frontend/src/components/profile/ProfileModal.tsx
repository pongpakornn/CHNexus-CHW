"use client";

import { useEffect, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";

// ✏ แก้ไขโปรไฟล์ของตัวเอง: ข้อมูลส่วนตัว + เปลี่ยนรหัสผ่าน (UserID / Level / สิทธิ์ แก้ได้ที่ User Management โดย Admin)
type Profile = {
  userId: string;
  name: string;
  position: string;
  department: string;
  section: string;
  division: string;
  levelText: string;
  masterAdmin: boolean;
  lastLogin: string | null;
  lastSession: string;
};

const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
const FIELDS = [
  ["position", "POSITION  (ตำแหน่ง)"],
  ["department", "UNIT  (หน่วยงาน)"],
  ["section", "SECTION  (แผนก)"],
  ["division", "DIVISION  (ฝ่าย)"],
] as const;

export function ProfileModal({ tab: startTab, onClose }: { tab: "info" | "password"; onClose: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState(startTab);
  const [p, setP] = useState<Profile | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Profile>("/profile")
      .then(setP)
      .catch((e) => setErr((e as Error).message));
  }, []);

  const set = (k: keyof Profile, v: string) => setP((x) => (x ? { ...x, [k]: v } : x));

  async function saveInfo() {
    if (!p) return;
    if (!p.name.trim()) return setErr("กรุณากรอก NAME");
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ message: string }>("/profile", {
        method: "PUT",
        body: { name: p.name, position: p.position, department: p.department, section: p.section, division: p.division },
      });
      await refresh();
      toast.show("SAVED", r.message, "ok");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (!pw.current) return setErr("กรุณากรอกรหัสผ่านปัจจุบัน");
    if (!pw.next) return setErr("กรุณากรอกรหัสผ่านใหม่");
    if (pw.next.length < 4) return setErr("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร");
    if (pw.next !== pw.confirm) return setErr("ยืนยันรหัสผ่านใหม่ไม่ตรงกัน");
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ message: string }>("/profile/password", { method: "POST", body: pw });
      toast.show("PASSWORD", r.message, "ok");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (k: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => (setTab(k), setErr(""))}
      className={`flex-1 rounded-lg px-3 py-2 text-xs font-extrabold uppercase tracking-wide transition ${tab === k ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <Modal
      open
      title="✏ EDIT PROFILE"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-success" disabled={busy || !p} onClick={tab === "info" ? saveInfo : savePassword}>
            {tab === "info" ? "SAVE" : "CHANGE PASSWORD"}
          </button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1">
        {tabBtn("info", "ข้อมูลส่วนตัว")}
        {tabBtn("password", "เปลี่ยนรหัสผ่าน")}
      </div>

      {!p && !err && <Loading />}

      {p && tab === "info" && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            saveInfo();
          }}
        >
          <label>
            <span className={L}>USER ID</span>
            <input className="field cursor-not-allowed bg-surface-2 text-ink-soft" readOnly value={p.userId} />
          </label>
          <label>
            <span className={L}>NAME *</span>
            <input className="field" autoFocus value={p.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          {FIELDS.map(([k, l]) => (
            <label key={k}>
              <span className={L}>{l}</span>
              <input className="field" value={p[k]} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-soft sm:col-span-2">
            {p.levelText}
            {p.masterAdmin ? " • MASTER ADMIN" : ""}
            {p.lastLogin ? ` • เข้าสู่ระบบล่าสุด ${p.lastLogin}` : ""}
            <br />
            USER ID, LEVEL และสิทธิ์การใช้งาน แก้ไขได้โดย Admin ที่หน้า User Management
          </div>
          <button type="submit" className="hidden" />
        </form>
      )}

      {p && tab === "password" && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            savePassword();
          }}
        >
          <input type="text" autoComplete="username" value={p.userId} readOnly hidden />
          <label>
            <span className={L}>CURRENT PASSWORD *</span>
            <input className="field" type="password" autoFocus autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label>
            <span className={L}>NEW PASSWORD * (อย่างน้อย 4 ตัวอักษร)</span>
            <input className="field" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label>
            <span className={L}>CONFIRM NEW PASSWORD *</span>
            <input className="field" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
          <button type="submit" className="hidden" />
        </form>
      )}

      {err && <p className="mt-3 whitespace-pre-line rounded-lg bg-[#ffebee] px-3 py-2 text-sm font-bold text-danger">{err}</p>}
    </Modal>
  );
}
