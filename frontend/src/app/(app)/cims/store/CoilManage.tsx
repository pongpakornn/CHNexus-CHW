"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { DateRange } from "@/components/forms/DateRange";
import { ChoiceCard, Glyph } from "@/components/buttons/ChoiceCard";
import { Badge, Empty, Loading, SearchBox } from "@/components/layout/Page";
import { api } from "@/lib/api";
import { parseNum, qty, today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { masterOf, type CoilRow } from "./TableRows";
import type { ManageMode } from "./CoilManageButtons";

export type { ManageMode };
import type { Product } from "./types";

// 🧲 MANAGE STOCK ของคลังที่นับ Coil (สิทธิ์ EDIT + APPROVE ของคลัง)
//   ADD    = ปุ่ม ＋ ที่บรรทัด PD CODE: เพิ่ม Master Coil / Number Coil
//   ADJUST = ปุ่ม ACTION ที่แถว Coil ลูก: EDIT / TRANSFER (สแกนออก) / ADJUST (คืนยอด / ลบออก)
//   HISTORY = ประวัติการจัดการของคลังนี้ (วันนี้ / เลือกช่วงวันที่ / กรองประเภท)

const kgNum = (s: string) => parseNum((s ?? "").replace(/,/g, ""));
const ton = (kg: number | null) => (kg === null || Number.isNaN(kg) ? "-" : (kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

// แถบบอกโหมดเหนือตาราง + ปุ่มออก
export function ManageBar({ mode, onExit, picked = 0, busy = false, onHide }: { mode: ManageMode; onExit: () => void; picked?: number; busy?: boolean; onHide?: () => void }) {
  if (!mode) return null;
  const add = mode === "ADD";
  const hide = mode === "HIDE";
  return (
    <div className={`mng-bar ${add ? "is-add" : "is-adj"}`} style={hide ? ({ "--c": "#64748b" } as React.CSSProperties) : undefined} role="status">
      <span className="mng-bar-ic" aria-hidden>
        {add ? "＋" : hide ? "◌" : "⚖"}
      </span>
      <div className="min-w-0 flex-1">
        <b>{add ? "ADD MASTER COIL / NUMBER COIL" : hide ? "HIDE PRODUCT" : "ADJUST STOCK"}</b>
        <span>{add ? "กดปุ่ม ＋ ที่บรรทัด PD CODE เพื่อเพิ่ม Master Coil / Number Coil ที่ยังไม่มีในคลัง" : hide ? "ติ๊กเลือกหลายรายการแล้วกด HIDE (n) หรือกดปุ่มตาท้ายแถวเพื่อซ่อนทีละรายการ · สินค้าที่ซ่อนจะไม่แสดงในคลังนี้อีก · แสดงคืนได้ที่ MASTER DATA > PRODUCT CONTROL" : "เปิด Coil ของสินค้า แล้วใช้ปุ่ม EDIT / TRANSFER / ADJUST ที่แถว Coil ลูก"}</span>
      </div>
      {hide && (
        <button type="button" className="fill-btn is-xs" disabled={picked === 0 || busy} onClick={onHide}>
          HIDE ({picked})
        </button>
      )}
      <button type="button" className="fill-btn is-xs" onClick={onExit}>
        ✕ EXIT
      </button>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-semibold text-ink-soft">{hint}</span>}
    </label>
  );
}

function ReadTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#ebe7f4] bg-[#faf9fd] px-3 py-2">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="truncate text-sm font-extrabold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

// ================================================================ ➕ ADD
export function AddCoilModal({ stkId, stockCode, product, onClose, onDone }: { stkId: number; stockCode: string; product: Product; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [source, setSource] = useState<string | null | undefined>(undefined);
  const [master, setMaster] = useState("");
  const [coil, setCoil] = useState("");
  const [kg, setKg] = useState("");
  const [remark, setRemark] = useState("");
  const [deduct, setDeduct] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ source: string | null }>(`/store/${stkId}/manage/info`)
      .then((r) => setSource(r.source))
      .catch(() => setSource(null));
  }, [stkId]);

  const w = kgNum(kg);
  const isMaster = !coil.trim() || coil.trim().toUpperCase() === master.trim().toUpperCase();
  const canDeduct = !!source && !isMaster && !!master.trim();

  async function save() {
    if (!master.trim() && !coil.trim()) return toast.show("WARNING", "กรุณากรอก MASTER COIL หรือ NUMBER COIL", "warn");
    if (w === null || Number.isNaN(w) || w <= 0) return toast.show("WARNING", "กรุณากรอก WEIGHT (KG) เป็นตัวเลขมากกว่า 0", "warn");
    const what = isMaster ? `Master Coil ${master.trim() || coil.trim()}` : `Coil ${coil.trim()}  (Master ${master.trim() || "-"})`;
    const how = canDeduct && deduct ? `\nตัด Master Coil ${master.trim()} ใน ${source} ${qty(w)} KG (เหมือนสแกนรับป้าย)` : "\nเพิ่มเข้าทะเบียนคลังนี้อย่างเดียว (ไม่ตัดคลังอื่น)";
    const ok = await dlg.confirm({
      title: "ADD MASTER COIL / NUMBER COIL",
      ok: "＋ ADD",
      message: `${stockCode}  •  ${product.partCode}\n${what}\nWEIGHT ${qty(w)} KG  (${ton(w)} TON)${how}\n\nมีป้ายเลขเดียวกันค้างใน NOT DEDUCTED = รับเข้า + ตัดให้แทน (ไม่ซ้ำ)\nยืนยันหรือไม่?`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/store/${stkId}/manage/add`, {
        method: "POST",
        body: { partId: product.partId, masterCoil: master, coilNo: coil, weightKg: kg, remark, deduct: canDeduct && deduct },
      });
      onDone(r.message);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="＋ ADD MASTER COIL / NUMBER COIL"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" onClick={save} disabled={busy}>
            {busy ? "⏳ SAVING..." : "＋ ADD"}
          </button>
        </>
      }
    >
      <div className="mng-head">
        <span className="sc-tag">{stockCode}</span>
        <b className="break-all">{product.partCode}</b>
        <span className="min-w-0 truncate text-ink-soft">{product.partName}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="MASTER COIL" hint="Master Coil ทั้งม้วน = กรอกช่องนี้อย่างเดียว">
          <input className="field" autoFocus value={master} maxLength={100} onChange={(e) => setMaster(e.target.value)} />
        </Field>
        <Field label="NUMBER COIL" hint="Coil ลูกที่ตัดจาก Master Coil">
          <input className="field" value={coil} maxLength={100} onChange={(e) => setCoil(e.target.value)} />
        </Field>
        <Field label="WEIGHT (KG.) *">
          <input className="field text-right tabular-nums" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2 self-end">
          <ReadTile label="WEIGHT (TON)" value={ton(w)} />
          <ReadTile label="STOCK (COIL)" value="+1" tone="var(--success)" />
        </div>
        <div className="sm:col-span-2">
          <Field label="REMARK">
            <input className="field" value={remark} maxLength={500} onChange={(e) => setRemark(e.target.value)} />
          </Field>
        </div>
      </div>
      {source === undefined ? null : canDeduct ? (
        <button type="button" className={`mng-opt mt-4 ${deduct ? "is-on" : ""}`} aria-pressed={deduct} onClick={() => setDeduct((d) => !d)}>
          <span className={`sw ${deduct ? "is-on" : ""} !border-0 !bg-transparent !p-0 !shadow-none`}>
            <span className="sw-track" />
          </span>
          <span className="min-w-0 text-left">
            <b>ตัดยอดจาก {source}</b>
            <span>ตัด Master Coil {master.trim()} ใน {source} ตามน้ำหนัก (บันทึกที่ Multi-Scanner / DEDUCTED) · ตัดไม่ได้ = ค้างที่ NOT DEDUCTED</span>
          </span>
        </button>
      ) : (
        <p className="mt-4 rounded-xl bg-[#f4f6fb] px-3 py-2 text-xs font-semibold text-ink-soft">
          {isMaster ? "Master Coil ทั้งม้วน = เพิ่มเข้าคลังนี้ · ป้ายใน NOT DEDUCTED ที่รอ Master Coil นี้จะถูก APPROVE ให้อัตโนมัติ" : "เพิ่มเข้าทะเบียนคลังนี้ (คลังนี้ไม่มีคลังต้นทางให้ตัด)"}
        </p>
      )}
    </Modal>
  );
}

// ================================================================ ✏️ EDIT
export function EditCoilModal({ stkId, stockCode, partCode, row, onClose, onDone }: { stkId: number; stockCode: string; partCode: string; row: CoilRow; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const old = kgNum(row.weight) ?? 0;
  const [master, setMaster] = useState(row.motherCoil && row.motherCoil !== "-" ? row.motherCoil : "");
  const [coil, setCoil] = useState(row.coilNo);
  const [kg, setKg] = useState(String(old));
  const [remark, setRemark] = useState(row.remark ?? "");
  const [busy, setBusy] = useState(false);
  const w = kgNum(kg);
  const diff = w === null || Number.isNaN(w) ? 0 : Number((w - old).toFixed(3));

  async function save() {
    if (!coil.trim()) return toast.show("WARNING", "กรุณากรอก NUMBER COIL", "warn");
    if (w === null || Number.isNaN(w) || w <= 0) return toast.show("WARNING", "กรุณากรอก WEIGHT (KG) เป็นตัวเลขมากกว่า 0", "warn");
    const changes = [
      coil.trim() !== row.coilNo && `NUMBER COIL: ${row.coilNo} → ${coil.trim()}`,
      master.trim() !== (row.motherCoil === "-" ? "" : row.motherCoil) && `MASTER: ${masterOf(row)} → ${master.trim() || "-"}`,
      diff !== 0 && `WEIGHT: ${qty(old)} → ${qty(w)} KG (${diff > 0 ? "+" : ""}${qty(diff)})`,
      remark.trim() !== (row.remark ?? "") && `REMARK: ${row.remark || "-"} → ${remark.trim() || "-"}`,
    ].filter(Boolean);
    if (changes.length === 0) return toast.show("EDIT", "ไม่มีอะไรเปลี่ยน", "warn");
    const ok = await dlg.confirm({
      title: "EDIT COIL",
      ok: "💾 SAVE",
      message:
        `${stockCode}  •  ${partCode}\n\n${changes.join("\n")}` +
        (diff !== 0 ? `\n\nยอด ${partCode} ${diff > 0 ? "+" : ""}${qty(diff)} KG\nส่วนต่างจะ${diff < 0 ? "คืนให้" : "ตัดเพิ่มจาก"}คลังต้นทาง (ถ้า Coil นี้ถูกตัดมาตอนสแกน)` : "") +
        "\nRECEIVED = เวลาที่แก้ไข\n\nยืนยันหรือไม่?",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/store/${stkId}/manage/coils/${row.coilId}`, { method: "PUT", body: { masterCoil: master, coilNo: coil, weightKg: kg, remark } });
      onDone(r.message);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="✏️ EDIT COIL"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" onClick={save} disabled={busy}>
            {busy ? "⏳ SAVING..." : "💾 SAVE"}
          </button>
        </>
      }
    >
      <div className="mng-head">
        <span className="sc-tag">{stockCode}</span>
        <b className="break-all">{partCode}</b>
        <span className="text-ink-soft">RECEIVED {row.received}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="MASTER COIL">
          <input className="field" value={master} maxLength={100} onChange={(e) => setMaster(e.target.value)} />
        </Field>
        <Field label="NUMBER COIL *">
          <input className="field" value={coil} maxLength={100} onChange={(e) => setCoil(e.target.value)} />
        </Field>
        <Field label="WEIGHT (KG.) *">
          <input className="field text-right tabular-nums" inputMode="decimal" autoFocus value={kg} onChange={(e) => setKg(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-2 self-end">
          <ReadTile label="WEIGHT (TON)" value={ton(w)} />
          <ReadTile label="STOCK (COIL)" value="1" />
          <ReadTile label="DIFF (KG)" value={diff === 0 ? "0" : `${diff > 0 ? "+" : ""}${qty(diff)}`} tone={diff < 0 ? "var(--danger)" : diff > 0 ? "var(--success)" : undefined} />
        </div>
        <div className="sm:col-span-2">
          <Field label="REMARK">
            <input className="field" value={remark} maxLength={500} onChange={(e) => setRemark(e.target.value)} />
          </Field>
        </div>
      </div>
      <p className="mt-4 rounded-xl bg-[#f4f6fb] px-3 py-2 text-xs font-semibold text-ink-soft">
        แก้น้ำหนัก = ยอดสินค้าในคลังนี้ปรับตาม + ส่วนต่างคืน / ตัดเพิ่มที่คลังต้นทาง (Master Coil) · WEIGHT (TON) / RECEIVED อัพเดทให้อัตโนมัติ · ป้าย NOT DEDUCTED ที่ตรงกันจะถูกเคลียร์ให้
      </p>
    </Modal>
  );
}

// ================================================================ ⚖ ADJUST (คืนยอด / ลบออก)
export function AdjustCoilModal({ stkId, stockCode, partCode, row, onClose, onDone }: { stkId: number; stockCode: string; partCode: string; row: CoilRow; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [mode, setMode] = useState<"RETURN" | "REMOVE" | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!mode) return toast.show("WARNING", "กรุณาเลือก คืนยอด หรือ ลบออกจากระบบ", "warn");
    if (!reason.trim()) return toast.show("WARNING", "กรุณาระบุหมายเหตุ (เหตุผลที่ปรับปรุงยอด)", "warn");
    const ok = await dlg.confirm({
      title: mode === "RETURN" ? "RETURN STOCK" : "REMOVE FROM STOCK",
      danger: mode === "REMOVE",
      ok: mode === "RETURN" ? "↩ RETURN" : "🗑 REMOVE",
      message:
        `${stockCode}  •  ${partCode}\nCoil ${row.coilNo}  •  Master ${masterOf(row)}  •  ${row.weight} KG\n\n` +
        (mode === "RETURN" ? `คืนยอด ${row.weight} KG ให้คลังต้นทาง (Master Coil ${masterOf(row)})\nยอดคลังนี้ลดลงตามน้ำหนัก` : `ลบ Coil นี้ออกจาก ${stockCode} (ยอดลดลง ${row.weight} KG)\nMaster Coil ยังอยู่เหมือนเดิม`) +
        `\n\nหมายเหตุ: ${reason.trim()}\n\nยืนยันหรือไม่?`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/store/${stkId}/manage/coils/${row.coilId}/adjust`, { method: "POST", body: { mode, reason } });
      onDone(r.message);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="⚖ ADJUST STOCK"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className={`cta-btn ${mode === "REMOVE" ? "is-red" : "is-orange"}`} onClick={save} disabled={busy || !mode}>
            {busy ? "⏳ SAVING..." : mode === "REMOVE" ? "🗑 REMOVE" : "↩ RETURN"}
          </button>
        </>
      }
    >
      <div className="mng-head">
        <span className="sc-tag">{stockCode}</span>
        <b className="break-all">{row.coilNo}</b>
        <span className="text-ink-soft">
          {partCode} • Master {masterOf(row)} • {row.weight} KG
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          color="#ea580c"
          on={mode === "RETURN"}
          onClick={() => setMode("RETURN")}
          icon={<Glyph d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />}
          title="คืนยอด (RETURN)"
          detail="คืนน้ำหนัก Coil นี้ให้คลังต้นทาง (เช่น STOCK-PANTA) · Master Coil ต้นทางเพิ่มขึ้น · ยอดคลังนี้ลดลง"
          meta={`+${row.weight} KG → SOURCE`}
        />
        <ChoiceCard
          color="#ef4444"
          on={mode === "REMOVE"}
          onClick={() => setMode("REMOVE")}
          delay={1}
          icon={<Glyph d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />}
          title="ลบออกจากระบบ (REMOVE)"
          detail="เอา Coil นี้ออกจากคลังนี้ · เหลือแค่ Master Coil (ต้นทางไม่เปลี่ยน) · ยอดคลังนี้ลดลง"
          meta={`-${row.weight} KG`}
        />
      </div>
      <div className="mt-4">
        <Field label="หมายเหตุ (REASON) *">
          <textarea className="field min-h-[84px]" maxLength={500} value={reason} placeholder="เช่น นับจริงไม่พบ / ป้ายซ้ำ / คืนของเข้าคลังต้นทาง" onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ================================================================ 🕘 HISTORY
type HRow = {
  logId: number;
  date: string;
  action: string;
  mode: string;
  partCode: string;
  coilNo: string;
  motherCoil: string;
  before: number | null;
  after: number | null;
  sourceCode: string;
  sourceQty: number | null;
  detail: string;
  reason: string;
  userId: string;
  userName: string;
};

const ACTIONS: [string, string, string][] = [
  ["ADD", "ADD MASTER COIL", "#16a34a"],
  ["EDIT", "EDIT", "#2563eb"],
  ["TRANSFER", "TRANSFER", "#0d9488"],
  ["ADJUST", "ADJUST", "#ea580c"],
];
const MODE_TEXT: Record<string, string> = { RETURN: "RETURN", REMOVE: "REMOVE", DEDUCT: "CUT SOURCE", MATCH: "NOT DEDUCTED", PLAIN: "" };

export function ManageHistoryModal({ stkId, stockCode, onClose }: { stkId: number; stockCode: string; onClose: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<HRow[] | null>(null);
  const [hasLog, setHasLog] = useState(true);
  const [view, setView] = useState("ALL");
  const k = useDebounced(key, 250);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const r = await api<{ hasLog: boolean; rows: HRow[] }>(`/store/${stkId}/manage/history`, { query: { from, to, key: k } });
      if (n !== seq.current) return;
      setHasLog(r.hasLog);
      setRows(r.rows);
    } catch (e) {
      toast.show("HISTORY", "โหลดประวัติไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [stkId, from, to, k, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const list = useMemo(() => (rows ?? []).filter((r) => view === "ALL" || r.action === view), [rows, view]);
  const color = (a: string) => ACTIONS.find((x) => x[0] === a)?.[2] ?? "var(--primary)";

  return (
    <Modal
      open
      size="xl"
      title={`🕘 MANAGE STOCK HISTORY • ${stockCode}`}
      onClose={onClose}
      footer={
        <span className="mr-auto self-center text-xs font-bold text-ink-soft">
          {list.length.toLocaleString()} RECORDS • ทุกรายการลง ACTIVITY LOG ด้วย (ใคร / ค่าเดิม → ค่าใหม่ / เวลา)
        </span>
      }
    >
      {!hasLog && (
        <div className="mb-3 rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">
          ยังไม่ได้รัน Script database/nexus/18_Coil_Manage.sql — การจัดการยังทำได้และลง Activity Log แต่หน้าประวัตินี้จะเริ่มเก็บหลังรัน Script
        </div>
      )}
      <div className="relative z-20 mb-3 flex flex-wrap items-center gap-3">
        <SearchBox className="min-w-[240px] flex-1" fancy value={key} onChange={setKey} placeholder="ค้นหา Coil / Master Coil / PD CODE / ผู้ใช้ / หมายเหตุ" />
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
      </div>
      {rows && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">FILTER</span>
          {[["ALL", "ALL", ""] as [string, string, string], ...ACTIONS].map(([a, label]) => (
            <button key={a} type="button" className={`flt-chip ${view === a ? "is-on" : ""}`} aria-pressed={view === a} onClick={() => setView(a)}>
              {label} <b>{(a === "ALL" ? rows.length : rows.filter((r) => r.action === a).length).toLocaleString()}</b>
            </button>
          ))}
        </div>
      )}
      {!rows ? (
        <Loading />
      ) : (
        <div className="overflow-auto rounded-2xl border border-[#e7e4ef]">
          <table className="data-table t-center hist-table w-full">
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th>DATE</th>
                <th>ACTION</th>
                <th>PD CODE</th>
                <th>MASTER COIL</th>
                <th>NUMBER COIL</th>
                <th className="text-right">KG BEFORE → AFTER</th>
                <th>SOURCE</th>
                <th>DETAIL</th>
                <th>REASON</th>
                <th>USER</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.logId} className="sc-row" style={{ animationDelay: `${Math.min(i, 20) * 14}ms` }}>
                  <td className="h-date whitespace-nowrap text-xs font-bold text-ink-soft">{r.date}</td>
                  <td className="whitespace-nowrap">
                    <Badge color={color(r.action)}>{r.action}</Badge>
                    {MODE_TEXT[r.mode] && <div className="mt-1 text-[10.5px] font-extrabold text-ink-soft">{MODE_TEXT[r.mode]}</div>}
                  </td>
                  <td className="whitespace-nowrap font-extrabold text-primary">{r.partCode || "-"}</td>
                  <td className="whitespace-nowrap">{r.motherCoil || "-"}</td>
                  <td className="whitespace-nowrap font-bold">{r.coilNo || "-"}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {qty(r.before)} → <b>{qty(r.after)}</b>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {r.sourceCode ? (
                      <>
                        <span className="sc-tag">{r.sourceCode}</span>{" "}
                        {r.sourceQty !== null && (
                          <b className={r.sourceQty > 0 ? "text-success" : "text-danger"}>
                            {r.sourceQty > 0 ? "+" : ""}
                            {qty(r.sourceQty)}
                          </b>
                        )}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="min-w-[220px] text-xs font-semibold">{r.detail}</td>
                  <td className="min-w-[140px] text-xs font-semibold text-[#b45309]">{r.reason || "-"}</td>
                  <td className="whitespace-nowrap">
                    <div className="font-bold">{r.userId}</div>
                    {r.userName && <div className="text-[11px] font-medium text-ink-soft">{r.userName}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <Empty>ยังไม่มีประวัติในช่วงวันที่นี้</Empty>}
        </div>
      )}
    </Modal>
  );
}
