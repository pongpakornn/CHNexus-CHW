"use client";

import { useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { dmy, type Card, type Scope } from "../edp";

// ⛔ ผลิตไม่ได้: เลือกการ์ดเอง หรือทั้งกะ (DAY / NIGHT / ALL) + เหตุผล -> การ์ดที่เลือก = ผลิตไม่ได้ (REMARK ของ EDP PLANNING)
//   ทั้งกะ = จบแผนของกะนั้นด้วย · ทุกครั้งเก็บลง EDP REPORT
type Mode = "pick" | "shift";

export function CantProduceModal({ date, shift, cards, onClose, onDone }: { date: string; shift: Scope; cards: Card[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const open = cards.filter((c) => c.isVisible && c.partNo && !c.isDone && !c.isProblem);
  const [mode, setMode] = useState<Mode | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sh, setSh] = useState<Scope>(shift);
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = reason.trim();
  const n = mode === "pick" ? picked.size : open.filter((c) => sh === "ALL" || c.shift === sh).length;
  const ready = !!mode && r.length >= 3 && (mode === "shift" || picked.size > 0);
  const toggle = (id: number) => setPicked((p) => (p.has(id) ? (p.delete(id), new Set(p)) : new Set(p).add(id)));

  async function save() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/edp/cant-produce", { method: "POST", body: { date, shift: mode === "shift" ? sh : shift, pldIds: mode === "pick" ? [...picked] : [], reason: r } });
      toast.show("CANNOT PRODUCE", res.message, "ok");
      onDone();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      setSure(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="⛔ ผลิตงานไม่ได้"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" disabled={busy} onClick={sure ? () => setSure(false) : onClose}>
            {sure ? "BACK" : "CANCEL"}
          </button>
          {sure ? (
            <button className="cta-btn is-red" disabled={busy} onClick={save}>
              {busy ? "…" : "✔ CONFIRM"}
            </button>
          ) : (
            <button className="cta-btn is-red" disabled={!ready} onClick={() => setSure(true)}>
              NEXT
            </button>
          )}
        </>
      }
    >
      {sure ? (
        <div className="grid gap-2 text-sm font-bold">
          <p>
            ยืนยัน <b className="text-danger">ผลิตไม่ได้ {n} การ์ด</b> วันที่ {dmy(date)}
            {mode === "shift" ? ` · ทั้งกะ ${sh} (จบแผนของกะนี้ทันที)` : ""} ?
          </p>
          <p className="text-ink-soft">เหตุผล: {r}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="cp-modes" role="radiogroup" aria-label="รูปแบบ">
            {(
              [
                ["pick", "🃏 เลือกการ์ด", "กดเลือกการ์ดที่ผลิตไม่ได้ทีละใบ"],
                ["shift", "🗂 ทั้งกะ", "ทุกการ์ดที่ยังไม่อัพเดทของกะที่เลือก แล้วจบแผน"],
              ] as const
            ).map(([k, t, d]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? "is-on" : ""} onClick={() => setMode(k)}>
                <b>{t}</b>
                <small>{d}</small>
              </button>
            ))}
          </div>

          {mode === "pick" &&
            (open.length === 0 ? (
              <p className="text-sm font-bold text-ink-soft">ไม่มีการ์ดที่ยังไม่อัพเดท</p>
            ) : (
              <div>
                <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">
                  เลือกการ์ด ({picked.size}/{open.length})
                  <button type="button" className="ml-2 text-accent underline" onClick={() => setPicked(picked.size === open.length ? new Set() : new Set(open.map((c) => c.pldId)))}>
                    {picked.size === open.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
                  </button>
                </span>
                <div className="cp-cards">
                  {open.map((c) => (
                    <button key={c.pldId} type="button" aria-pressed={picked.has(c.pldId)} className={picked.has(c.pldId) ? "is-on" : ""} onClick={() => toggle(c.pldId)}>
                      <b>{c.partNo}</b>
                      <small>
                        {c.customer} · รอบ {c.roundId} · {c.timeStart ?? "-"} · {c.qtyPlan} PCS
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ))}

          {mode === "shift" && (
            <div>
              <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">กะ</span>
              <div className="cp-shifts" role="radiogroup" aria-label="กะ">
                {(["DAY", "NIGHT", "ALL"] as Scope[]).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={sh === s} className={sh === s ? "is-on" : ""} onClick={() => setSh(s)}>
                    {s === "ALL" ? "ทุกกะ" : s}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs font-bold text-ink-soft">การ์ดที่ยังไม่อัพเดท {n} ใบ</p>
            </div>
          )}

          {mode && (
            <label className="grid gap-1 text-sm font-bold">
              เหตุผลที่ผลิตไม่ได้ *
              <textarea className="field" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น เครื่องเสีย / ไม่มีวัตถุดิบ / ไม่มีพนักงาน" />
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
