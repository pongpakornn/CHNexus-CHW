"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { sharedGet } from "@/lib/sharedGet";
import { PC_PERM } from "@/lib/menu";
import type { PcMeta, PcQueue } from "@/lib/pcwof";
import { useToast } from "@/components/notifications/Toasts";

// ✍ WORK ORDER FOLLOW รอลงลายเซ็น: คิวของฉัน (/pcwof/sign/queue) · ครั้งแรกจำไว้เฉย ๆ · มีรายการใหม่ = Toast (กด = เปิดชีท) · ทุกหน้า
export function PcwofSignHost() {
  const { me } = useAuth();
  return me?.can[PC_PERM] ? <Host /> : null;
}

function Host() {
  const toast = useToast();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const ready = useRef<boolean | null>(null);

  const poll = useCallback(async () => {
    try {
      if (ready.current === null) ready.current = (await api<PcMeta>("/pcwof/meta")).ready;
      if (!ready.current) return; // DB not installed yet
      const q = await sharedGet<PcQueue[]>("/pcwof/sign/queue");
      const key = (x: PcQueue) => `${x.sheetId}|${x.role}`;
      const first = seen.current === null;
      const prev = seen.current ?? new Set<string>();
      seen.current = new Set(q.map(key));
      if (!first)
        q.filter((x) => !prev.has(key(x)))
          .slice(0, 3)
          .forEach((x) =>
            toast.show(`✍ WORK ORDER FOLLOW รอลงลายเซ็น (${x.role})`, `${x.customerName ?? ""} ${x.workOrderNo ?? ""} ${x.month ?? ""}\nกดเพื่อเปิดชีท`.trim(), "warn", {
              onClick: () => router.push(`/pc/wof/${x.sheetId}`),
              ms: 12000,
            }),
          );
    } catch {
      /* next round retries */
    }
  }, [toast, router]);

  useEffect(() => {
    const t0 = setTimeout(poll, 3000);
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 300_000);
    return () => (clearTimeout(t0), clearInterval(t));
  }, [poll]);
  useLive(["pcwof"], poll);
  return null;
}
