"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { springSoft, staggerDelay } from "@/lib/motion";
import { cascade, dmy, imgOf, nowSlot, shiftStart, sortMin, timesOf, type Card, type CardsRes, type Meta, type Shift } from "@/app/(app)/edp/edp";
import "@/app/(app)/edp/edp.css";

// ⏰ EDP ALERT : การ์ดเลยเวลา START แล้วแต่ยังไม่ MARK SUCCESS -> หน้าต่างแจ้งเตือนกลางจอ (พื้นหลังเบลอมืดใส เห็นหน้าระบบด้านหลัง)
//   แสดงเฉพาะตอนอยู่ในระบบ EDP PLANNING (/edp/*) และผู้ใช้ที่ MARK SUCCESS ได้ · แผนของรอบ / กะปัจจุบันตามนาฬิกา
//   CANCEL / GO UPDATE = ซ่อนชั่วคราว แล้วแจ้งซ้ำตามเวลาที่ตั้ง (ค่าเริ่มต้น 10 นาที) จนกว่าจะ MARK ครบ
//   ตั้งค่า (เปิด / ปิด · เลยกี่นาที · แจ้งซ้ำทุกกี่นาที · เฉพาะแผนที่ START แล้ว) = USER MANAGEMENT › SETUP › EDP ALERT
type Cfg = { enabled: boolean; graceMinutes?: number; remindMinutes?: number; onlyStarted?: boolean; snoozeUntil?: string | null; now?: string };
type Late = { c: Card; se: string; ob: string; oe: string; sb: string; min: number };

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
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [plan, setPlan] = useState<{ date: string; shift: Shift; res: CardsRes } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const meta = useRef<Meta | null>(null);
  const [skew, setSkew] = useState(0); // เวลา Server - เวลาเครื่อง

  const load = useCallback(async () => {
    try {
      const c = await api<Cfg>("/edp/alert");
      if (c.now) setSkew(new Date(c.now).getTime() - Date.now());
      setCfg(c);
      if (!c.enabled) return setPlan(null);
      meta.current ??= await api<Meta>("/edp/meta");
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

  const late = useMemo<Late[]>(() => {
    if (!cfg?.enabled || !plan) return [];
    if (cfg.onlyStarted !== false && plan.res.status !== "IN PROGRESS") return [];
    const list = plan.res.cards
      .filter((c) => c.isVisible && c.partNo)
      .map((c, i) => ({ c, i, t: timesOf(c.timeStart, c.timeEnd) }))
      .sort((a, b) => sortMin(a.t.sb, shiftStart(a.c.shift)) - sortMin(b.t.sb, shiftStart(b.c.shift)) || a.i - b.i)
      .map((x) => x.c);
    const times = cascade(list.map((c) => ({ key: c.pldId, shift: c.shift, base: timesOf(c.timeStart, c.timeEnd), baseHg: c.origHg ?? c.hgPlan, hg: c.isDone && c.hgAct != null ? c.hgAct : c.hgPlan, skip: c.isProblem })));
    const grace = Math.max(0, cfg.graceMinutes ?? 0);
    const at = now + skew;
    return list.flatMap((c) => {
      if (c.isDone || c.isProblem) return [];
      const t = times.get(c.pldId) ?? timesOf(c.timeStart, c.timeEnd);
      const d = due(plan.date, t.se, c.shift);
      if (d == null) return [];
      const min = Math.floor((at - d) / 60000);
      return min >= Math.max(1, grace) ? [{ c, ...t, min }] : [];
    });
  }, [cfg, plan, now, skew]);

  const show = late.length > 0 && !snoozed && !hidden;
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

  return (
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
                  การ์ด {late.length} ใบ เลยเวลา START แล้วแต่ยังไม่กด MARK SUCCESS · {dmy(plan.date)} กะ {plan.shift} · ค้างนานสุด {lateText(Math.max(...late.map((x) => x.min)))}
                </span>
              </div>
            </div>
            <div className="eda-body">
              {late.map((x, i) => {
                const img = imgOf(x.c);
                return (
                  <motion.article
                    key={x.c.pldId}
                    className="edp-card is-set is-late eda-card"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: reduce ? 0 : staggerDelay(i), duration: 0.35 } }}
                  >
                    <header>
                      <span className="edp-round">R{x.c.roundId || "-"}</span>
                      <b className="truncate">{x.c.customer}</b>
                      <span className="edp-late">ช้า {lateText(x.min)}</span>
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
                        <div className="edp-part">{x.c.partNo}</div>
                        <div className="edp-name">{x.c.partName ?? "-"}</div>
                        <div className="edp-times">
                          <span>
                            <small>START</small>
                            {x.sb}-{x.se}
                          </span>
                          <span>
                            <small>PLAN</small>
                            {x.c.qtyPlan.toLocaleString()} PCS · {x.c.hgPlan} HG
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
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
  );
}
