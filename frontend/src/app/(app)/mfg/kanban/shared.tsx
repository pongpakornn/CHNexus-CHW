"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { fadeOnly, fadeUp } from "@/lib/motion";
import "./kanban.css";

// 🏭 MANUFACTURING › KANBAN CONTROL: shared types · one data hook for the 4 pages (GET /api/kanban, live topic "kanban") · flow editor · entrance motion
export type Step = { zone: string; point: string };
export type Kanban = {
  id: number;
  code: string;
  name: string;
  customer: string | null;
  customerName: string | null;
  perBox: number;
  orderQty: number;
  zone: string | null;
  note: string | null;
  target: number;
  auto: boolean;
  acc: number;
  used: number;
  updatedBy: string | null;
  updatedDate: string;
  steps: Step[];
};
export type Order = {
  id: number;
  kanbanId: number;
  code: string;
  name: string;
  customer: string | null;
  zone: string | null;
  qty: number;
  perBox: number;
  cards: number;
  flowMode: "STANDARD" | "TEMP";
  plannedStart: string | null;
  createdBy: string | null;
  createdAt: string;
  queue: number;
  running: number;
  done: number;
  receiptId: number | null;
  steps: Step[];
};
export type Receipt = { id: number; kanbanId: number; code: string; name: string; customer: string | null; perBox: number; qty: number; status: "WAITING" | "ORDERED"; orderId: number | null; isAuto: boolean; receivedBy: string | null; receivedAt: string };
export type Scan = { id: number; kanbanId: number; code: string; name: string; qty: number; ref: string | null; by: string | null; at: string };
export type Machine = { zone: string; code: string; name: string | null; type: string };
export type KanbanData = {
  can: { add: boolean; edit: boolean; delete: boolean };
  kanbans: Kanban[];
  orders: Order[];
  receipts: Receipt[];
  scans: Scan[];
  options: { zones: string[]; machines: Machine[]; points: string[] };
};

export const isReady = (k: Kanban) => k.steps.length > 0;
/** Kanban cards = qty / pcs per box (rounded up) */
export const cardCount = (qty: number, perBox: number) => (Number.isSafeInteger(qty) && qty > 0 && perBox > 0 ? Math.ceil(qty / perBox) : 0);
export const n0 = (v: number) => v.toLocaleString();
export const when = (s: string | null) => (s ? new Date(s).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-");

export function useKanbanData() {
  const toast = useToast();
  const [data, setData] = useState<KanbanData | null>(null);
  const last = useRef("");
  const load = useCallback(
    async (quiet = false) => {
      try {
        const d = await api<KanbanData>("/kanban");
        if (!sameData(last, d)) setData(d); // same data = no re-render (live refresh stays smooth)
      } catch (e) {
        if (quiet) return;
        toast.show("ERROR", "โหลดข้อมูล KANBAN ไม่สำเร็จ\n" + (e as Error).message, "error");
        setData((d) => d ?? { can: { add: false, edit: false, delete: false }, kanbans: [], orders: [], receipts: [], scans: [], options: { zones: [], machines: [], points: [] } });
      }
    },
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["kanban"], () => load(true));
  return { data, reload: () => load(true) };
}

/** API call + toast (ok / error) · returns the response or null */
export function useRun() {
  const toast = useToast();
  return useCallback(
    async <T extends { message?: string },>(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T | null> => {
      try {
        const r = await api<T>(path, { method, body });
        if (r?.message) toast.show(method === "DELETE" ? "DELETED" : "SAVED", r.message, "ok");
        return r;
      } catch (e) {
        toast.show("ERROR", (e as Error).message, "error");
        return null;
      }
    },
    [toast],
  );
}

/** entrance motion: rise + fade in order (i) · reduced motion = fade only */
export function Rise({ i = 0, className, children }: { i?: number; className?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={reduce ? fadeOnly : fadeUp} initial="hidden" animate="show" custom={i}>
      {children}
    </motion.div>
  );
}

/** status pill: พร้อมใช้งาน / ยังไม่พร้อมใช้งาน */
export function ReadyPill({ ready }: { ready: boolean }) {
  return <span className={`kb-pill ${ready ? "is-ok" : "is-warn"}`}>{ready ? "พร้อมใช้งาน" : "ยังไม่พร้อมใช้งาน"}</span>;
}

/** flow chips: 1 › 2 › 3 */
export function FlowChips({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return <span className="text-xs font-bold text-ink-soft">ยังไม่ได้ตั้งค่า FLOW</span>;
  return (
    <span className="kb-flow">
      {steps.map((s, i) => (
        <span key={i} className={`kb-chip ${i === 0 ? "is-first" : ""}`} title={s.zone}>
          <b>{i + 1}</b>
          {s.point}
        </span>
      ))}
    </span>
  );
}

/** stacked Kanban cards: shows at most 3 layers (the rest wait behind) */
export function CardStack({ count, label }: { count: number; label?: string }) {
  const layers = Math.min(3, Math.max(1, count));
  return (
    <span className="kb-stack" aria-label={`${count} ใบ Kanban`}>
      {Array.from({ length: layers }, (_, i) => (
        <span key={i} className="kb-stack-card" style={{ "--l": layers - 1 - i } as React.CSSProperties} />
      ))}
      <span className="kb-stack-n">
        <b>{n0(count)}</b> {label ?? "ใบ"}
      </span>
    </span>
  );
}

/** flow step editor: N update points, each = ZONE + point (machine code of that zone or typed) */
export function FlowEditor({ steps, onChange, options, disabled, max = 20 }: { steps: Step[]; onChange: (s: Step[]) => void; options: KanbanData["options"]; disabled?: boolean; max?: number }) {
  const zoneOpts = useMemo(() => options.zones.map((z) => ({ value: z, label: z })), [options.zones]);
  const pointOpts = useCallback(
    (zone: string) => {
      const m = options.machines.filter((x) => !zone || x.zone === zone).map((x) => ({ value: x.code, label: x.code, sub: [x.name, x.type].filter(Boolean).join(" · ") }));
      const extra = options.points.filter((p) => !m.some((x) => x.value === p)).map((p) => ({ value: p, label: p }));
      return [...m, ...extra];
    },
    [options],
  );
  const up = (t: string) => t.trim().toUpperCase().slice(0, 50) || null;
  const free = (t: string) => t.trim().slice(0, 100) || null;
  const set = (i: number, p: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="grid gap-2">
      <ol className="grid gap-2">
        {steps.map((s, i) => (
          <li key={i} className="kb-step">
            <span className="kb-step-no">{i + 1}</span>
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <ComboBox value={s.zone} onChange={(v) => set(i, { zone: v })} options={zoneOpts} free={up} disabled={disabled} ariaLabel={`ZONE จุดที่ ${i + 1}`} placeholder="เลือก / พิมพ์ ZONE" />
              <ComboBox value={s.point} onChange={(v) => set(i, { point: v })} options={pointOpts(s.zone)} free={free} disabled={disabled} ariaLabel={`จุดอัพเดทหน้างาน ${i + 1}`} placeholder="เลือกเครื่อง / จุดอัพเดทหน้างาน" mono />
            </div>
            {!disabled && steps.length > 1 && (
              <button type="button" className="kb-step-x" aria-label={`ลบจุดที่ ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
      {!disabled && steps.length < max && (
        <button type="button" className="btn-ghost w-fit" onClick={() => onChange([...steps, { zone: steps.at(-1)?.zone ?? "", point: "" }])}>
          ＋ เพิ่มจุด
        </button>
      )}
    </div>
  );
}
