"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import { Checkbox } from "@/components/ui/Checkbox";
import { api, ApiError } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { startPage } from "@/lib/menu";

const REMEMBER_KEY = "chr_remember_uid";

// 🔐 หน้า Login (LoginView.xaml) - เงื่อนไขเดิม: บัญชีที่ใช้งานอยู่เครื่องอื่นเข้าไม่ได้ / บัญชีที่ล็อกเข้าไม่ได้
export default function LoginPage() {
  const { me, loading, refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  // REMEMBER ME: จำแค่ User ID ในเครื่องนี้ (ไม่เก็บรหัสผ่าน)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved)
        queueMicrotask(() => {
          setUserId(saved);
          setRemember(true);
          pwRef.current?.focus();
        });
    } catch {}
  }, []);

  useEffect(() => {
    if (!loading && me) router.replace(startPage(me.can) ?? "/no-permission");
  }, [me, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !password) {
      toast.show("Warning", "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน", "warn");
      return;
    }
    setBusy(true);
    try {
      const m = await api<Me>("/auth/login", { method: "POST", body: { userId: userId.trim(), password } });
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, userId.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {}
      toast.show("Success", `ยินดีต้อนรับคุณ ${m.userName}`, "ok");
      await refresh();
      router.replace(startPage(m.can) ?? "/no-permission");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.show(err instanceof ApiError && err.status === 409 ? "Login Denied" : "Error", msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-primary-dark via-primary to-accent p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/app-192.png" alt="CHR-Nexus" className="h-20 w-20 rounded-2xl object-cover shadow-lg" />
          <div className="text-2xl font-extrabold text-primary">CHR-Nexus</div>
          <div className="text-xs font-bold tracking-wide text-ink-soft">CH.RADIATORS COMPANY LIMITED</div>
          <div className="-mt-1.5 text-xs font-medium text-ink-soft">บริษัท ซีเอช เรดิเอเตอร์ จำกัด</div>
        </div>
        <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">User ID</label>
        <input className="field mb-4" autoFocus autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">Password</label>
        <input className="field mb-4" type="password" ref={pwRef} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="mb-6">
          <Checkbox checked={remember} onChange={setRemember} label="REMEMBER ME" />
        </div>
        <button className="btn w-full bg-accent py-3 text-base" disabled={busy}>
          {busy ? "⏳ กำลังเข้าสู่ระบบ..." : "LOGIN"}
        </button>
        <div className="mt-6 text-center text-[11px] text-ink-soft">© 2026 CHR-Nexus • Pongpakorn Urang</div>
      </form>
    </div>
  );
}
