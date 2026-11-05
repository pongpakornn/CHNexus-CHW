"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useToast } from "@/components/notifications/Toasts";
import { days, dt, n0, type MinItem } from "@/components/print/MinReportSheet";

// ⚠ MIN REPORT : หน้าต่างแจ้งเตือนกลางจอ (ทุกหน้า) เมื่อมีสินค้าค้างที่ค่า MIN ครบตามวันที่ตั้ง (SETUP > MIN REPORT)
//   REPORT = ระบุสาเหตุ -> CONFIRM (บันทึกว่าใครรายงาน) · CANCEL = ซ่อนชั่วคราว แล้วแจ้งซ้ำตามเวลาที่ตั้ง
//   แจ้งต่อไปเรื่อย ๆ จนกว่าจะรายงาน หรือสินค้ากลับมาพ้นค่า MIN · เห็นเฉพาะคลังที่มีสิทธิ์ดู
type Alerts = { stuckDays: number; remindMinutes: number; snoozeUntil: string | null; now: string; items: MinItem[] };

const QUICK = ["รอของจาก Supplier", "PR อยู่ระหว่างอนุมัติ", "ใช้มากกว่าปกติ / Order เพิ่ม", "รอผลิต / รอตรวจสอบคุณภาพ", "ปรับค่า MIN / MAX ใหม่แล้ว"];
const every = (m: number) => (m % 60 === 0 ? `${m / 60} ชม.` : m > 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`);

// กล่องกรอกสาเหตุ (ใช้ทั้งหน้าต่างแจ้งเตือน และหน้า Store > MIN REPORT)
export function ReportBox({ item, onDone, onBack }: { item: MinItem; onDone: () => void; onBack: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  async function confirm() {
    if (reason.trim().length < 3) return toast.show("WARNING", "กรุณาระบุหมายเหตุ / สาเหตุที่สินค้าค้างอยู่ที่ค่า MIN", "warn");
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/minreport/report", { method: "POST", body: { watchId: item.watchId, reason: reason.trim() } });
      toast.show("REPORTED", r.message, "ok");
      onDone();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mr-rbox">
      <label className="mr-rlbl">
        หมายเหตุ / สาเหตุที่ค้างอยู่ที่ค่า MIN {days(item.days)} <b>*</b>
      </label>
      <div className="mr-quick">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => setReason((r) => (r.trim() ? `${r.trim()} · ${q}` : q))}>
            ＋ {q}
          </button>
        ))}
      </div>
      <textarea ref={ref} value={reason} maxLength={1000} rows={3} onChange={(e) => setReason(e.target.value)} placeholder="เช่น รอของจาก Supplier ส่งวันที่ ... / เปิด PR เลขที่ ... แล้ว" />
      <div className="mr-ract">
        <span>{reason.length} / 1000</span>
        <button type="button" className="cta-btn is-gray is-sm" onClick={onBack} disabled={busy}>
          ย้อนกลับ
        </button>
        <button type="button" className="cta-btn is-green is-sm" onClick={confirm} disabled={busy}>
          {busy ? "…" : "✓ CONFIRM"}
        </button>
      </div>
    </div>
  );
}

// แถวสินค้า 1 รายการ: ข้อมูล + ปุ่ม REPORT (กด = กางกล่องกรอกสาเหตุ)
export function MinItemCard({ item, stuckDays, onReported, showStock = true }: { item: MinItem; stuckDays: number; onReported: () => void; showStock?: boolean }) {
  const [open, setOpen] = useState(false);
  const late = item.days >= stuckDays;
  return (
    <div className={`mr-card ${late ? "is-late" : ""} ${open ? "is-open" : ""}`}>
      <div className="mr-card-main">
        <div className="mr-card-id">
          {showStock && <span className="mr-stk">{item.stockCode}</span>}
          <b>{item.partCode}</b>
          {item.test && <span className="mr-test">TEST</span>}
          <span className="mr-pname">{item.partName}</span>
        </div>
        <div className="mr-nums">
          <span>
            STOCK <b>{n0(item.qty)}</b>
            {item.stockBox ? <small> · {item.stockBox} BOX</small> : null}
          </span>
          <span>
            MIN <b className="text-danger">{n0(item.min)}</b>
          </span>
          <span>
            MAX <b>{n0(item.max)}</b>
          </span>
        </div>
        <div className="mr-age">
          <span className="mr-days">{days(item.days)}</span>
          <small>ตั้งแต่ {dt(item.belowSince)}</small>
          {!late && <small className="mr-watch">เฝ้าดู · แจ้งเตือนเมื่อครบ {stuckDays} วัน</small>}
        </div>
        {!open && (
          <button type="button" className="cta-btn is-red is-sm mr-rbtn" onClick={() => setOpen(true)}>
            📝 REPORT
          </button>
        )}
      </div>
      {open && <ReportBox item={item} onBack={() => setOpen(false)} onDone={onReported} />}
    </div>
  );
}

export function MinReportAlert() {
  const [data, setData] = useState<Alerts | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const skew = useRef(0); // เวลาเครื่อง Server - เครื่องผู้ใช้
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Alerts>("/minreport/alerts");
      if (r.now) skew.current = new Date(r.now).getTime() - Date.now();
      setData(r);
      setHidden(false);
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 1500);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [load]);
  useLive(["minreport"], load);

  // เลื่อนไว้ (CANCEL) -> ตั้งเวลาเปิดอีกครั้งเมื่อครบกำหนด
  const until = data?.snoozeUntil ? new Date(data.snoozeUntil).getTime() : 0;
  const [snoozed, setSnoozed] = useState(true);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const wait = until - (Date.now() + skew.current);
    const t0 = setTimeout(() => setSnoozed(wait > 0), 0);
    if (wait > 0) timer.current = setTimeout(() => (setSnoozed(false), load()), Math.min(wait + 1000, 2_147_000_000));
    return () => {
      clearTimeout(t0);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [until, load]);

  const show = !!data && data.items.length > 0 && !snoozed && !hidden;

  async function cancel() {
    setBusy(true);
    try {
      const r = await api<{ until: string }>("/minreport/snooze", { method: "POST" });
      setData((d) => (d ? { ...d, snoozeUntil: r.until } : d));
    } catch {
      setHidden(true); // บันทึกไม่ได้ = ซ่อนจนกว่าจะโหลดรอบหน้า
    } finally {
      setBusy(false);
    }
  }

  if (!show || !data) return null;
  const maxD = Math.max(...data.items.map((i) => i.days));
  return (
    <div className="mr-alert-bg" role="dialog" aria-modal="true" aria-label="MIN REPORT">
      <div className="mr-alert">
        <div className="mr-alert-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/picklist/ch-logo.png" alt="CH. RADIATORS CO.,LTD." draggable={false} />
          <div>
            <b>⚠ MIN STOCK ALERT</b>
            <span>
              สินค้า {data.items.length} รายการ ค้างอยู่ที่ค่า MIN มาแล้ว ≥ {data.stuckDays} วัน (นานสุด {days(maxD)}) · กรุณากด REPORT แล้วระบุสาเหตุ
            </span>
          </div>
        </div>
        <div className="mr-alert-body">
          {data.items.map((it) => (
            <MinItemCard key={it.watchId} item={it} stuckDays={data.stuckDays} onReported={load} />
          ))}
        </div>
        <div className="mr-alert-foot">
          <small>CANCEL = ซ่อนชั่วคราว แล้วแจ้งเตือนอีกครั้งใน {every(data.remindMinutes)} จนกว่าจะรายงาน</small>
          <button type="button" className="cta-btn is-gray" onClick={cancel} disabled={busy}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
