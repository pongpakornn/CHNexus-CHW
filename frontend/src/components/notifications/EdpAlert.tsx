"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { springSoft } from "@/lib/motion";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { cascade, dmy, hgOf, imgOf, nowSlot, shiftStart, sortMin, timesOf, type Card, type CardsRes, type Meta, type Shift } from "@/app/(app)/edp/edp";
import { EditCard } from "@/app/(app)/edp/submission/EditCard";
import "@/app/(app)/edp/edp.css";

// ⏰ EDP ALERT : การ์ดเลยเวลา START แล้วแต่ยังไม่ MARK SUCCESS -> หน้าต่างแจ้งเตือนกลางจอ (พื้นหลังเบลอมืดใส เห็นหน้าระบบด้านหลัง)
//   แสดงเฉพาะตอนอยู่ในระบบ EDP PLANNING (/edp/*) และผู้ใช้ที่ MARK SUCCESS ได้ · แผนของรอบ / กะปัจจุบันตามนาฬิกา
//   CANCEL / GO UPDATE = ซ่อนชั่วคราว แล้วแจ้งซ้ำตามเวลาที่ตั้ง (ค่าเริ่มต้น 10 นาที) จนกว่าจะ MARK ครบ
//   ตั้งค่า (เปิด / ปิด · เลยกี่นาที · แจ้งซ้ำทุกกี่นาที · เฉพาะแผนที่ START แล้ว) = USER MANAGEMENT › SETUP › EDP ALERT
//   การ์ด = การ์ดจริงของหน้า Plan Submission (ข้อมูลจากระบบ) เรียงช้ามากสุด -> น้อยสุด · กรอก ACT / HG แล้ว MARK SUCCESS / EDIT ได้จากหน้าต่างนี้เลย
//   4 ใบขึ้นไป = วงแหวน 3D (Coverflow) เลื่อนเอง: ลูกศร · ลาก / swipe · กดการ์ดข้าง · ล้อเมาส์ · คีย์ ← →  ·  น้อยกว่า 4 ใบ = เรียงธรรมดา
type Cfg = { enabled: boolean; graceMinutes?: number; remindMinutes?: number; onlyStarted?: boolean; snoozeUntil?: string | null; now?: string };
type Late = { c: Card; sb: string; se: string; min: number };
type Typed = Record<number, { qty: number; hg: number }>;

const lateText = (m: number) => (m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`);

// เวลา HH:mm ของการ์ด -> วันเวลาจริง (เวลาก่อนต้นกะ = วันถัดไป) · เงื่อนไขเดียวกับหน้า Plan Submission
function due(date: string, hhmm: string, shift: Shift) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(`${date}T${hhmm}:00`);
  if (+m[1] < shiftStart(shift)) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function EdpAlert() {
  const path = usePathname() ?? "";
  const { me } = useAuth();
  const inEdp = path.startsWith("/edp");
  const can = !!me && (me.userLevel === 1 || !!me.can.edpSubmitEdit);
  return inEdp && can ? <EdpAlertHost path={path} /> : null;
}

function EdpAlertHost({ path }: { path: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const toast = useToast();
  const dlg = useDialogs();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [plan, setPlan] = useState<{ date: string; shift: Shift; res: CardsRes } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [typed, setTyped] = useState<Typed>({});
  const [marking, setMarking] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Late | null>(null);
  const meta = useRef<Meta | null>(null);
  const [skew, setSkew] = useState(0); // เวลา Server - เวลาเครื่อง

  const load = useCallback(async () => {
    try {
      const c = await api<Cfg>("/edp/alert");
      if (c.now) setSkew(new Date(c.now).getTime() - Date.now());
      setCfg(c);
      if (!c.enabled) return setPlan(null);
      meta.current ??= await api<Meta>("/edp/meta");
      setCanSubmit(meta.current.can.submit);
      const s = nowSlot(meta.current.rounds);
      const res = await api<CardsRes>("/edp/cards", { query: { date: s.date, shift: s.shift } });
      setPlan({ date: s.date, shift: s.shift, res });
      setHidden(false);
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 1200);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    const tick = setInterval(() => setNow(Date.now()), 20_000); // เวลาเดินต่อ = การ์ดที่เพิ่งเลยเวลาขึ้นเอง
    return () => (clearTimeout(first), clearInterval(t), clearInterval(tick));
  }, [load]);
  // ⚡ หน้างาน MARK / ตั้งแผนใหม่ / แก้ค่าตั้ง = Server แจ้งทันที -> เช็คใหม่ (MARK ครบ = หน้าต่างหายเอง)
  useLive(["edp"], load);

  // เลื่อนไว้ (CANCEL) -> ครบกำหนดแล้วแสดงใหม่
  const until = cfg?.snoozeUntil ? new Date(cfg.snoozeUntil).getTime() : 0;
  const snoozed = until > now + skew;
  useEffect(() => {
    if (!until) return;
    const wait = until - (Date.now() + skew);
    if (wait <= 0) return;
    const t = setTimeout(() => (setNow(Date.now()), load()), Math.min(wait + 800, 2_147_000_000));
    return () => clearTimeout(t);
  }, [until, skew, load]);

  // การ์ดที่เลยเวลา: เวลาไหลต่อกันทั้งกะแบบหน้า Plan Submission (cascade เดียวกัน) · เรียงช้ามากสุดก่อน
  const late = useMemo<Late[]>(() => {
    if (!cfg?.enabled || !plan) return [];
    if (cfg.onlyStarted !== false && plan.res.status !== "IN PROGRESS") return [];
    const list = plan.res.cards
      .filter((c) => c.isVisible && c.partNo)
      .map((c, i) => ({ c, i, t: timesOf(c.timeStart, c.timeEnd) }))
      .sort((a, b) => sortMin(a.t.sb, shiftStart(a.c.shift)) - sortMin(b.t.sb, shiftStart(b.c.shift)) || a.i - b.i)
      .map((x) => x.c);
    const times = cascade(list.map((c) => ({ key: c.pldId, shift: c.shift, base: timesOf(c.timeStart, c.timeEnd), baseHg: c.origHg ?? c.hgPlan, hg: c.isDone && c.hgAct != null ? c.hgAct : c.hgPlan, skip: c.isProblem })), false);
    const grace = Math.max(0, cfg.graceMinutes ?? 0);
    const at = now + skew;
    return list
      .flatMap((c, i) => {
        if (c.isDone || c.isProblem) return [];
        const t = times.get(c.pldId) ?? timesOf(c.timeStart, c.timeEnd);
        const d = due(plan.date, t.se, c.shift);
        if (d == null) return [];
        const min = Math.floor((at - d) / 60000);
        return min >= Math.max(1, grace) ? [{ c, sb: t.sb, se: t.se, min, i }] : [];
      })
      .sort((a, b) => b.min - a.min || a.i - b.i)
      .map(({ c, sb, se, min }) => ({ c, sb, se, min }));
  }, [cfg, plan, now, skew]);

  const show = late.length > 0 && !snoozed && !hidden && !edit;
  const remind = cfg?.remindMinutes ?? 10;

  async function snooze(go: boolean) {
    setBusy(true);
    try {
      const r = await api<{ until: string }>("/edp/alert/snooze", { method: "POST" });
      setCfg((c) => (c ? { ...c, snoozeUntil: r.until } : c));
    } catch {
      setHidden(true); // บันทึกไม่ได้ = ซ่อนจนกว่าจะเช็ครอบหน้า
    } finally {
      setBusy(false);
    }
    if (go) router.push("/edp/submission");
  }

  // ตัวเลขบนการ์ด (พิมพ์ค้างไว้ในหน้าต่างนี้ ยังไม่ได้ MARK) · ชิ้น <-> HG ด้วย QTY_HG แบบหน้า Plan Submission
  const qtyOf = (c: Card) => typed[c.pldId]?.qty ?? c.qtyPlan;
  const hgOfCard = (c: Card) => typed[c.pldId]?.hg ?? c.hgPlan;
  const type = (c: Card, qty: number, hg: number) => setTyped((t) => ({ ...t, [c.pldId]: { qty: Math.max(0, qty), hg: Math.max(0, hg) } }));

  // ✔ MARK SUCCESS (เงื่อนไขเดียวกับหน้า Plan Submission: HG = 0 ถามยืนยันข้ามก่อน)
  async function mark(c: Card) {
    if (marking.has(c.pldId)) return;
    const hg = hgOfCard(c),
      qty = qtyOf(c);
    if (hg <= 0 && !(await dlg.confirm({ title: "CONFIRM SKIPPING", message: "ยอดผลิตเป็น 0 คุณต้องการบันทึกและข้ามรายการนี้ใช่หรือไม่?", ok: "SKIP" }))) return;
    setMarking((m) => new Set(m).add(c.pldId));
    try {
      const r = await api<{ message: string }>("/edp/mark", { method: "POST", body: { pldId: c.pldId, qtyAct: qty, hgAct: hg, partNo: c.partNo } });
      toast.show("SUCCESS", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", "บันทึกไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setMarking((m) => {
        const n = new Set(m);
        n.delete(c.pldId);
        return n;
      });
    }
  }

  const cardProps = { canSubmit, marking, qtyOf, hgOf: hgOfCard, type, mark, onEdit: setEdit };

  return (
    <>
      <AnimatePresence>
        {show && plan && (
          <motion.div
            key="edp-alert"
            className="eda-bg"
            role="dialog"
            aria-modal="true"
            aria-label="EDP ALERT"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          >
            <motion.div
              className="eda-box edp-light"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? { duration: 0.2 } : springSoft }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.22 } }}
            >
              <div className="eda-head">
                <span className="eda-bell" aria-hidden>
                  ⏰
                </span>
                <div className="min-w-0">
                  <b>EDP • PLAN OVERDUE</b>
                  <span>
                    การ์ด {late.length} ใบ เลยเวลา START แล้วแต่ยังไม่กด MARK SUCCESS · {dmy(plan.date)} กะ {plan.shift} · ค้างนานสุด {lateText(late[0].min)}
                  </span>
                </div>
              </div>
              {late.length >= 4 ? (
                <Ring late={late} reduce={!!reduce} {...cardProps} />
              ) : (
                <div className="eda-few">
                  {late.map((x, i) => (
                    <motion.div key={x.c.pldId} className="eda-slot is-flat" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, transition: { delay: reduce ? 0 : i * 0.06, duration: 0.35 } }}>
                      <AlertCard x={x} act {...cardProps} />
                    </motion.div>
                  ))}
                </div>
              )}
              <div className="eda-foot">
                <small>CANCEL = ซ่อนชั่วคราว แล้วแจ้งเตือนอีกครั้งใน {remind} นาที จนกว่าจะ MARK SUCCESS ครบ</small>
                <button type="button" className="cta-btn is-gray" disabled={busy} onClick={() => snooze(false)}>
                  CANCEL
                </button>
                {!path.startsWith("/edp/submission") && (
                  <button type="button" className="cta-btn is-green" disabled={busy} onClick={() => snooze(true)}>
                    ▶ GO UPDATE
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ✏ EDIT: ป๊อปอัปเดียวกับหน้า Plan Submission (ระหว่างแก้ หน้าต่างแจ้งเตือนหลบให้ ปิดแล้วกลับมา) */}
      {edit && <EditCard card={edit.c} qty0={qtyOf(edit.c)} hg0={hgOfCard(edit.c)} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), load())} />}
    </>
  );
}

type CardProps = {
  canSubmit: boolean;
  marking: Set<number>;
  qtyOf: (c: Card) => number;
  hgOf: (c: Card) => number;
  type: (c: Card, qty: number, hg: number) => void;
  mark: (c: Card) => void;
  onEdit: (x: Late) => void;
};

// 🎠 วงแหวน 3D (Coverflow): ใบกลางใหญ่สุด · ข้างละ 3 ใบ เอียงเข้าหากลาง ยิ่งไกลยิ่งเล็ก / จาง · ไม่หมุนเอง
//   transform / opacity อย่างเดียว · ใบที่วนข้ามไปอีกฝั่ง = ปิด transition ชั่วขณะ (ไม่บินผ่านกลางจอ)
const POSE = {
  wide: { x: [0, 200, 300, 360], s: [1.08, 0.86, 0.76, 0.66] },
  narrow: { x: [0, 92, 132, 156], s: [1, 0.8, 0.7, 0.6] },
};
const OP = [1, 0.95, 0.8, 0.5];

function pose(o: number, narrow: boolean) {
  const P = narrow ? POSE.narrow : POSE.wide;
  const a = Math.abs(o),
    sg = o < 0 ? -1 : 1;
  if (a > 3) return `translate(-50%, -50%) translateX(${sg * P.x[3]}px) translateZ(-300px) rotateY(${-sg * 38}deg) scale(0.6)`;
  return `translate(-50%, -50%) translateX(${sg * P.x[a]}px) translateZ(${a === 0 ? 70 : -a * 90}px) rotateY(${a === 0 ? 0 : -sg * 38}deg) scale(${P.s[a]})`;
}
const offsetOf = (i: number, cur: number, n: number) => {
  let o = (((i - cur) % n) + n) % n;
  if (o > n / 2) o -= n;
  return o;
};

function Ring({ late, reduce, ...cardProps }: { late: Late[]; reduce: boolean } & CardProps) {
  const n = late.length;
  const [pos, setPos] = useState({ cur: 0, prev: 0 });
  const [opened, setOpened] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const tilts = useRef<(HTMLDivElement | null)[]>([]);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const wheelAt = useRef(0);
  const cur = ((pos.cur % n) + n) % n;
  const prev = ((pos.prev % n) + n) % n;

  const go = useCallback((to: number) => setPos((p) => ({ cur: (((to % n) + n) % n), prev: p.cur })), [n]);
  const step = useCallback((d: number) => setPos((p) => ({ cur: ((((p.cur + d) % n) + n) % n), prev: p.cur })), [n]);

  // เปิดครั้งแรก: การ์ดกางออกจากกลางจอ
  useEffect(() => {
    const t = setTimeout(() => setOpened(true), 60);
    return () => clearTimeout(t);
  }, []);
  // มือถือ = ระยะการ์ดข้างแคบลง
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // คีย์บอร์ด ← → (ไม่แย่งตอนพิมพ์ในช่อง ACT / HG)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step]);
  // ล้อเมาส์ (ทีละใบ · เว้น 350ms)
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = Date.now();
      if (t - wheelAt.current < 350) return;
      wheelAt.current = t;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (d) step(d > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [step]);

  const isField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, button");
  const resetTilt = () => {
    const el = tilts.current[cur];
    if (el) el.style.transform = "";
  };

  return (
    <div className="eda-ring-wrap">
      <button type="button" className="eda-nav is-prev" aria-label="การ์ดก่อนหน้า" onClick={() => step(-1)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>
      <button type="button" className="eda-nav is-next" aria-label="การ์ดถัดไป" onClick={() => step(1)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      <div
        ref={stage}
        className="eda-stage"
        onPointerDown={(e) => {
          if (isField(e.target)) return;
          drag.current = { x: e.clientX, moved: false };
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 40) {
            d.moved = true;
            step(dx < 0 ? 1 : -1);
          }
          setTimeout(() => (drag.current = null), 0);
        }}
        onPointerCancel={() => (drag.current = null)}
        onPointerMove={(e) => {
          // ใบกลางเอียงตามเมาส์ (rotateX ±7° · rotateY ±9°)
          if (reduce || drag.current || e.pointerType !== "mouse") return;
          const el = tilts.current[cur];
          if (!el) return;
          const r = el.getBoundingClientRect();
          const x = Math.max(-1.5, Math.min(1.5, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
          const y = Math.max(-1.5, Math.min(1.5, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
          el.style.transform = `rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`;
        }}
        onPointerLeave={resetTilt}
      >
        {/* เงาวงรีใต้ใบกลาง: ยุบนิดหนึ่งทุกครั้งที่เลื่อน */}
        <div key={`sh${pos.cur}`} className="eda-shadow" aria-hidden />
        {late.map((x, i) => {
          const o = offsetOf(i, cur, n);
          const a = Math.abs(o);
          const jump = Math.abs(o - offsetOf(i, prev, n)) > 1; // วนข้ามจากท้ายไปอีกฝั่ง
          const act = o === 0;
          return (
            <div
              key={x.c.pldId}
              className={`eda-slot ${act ? "is-act" : ""}`}
              aria-hidden={a > 3}
              style={{
                transform: opened ? pose(o, narrow) : "translate(-50%, -50%) translateZ(-300px) scale(0.4)",
                opacity: opened ? (a > 3 ? 0 : OP[a]) : 0,
                zIndex: 100 - a,
                pointerEvents: a > 3 ? "none" : undefined,
                transition: jump || !opened ? "none" : undefined,
                transitionDelay: `${a * 45}ms`,
              }}
              onClickCapture={(e) => {
                if (drag.current?.moved) {
                  e.stopPropagation();
                  e.preventDefault();
                  return;
                }
                // กดการ์ดข้าง = เลื่อนมาเป็นใบหลัก (ปุ่มบนการ์ดข้างยังกดไม่ได้)
                if (!act) {
                  e.stopPropagation();
                  e.preventDefault();
                  resetTilt();
                  go(i);
                }
              }}
            >
              <div ref={(el) => void (tilts.current[i] = el)} className="eda-tilt">
                <AlertCard x={x} act={act} shineKey={act ? pos.cur : undefined} {...cardProps} />
              </div>
            </div>
          );
        })}
      </div>
      {/* แถบความคืบหน้า: ใบปัจจุบันยืดยาวสีแดง + ใบที่ / ทั้งหมด */}
      <div className="eda-bars" aria-hidden>
        {late.map((x, i) => (
          <span key={x.c.pldId} className={i === cur ? "is-on" : ""} />
        ))}
      </div>
      <p className="eda-count" aria-live="polite">
        <b>
          {cur + 1} / {n}
        </b>{" "}
        · ลาก / กดการ์ดข้าง / ลูกศร / ล้อเมาส์ เพื่อเลื่อน
      </p>
    </div>
  );
}

// 🃏 การ์ดแจ้งเตือน = การ์ดของหน้า Plan Submission (รูป · PART · ชื่อ · START · PLAN · ACT / HG · EDIT / MARK SUCCESS)
function AlertCard({ x, act, shineKey, canSubmit, marking, qtyOf, hgOf: hgNow, type, mark, onEdit }: { x: Late; act: boolean; shineKey?: number } & CardProps) {
  const c = x.c;
  const img = imgOf(c);
  const busy = marking.has(c.pldId);
  const lock = !canSubmit || !act;
  return (
    <article className={`edp-card is-set is-late eda-c ${act ? "is-act" : ""}`}>
      {shineKey !== undefined && <span key={shineKey} className="eda-shine" aria-hidden />}
      <header>
        <span className="edp-round">R{c.roundId || "-"}</span>
        <b className="truncate">{c.customer}</b>
        <span className="edp-late eda-late">
          <i aria-hidden />
          ช้า {lateText(x.min)}
        </span>
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
          <div className="edp-name truncate">{c.partName ?? "-"}</div>
          <div className="edp-times eda-chips">
            <span>
              <small>START</small>
              {x.sb}-{x.se}
            </span>
            <span>
              <small>PLAN</small>
              {c.qtyPlan.toLocaleString()} PCS · {c.hgPlan} HG
            </span>
          </div>
        </div>
      </div>
      <div className="edp-qty">
        <label>
          <small>ACT (PCS)</small>
          <input type="number" min={0} className="field" disabled={lock} value={qtyOf(c)} onChange={(e) => type(c, +e.target.value || 0, hgOf(+e.target.value || 0, c.qtyHg, hgNow(c)))} />
        </label>
        <label>
          <small>HG</small>
          <input type="number" min={0} className="field" disabled={lock} value={hgNow(c)} onChange={(e) => type(c, (+e.target.value || 0) * c.qtyHg, +e.target.value || 0)} />
        </label>
      </div>
      {canSubmit && (
        <footer>
          <button type="button" className="fill-btn" disabled={!act} onClick={() => onEdit(x)}>
            ✏ EDIT
          </button>
          <button type="button" className="cta-btn is-green" disabled={!act || busy} onClick={() => mark(c)}>
            {busy ? <span className="edp-spin" aria-label="กำลังบันทึก" /> : "✔ MARK SUCCESS"}
          </button>
        </footer>
      )}
    </article>
  );
}
