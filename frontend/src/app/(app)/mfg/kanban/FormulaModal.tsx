"use client";

import { useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { formulaCards, n0, useRun, type Formula } from "./shared";

// ⚙ KANBAN MANAGEMENT › สูตรคำนวณ KANBAN (like Max-Min formulas): list as cards · add / edit / delete (EDIT right) · live example (not saved)
//   CARDS = ROUND( QTY x (1 + ALLOWANCE % / 100) / PACKING ) · at least 1 card · each Kanban picks one formula, used when the order is placed
type Form = { id: number; isDefault: boolean; name: string; roundMode: Formula["roundMode"]; allowance: string };
const toForm = (f?: Formula): Form => ({ id: f?.id ?? 0, isDefault: f?.isDefault ?? false, name: f?.name ?? "", roundMode: f?.roundMode ?? "UP", allowance: String(f?.allowancePct ?? 0) });
const ROUNDS = [
  ["UP", "ROUND UP"],
  ["NEAREST", "ROUND (NEAREST)"],
  ["DOWN", "ROUND DOWN"],
] as const;
const R = { UP: "RoundUp", NEAREST: "Round", DOWN: "RoundDown" };
const dec = (s: string) => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

export function describe(f: Pick<Formula, "roundMode" | "allowancePct">) {
  const qty = f.allowancePct > 0 ? `QTY x ${1 + f.allowancePct / 100}` : "QTY";
  return `KANBAN = ${R[f.roundMode]}(${qty} / PACKING)  •  อย่างน้อย 1 ใบ`;
}

export function FormulaModal({ formulas, selectId, canEdit, onClose, onChanged }: { formulas: Formula[]; selectId?: number | null; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const run = useRun();
  const [form, setForm] = useState<Form>(toForm(formulas.find((f) => f.id === selectId) ?? formulas[0]));
  const [ex, setEx] = useState({ qty: "1000", pack: "40" });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pct = Number(form.allowance) || 0;
  const cur = { roundMode: form.roundMode, allowancePct: pct };
  const qty = Number(ex.qty) || 0;
  const pack = Number(ex.pack) || 0;
  const cards = formulaCards(qty, pack, cur);
  const ro = !canEdit;

  async function save() {
    if (!form.name.trim()) return toast.show("WARNING", "กรุณากรอกชื่อสูตร (FORMULA NAME)", "warn");
    if (!(pct >= 0 && pct <= 100)) return toast.show("WARNING", "เผื่อ (ALLOWANCE) ต้องอยู่ระหว่าง 0 - 100 %", "warn");
    setBusy(true);
    const r = await run<{ id: number; message: string }>("/kanban/formulas", "POST", { id: form.id, name: form.name, roundMode: form.roundMode, allowancePct: pct });
    setBusy(false);
    if (!r) return;
    setForm((f) => ({ ...f, id: r.id, name: f.name.trim().toUpperCase() }));
    onChanged();
  }

  async function remove() {
    const f = formulas.find((x) => x.id === form.id);
    if (!f || f.isDefault) return;
    if (f.used > 0) return toast.show("ลบไม่ได้", `มี Kanban ใช้สูตรนี้อยู่ ${n0(f.used)} รายการ`, "warn");
    if (!(await dlg.confirm({ title: "DELETE FORMULA", message: `ลบสูตร "${f.name}" ?`, ok: "DELETE", danger: true }))) return;
    if (await run(`/kanban/formulas/${f.id}`, "DELETE")) {
      setForm(toForm(formulas.find((x) => x.isDefault)));
      onChanged();
    }
  }

  return (
    <Modal
      open
      wide
      title="⚙ สูตรคำนวณ KANBAN"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cta-btn is-gray mr-auto" onClick={onClose}>
            CLOSE
          </button>
          {canEdit && (
            <>
              <button type="button" className="cta-btn is-red" disabled={!form.id || form.isDefault} onClick={remove}>
                🗑 DELETE
              </button>
              <button type="button" className="cta-btn is-purple" disabled={busy} onClick={save}>
                {busy ? "…" : "💾 SAVE"}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
        {/* formula list = cards (picked = border + check) */}
        <div className="grid content-start gap-2.5">
          {canEdit && (
            <button type="button" className={`fill-btn w-full ${form.id === 0 ? "is-on" : ""}`} onClick={() => setForm(toForm())}>
              ＋ NEW FORMULA
            </button>
          )}
          {formulas.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setForm(toForm(f))}
              className={`adm-card ch-card fm-card ${form.id === f.id ? "is-on" : ""}`}
              style={{ "--c": f.isDefault ? "#16a34a" : "#6750a4", animationDelay: `${i * 40}ms` } as React.CSSProperties}
            >
              <span className="adm-bar" />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13.5px] font-extrabold text-[#1f2350]">{f.name}</span>
                <span className="mt-0.5 block text-[10.5px] font-bold text-ink-soft">
                  {f.isDefault ? "DEFAULT • " : ""}
                  {f.roundMode} • +{f.allowancePct}% • ใช้ {n0(f.used)} KANBAN
                </span>
              </span>
              <span className="adm-check" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 12.5 4 4 8-9" />
                </svg>
              </span>
            </button>
          ))}
        </div>

        <div className="grid content-start gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-[11px] font-extrabold uppercase text-ink-soft">FORMULA NAME</span>
              <input className="field uppercase" maxLength={100} value={form.name} readOnly={ro} placeholder="ชื่อสูตร เช่น เผื่อเสีย 5%" onChange={(e) => set("name", e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-extrabold uppercase text-ink-soft">เผื่อ (ALLOWANCE %)</span>
              <input className="field font-mono" inputMode="decimal" readOnly={ro} value={form.allowance} onChange={(e) => set("allowance", dec(e.target.value))} />
            </label>
            <div className="grid gap-1.5 sm:col-span-3">
              <span className="text-[11px] font-extrabold uppercase text-ink-soft">ROUND (ปัดเศษจำนวนใบ)</span>
              <div className="flex flex-wrap gap-2">
                {ROUNDS.map(([v, t]) => (
                  <button key={v} type="button" disabled={ro} className={`fill-btn is-sm ${form.roundMode === v ? "is-on" : ""}`} onClick={() => set("roundMode", v)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div key={describe(cur)} className="fm-formula">
            <span className="fm-fx">ƒx</span>
            {describe(cur)}
          </div>

          {/* live example (not saved) */}
          <div className="adm-box">
            <div className="mb-2 text-[11px] font-extrabold uppercase text-ink-soft">EXAMPLE (NOT SAVED)</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase text-ink-soft">จำนวนที่สั่งผลิต (ชิ้น)</span>
                <input className="field font-mono" inputMode="numeric" value={ex.qty} onChange={(e) => setEx((x) => ({ ...x, qty: e.target.value.replace(/\D/g, "") }))} />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase text-ink-soft">PACKING (ชิ้น / กล่อง)</span>
                <input className="field font-mono" inputMode="numeric" value={ex.pack} onChange={(e) => setEx((x) => ({ ...x, pack: e.target.value.replace(/\D/g, "") }))} />
              </label>
            </div>
            <div className="mt-2 text-xs font-semibold text-ink-soft">
              {pack > 0 && qty > 0 ? `${n0(qty)}${pct ? ` x ${1 + pct / 100}` : ""} / ${n0(pack)} = ${(qty * (1 + pct / 100) / pack).toFixed(2)} → ${R[form.roundMode]}` : "กรอกจำนวนที่สั่งผลิต และ PACKING ให้มากกว่า 0"}
            </div>
            <div className="mt-2 fm-res" style={{ "--c": "var(--primary)" } as React.CSSProperties}>
              <div className="text-[11px] font-extrabold text-ink-soft">จำนวน KANBAN (ใบ)</div>
              <div key={cards} className="fm-num">
                {n0(cards)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
