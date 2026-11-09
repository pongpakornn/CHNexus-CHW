"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { api } from "@/lib/api";
import { motion, useReducedMotion } from "framer-motion";
import { STAGGER, fadeOnly, fadeUp, springPop, springSoft } from "@/lib/motion";
import { useLive } from "@/lib/live";
import { EdpBar } from "../EdpBar";
import { cascade, dmy, hgOf, imgOf, nowSlot, roundLabel, shiftStart, slotSwap, sortMin, timesOf, type Card, type CardsRes, type Meta, type Part, type Scope, type Shift, type Times } from "../edp";
import "../edp.css";

// 🏭 EDP › PLAN SUBMISSION (หน้างาน) - ย้ายจากหน้า DASHBOARD ของ EDP Systems
//   เปิดหน้า = เลือกแผน (วันที่ · กะ · รอบ) แล้วกด START PLANNING · ปิดกะแล้วกลับมาหน้าเลือกแผน (จำแผนที่เริ่มไว้ใน session)
//   กรอกยอดจริง (ชิ้น / HG) แล้ว MARK SUCCESS · แก้ไข / แจ้งผลิตไม่ได้ · ลากการ์ดวางทับอีกใบ = สลับเวลา (ยืนยันก่อน · ย้อนกลับได้)
//   เวลาของการ์ดไหลต่อกันทั้งกะ (3.25 นาที / HG) · เลยเวลา START แล้วยังไม่ MARK = ป้ายแดง "ช้า" · เครื่องอื่นแก้ = จอนี้อัพเดทเอง
type Typed = Record<number, { qty: number; hg: number; hgPlan: number }>;
type Saved = { date: string; shift: Scope; round: number | null; started: boolean };
const KEY = "edp-submit";

const lateText = (min: number) => (min < 60 ? `${min} นาที` : `${Math.floor(min / 60)} ชม. ${min % 60} นาที`);

// เวลา HH:mm ของการ์ด -> วันเวลาจริง (เวลาก่อนต้นกะ = วันถัดไป)
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
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });
  const [meta, setMeta] = useState<Meta | null>(null);
  const [date, setDate] = useState("");
  const [shift, setShift] = useState<Scope>("DAY");
  const [round, setRound] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [data, setData] = useState<CardsRes | null>(null);
  const [typed, setTyped] = useState<Typed>({});
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Card | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sig = useRef("");

  // โหลดครั้งเดียว (ไม่ผูกกับ toast = แจ้งเตือนแล้วไม่รีเซ็ตกะที่เลือก) · แผนที่ START ไว้จำใน session
  useEffect(() => {
    api<Meta>("/edp/meta")
      .then((m) => {
        let saved: Saved | null = null;
        try {
          saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
        } catch {}
        const s = nowSlot(m.rounds);
        setMeta(m);
        setDate(saved?.date ?? s.date);
        setShift(saved?.shift ?? s.shift);
        setRound(saved?.round ?? null);
        setStarted(!!saved?.started);
      })
      .catch((e) => toastRef.current.show("ERROR", "โหลดข้อมูลตั้งต้นไม่สำเร็จ\n" + (e as Error).message, "error"));
  }, []);
  useEffect(() => {
    if (!date) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ date, shift, round, started } satisfies Saved));
    } catch {}
  }, [date, shift, round, started]);
  useEffect(() => {
    if (!meta) return;
    api<string[]>("/edp/dates", { query: { shift } })
      .then((d) => setDates(d.map((x) => x.slice(0, 10))))
      .catch(() => setDates([]));
  }, [meta, shift]);

  const load = useCallback(
    async (quiet = false) => {
      if (!date) return;
      try {
        const r = await api<CardsRes>("/edp/cards", { query: { date, shift } });
        sig.current = r.sig;
        setData(r);
      } catch (e) {
        if (!quiet) {
          toastRef.current.show("ERROR", "โหลดแผนไม่สำเร็จ\n" + (e as Error).message, "error");
          setData({ status: null, sig: "", cards: [] });
        }
      }
    },
    [date, shift],
  );
  useEffect(() => {
    const t = setTimeout(() => (setData(null), load()), 0);
    return () => clearTimeout(t);
  }, [load]);
  // Realtime: ลายเซ็นแผนเปลี่ยน (MARK / แก้ / สลับ จากเครื่องอื่น) = โหลดเงียบ
  useLive(["edp"], () => load(true), 15_000);
  useEffect(() => {
    const t = setInterval(async () => {
      if (!date || edit || !started) return;
      try {
        const r = await api<{ sig: string }>("/edp/signature", { query: { date, shift } });
        if (r.sig !== sig.current) load(true);
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [date, shift, edit, started, load]);
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
  const closed = data?.status === "COMPLETED";

  const late = (c: Card) => {
    if (c.isDone || c.isProblem) return 0;
    const t = times.get(c.pldId);
    const due = t ? resolve(date, t.se, c.shift) : null;
    return due && now > due.getTime() ? Math.max(1, Math.floor((now - due.getTime()) / 60000)) : 0;
  };
  const overdue = started ? shown.filter((c) => late(c) > 0) : [];

  function type(c: Card, qty: number, hg: number) {
    setTyped((t) => ({ ...t, [c.pldId]: { qty: Math.max(0, qty), hg: Math.max(0, hg), hgPlan: c.hgPlan } }));
  }

  function start() {
    if (shown.length === 0) return toast.show("PLAN NOT FOUND", `ไม่พบแผนการผลิตของ ${dmy(date)} กะ ${shift}${round ? ` รอบ ${round}` : ""}\nกรุณาตั้งแผนงานที่หน้า PLAN SETTING ก่อน`, "warn");
    setStarted(true);
    api("/edp/start", { method: "POST", body: { date, shift } }).then(() => load(true), () => {});
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

  // ลากการ์ด a ไปวางบน b (กะเดียวกัน · ยังไม่เสร็จทั้งคู่) -> ยืนยัน -> เวลาใหม่ของทุกการ์ดที่ขยับ (ย้อนกลับได้ด้วยปุ่ม UNDO)
  async function swap(a: number, b: number) {
    const A = cards.find((c) => c.pldId === a),
      B = cards.find((c) => c.pldId === b);
    if (!A || !B || a === b) return;
    if (A.shift !== B.shift) return toast.show("SWAP", "สลับได้เฉพาะการ์ดในกะเดียวกัน", "warn");
    if (A.isDone || B.isDone) return toast.show("SWAP", "การ์ดที่ทำเสร็จแล้วสลับเวลาไม่ได้", "warn");
    if (!(await dlg.confirm({ title: "SWAP CARDS", message: `สลับเวลาการ์ด\n${A.customer} ${A.partNo} (${A.timeStart})\n↔ ${B.customer} ${B.partNo} (${B.timeStart}) ?`, ok: "SWAP" }))) return;
    const same = cards.filter((c) => c.shift === A.shift);
    const slots = same.map((c) => ({ ...timesOf(c.timeStart, c.timeEnd), hg: c.hgPlan }));
    const ch = slotSwap(slots, same.indexOf(A), same.indexOf(B));
    const list = [...ch.entries()].map(([k, t]) => ({ pldId: same[k].pldId, timeStart: `${t.sb}-${t.se}`, timeEnd: `${t.ob}-${t.oe}` }));
    try {
      const r = await api<{ message: string; batch: string }>("/edp/swap", { method: "POST", body: { a, b, times: list } });
      toast.show("SWAP", r.message, "ok");
      setUndo(r.batch);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
    load(true);
  }
  async function undoSwap() {
    if (!undo) return;
    try {
      const r = await api<{ message: string }>("/edp/swap/undo", { method: "POST", body: { batch: undo } });
      toast.show("UNDO", r.message, "ok");
      setUndo(null);
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function finish() {
    const left = cards.filter((c) => !c.isDone && !c.isProblem).length;
    if (!(await dlg.confirm({ title: "FINISH SHIFT", message: left ? `ยังมีการ์ดที่ยังไม่ MARK ${left} ใบ\nยืนยันปิดกะ ${shift} วันที่ ${dmy(date)} ?` : `ยืนยันปิดกะ ${shift} วันที่ ${dmy(date)} ?`, ok: "FINISH" }))) return;
    try {
      const r = await api<{ message: string }>("/edp/finish", { method: "POST", body: { date, shift } });
      toast.show("COMPLETED", r.message, "ok");
      setStarted(false);
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  if (!meta) return <Loading />;
  return (
    <PageBody className="edp-dark">
      <PageHeader
        icon="/icons/registration.png"
        title="EDP • PLAN SUBMISSION"
        subtitle={started ? `${dmy(date)} · กะ ${shift}${round ? ` · รอบ ${round}` : ""} · กรอกยอดจริงแล้ว MARK SUCCESS · ลากการ์ดวางทับอีกใบเพื่อสลับเวลา` : "เลือกแผนการผลิตก่อนเริ่มงาน"}
        actions={data?.status && <span className={`edp-stat is-${data.status.replace(" ", "-").toLowerCase()}`}>{data.status}</span>}
      />
      {!started ? (
        <Picker date={date} onDate={setDate} shift={shift} onShift={(s) => (setShift(s), setRound(null))} meta={meta} round={round} onRound={setRound} dates={dates} data={data} cards={shown} onStart={start} />
      ) : (
        <>
          <EdpBar date={date} onDate={setDate} shift={shift} onShift={(s) => (setShift(s), setRound(null))} rounds={meta.rounds} round={round} onRound={setRound}>
            <button type="button" className="fill-btn is-sm" onClick={() => setStarted(false)}>
              ↩ CHANGE PLAN
            </button>
            {undo && canSubmit && (
              <button type="button" className="fill-btn is-sm is-red" onClick={undoSwap}>
                ↶ UNDO SWAP
              </button>
            )}
            <span className="edp-progress" style={{ "--p": shown.length ? done / shown.length : 0 } as React.CSSProperties}>
              <b>{done}</b> / {shown.length} DONE
            </span>
            {canSubmit && shift !== "ALL" && cards.length > 0 && !closed && (
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
            <Empty>
              ไม่พบแผนการผลิตของวันที่ {dmy(date)} กะ {shift}
              {round ? ` รอบ ${round}` : ""} · กรุณาตั้งแผนที่หน้า PLAN SETTING ก่อน
            </Empty>
          ) : (
            <div className="edp-cards">
              {shown.map((c, i) => {
                const t: Times = times.get(c.pldId) ?? timesOf(c.timeStart, c.timeEnd);
                const lt = late(c);
                const img = imgOf(c);
                const lock = c.isDone || c.isProblem || !canSubmit || closed;
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
                      <span className="edp-round">
                        {shift === "ALL" ? `${c.shift === "DAY" ? "☀" : "🌙"} ` : ""}R{c.roundId || "-"}
                      </span>
                      <b className="truncate">{c.customer}</b>
                      {lt > 0 && <span className="edp-late">ช้า {lateText(lt)}</span>}
                      {c.isDone && <span className="edp-badge is-ok">✔ FINISHED</span>}
                      {c.isProblem && <span className="edp-badge is-bad">⛔ ผลิตไม่ได้</span>}
                    </header>
                    <div className="edp-card-body">
                      <div className="edp-img">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
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
                    {canSubmit && !c.isDone && !closed && !c.isProblem && (
                      <footer>
                        <button type="button" className="fill-btn" onClick={() => setEdit(c)}>
                          ✏ EDIT
                        </button>
                        <button type="button" className="cta-btn is-green" disabled={busy.has(c.pldId)} onClick={() => mark(c)}>
                          {busy.has(c.pldId) ? "…" : "✔ MARK SUCCESS"}
                        </button>
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {edit && <EditCard card={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), load(true))} />}
    </PageBody>
  );
}

// ▶ หน้าเลือกแผนก่อนเริ่มงาน (แบบโปรแกรมเดิม): วันที่ (วันที่มีแผนกดเลือกได้เลย) · กะ · รอบ -> ดูจำนวนการ์ด / สถานะ -> START PLANNING
function Picker({
  date,
  onDate,
  shift,
  onShift,
  meta,
  round,
  onRound,
  dates,
  data,
  cards,
  onStart,
}: {
  date: string;
  onDate: (d: string) => void;
  shift: Scope;
  onShift: (s: Scope) => void;
  meta: Meta;
  round: number | null;
  onRound: (r: number | null) => void;
  dates: string[];
  data: CardsRes | null;
  cards: Card[];
  onStart: () => void;
}) {
  const done = cards.filter((c) => c.isDone).length;
  const rs = meta.rounds.filter((r) => r.shift === shift);
  const reduce = useReducedMotion();
  const V = reduce ? fadeOnly : fadeUp;
  return (
    <section className="edp-pick">
      <div className="edp-pick-hero">
        <small>EDP PLANNING · PLAN SUBMISSION</small>
        <h2>เลือกแผนการผลิต</h2>
        <p>เลือกวันที่ · กะ · รอบ แล้วกด START PLANNING เพื่อเริ่มกรอกยอดผลิต</p>
      </div>
      <EdpBar date={date} onDate={onDate} shift={shift} onShift={onShift} />
      {dates.length > 0 && (
        <div className="edp-chips">
          <span>วันที่มีแผน</span>
          {/* ชิปวันที่ไล่ขึ้นทีละอัน · พื้นม่วงเลื่อนไปหาวันที่ที่เลือก (layoutId) */}
          {dates.slice(0, 10).map((d, i) => (
            <motion.button
              key={d}
              type="button"
              className={d === date ? "is-on" : ""}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: reduce ? 0 : i * STAGGER.chips, duration: 0.35 } }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onDate(d)}
            >
              {d === date && <motion.span layoutId="edp-date-pill" className="edp-chip-pill" transition={springSoft} />}
              <span className="relative">{dmy(d)}</span>
            </motion.button>
          ))}
        </div>
      )}
      {shift !== "ALL" && (
        <div className="edp-rounds">
          {/* การ์ดรอบ: เลือกแล้วเด้งเล็กน้อย (spring) */}
          {[{ id: null as number | null, title: "ทั้งกะ", sub: `ทุกรอบของกะ ${shift}` }, ...rs.map((r) => ({ id: r.roundId as number | null, title: `รอบ ${r.roundId}`, sub: roundLabel(r).replace(/^รอบ \d+ /, "") }))].map((x, i) => (
            <motion.button
              key={x.id ?? "all"}
              type="button"
              className={round === x.id ? "is-on" : ""}
              custom={i}
              variants={V}
              initial="hidden"
              animate={reduce ? "show" : { opacity: 1, y: 0, scale: round === x.id ? 1.03 : 1, transition: { ...springPop, delay: 0 } }}
              whileHover={reduce ? undefined : { y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onRound(x.id)}
            >
              <b>{x.title}</b>
              <small>{x.sub}</small>
            </motion.button>
          ))}
        </div>
      )}
      <motion.div className="edp-pick-foot" custom={4} variants={V} initial="hidden" animate="show">
        {!data ? (
          <span>⏳ กำลังโหลดแผน...</span>
        ) : cards.length > 0 ? (
          <span>
            พบแผน <b>{cards.length}</b> การ์ด · เสร็จแล้ว <b>{done}</b>
            {data.status && <i className={`edp-stat is-${data.status.replace(" ", "-").toLowerCase()}`}>{data.status}</i>}
          </span>
        ) : (
          <span>ไม่พบแผนของวันที่ / กะ / รอบนี้ · ตั้งแผนที่หน้า PLAN SETTING</span>
        )}
        <motion.button type="button" className="edp-start" disabled={!data || cards.length === 0} onClick={onStart} whileTap={{ scale: 0.97 }}>
          ▶ START PLANNING
        </motion.button>
      </motion.div>
    </section>
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
                <ComboBox value={cust} onChange={(v) => v !== cust && (setCust(v), setPartId(null))} options={custs.map((c) => ({ value: c, label: c }))} placeholder="พิมพ์ค้นหาลูกค้า" ariaLabel="CUSTOMER" />
              </label>
              <label className="fx">
                <span className="fx-cap">PART NO</span>
                <ComboBox
                  value={partId ? String(partId) : ""}
                  onChange={(v) => {
                    const p = parts?.find((x) => x.partId === +v);
                    setPartId(+v);
                    if (p?.pcsHg) setQty(hg * p.pcsHg);
                  }}
                  options={list.map((p) => ({ value: String(p.partId), label: p.partNo, sub: p.partName ?? undefined }))}
                  placeholder={parts ? "พิมพ์ค้นหา PART NO / ชื่อ" : "LOADING..."}
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
