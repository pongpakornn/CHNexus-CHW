"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { Checkbox } from "@/components/forms/Checkbox";
import { api, ApiError } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { startPage } from "@/lib/menu";

// REMEMBER ME: จำบัญชี (User ID + ชื่อ) ในเครื่องนี้ - ไม่เก็บรหัสผ่าน
type Saved = { id: string; name: string };
const REMEMBER_KEY = "chr_remember_list";
const MAX_SAVED = 5;

function readSaved(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string").slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}
function writeSaved(list: Saved[]) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {}
}

// 🔐 หน้า Login (LoginView.xaml) - เงื่อนไขเดิม: บัญชีที่ใช้งานอยู่เครื่องอื่นเข้าไม่ได้ / บัญชีที่ล็อกเข้าไม่ได้
//   ธีมมืด + การ์ดใสสีเดียวกับ Sidebar · การ์ดบัญชีที่จำไว้ด้านล่าง (กด = เลือกบัญชี แล้วใส่แค่รหัสผ่าน)
export default function LoginPage() {
  const { me, loading, refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [formErr, setFormErr] = useState("");
  const fid = useId();
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = readSaved();
    if (list.length > 0)
      queueMicrotask(() => {
        setSaved(list);
        setUserId(list[0].id);
        setRemember(true);
        pwRef.current?.focus();
      });
  }, []);

  useEffect(() => {
    if (!loading && me) router.replace(startPage(me.can) ?? "/no-permission");
  }, [me, loading, router]);

  function pick(s: Saved) {
    setUserId(s.id);
    setPassword("");
    setRemember(true);
    pwRef.current?.focus();
  }

  function forget(id: string) {
    const list = saved.filter((s) => s.id !== id);
    setSaved(list);
    writeSaved(list);
    if (userId === id) setUserId("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !password) {
      setFormErr("กรุณาระบุชื่อผู้ใช้และรหัสผ่าน");
      toast.show("Warning", "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน", "warn");
      return;
    }
    setFormErr("");
    setBusy(true);
    try {
      const id = userId.trim();
      const m = await api<Me>("/auth/login", { method: "POST", body: { userId: id, password } });
      const rest = saved.filter((s) => s.id.toLowerCase() !== id.toLowerCase());
      writeSaved(remember ? [{ id, name: m.userName }, ...rest] : rest);
      toast.show("Success", `ยินดีต้อนรับคุณ ${m.userName}`, "ok");
      await refresh();
      router.replace(startPage(m.can) ?? "/no-permission");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormErr(msg);
      toast.show(err instanceof ApiError && err.status === 409 ? "Login Denied" : "Error", msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg-bg grid min-h-dvh place-items-center p-4">
      <div className="grid w-full max-w-sm gap-4">
        <form onSubmit={submit} className="lg-card" data-reveal="own">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/app-192.png" alt="CHR-Nexus" className="h-20 w-20 rounded-2xl object-cover shadow-lg" />
            <div className="text-2xl font-extrabold text-white">CHR-Nexus</div>
            <div className="text-xs font-bold tracking-wide text-white/70">CH.RADIATORS COMPANY LIMITED</div>
            <div className="-mt-1.5 text-xs font-medium text-white/70">บริษัท ซีเอช เรดิเอเตอร์ จำกัด</div>
          </div>
          <label htmlFor={`${fid}-user`} className="mb-1 block text-xs font-bold uppercase text-white/80">User ID</label>
          <input id={`${fid}-user`} className="lg-field mb-4" autoFocus autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <label htmlFor={`${fid}-pw`} className="mb-1 block text-xs font-bold uppercase text-white/80">Password</label>
          <div className="relative mb-4">
            <input id={`${fid}-pw`} ref={pwRef} className="lg-field" style={{ paddingRight: 58 }} type={showPw ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button
              type="button"
              className="absolute inset-y-0 right-1 my-auto h-8 rounded-lg px-2.5 text-[11px] font-extrabold uppercase text-white/80 hover:bg-white/10"
              aria-pressed={showPw}
              aria-label={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? "HIDE" : "SHOW"}
            </button>
          </div>
          {formErr && (
            <p role="alert" className="mb-4 rounded-lg bg-[#7f1d1d]/60 px-3 py-2 text-xs font-bold text-[#fecaca]">
              {formErr}
            </p>
          )}
          <div className="mb-6 text-white/80">
            <Checkbox checked={remember} onChange={setRemember} label="REMEMBER ME" />
          </div>
          <button className="btn w-full bg-accent py-3 text-base" disabled={busy}>
            {busy ? "กำลังเข้าสู่ระบบ…" : "LOGIN"}
          </button>
          <div className="mt-6 text-center text-[11px] text-white/70">© 2026 CHR-Nexus • Pongpakorn Urang</div>
        </form>

        {saved.length > 0 && (
          <div className="lg-card is-sub" data-reveal="own">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/70">REMEMBERED ACCOUNTS</div>
            <div className="grid gap-1.5">
              {saved.map((s, i) => (
                <div key={s.id} className={`lg-acc ${s.id === userId ? "is-on" : ""}`} style={{ "--i": i } as React.CSSProperties}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => pick(s)}>
                    <span className="lg-acc-av">{(s.name || s.id).trim().charAt(0).toUpperCase()}</span>
                    <span className="min-w-0">
                      <b className="block truncate text-sm text-white">{s.name || s.id}</b>
                      <small className="block truncate text-[11px] text-white/70">{s.id}</small>
                    </span>
                  </button>
                  <button type="button" className="lg-acc-x" title="ลบบัญชีนี้ออกจากเครื่องนี้" aria-label="ลบบัญชีนี้ออกจากเครื่องนี้" onClick={() => forget(s.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
