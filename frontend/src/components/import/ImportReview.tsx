"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { Empty, SearchBox } from "@/components/layout/Page";
import { Pager } from "@/components/tables/Pager";
import { api } from "@/lib/api";
import { EASE, fadeOnly, fadeUp } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { countRows, isReady } from "./counts";
import type { ApplyBody, ImportPreview, ImportRow } from "./types";
import "./import.css";

type View = "home" | "ready" | "changed" | "new" | "same" | "check" | "errors";
type Edits = Record<string, Record<string, string>>;
const PAGE = 50;
const ST: Record<ImportRow["status"], string> = { NEW: "ใหม่", CHANGED: "ยอดเปลี่ยน", SAME: "เหมือนเดิม", DUPLICATE: "ซ้ำในไฟล์", SIMILAR: "คล้ายของเดิม", INVALID: "ไม่ถูกต้อง" };
const TITLE: Record<Exclude<View, "home">, string> = { ready: "✅ พร้อมดำเนินการ", changed: "✏️ ยอดเปลี่ยน (เดิม → ใหม่)", new: "🆕 รายการใหม่", same: "✔ เหมือนเดิม (ไม่แตะ)", check: "⚠ ต้องตรวจสอบ", errors: "⛔ ข้อผิดพลาด" };
const isCheck = (r: ImportRow) => r.status === "DUPLICATE" || r.status === "SIMILAR" || r.status === "INVALID";

// Generic import review: summary cards -> row list (view / edit / exclude / pick existing) -> IMPORT confirm.
// Map value: existing key = use that one; "" = keep as new (SIMILAR rows).
// readOnly = review / filter only (no IMPORT button), e.g. PENTA STOCK until its columns are decided
export function ImportReview({ preview, applyUrl, onDone, onClose, warn, readOnly }: { preview: ImportPreview; applyUrl: string; onDone: () => void; onClose: () => void; warn?: string; readOnly?: boolean }) {
  const dlg = useDialogs();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>("home");
  const [exclude, setExclude] = useState<string[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { rows, errors } = preview;
  const c = useMemo(() => countRows(rows, exclude, map, edits), [rows, exclude, map, edits]);
  const dirty = exclude.length > 0 || Object.keys(edits).length > 0 || Object.keys(map).length > 0;

  // excluded rows stay in "ready" / "check" (greyed) so the user can undo
  const listOf = (v: View): ImportRow[] => {
    const off = (r: ImportRow) => exclude.includes(r.key);
    const rdy = (r: ImportRow) => isReady(r, exclude, map, edits);
    switch (v) {
      case "ready": return rows.filter((r) => rdy(r) || (off(r) && (r.status === "NEW" || r.status === "CHANGED")));
      case "changed": return rows.filter((r) => r.status === "CHANGED" && !off(r));
      case "new": return rows.filter((r) => r.status === "NEW" && !off(r));
      case "same": return rows.filter((r) => r.status === "SAME");
      case "check": return rows.filter((r) => isCheck(r) && !rdy(r));
      default: return [];
    }
  };

  async function close() {
    if (busy) return;
    if (dirty && !readOnly && !(await dlg.confirm({ title: "ปิดหน้าต่าง", message: "มีการแก้ไข / เลือกรายการไว้ ต้องการปิดและทิ้งการเปลี่ยนแปลงใช่หรือไม่?", ok: "CLOSE", danger: true }))) return;
    onClose();
  }

  async function doImport() {
    if (lock.current) return;
    lock.current = true;
    try {
      const lines = [
        `ไฟล์: ${preview.file}`,
        `พร้อมดำเนินการ ${c.ready.toLocaleString()} รายการ (ใหม่ ${c.new.toLocaleString()} • ยอดเปลี่ยน ${c.changed.toLocaleString()}${c.fixed ? ` • แก้แล้ว ${c.fixed.toLocaleString()}` : ""})`,
        `เหมือนเดิม ${c.same.toLocaleString()} รายการ (ไม่แตะ)`,
        c.check ? `⚠ ต้องตรวจสอบ ${c.check.toLocaleString()} รายการ (ข้าม ไม่นำเข้า)` : "",
        exclude.length ? `ไม่ใช้ ${exclude.length.toLocaleString()} รายการ` : "",
        warn ? `\n⚠ ${warn}` : "",
      ].filter(Boolean);
      if (!(await dlg.confirm({ title: `IMPORT ${preview.title}`, message: `${lines.join("\n")}\n\nยืนยันการนำเข้าหรือไม่?`, ok: "IMPORT" }))) return;
      setBusy(true);
      // unresolved SIMILAR / INVALID rows are skipped as promised in the confirm; the server would otherwise insert SIMILAR as new
      const skip = rows.filter((r) => isCheck(r) && r.status !== "DUPLICATE" && !isReady(r, exclude, map, edits)).map((r) => r.key);
      const body: ApplyBody = { id: preview.id, exclude: [...new Set([...exclude, ...skip])], edits, map };
      const r = await api<{ message: string }>(applyUrl, { method: "POST", body });
      toast.show(`IMPORT ${preview.title}`, r.message, r.message.includes("⚠") ? "warn" : "ok");
      onDone();
    } catch (e) {
      dlg.alert({ title: "IMPORT", tone: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  const toggle = (k: string) => setExclude((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const setEdit = (k: string, f: string, v: string | null) =>
    setEdits((x) => {
      const row = { ...(x[k] ?? {}) };
      if (v === null) delete row[f];
      else row[f] = v;
      const n = { ...x, [k]: row };
      if (!Object.keys(row).length) delete n[k];
      return n;
    });
  const setMapOf = (k: string, v: string | null) =>
    setMap((x) => {
      const n = { ...x };
      if (v === null) delete n[k];
      else n[k] = v;
      return n;
    });

  const cards: { tone: string; icon: string; title: string; n: number; sub: string; v: View }[] = [
    { tone: "ok", icon: "✅", title: "พร้อมดำเนินการ", n: c.ready, sub: `ใหม่ ${c.new.toLocaleString()} • ยอดเปลี่ยน ${c.changed.toLocaleString()}${c.fixed ? ` • แก้แล้ว ${c.fixed.toLocaleString()}` : ""}`, v: "ready" },
    { tone: "warn", icon: "✏️", title: "ยอดเปลี่ยน", n: c.changed, sub: "อัพเดทเป็นค่าใหม่ (ดูเดิม → ใหม่)", v: "changed" },
    { tone: "blue", icon: "🆕", title: "รายการใหม่", n: c.new, sub: "ยังไม่มีในระบบ = เพิ่ม", v: "new" },
    { tone: "mute", icon: "✔", title: "เหมือนเดิม", n: c.same, sub: "ใช้ตัวเดิม ไม่แตะ", v: "same" },
    ...(c.check ? [{ tone: "bad", icon: "⚠", title: "ต้องตรวจสอบ", n: c.check, sub: "ซ้ำ / คล้ายของเดิม / ไม่ถูกต้อง • ไม่นำเข้าจนกว่าจะแก้", v: "check" as View }] : []),
    ...(errors.length ? [{ tone: "bad", icon: "⛔", title: "ข้อผิดพลาด", n: errors.length, sub: "ระบุเซลล์ที่มีปัญหา", v: "errors" as View }] : []),
  ];

  const slide = reduce ? { opacity: 0 } : { opacity: 0, x: view === "home" ? -24 : 24 };
  return (
    <Modal
      open
      size="xl"
      title={readOnly ? `🔎 ตรวจไฟล์ • ${preview.title}` : `📥 เตรียม IMPORT • ${preview.title}`}
      onClose={close}
      footer={
        <>
          <span className="mr-auto min-w-0 truncate text-xs font-bold text-ink-soft">{busy ? "กำลังนำเข้า…" : preview.file}</span>
          {view !== "home" && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setView("home")}>
              ← กลับ
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
            CANCEL
          </button>
          {!readOnly && (
            <button type="button" className="btn bg-accent" disabled={busy || c.ready === 0} onClick={doImport}>
              {busy ? <span className="ff-spin is-sm" aria-label="กำลังทำงาน" /> : `📥 IMPORT (${c.ready.toLocaleString()})`}
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-3">
        {warn && <div className="ir-warn">⚠ {warn}</div>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} initial={slide} animate={{ opacity: 1, x: 0 }} exit={slide} transition={{ duration: 0.3, ease: EASE }}>
            {view === "home" ? (
              <motion.div className="ff-cards" initial="hidden" animate="show">
                {cards.map((k, i) => (
                  <motion.div key={k.v} custom={i} variants={reduce ? fadeOnly : fadeUp}>
                    <button type="button" className={`ff-card ir-card is-${k.tone}`} onClick={() => setView(k.v)}>
                      <span className="ff-card-ic" aria-hidden>
                        {k.icon}
                      </span>
                      <span className="min-w-0">
                        <small>{k.title}</small>
                        <b>{k.n.toLocaleString()}</b>
                        <em>{k.sub}</em>
                      </span>
                      <span className="ff-card-go" aria-hidden>
                        ›
                      </span>
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            ) : view === "errors" ? (
              <div className="grid gap-2">
                <b className="text-sm font-black text-[#1f2350]">
                  {TITLE.errors} • {errors.length.toLocaleString()}
                </b>
                {errors.map((e, i) => (
                  <div key={i} className="ir-err">
                    <b>{e.cell}</b>
                    <span>{e.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <RowList title={TITLE[view]} list={listOf(view)} view={view} exclude={exclude} edits={edits} map={map} onToggle={toggle} onEdit={setEdit} onMap={setMapOf} busy={busy} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Modal>
  );
}

function RowList({ title, list, view, exclude, edits, map, onToggle, onEdit, onMap, busy }: { title: string; list: ImportRow[]; view: View; exclude: string[]; edits: Edits; map: Record<string, string>; onToggle: (k: string) => void; onEdit: (k: string, f: string, v: string | null) => void; onMap: (k: string, v: string | null) => void; busy: boolean }) {
  const [key, setKey] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(key, 200).trim().toLowerCase();
  const rows = useMemo(() => (q ? list.filter((r) => [r.label, r.sub, r.key, r.note].join(" ").toLowerCase().includes(q)) : list), [list, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm font-black text-[#1f2350]">
          {title} • {rows.length.toLocaleString()}
        </b>
        <SearchBox value={key} onChange={(s) => (setKey(s), setPage(0))} placeholder="ค้นหา..." className="ml-auto min-w-[200px] max-w-full" />
      </div>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="grid gap-2">
          {rows.slice(cur * PAGE, cur * PAGE + PAGE).map((r) => (
            <RowCard key={r.key} r={r} off={exclude.includes(r.key)} edit={edits[r.key]} mapped={map[r.key]} view={view} onToggle={onToggle} onEdit={onEdit} onMap={onMap} busy={busy} />
          ))}
        </div>
      )}
      {pages > 1 && <Pager page={cur} pages={pages} total={rows.length} size={PAGE} onPage={setPage} />}
    </div>
  );
}

function RowCard({ r, off, edit, mapped, view, onToggle, onEdit, onMap, busy }: { r: ImportRow; off: boolean; edit?: Record<string, string>; mapped?: string; view: View; onToggle: (k: string) => void; onEdit: (k: string, f: string, v: string | null) => void; onMap: (k: string, v: string | null) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const editable = r.fields.some((f) => f.edit);
  const tone = r.status === "NEW" ? "is-new" : r.status === "CHANGED" ? "is-changed" : r.status === "SAME" ? "" : "is-bad";
  return (
    <div className={`ir-row ${off ? "is-off" : ""}`}>
      <div className="ir-head">
        <span className={`ff-st ${tone}`}>{ST[r.status]}</span>
        <b>{r.label}</b>
        {r.sub && <small>{r.sub}</small>}
        {mapped !== undefined && <span className="ff-st is-ok">{mapped ? `ใช้ ${r.suggest?.find((s) => s.key === mapped)?.label ?? mapped}` : "เพิ่มเป็นรายการใหม่"}</span>}
        {edit && <span className="ff-st is-ok">แก้ไขแล้ว</span>}
        <div className="ir-acts">
          <button type="button" className="fill-btn is-sm" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
            {open ? "ซ่อน" : "ดู"}
          </button>
          {editable && (
            <button
              type="button"
              className={`fill-btn is-sm ${editing ? "is-on" : ""}`}
              disabled={busy || off}
              onClick={() => {
                setEditing((x) => !x);
                setOpen(true);
              }}
            >
              แก้ไข
            </button>
          )}
          {view !== "same" && (
            <button type="button" className={`fill-btn is-sm ${off ? "" : "is-danger"}`} disabled={busy} onClick={() => onToggle(r.key)}>
              {off ? "ใช้" : "ไม่ใช้"}
            </button>
          )}
        </div>
      </div>
      {r.note && <p className="ir-note">{r.note}</p>}
      {r.status === "SIMILAR" && !off && (
        <div className="ir-sug">
          <small>ใกล้เคียงในระบบ:</small>
          {(r.suggest ?? []).map((s) => (
            <button key={s.key} type="button" className={mapped === s.key ? "is-on" : ""} disabled={busy} onClick={() => onMap(r.key, mapped === s.key ? null : s.key)}>
              ✔ ใช้ตัวที่มีอยู่ {s.label}
            </button>
          ))}
          <button type="button" className={mapped === "" ? "is-on" : ""} disabled={busy} onClick={() => onMap(r.key, mapped === "" ? null : "")}>
            ➕ เพิ่มเป็นรายการใหม่
          </button>
        </div>
      )}
      {open && (
        <div className="ir-fields">
          {r.fields.map((f) => {
            const v = edit?.[f.name];
            const chg = f.old !== null && f.old !== (v ?? f.new);
            return editing && f.edit ? (
              <label key={f.name}>
                <small>{f.name}</small>
                <input className="field" value={v ?? f.new ?? ""} disabled={busy} onChange={(e) => onEdit(r.key, f.name, e.target.value === (f.new ?? "") ? null : e.target.value)} />
              </label>
            ) : (
              <div key={f.name} className={chg ? "is-chg" : ""}>
                <small>{f.name}</small>
                <span>
                  {chg && <s>{f.old || "-"}</s>}
                  <b>{v ?? f.new ?? "-"}</b>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
