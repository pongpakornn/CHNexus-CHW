"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Shell } from "@/components/layout/Shell";
import { useAuth } from "@/lib/auth";
import { installBugReporter } from "@/lib/bugReport";

// หน้าระบบทั้งหมด: ต้อง Login ก่อน (API ตรวจสิทธิ์ซ้ำทุก Request)
export function AppGate({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => installBugReporter(), []); // 🐞 Error ของหน้าเว็บ -> BUG LOG
  // 🟢 สถานะ ONLINE: ส่ง ping ทุก 60 วินาที (แม้ซ่อนแท็บ) · ปิดหน้าต่าง / ปิด Browser = แจ้ง Server -> OFFLINE ให้เองในไม่กี่วินาที
  //    (Reload / เปิดหน้าใหม่ทัน = ยัง ONLINE) - ทำให้ Login จากเครื่องอื่นได้ ไม่ค้าง "กำลังใช้งานอยู่ในเครื่องอื่น"
  const uid = me?.userId;
  useEffect(() => {
    if (!uid) return;
    const ping = () => fetch("/api/auth/ping", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
    const t = setInterval(ping, 60_000);
    const bye = () => navigator.sendBeacon?.("/api/auth/bye");
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
    };
  }, [uid]);
  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [me, loading, router]);
  if (!me) return <div className="grid h-dvh place-items-center text-ink-soft">⏳ LOADING...</div>;
  return <Shell>{children}</Shell>;
}
