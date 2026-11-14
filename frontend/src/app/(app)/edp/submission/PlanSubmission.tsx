"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { motion, useReducedMotion } from "framer-motion";
import { STAGGER, fadeOnly, fadeUp, springPop, springSoft } from "@/lib/motion";
import { useLive } from "@/lib/live";
import { EdpBar } from "../EdpBar";
import { DragGrid } from "./DragGrid";
import { EditCard } from "./EditCard";
import { cascade, dmy, hgOf, imgOf, nowSlot, roundLabel, shiftStart, slotSwap, sortMin, timesOf, type Card, type CardsRes, type Meta, type Scope, type Shift, type Times } from "../edp";
import "../edp.css";

// 🏭 EDP › PLAN SUBMISSION (หน้างาน) - ย้ายจากหน้า DASHBOARD ของ EDP Systems
//   เปิดหน้า = เลือกแผน (วันที่ · กะ · รอบ) แล้วกด START PLANNING · แผนที่ START ไปแล้ว (IN PROGRESS) = แสดงการ์ดเลย ไม่ต้องกดเริ่มใหม่
//   ปิดกะแล้วกลับมาหน้าเลือกแผน (จำแผนที่เริ่มไว้ใน session)
//   กรอกยอดจริง (ชิ้น / HG) แล้ว MARK SUCCESS · แก้ไข / แจ้งผลิตไม่ได้ · ลากการ์ดวางทับอีกใบ = สลับเวลา (ยืนยันก่อน · ย้อนกลับได้)
//   เวลาของการ์ดไหลต่อกันทั้งกะ (3.25 นาที / HG) · เลยเวลา START แล้วยังไม่ MARK = ป้ายแดง "ช้า" · เครื่องอื่นแก้ = จอนี้อัพเดทเอง
//   เงื่อนไขเวลา / ฟังก์ชัน = DashboardViewModel ของโปรแกรม EDP Systems (.exe) ทุกข้อ:
//     ชิ้น <-> HG ด้วย QTY_HG · ส่วนต่าง = (HG − HG ตั้งต้นก่อนแก้ครั้งแรก) × 3.25 · ลากสลับใช้ HG ตั้งต้น · แถบเตือนกวาดทั้งกะ
//     FINISH กะ DAY = ไปกะ NIGHT ต่อให้เลย · ALL = ปิดทั้ง 2 กะ
type Typed = Record<number, { qty: number; hg: number; hgPlan: number }>;
type Saved = { date: string; shift: Scope; round: number | null; started: boolean };
const KEY = "edp-submit";

// 🎨 สีสถานะการ์ด: เขียว = อัพเดทแล้ว (MARK) · แดง = ผลิตไม่ได้ (Blank ไว้) · ส้ม = แก้ไขแผนแล้ว · ฟ้า = อยู่ระหว่างแผน (รออัพเดท)
function statusOf(c: Card) {
  if (c.isDone) return { k: "ok", label: "✔ อัพเดทแล้ว", tip: "MARK SUCCESS แล้ว" };
  if (c.isProblem) return { k: "bad", label: "⛔ ผลิตไม่ได้", tip: c.remark ? `แจ้งผลิตไม่ได้: ${c.remark}` : "แจ้งผลิตไม่ได้" };
  if (c.isEdited) return { k: "edit", label: "✏ แก้ไขแล้ว", tip: c.remark ? `แก้ไขแผน: ${c.remark}` : "แก้ไขแผนจากหน้างานแล้ว รออัพเดทยอด" };
  return { k: "plan", label: "● ระหว่างแผน", tip: "อยู่ระหว่างแผน รอกรอกยอดแล้ว MARK SUCCESS" };
}

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
  const [undo, setUndo] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sig = useRef("");
  const auto = useRef(true); // เปิดหน้าครั้งแรก: แผนที่ START แล้ว = ข้ามหน้าเลือกแผน (ครั้งเดียว · กด CHANGE PLAN แล้วไม่เด้งกลับ)
  const next = useRef(false); // FINISH กะ DAY แล้ว: โหลดกะ NIGHT เสร็จ = เริ่มงานต่อให้เลย (ไม่มีแผน = แจ้ง PLAN NOT FOUND)

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
        if (auto.current) {
          auto.current = false;
          if (r.status === "IN PROGRESS" && r.cards.some((c) => c.isVisible && c.partNo)) setStarted(true);
        }
        if (next.current) {
          next.current = false;
          if (r.cards.some((c) => c.isVisible && c.partNo)) {
            setStarted(true);
            if (r.status === "READY") api("/edp/start", { method: "POST", body: { date, shift } }).catch(() => {});
          } else {
            setStarted(false);
            toastRef.current.show("PLAN NOT FOUND", `ไม่พบแผนการผลิตของ ${dmy(date)} กะ ${shift}\nกรุณาตั้งแผนงานที่หน้า PLAN SETTING ก่อน`, "warn");
          }
        }
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
  // ⚡ Realtime: เครื่องอื่น MARK / แก้ / สลับ = Server แจ้งทันที (หัวข้อ "edp") -> โหลดเงียบ ไม่กระพริบ
  //   สำรอง: ทุก 30 วินาทีเช็คลายเซ็นแผน (เบา) เปลี่ยนจริงค่อยโหลด · กำลังแก้การ์ด = ไม่ดึงทับ
  //   ระหว่างเปิด EDIT ไม่ดึงทับ · ปิด EDIT (ไม่ว่าบันทึกหรือไม่) = โหลดใหม่ทันที ไม่พลาดที่เครื่องอื่น MARK ระหว่างนั้น
  useLive(["edp"], () => (edit ? undefined : load(true)));
  useEffect(() => {
    const t = setInterval(async () => {
      if (!date || edit || document.visibilityState !== "visible") return;
      try {
        const r = await api<{ sig: string }>("/edp/signature", { query: { date, shift } });
        if (r.sig !== sig.current) load(true);
      } catch {}
    }, 30_000);
    return () => clearInterval(t);
  }, [date, shift, edit, load]);
  // นาฬิกาของป้าย "ช้า" (โปรแกรมเดิมเดินทุกวินาที · เว็บเดินทุก 5 วิ ป้ายขึ้นตรงนาทีโดยไม่วาดการ์ดใหม่ถี่เกิน)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
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
    () => cascade(cards.map((c) => ({ key: c.pldId, shift: c.shift, base: timesOf(c.timeStart, c.timeEnd), baseHg: c.origHg ?? c.hgPlan, hg: hgNow(c), skip: c.isProblem })), false),
    [cards, hgNow],
  );

  const shown = round == null || shift === "ALL" ? cards : cards.filter((c) => c.roundId === round);
  const done = shown.filter((c) => c.isDone).length;
  const canSubmit = meta?.can.submit ?? false;
  const closed = data?.status === "COMPLETED";

  const late = (c: Card) => {
    if (c.isDone || c.isProblem || closed) return 0; // ปิดกะแล้ว (COMPLETED) = ดูย้อนหลัง ไม่เตือน (RefreshOverdueAlerts · IsReviewMode)
    const t = times.get(c.pldId);
    const due = t ? resolve(date, t.se, c.shift) : null;
    return due && now > due.getTime() ? Math.max(1, Math.floor((now - due.getTime()) / 60000)) : 0;
  };
  // กวาดทั้งกะ (ทุกรอบ) แบบ RefreshOverdueAlerts: การ์ดค้างจากรอบอื่นก็เตือน ถึงจอจะเปิดดูอยู่คนละรอบ
  const overdue = started ? cards.filter((c) => late(c) > 0) : [];

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
    if (busy.has(a) || busy.has(b)) return toast.show("SWAP", "การ์ดนี้กำลังบันทึก MARK SUCCESS อยู่ ลองใหม่อีกครั้ง", "warn");
    if (!(await dlg.confirm({ title: "SWAP CARDS", message: `สลับเวลาการ์ด\n${A.customer} ${A.partNo} (${A.timeStart})\n↔ ${B.customer} ${B.partNo} (${B.timeStart}) ?`, ok: "SWAP" }))) return;
    // ช่องเวลาตามแผนใน DB + HG ตั้งต้น (ก่อนแก้ครั้งแรก) แบบ ExecuteSwapCards · ส่วนต่างจากยอดจริงจึงไม่ถูกนับซ้ำ
    const same = cards.filter((c) => c.shift === A.shift);
    const slots = same.map((c) => ({ ...timesOf(c.timeStart, c.timeEnd), hg: c.origHg ?? c.hgPlan }));
    const ch = slotSwap(slots, same.indexOf(A), same.indexOf(B));
    const list = [...ch.entries()].map(([k, t]) => ({ pldId: same[k].pldId, timeStart: `${t.sb}-${t.se}`, timeEnd: `${t.ob}-${t.oe}` }));
    try {
      const r = await api<{ message: string; batch: string }>("/edp/swap", { method: "POST", body: { a, b, times: list, date, shift, planSig: data?.planSig } });
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

  // ปิดกะ (ExecuteFinalSubmit): DAY = ปิดแล้วไปกะ NIGHT ต่อ · NIGHT = จบของวันนี้ · ALL = ปิดทั้ง 2 กะ
  async function finish() {
    const left = cards.filter((c) => !c.isDone && !c.isProblem).length;
    const what = shift === "ALL" ? "ทั้ง 2 กะ (DAY + NIGHT)" : `กะ ${shift}`;
    const msg = `ยืนยันจบแผนงาน${what} วันที่ ${dmy(date)} ?`;
    if (!(await dlg.confirm({ title: "FINISH SHIFT", message: left ? `ยังมีการ์ดที่ยังไม่ MARK ${left} ใบ\n${msg}` : msg, ok: "FINISH" }))) return;
    try {
      const r = await api<{ message: string }>("/edp/finish", { method: "POST", body: { date, shift } });
      if (shift === "DAY") {
        toast.show("COMPLETED", `${r.message}\nไปต่อที่กะ NIGHT`, "ok");
        next.current = true;
        setRound(null);
        setShift("NIGHT");
        return;
      }
      toast.show("ALL JOBS DONE", "จบการวางแผนการผลิตของวันนี้เรียบร้อยแล้ว", "ok");
      setStarted(false);
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  if (!meta) return <Loading />;
  return (
    <PageBody className="edp-light">
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
            {canSubmit && cards.length > 0 && !closed && (
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
            <DragGrid
              items={shown}
              idOf={(c) => c.pldId}
              locked={(c) => c.isDone || busy.has(c.pldId) || !canSubmit || closed}
              onSwap={swap}
              render={(c, _i, handle, lifted) => {
                const t: Times = times.get(c.pldId) ?? timesOf(c.timeStart, c.timeEnd);
                const lt = late(c);
                const img = imgOf(c);
                const lock = c.isDone || c.isProblem || !canSubmit || closed;
                const moveLock = c.isDone || busy.has(c.pldId) || !canSubmit || closed; // ลากสลับได้ = ยังไม่ MARK (ใบผลิตไม่ได้ก็ลากได้ แบบ CanMoveCard)
                const st = statusOf(c);
                return (
                  <article className={`edp-card is-set is-st-${st.k} ${c.isDone ? "is-done" : ""} ${c.isProblem ? "is-problem" : ""} ${lt ? "is-late" : ""} ${lifted ? "is-lifted" : ""}`}>
                    <header className={moveLock ? "" : "edp-handle"} {...(moveLock ? {} : handle)} title={moveLock ? undefined : "ลากที่หัวการ์ดไปวางทับอีกใบเพื่อสลับเวลา"}>
                      <span className="edp-round">
                        {shift === "ALL" ? `${c.shift === "DAY" ? "☀" : "🌙"} ` : ""}R{c.roundId || "-"}
                      </span>
                      <b className="truncate">{c.customer}</b>
                      {lt > 0 && <span className="edp-late">ช้า {lateText(lt)}</span>}
                      <span className={`edp-st is-${st.k}`} title={st.tip}>
                        {st.label}
                      </span>
                      {!moveLock && (
                        <span className="edp-grip" aria-hidden>
                          ⠿
                        </span>
                      )}
                    </header>
                    <div className="edp-card-body">
                      <div className="edp-img">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" loading="lazy" draggable={false} onError={(e) => (e.currentTarget.style.display = "none")} />
                        ) : (
                          <span>NO IMAGE</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="edp-part">{c.partNo}</div>
                        <div className="edp-name">{c.partName ?? "-"}</div>
                        <div className="edp-times">
                          {/* เวลาเปลี่ยน (กรอก HG / สลับการ์ด) = ตัวเลขเลื่อนขึ้นจาง ๆ */}
                          <span key={`s${t.sb}${t.se}`} className="edp-tick">
                            <small>START</small>
                            {t.sb}-{t.se}
                          </span>
                          <span key={`o${t.ob}${t.oe}`} className="edp-tick">
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
                        <input type="number" min={0} className="field" disabled={lock || lifted} value={qtyNow(c)} onChange={(e) => type(c, +e.target.value || 0, hgOf(+e.target.value || 0, c.qtyHg, hgNow(c)))} />
                      </label>
                      <label>
                        <small>HG</small>
                        <input type="number" min={0} className="field" disabled={lock || lifted} value={hgNow(c)} onChange={(e) => type(c, (+e.target.value || 0) * c.qtyHg, +e.target.value || 0)} />
                      </label>
                    </div>
                    {c.remark && <p className="edp-remark">📝 {c.remark}</p>}
                    {canSubmit && !c.isDone && !closed && !c.isProblem && !lifted && (
                      <footer>
                        <button type="button" className="fill-btn" onClick={() => setEdit(c)}>
                          ✏ EDIT
                        </button>
                        <button type="button" className="cta-btn is-green" disabled={busy.has(c.pldId)} onClick={() => mark(c)}>
                          {busy.has(c.pldId) ? <span className="edp-spin" aria-label="กำลังบันทึก" /> : "✔ MARK SUCCESS"}
                        </button>
                      </footer>
                    )}
                  </article>
                );
              }}
            />
          )}
        </>
      )}
      {edit && <EditCard card={edit} qty0={qtyNow(edit)} hg0={hgNow(edit)} onClose={() => (setEdit(null), load(true))} onSaved={() => (setEdit(null), load(true))} />}
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
          <span>กำลังโหลดแผน…</span>
        ) : cards.length > 0 ? (
          <span>
            พบแผน <b>{cards.length}</b> การ์ด · เสร็จแล้ว <b>{done}</b>
            {data.status && <i className={`edp-stat is-${data.status.replace(" ", "-").toLowerCase()}`}>{data.status}</i>}
          </span>
        ) : (
          <span>ไม่พบแผนของวันที่ / กะ / รอบนี้ · ตั้งแผนที่หน้า PLAN SETTING</span>
        )}
        <motion.button type="button" className="edp-start" disabled={!data || cards.length === 0} onClick={onStart} whileTap={{ scale: 0.97 }}>
          {data?.status === "IN PROGRESS" ? "▶ CONTINUE PLAN" : "▶ START PLANNING"}
        </motion.button>
      </motion.div>
    </section>
  );
}
