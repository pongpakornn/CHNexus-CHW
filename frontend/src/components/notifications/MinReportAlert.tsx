"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, download } from "@/lib/api";
import { useLive } from "@/lib/live";
import { sharedGet } from "@/lib/sharedGet";
import { ReportPreview, dt, n0, span, titleOf, useNow, type MinItem, type SheetData } from "@/components/print/MinReportSheet";
import { IC, Ico, PendingRow, type ReasonGroup } from "@/components/notifications/MinPending";

// ⚠ MIN REPORT : หน้าต่างแจ้งเตือนกลางจอ เมื่อมีสินค้าค้างอยู่ใต้ค่า MIN ต่อเนื่องครบตามวันที่ตั้ง (SETUP > MIN REPORT)
//   แสดงเฉพาะในระบบ CIMS (/cims/*) · เห็นเฉพาะคลังที่มีสิทธิ์ดู
//   แถวสินค้า = แถวเดียวกับหน้า Store › MIN REPORT › PENDING (PendingRow) · 🔀 ดู FLOW ลายเซ็น · ✎ REPORT (เลือกหมายเหตุ -> ส่ง)
//   CANCEL = ซ่อนชั่วคราว แล้วแจ้งซ้ำตามเวลาที่ตั้ง · กลับมาพ้น MIN (เขียว) = หายจากรายการเองทันที (Server เช็คใหม่เมื่อยอดเปลี่ยน)
type Alerts = { stuckDays: number; remindMinutes: number; snoozeUntil: string | null; now: string; reasons?: string[]; reasonGroups?: ReasonGroup[]; items: MinItem[] };

export { REASONS, ReportBox } from "@/components/notifications/MinPending";

// หน้าต่างลายเซ็น (MinSignAlert) รอให้หน้าต่างนี้ปิดก่อน ไม่ซ้อนกัน
export const MIN_ALERT_EVENT = "nexus:minalert";

const every = (m: number) => (m % 60 === 0 ? `${m / 60} ชม.` : m > 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`);

export function MinReportAlert() {
  const path = usePathname() ?? "";
  return path.startsWith("/cims") ? <MinReportAlertHost /> : null;
}

function MinReportAlertHost() {
  const [data, setData] = useState<Alerts | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ sheet: SheetData; items: MinItem[] } | null>(null); // 👁 PREVIEW เอกสาร (รายชิ้น / ทั้งหมด)
  const now = useNow();
  const skew = useRef(0); // เวลาเครื่อง Server - เครื่องผู้ใช้
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await sharedGet<Alerts>("/minreport/alerts");
      if (r.now) skew.current = new Date(r.now).getTime() - Date.now();
      setData(r);
      setHidden(false);
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 1500);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 300_000);
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

  const show = !!data && data.items.length > 0 && !snoozed && !hidden && !preview;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<boolean>(MIN_ALERT_EVENT, { detail: show }));
    return () => void window.dispatchEvent(new CustomEvent<boolean>(MIN_ALERT_EVENT, { detail: false }));
  }, [show]);

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

  // 👁 PREVIEW: เอกสาร FM-EN-04-22 รายชิ้น / ทั้งหมด (ระหว่างดู หน้าต่างแจ้งเตือนหลบให้ ปิดแล้วกลับมา)
  function openPreview(items: MinItem[]) {
    if (!data) return;
    const stocks = [...new Set(items.map((i) => i.stockCode))];
    setPreview({ items, sheet: { kind: "pending", stock: stocks.join(" · "), stuckDays: data.stuckDays, rows: items } });
  }
  async function excel() {
    if (!preview) return;
    // Excel แยกไฟล์ตามคลัง (แบบหน้า Store › MIN REPORT) · รายชิ้น = เฉพาะรายการนั้น
    const one = preview.items.length === 1 ? preview.items[0] : null;
    for (const stk of [...new Set(preview.items.map((i) => i.stkId))])
      await download(`/minreport/stock/${stk}/export`, { kind: "pending", ...(one ? { id: one.watchId } : {}) });
  }
  const previewEl = (
    <ReportPreview
      data={preview?.sheet ?? null}
      onClose={() => setPreview(null)}
      onExcel={excel}
      onPdfDone={(n) => {
        for (const stk of [...new Set((preview?.items ?? []).map((i) => i.stkId))]) api(`/minreport/stock/${stk}/pdf-log`, { method: "POST", body: { kind: "pending", rows: n } }).catch(() => {});
      }}
    />
  );

  if (!show || !data) return preview ? previewEl : null;
  const items = data.items; // Server เรียงค้างนานสุดก่อน
  const oldest = items[0];
  const ref = now || Date.parse(oldest.lastSeen);
  const stocks = [...new Set(items.map((i) => i.stockCode))];
  return (
    <div className="mr-alert-bg" role="dialog" aria-modal="true" aria-label="MIN STOCK ALERT">
      <div className="mr-alert is-v2">
        <div className="mr-alert-head">
          <span className="mr-alert-ic" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
            </svg>
          </span>
          <div className="min-w-0">
            <b>
              MIN STOCK <em>ALERT</em>
            </b>
            <span>
              สินค้าค้างอยู่ใต้ค่า MIN ต่อเนื่อง ≥ <em>{data.stuckDays} วัน</em> จำนวน <em>{items.length} รายการ</em> · กรุณากด REPORT แล้วระบุสาเหตุ
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/picklist/ch-logo.png" alt="CH. RADIATORS CO.,LTD." draggable={false} />
        </div>
        <div className="mrp is-soft mr-alert-body">
          <div className="mrp-stats">
            <div className="mrp-stat is-red is-on">
              <span className="mrp-stat-ic">
                <Ico d={IC.cart} />
              </span>
              <span className="mrp-stat-tx">
                <small>รอรายงาน</small>
                <b>{items.length}</b>
                <span>ค้างที่ค่า MIN ≥ {data.stuckDays} วัน</span>
              </span>
            </div>
            <div className="mrp-stat is-ink">
              <span className="mrp-stat-ic">
                <Ico d={IC.clock} />
              </span>
              <span className="mrp-stat-tx">
                <small>ค้างนานสุด</small>
                <b className="is-dur">{span(oldest.belowSince, null, ref)}</b>
                <span>
                  {titleOf(oldest) || "ไม่มีรหัส"} · ตั้งแต่ {dt(oldest.belowSince)}
                </span>
              </span>
            </div>
            <div className="mrp-stat is-violet">
              <span className="mrp-stat-ic">
                <Ico d={IC.cal} />
              </span>
              <span className="mrp-stat-tx">
                <small>คลัง</small>
                <b>{n0(stocks.length)}</b>
                <span className="truncate">{stocks.join(" · ")}</span>
              </span>
            </div>
            <div className="mr-alert-note">
              <b>!</b>
              <span>กรุณาตรวจสอบและรายงานสาเหตุ เพื่อป้องกันปัญหาสต็อกขาด</span>
            </div>
          </div>
          <div className="mrp-list">
            {items.map((it, i) => (
              <PendingRow key={it.watchId} no={i + 1} item={it} stuckDays={data.stuckDays} reasons={data.reasons} groups={data.reasonGroups} now={now} onReported={load} onPreview={() => openPreview([it])} showStock />
            ))}
          </div>
        </div>
        <div className="mr-alert-foot">
          <small>
            <i>i</i>CANCEL = ซ่อนชั่วคราว แล้วแจ้งเตือนอีกครั้งใน {every(data.remindMinutes)} จนกว่าจะรายงาน · สินค้ากลับมาพ้นค่า MIN แล้วจะหายจากรายการเอง
          </small>
          <button type="button" className="cta-btn is-purple" onClick={() => openPreview(items)} disabled={busy}>
            🖨 PREVIEW ALL
          </button>
          <button type="button" className="cta-btn is-gray" onClick={cancel} disabled={busy}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
