"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useLive } from "./live";

export type Me = {
  userId: string;
  userName: string;
  userLevel: number;
  isMasterAdmin: boolean;
  department: string;
  can: Record<string, boolean>;
  permissions: { systemId: string; view: boolean; add: boolean; edit: boolean; delete: boolean; approve: boolean }[];
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>("/auth/me");
      // ค่าเหมือนเดิม = ไม่ต้องวาดทั้งแอปใหม่
      setMe((prev) => (prev && JSON.stringify(prev) === JSON.stringify(m) ? prev : m));
      return m;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      // ออกจากระบบ = โหลดหน้า Login ใหม่ทั้งหน้า (ไม่ให้ข้อมูลของผู้ใช้เดิมค้างใน State)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
  }, []);

  useEffect(() => {
    queueMicrotask(refresh);
    // สิทธิ์เปลี่ยนโดย Admin -> โหลดใหม่ทุก 60 วินาที (API ตรวจสิทธิ์ทุกครั้งอยู่แล้ว)
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // ⚡ Admin บันทึกสิทธิ์ / ผู้ใช้ (หัวข้อ users) = โหลดสิทธิ์ของฉันใหม่ทันที (เมนู / ปุ่ม เปลี่ยนตามโดยไม่ต้อง Login ใหม่)
  useLive(me ? ["users"] : [], refresh);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
