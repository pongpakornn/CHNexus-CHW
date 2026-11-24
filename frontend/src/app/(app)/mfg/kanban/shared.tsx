"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { fadeOnly, fadeUp } from "@/lib/motion";
import { formulaCards } from "@/lib/kanban";
import "./kanban.css";

export { formulaCards };

// 🏭 MANUFACTURING › KANBAN: shared types · one data hook for the 4 pages (GET /api/kanban, live topic "kanban") · flow editor · entrance motion
export type Step = { zone: string; point: string };
export type Kanban = {
  id: number;
  code: string;
  name: string; // Product Name (Part Information)
  partId: number | null;
  partA: string | null;
  partNo: string | null;
  customer: string | null;
  customerName: string | null;
  perBox: number; // PACKING (pcs per box)
  orderQty: number;
  zone: string | null;
  note: string | null;
  formulaId: number | null; // null = default formula
  formulaName: string | null;
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
  partId: number | null;
  partA: string | null;
  partNo: string | null;
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
export type Stuck = { id: number; code: string; partA: string | null; seq: number; total: number; point: string; zone: string; minutes: number };
export type Machine = { zone: string; code: string; name: string | null; type: string };
/** Zone & Workstation Information (script 74): zone + its line-side store · active workstations */
export type ZoneInfo = { code: string; name: string | null; status: string; store: string | null; storeName: string | null };
export type Station = { zone: string; code: string; name: string | null; machine: string | null; machineName: string | null; operators: number };
/** card formula (script 75): CARDS = ROUND( QTY x (1 + ALLOWANCE % / 100) / PACKING ) · at least 1 card */
export type Formula = { id: number; name: string; roundMode: "UP" | "NEAREST" | "DOWN"; allowancePct: number; isDefault: boolean; used: number; updatedBy: string | null; updatedDate: string };
/** flow point = every workstation of the zone (parallel) */
export const ALL_STATIONS = "ALL";
export type KanbanData = {
  can: { add: boolean; edit: boolean; delete: boolean };
  kanbans: Kanban[];
  orders: Order[];
  receipts: Receipt[];
  scans: Scan[];
  options: { zones: string[]; machines: Machine[]; points: string[]; zoneInfo: ZoneInfo[]; stations: Station[]; zoneMaster: boolean };
  stuck: Stuck[];
  formulas: Formula[];
};

export const isReady = (k: Kanban) => k.steps.length > 0;
/** the formula a Kanban uses (none picked = default) */
export const formulaOf = (k: Pick<Kanban, "formulaId"> | null | undefined, formulas: Formula[]) => formulas.find((f) => f.id === k?.formulaId) ?? formulas.find((f) => f.isDefault) ?? null;
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
        setData((d) => d ?? { can: { add: false, edit: false, delete: false }, kanbans: [], orders: [], receipts: [], scans: [], options: { zones: [], machines: [], points: [], zoneInfo: [], stations: [], zoneMaster: false }, stuck: [], formulas: [] });
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
  return (
    <span className={`kb-pill ${ready ? "is-ok" : "is-warn"}`} title={ready ? undefined : "ต้อง SET FLOW ก่อนจึงจะใช้งาน Kanban นี้ได้"}>
      {ready ? "พร้อมใช้งาน" : "ยังไม่พร้อมใช้งาน · รอ SET FLOW"}
    </span>
  );
}

/** flow chips: 1 › 2 › 3 */
export function FlowChips({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return <span className="text-xs font-bold text-ink-soft">ยังไม่ได้ตั้งค่า FLOW</span>;
  return (
    <span className="kb-flow">
      {steps.map((s, i) => (
        <span key={i} className={`kb-chip ${i === 0 ? "is-first" : ""}`} title={`ZONE ${s.zone}`}>
          <b>{i + 1}</b>
          {s.point === ALL_STATIONS ? `${s.zone} · ทุกสถานี` : s.point}
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

/** Part Information rows that have a PART A or PART B (partA = the part code, kind = A / B) · packing = PackSize · loaded once per page */
export type Part = { id: number; partA: string; kind: "A" | "B"; partNo: string; name: string; customer: string; packing: number };
export function useParts() {
  const [parts, setParts] = useState<Part[] | null>(null);
  useEffect(() => {
    api<Part[]>("/kanban/parts")
      .then(setParts)
      .catch(() => setParts([]));
  }, []);
  return parts;
}

/** part picture (Part Information image) · no picture / broken file = box icon */
export function PartImg({ partId, className = "" }: { partId: number | null; className?: string }) {
  const [bad, setBad] = useState<number | null>(null);
  return partId && bad !== partId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/images/part/${partId}`} alt="รูปชิ้นงาน" decoding="async" draggable={false} className={`object-contain ${className}`} onError={() => setBad(partId)} />
  ) : (
    <span className={`grid place-items-center text-4xl ${className}`} aria-hidden>
      📦
    </span>
  );
}

/** creation stage of a Kanban: 0 = draft (not saved) · 1 = saved, waiting for SET FLOW · 2 = ready */
export const STAGES = [
  { label: "ร่าง · ยังไม่บันทึก", cls: "is-draft" },
  { label: "รอ SET FLOW", cls: "is-warn" },
  { label: "พร้อมใช้งาน", cls: "is-ok" },
] as const;

/** Kanban card preview (like the Pick List label preview): picture left · W/O / customer / PART / PART NO / product name · creation stage
 *  (production progress is shown where the card is used: สั่งผลิต · KANBAN BOARD) */
export function KanbanCard({ k, stage }: { k: { code: string; partId: number | null; partA: string | null; partNo: string | null; name: string; customer: string | null; zone: string | null; perBox: number; formula: string | null }; stage: 0 | 1 | 2 }) {
  const st = STAGES[stage];
  return (
    <article className="kb-card" aria-label="KANBAN PREVIEW">
      <div className="kb-card-img">
        <PartImg partId={k.partId} className="size-full" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="kb-card-wo min-w-0 flex-1">
            W/O : <span className="text-ink-soft">—</span>
          </p>
          <span className={`kb-pill ${st.cls}`}>{st.label}</span>
        </div>
        <dl className="kb-card-dl">
          <dt>CUSTOMER</dt>
          <dd>{k.customer || "-"}</dd>
          <dt>PART</dt>
          <dd className="font-mono text-[15px] font-black text-ink">{k.partA || "-"}</dd>
          <dt>PART NO</dt>
          <dd className="font-mono">{k.partNo || "-"}</dd>
          <dt>PRODUCT</dt>
          <dd title={k.name}>{k.name || "-"}</dd>
        </dl>
        <p className="kb-card-meta">
          <span className="font-mono">{k.code || "KANBAN CODE"}</span>
          <span>
            {k.zone || "-"} · PACKING <b>{n0(k.perBox)}</b>
          </span>
        </p>
        {k.formula && <p className="mt-1 truncate text-[11px] font-bold text-ink-soft">ƒx {k.formula}</p>}
      </div>
    </article>
  );
}

/** flow step editor: N update points, each = ZONE + point (machine code of that zone or typed) */
export function FlowEditor({ steps, onChange, options, disabled, max = 20 }: { steps: Step[]; onChange: (s: Step[]) => void; options: KanbanData["options"]; disabled?: boolean; max?: number }) {
  const zoneOpts = useMemo(() => options.zones.map((z) => ({ value: z, label: z, sub: options.zoneInfo.find((x) => x.code === z)?.name ?? undefined })), [options.zones, options.zoneInfo]);
  // point of a zone: ALL workstations (parallel) · one workstation · a machine of the zone · points used before
  const pointOpts = useCallback(
    (zone: string) => {
      const st = options.stations.filter((x) => x.zone === zone);
      const all = st.length ? [{ value: ALL_STATIONS, label: "ALL · ทุกสถานีงานในโซน", sub: `${st.length} สถานี · ${st.reduce((a, x) => a + x.operators, 0)} คน` }] : [];
      const ws = st.map((x) => ({ value: x.code, label: x.code, sub: ["สถานีงาน", x.name, x.machine, `${x.operators} คน`].filter(Boolean).join(" · ") }));
      const m = options.machines.filter((x) => (!zone || x.zone === zone) && !ws.some((w) => w.value === x.code)).map((x) => ({ value: x.code, label: x.code, sub: ["เครื่องจักร", x.name, x.type].filter(Boolean).join(" · ") }));
      const used = [...all, ...ws, ...m];
      const extra = options.points.filter((p) => p !== ALL_STATIONS && !used.some((x) => x.value === p)).map((p) => ({ value: p, label: p }));
      return [...used, ...extra];
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
              <ComboBox
                value={s.zone}
                onChange={(v) => set(i, { zone: v, ...(v !== s.zone && s.point === ALL_STATIONS ? { point: "" } : {}) })}
                options={zoneOpts}
                free={options.zoneMaster ? undefined : up}
                disabled={disabled}
                ariaLabel={`ZONE จุดที่ ${i + 1}`}
                placeholder={options.zoneMaster ? (zoneOpts.length ? "เลือก ZONE" : "ยังไม่มี ZONE · เพิ่มที่ Master Data") : "เลือก / พิมพ์ ZONE"}
              />
              <ComboBox value={s.point} onChange={(v) => set(i, { point: v })} options={pointOpts(s.zone)} free={free} disabled={disabled} ariaLabel={`สถานีงาน / เครื่องจักร จุดที่ ${i + 1}`} placeholder={s.zone ? "เลือกสถานีงาน / เครื่องจักร" : "เลือก ZONE ก่อน"} mono />
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
