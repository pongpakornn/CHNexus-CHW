"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { Select } from "@/components/dropdowns/Select";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EdpBar } from "../EdpBar";
import { cascade, hgOf, imgOf, nowSlot, shiftStart, slotSwap, sortMin, timesOf, type Card, type CardsRes, type Meta, type Part, type Scope, type Shift, type Times } from "../edp";
import "../edp.css";

// 🏭 EDP › PLAN SUBMISSION (หน้างาน) - ย้ายจากหน้า DASHBOARD ของ EDP Systems
//   การ์ดของ วันที่ + กะ (+ รอบ) · กรอกยอดจริง (ชิ้น / HG) แล้ว MARK SUCCESS · แก้ไข / แจ้งผลิตไม่ได้ · ลากการ์ดวางทับอีกใบ = สลับเวลา
//   เวลาของการ์ดไหลต่อกันทั้งกะ (HG เปลี่ยน = เวลาการ์ดถัดไปเลื่อน 3.25 นาที / HG) · การ์ดเลยเวลา START แล้วยังไม่ MARK = ป้ายแดง "ช้า"
//   เครื่องอื่น MARK / แก้แผน = จอนี้อัพเดทเอง (ตัวเลขที่พิมพ์ค้างไว้ไม่หาย)
type Typed = Record<number, { qty: number; hg: number; hgPlan: number }>;

const lateText = (min: number) => (min < 60 ? `${min} นาที` : `${Math.floor(min / 60)} ชม. ${min % 60} นาที`);

// เวลา HH:mm ของการ์ด -> วันเวลาจริง (กะดึก 00-07 = วันถัดไป · กะเช้า 00-07 = วันถัดไป)
function resolve(date: string, hhmm: string, shift: Shift) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(`${date}T${hhmm}:00`);
  if (+m[1] < shiftStart(shift)) d.setDate(d.getDate() + 1);
  return d;
}

export default function PlanSubmission() {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [date, setDate] = useState("");
  const [shift, setShift] = useState<Scope>("DAY");
  const [round, setRound] = useState<number | null>(null);
  const [data, setData] = useState<CardsRes | null>(null);
  const [typed, setTyped] = useState<Typed>({});
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Card | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sig = useRef("");

  useEffect(() => {
    api<Meta>("/edp/meta")
      .then((m) => {
        setMeta(m);
        const s = nowSlot(m.rounds);
        setDate(s.date);
        setShift(s.shift);
        setRound(s.round);
      })
      .catch((e) => toast.show("ERROR", "โหลดข้อมูลตั้งต้นไม่สำเร็จ\n" + (e as Error).message, "error"));
  }, [toast]);

  const load = useCallback(
    async (quiet = false) => {
      if (!date) return;
      try {
        const r = await api<CardsRes>("/edp/cards", { query: { date, shift } });
        sig.current = r.sig;
        setData(r);
        if (!quiet && r.cards.some((c) => c.isVisible && c.partNo)) api("/edp/start", { method: "POST", body: { date, shift } }).catch(() => {});
      } catch (e) {
        if (!quiet) {
          toast.show("ERROR", "โหลดแผนไม่สำเร็จ\n" + (e as Error).message, "error");
          setData({ status: null, sig: "", cards: [] });
        }
      }
    },
    [date, shift, toast],
  );
  useEffect(() => {
    const t = setTimeout(() => (setData(null), load()), 0);
    return () => clearTimeout(t);
  }, [load]);
  // Realtime: ลายเซ็นแผนเปลี่ยน (MARK / แก้ / สลับ จากเครื่องอื่น) = โหลดเงียบ
  useLive(["edp"], () => load(true), 15_000);
  useEffect(() => {
    const t = setInterval(async () => {
      if (!date || edit) return;
      try {
        const r = await api<{ sig: string }>("/edp/signature", { query: { date, shift } });
        if (r.sig !== sig.current) load(true);
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [date, shift, edit, load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // การ์ดที่หน้างานเห็น (Show + มีชิ้นงาน) เรียงตามเวลาเริ่มของแผน · เวลาไหลต่อกันทั้งกะ
  const cards = useMemo(() => {
    const list = (data?.cards ?? []).filter((c) => c.isVisible && c.partNo);
    return list
      .map((c, i) => ({ c, i, t: timesOf(c.timeStart, c.timeEnd) }))
      .sort((a, b) => (a.c.shift === b.c.shift ? 0 : a.c.shift === "DAY" ? -1 : 1) || sortMin(a.t.sb, shiftStart(a.c.shift)) - sortMin(b.t.sb, shiftStart(b.c.shift)) || a.i - b.i)
      .map((x) => x.c);
  }, [data]);

  const hgNow = useCallback((c: Card) => (c.isDone && c.hgAct != null ? c.hgAct : typed[c.pldId] && typed[c.pldId].hgPlan === c.hgPlan ? typed[c.pldId].hg : c.hgPlan), [typed]);
  const qtyNow = (c: Card) => (c.isDone && c.hgAct != null ? c.qtyAct : typed[c.pldId] && typed[c.pldId].hgPlan === c.hgPlan ? typed[c.pldId].qty : c.qtyPlan);

  const times = useMemo(
    () => cascade(cards.map((c) => ({ key: c.pldId, shift: c.shift, base: timesOf(c.timeStart, c.timeEnd), baseHg: c.origHg ?? c.hgPlan, hg: hgNow(c), skip: c.isProblem }))),
    [cards, hgNow],
  );

  const shown = round == null || shift === "ALL" ? cards : cards.filter((c) => c.roundId === round);
  const done = shown.filter((c) => c.isDone).length;
  const canSubmit = meta?.can.submit ?? false;

  const late = (c: Card) => {
    if (c.isDone || c.isProblem) return 0;
    const t = times.get(c.pldId);
    const due = t ? resolve(date, t.se, c.shift) : null;
    return due && now > due.getTime() ? Math.max(1, Math.floor((now - due.getTime()) / 60000)) : 0;
  };
  const overdue = shown.filter((c) => late(c) > 0);

  function type(c: Card, qty: number, hg: number) {
    setTyped((t) => ({ ...t, [c.pldId]: { qty: Math.max(0, qty), hg: Math.max(0, hg), hgPlan: c.hgPlan } }));
  }

  async function mark(c: Card) {
    if (busy.has(c.pldId)) return;
    const hg = hgNow(c),
      qty = qtyNow(c);
    if (hg <= 0 && !(await dlg.confirm({ title: "CONFIRM SKIPPING", message: "ยอดผลิตเป็น 0 คุณต้องการบันทึกและข้ามรายการนี้ใช่หรือไม่?", ok: "SKIP" }))) return;
    setBusy((b) => new Set(b).add(c.pldId));
    try {
      const r = await api<{ message: string }>("/edp/mark", { method: "POST", body: { pldId: c.pldId, qtyAct: qty, hgAct: hg, partNo: c.partNo } });
      toast.show("SUCCESS", r.message, "ok");
      await load(true);
    } catch (e) {
      toast.show("ERROR", "บันทึกไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(c.pldId);
        return n;
      });
    }
  }

  // ลากการ์ด a ไปวางบน b (กะเดียวกัน · ยังไม่เสร็จทั้งคู่) -> เวลาใหม่ของทุกการ์ดที่ขยับ
  async function swap(a: number, b: number) {
    const A = cards.find((c) => c.pldId === a),
      B = cards.find((c) => c.pldId === b);
    if (!A || !B || a === b) return;
    if (A.shift !== B.shift) return toast.show("SWAP", "สลับได้เฉพาะการ์ดในกะเดียวกัน", "warn");
    if (A.isDone || B.isDone) return toast.show("SWAP", "การ์ดที่ทำเสร็จแล้วสลับเวลาไม่ได้", "warn");
    const same = cards.filter((c) => c.shift === A.shift);
    const slots = same.map((c) => ({ ...timesOf(c.timeStart, c.timeEnd), hg: c.hgPlan }));
    const ch = slotSwap(slots, same.indexOf(A), same.indexOf(B));
    const list = [...ch.entries()].map(([k, t]) => ({ pldId: same[k].pldId, timeStart: `${t.sb}-${t.se}`, timeEnd: `${t.ob}-${t.oe}` }));
    try {
      const r = await api<{ message: string }>("/edp/swap", { method: "POST", body: { a, b, times: list } });
      toast.show("SWAP", r.message, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
    load(true);
  }

  async function finish() {
    const left = cards.filter((c) => !c.isDone && !c.isProblem).length;
    if (!(await dlg.confirm({ title: "FINISH SHIFT", message: left ? `ยังมีการ์ดที่ยังไม่ MARK ${left} ใบ\nยืนยันปิดกะ ${shift} วันที่ ${date} ?` : `ยืนยันปิดกะ ${shift} วันที่ ${date} ?`, ok: "FINISH" }))) return;
    try {
      const r = await api<{ message: string }>("/edp/finish", { method: "POST", body: { date, shift } });
      toast.show("COMPLETED", r.message, "ok");
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  if (!meta) return <Loading />;
  return (
    <PageBody>
      <PageHeader
        icon="/icons/Dashboard.png"
        title="EDP • PLAN SUBMISSION"
        subtitle="หน้างาน · กรอกยอดจริงแล้ว MARK SUCCESS · ลากการ์ดวางทับอีกใบเพื่อสลับเวลา"
        actions={
          data?.status && (
            <span className={`edp-stat is-${data.status.replace(" ", "-").toLowerCase()}`}>{data.status}</span>
          )
        }
      />
      <EdpBar date={date} onDate={setDate} shift={shift} onShift={(s) => (setShift(s), setRound(null))} rounds={meta.rounds} round={round} onRound={setRound}>
        <span className="edp-progress" style={{ "--p": shown.length ? done / shown.length : 0 } as React.CSSProperties}>
          <b>{done}</b> / {shown.length} DONE
        </span>
        {canSubmit && shift !== "ALL" && cards.length > 0 && data?.status !== "COMPLETED" && (
          <button type="button" className="cta-btn is-green" onClick={finish}>
            ✔ FINISH SHIFT
          </button>
        )}
      </EdpBar>

      {overdue.length > 0 && (
        <div className="edp-alert" role="alert">
          ⚠ เลยเวลาเริ่มงานแล้ว แต่ยังไม่ได้กด MARK SUCCESS {overdue.length} การ์ด · ค้างนานสุด {lateText(Math.max(...overdue.map(late)))}
        </div>
      )}

      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>ไม่พบแผนการผลิตของวันที่ {date} กะ {shift}{round ? ` รอบ ${round}` : ""} · กรุณาตั้งแผนที่หน้า PLAN SETTING ก่อน</Empty>
      ) : (
        <div className="edp-cards">
          {shown.map((c, i) => {
            const t: Times = times.get(c.pldId) ?? timesOf(c.timeStart, c.timeEnd);
            const lt = late(c);
            const img = imgOf(c);
            const lock = c.isDone || c.isProblem || !canSubmit || data.status === "COMPLETED";
            return (
              <article
                key={c.pldId}
                className={`edp-card ${c.isDone ? "is-done" : ""} ${c.isProblem ? "is-problem" : ""} ${lt ? "is-late" : ""} ${drag === c.pldId ? "is-drag" : ""} ${over === c.pldId ? "is-over" : ""}`}
                style={{ "--i": Math.min(i, 16) } as React.CSSProperties}
                draggable={!lock}
                onDragStart={(e) => (setDrag(c.pldId), e.dataTransfer.setData("text/plain", String(c.pldId)))}
                onDragEnd={() => (setDrag(null), setOver(null))}
                onDragOver={(e) => drag && drag !== c.pldId && !lock && (e.preventDefault(), setOver(c.pldId))}
                onDragLeave={() => setOver((o) => (o === c.pldId ? null : o))}
                onDrop={(e) => (e.preventDefault(), setOver(null), drag && swap(drag, c.pldId))}
              >
                <header>
                  <span className="edp-round">{shift === "ALL" ? `${c.shift === "DAY" ? "☀" : "🌙"} ` : ""}R{c.roundId || "-"}</span>
                  <b className="truncate">{c.customer}</b>
                  {lt > 0 && <span className="edp-late">ช้า {lateText(lt)}</span>}
                  {c.isDone && <span className="edp-badge is-ok">✔ FINISHED</span>}
                  {c.isProblem && <span className="edp-badge is-bad">⛔ ผลิตไม่ได้</span>}
                </header>
                <div className="edp-card-body">
                  <div className="edp-img">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" loading="lazy" />
                    ) : (
                      <span>NO IMAGE</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="edp-part">{c.partNo}</div>
                    <div className="edp-name">{c.partName ?? "-"}</div>
                    <div className="edp-times">
                      <span>
                        <small>START</small>
                        {t.sb}-{t.se}
                      </span>
                      <span>
                        <small>OUT</small>
                        {t.ob}-{t.oe}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="edp-qty">
                  <label>
                    <small>PLAN</small>
                    <b>
                      {c.qtyPlan.toLocaleString()} <i>PCS</i> · {c.hgPlan} <i>HG</i>
                    </b>
                  </label>
                  <label>
                    <small>ACT (PCS)</small>
                    <input type="number" min={0} className="field" disabled={lock} value={qtyNow(c)} onChange={(e) => type(c, +e.target.value || 0, hgOf(+e.target.value || 0, c.pcsHg))} />
                  </label>
                  <label>
                    <small>HG</small>
                    <input type="number" min={0} className="field" disabled={lock} value={hgNow(c)} onChange={(e) => type(c, (+e.target.value || 0) * c.pcsHg, +e.target.value || 0)} />
                  </label>
                </div>
                {c.remark && <p className="edp-remark">📝 {c.remark}</p>}
                {canSubmit && !c.isDone && data.status !== "COMPLETED" && (
                  <footer>
                    {!c.isProblem && (
                      <button type="button" className="fill-btn" onClick={() => setEdit(c)}>
                        ✏ EDIT
                      </button>
                    )}
                    {!c.isProblem && (
                      <button type="button" className="cta-btn is-green" disabled={busy.has(c.pldId)} onClick={() => mark(c)}>
                        {busy.has(c.pldId) ? "…" : "✔ MARK SUCCESS"}
                      </button>
                    )}
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}
      {edit && <EditCard card={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), load(true))} />}
    </PageBody>
  );
}

// ✏ แก้ไขการ์ดจากหน้างาน: เปลี่ยนลูกค้า / ชิ้นงาน / จำนวน หรือแจ้งว่าผลิตไม่ได้ (ต้องมีหมายเหตุเสมอ · เก็บประวัติเดิม -> ใหม่)
function EditCard({ card, onClose, onSaved }: { card: Card; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [parts, setParts] = useState<Part[] | null>(null);
  const [problem, setProblem] = useState(false);
  const [cust, setCust] = useState(card.customer);
  const [partId, setPartId] = useState<number | null>(card.partId);
  const [qty, setQty] = useState(card.qtyPlan);
  const [hg, setHg] = useState(card.hgPlan);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<Part[]>("/edp/parts")
      .then(setParts)
      .catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  const custs = useMemo(() => [...new Set((parts ?? []).map((p) => p.customer))].filter(Boolean), [parts]);
  const list = (parts ?? []).filter((p) => p.customer === cust);
  const part = parts?.find((p) => p.partId === partId) ?? null;

  async function save() {
    if (!remark.trim()) return toast.show("REMARK", "กรุณาระบุหมายเหตุ/ปัญหาที่พบก่อนบันทึก", "warn");
    if (!problem && !partId) return toast.show("PART", "กรุณาเลือกชิ้นงาน", "warn");
    setSaving(true);
    try {
      const r = await api<{ message: string }>("/edp/edit", { method: "POST", body: { pldId: card.pldId, problem, partId, qty, hg, remark } });
      toast.show("SAVED", r.message, "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`✏ EDIT PLAN • ${card.customer} ${card.partNo}`}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className={`cta-btn ${problem ? "is-red" : "is-green"}`} disabled={saving} onClick={save}>
            {saving ? "…" : problem ? "⛔ REPORT PROBLEM" : "💾 SAVE"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="edp-seg is-2" style={{ "--n": problem ? 1 : 0, "--c": 2 } as React.CSSProperties}>
          <span className="edp-seg-glider" aria-hidden />
          <button type="button" className={!problem ? "is-on" : ""} onClick={() => setProblem(false)}>
            ✏ แก้ไขแผน
          </button>
          <button type="button" className={problem ? "is-on" : ""} onClick={() => setProblem(true)}>
            ⛔ ผลิตไม่ได้
          </button>
        </div>
        <div className={`fold ${problem ? "is-closed" : ""}`}>
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="fx">
                <span className="fx-cap">CUSTOMER</span>
                <Select value={cust} onChange={(v) => (setCust(v), setPartId(null))} options={custs.map((c) => ({ value: c, label: c }))} ariaLabel="CUSTOMER" />
              </label>
              <label className="fx">
                <span className="fx-cap">PART NO</span>
                <Select
                  value={partId ? String(partId) : ""}
                  onChange={(v) => {
                    const p = parts?.find((x) => x.partId === +v);
                    setPartId(+v);
                    if (p?.pcsHg) setQty(hg * p.pcsHg);
                  }}
                  options={[{ value: "", label: parts ? "เลือกชิ้นงาน" : "LOADING..." }, ...list.map((p) => ({ value: String(p.partId), label: p.partNo }))]}
                  ariaLabel="PART NO"
                />
              </label>
              <label className="fx">
                <span className="fx-cap">QTY PLAN (PCS)</span>
                <input type="number" min={0} className="field fx-in" value={qty} onChange={(e) => (setQty(+e.target.value || 0), part && setHg(hgOf(+e.target.value || 0, part.pcsHg)))} />
              </label>
              <label className="fx">
                <span className="fx-cap">HG PLAN {part ? `(${part.pcsHg} PCS/HG)` : ""}</span>
                <input type="number" min={0} className="field fx-in" value={hg} onChange={(e) => (setHg(+e.target.value || 0), part && setQty((+e.target.value || 0) * part.pcsHg))} />
              </label>
            </div>
          </div>
        </div>
        <label className="fx">
          <span className="fx-cap">REMARK / ปัญหาที่พบ *</span>
          <textarea className="field fx-in min-h-[90px]" maxLength={500} value={remark} placeholder="เช่น แม่พิมพ์เสีย · วัตถุดิบไม่พอ · เปลี่ยนแผนตามหัวหน้า" onChange={(e) => setRemark(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
