"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { refreshNotifications } from "@/lib/support";
import { openMinSign } from "@/lib/minSign";
import { dt, n0, span, subOf, titleOf, type MinItem } from "@/components/print/MinReportSheet";

// 📋 MIN REPORT ส่วนกลาง: ใช้ร่วมกัน 2 ที่ให้หน้าตา / ข้อมูลเหมือนกัน
//   1) หน้าต่างแจ้งเตือนกลางจอ (MinReportAlert · เฉพาะระบบ CIMS)   2) หน้า Store › ปุ่ม MIN REPORT › PENDING REPORT
//   แถวสินค้า (PendingRow) · กล่องรายงาน (ReportBox) · 🔀 ดู FLOW ลายเซ็นของคลัง (FlowModal)

// หมายเหตุที่เลือกได้ (Server ส่งรายการล่าสุดมาด้วย) - ตัวเลือกใหม่แทนตัวเดิมที่ความหมายซ้ำกัน (รอผลิต / รอตรวจสอบคุณภาพ)
export const REASONS = ["กำลังผลิต", "รอ Box FG", "รอ Check", "รอ Q-Gate", "รอซ่อม", "ปัญหาคุณภาพ", "ยังไม่มีแผนผลิต", "รอของจาก Supplier", "PR อยู่ระหว่างอนุมัติ", "ใช้มากกว่าปกติ / Order เพิ่ม", "ปรับค่า MIN / MAX ใหม่แล้ว"];
// กล่องรายงาน (ใช้ทั้งหน้าต่างแจ้งเตือน และหน้า Store > MIN REPORT): เลือกหมายเหตุ + กรอกรายละเอียดเพิ่มเติม
//   ส่งแล้ว = แจ้งคนที่ต้องลงลายเซ็นช่องถัดไปทันที (Toast + กระดิ่ง + แชท) · ผู้รายงานอยู่ในช่องแรกเอง = เปิดเอกสารให้เซ็นต่อ
export function ReportBox({ item, onDone, onBack, reasons = REASONS }: { item: MinItem; onDone: () => void; onBack: () => void; reasons?: string[] }) {
  const toast = useToast();
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  // กดหมายเหตุ = ใส่ข้อความนั้นในช่องรายละเอียด (แทนหมายเหตุตัวเดิม) แล้ววางเคอร์เซอร์ท้ายข้อความ ให้พิมพ์ต่อได้เลย
  //   กดตัวเดิมซ้ำ = ยกเลิก (เอาข้อความหมายเหตุออก เหลือที่พิมพ์ต่อไว้)
  const lead = (t: string) => (t ? `${t} · ` : "");
  function pick(q: string) {
    const next = type === q ? "" : q;
    const rest = type && reason.startsWith(type) ? reason.slice(type.length).replace(/^\s*·\s*/, "") : reason;
    const v = lead(next) + rest;
    setType(next);
    setReason(v);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(v.length, v.length);
    });
  }
  // ข้อความยังขึ้นต้นด้วยหมายเหตุที่เลือก = ส่งเป็นหมายเหตุ + รายละเอียดที่พิมพ์ต่อ · ลบหมายเหตุออกจากช่องเอง = ถือว่าไม่ได้เลือก
  const chosen = type && reason.startsWith(type) ? type : "";
  const detail = (chosen ? reason.slice(chosen.length).replace(/^\s*·\s*/, "") : reason).trim();
  async function confirm() {
    if (!chosen && detail.length < 3) return toast.show("WARNING", "กรุณาเลือกหมายเหตุ หรือระบุสาเหตุที่สินค้าค้างอยู่ที่ค่า MIN", "warn");
    setBusy(true);
    try {
      const r = await api<{ id: number; signNow: boolean; message: string }>("/minreport/report", { method: "POST", body: { watchId: item.watchId, reasonType: chosen, reason: detail } });
      toast.show("REPORTED", r.message, "ok");
      refreshNotifications();
      onDone();
      if (r.signNow) openMinSign(r.id);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mr-rbox">
      <label className="mr-rlbl">
        เลือกหมายเหตุ ({titleOf(item) || "ไม่มีรหัส"}) <b>*</b>
      </label>
      <div className="mr-quick" role="radiogroup" aria-label="หมายเหตุ">
        {reasons.map((q) => (
          <button key={q} type="button" role="radio" aria-checked={chosen === q} className={chosen === q ? "is-on" : ""} onClick={() => pick(q)}>
            {chosen === q ? "✓ " : ""}
            {q}
          </button>
        ))}
      </div>
      <label className="mr-rlbl">หมายเหตุ / รายละเอียด {chosen ? "(พิมพ์เพิ่มต่อท้ายได้)" : <b>*</b>}</label>
      <textarea ref={ref} value={reason} maxLength={900} rows={3} onChange={(e) => setReason(e.target.value)} placeholder="เลือกหมายเหตุด้านบน แล้วพิมพ์เพิ่มต่อ เช่น แผนผลิตวันที่ ... / เปิด PR เลขที่ ... / รอ Q-Gate ตรวจ Lot ..." />
      <div className="mr-ract">
        <span>{reason.length} / 900</span>
        <button type="button" className="cta-btn is-gray is-sm" onClick={onBack} disabled={busy}>
          ย้อนกลับ
        </button>
        <button type="button" className="cta-btn is-green is-sm" onClick={confirm} disabled={busy}>
          {busy ? "…" : "✓ ส่ง REPORT"}
        </button>
      </div>
    </div>
  );
}


// ไอคอนเส้นบาง (SVG ในไฟล์ ไม่โหลดรูป) - การ์ดสรุป / เวลา
export const IC = {
  cart: "M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L19.5 8H6.2M9 19.5h.01M17 19.5h.01",
  cal: "M5 6h14v14H5zM5 10h14M9 3.5v4M15 3.5v4M8.5 13.5h2M13.5 13.5h2M8.5 16.5h2",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  pen: "M4 20c3-1 4-5 6-5s1 4 3 4 3-3 4-3M14.5 4.5l5 5-8 8H6.5v-5z",
};
export const Ico = ({ d, className = "" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export function PendingRow({
  no,
  item: it,
  stuckDays,
  reasons,
  now,
  onPreview,
  onReported,
  showStock = false,
}: {
  no: number;
  item: MinItem;
  stuckDays: number;
  reasons?: string[];
  now: number;
  onPreview?: () => void;
  onReported: () => void;
  showStock?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState(false);
  const late = it.days >= stuckDays;
  const ref = now || Date.parse(it.lastSeen);
  const pct = Math.min(100, ((ref - Date.parse(it.belowSince)) / (stuckDays * 86_400_000)) * 100);
  const title = titleOf(it);
  return (
    <div className={`mrp-row ${late ? "is-late" : "is-watch"} ${open ? "is-open" : ""}`} style={{ animationDelay: `${Math.min(no, 12) * 25}ms` }}>
      <div className="mrp-main">
        <span className="mrp-no">{no}</span>
        <div className="mrp-part has-img">
          {/* 🖼 รูปสินค้า (ทะเบียน Master Data) · ไม่มีรูป = กรอบว่าง */}
          <span className="mrp-img" aria-hidden>
            {it.partId > 0 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/images/part/${it.partId}`} alt="" loading="lazy" draggable={false} onError={(e) => (e.currentTarget.style.display = "none")} />
            )}
          </span>
          <div className="mrp-part-tx">
          <b className={title ? "" : "is-none"}>
            {showStock && <em className="mrp-stk">{it.stockCode}</em>}
            {title || "ไม่มีรหัส"}
          </b>
          <span>{subOf(it)}</span>
          <div className="mrp-tags">
            {it.customer && <i>CUSTOMER : {it.customer}</i>}
            {it.supplier && <i>SUPPLIER : {it.supplier}</i>}
            {it.test && <i className="is-test">TEST</i>}
            {!!it.reportCount && (
              <i className="is-follow" title={it.lastReason ?? undefined}>
                🔁 ติดตามครั้งที่ {it.reportCount + 1} · รายงานล่าสุด {dt(it.lastReportAt)} · ยังไม่กลับเป็นเขียว
                {it.qty != null && it.min != null && it.min > it.qty ? ` (ขาดอีก ${n0(it.min - it.qty)})` : ""}
              </i>
            )}
          </div>
          </div>
        </div>
        <div className="mrp-nums">
          <span>
            <small>STOCK</small>
            <b>{n0(it.qty)}</b>
          </span>
          {it.stockBox && (
            <span>
              <small>BOX</small>
              <b>{it.stockBox}</b>
            </span>
          )}
          <span className="is-min">
            <small>MIN</small>
            <b>{n0(it.min)}</b>
          </span>
          <span>
            <small>MAX</small>
            <b>{n0(it.max)}</b>
          </span>
        </div>
        <div className="mrp-time">
          <b>
            <Ico d={IC.clock} className="mrp-clock" />
            {span(it.belowSince, null, ref)}
          </b>
          <small>
            ตั้งแต่ {dt(it.belowSince)} · อัพเดท {dt(it.lastSeen)}
          </small>
          <div className="mrp-bar" title={late ? `เกิน ${stuckDays} วันแล้ว` : `แจ้งเตือนเมื่อครบ ${stuckDays} วัน`}>
            <span style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
        </div>
        <RowActions className="mrp-act">
          {onPreview && <RowAction kind="view" title="PREVIEW เอกสาร (FM-EN-04-22)" onClick={onPreview} />}
          <FlowButton onClick={() => setFlow(true)} />
          <RowAction kind="edit" title="REPORT : เลือกหมายเหตุ + รายละเอียด" active={open} onClick={() => setOpen((v) => !v)} />
        </RowActions>
      </div>
      {open && <ReportBox item={it} reasons={reasons} onBack={() => setOpen(false)} onDone={onReported} />}
      {flow && <FlowModal stkId={it.stkId} stockCode={it.stockCode} title={title || subOf(it)} onClose={() => setFlow(false)} />}
    </div>
  );
}


// 🔀 ปุ่มดู FLOW ลายเซ็น (แบบเดียวกับปุ่มในแถว)
export function FlowButton({ onClick, title = "ดู FLOW ลายเซ็นของเอกสาร" }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" className="ra ra-flow" title={title} aria-label={title} onClick={onClick}>
      <span className="ra-ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="5" cy="6" r="2.2" />
          <circle cx="19" cy="6" r="2.2" />
          <circle cx="12" cy="18" r="2.2" />
          <path d="M7.2 6h9.6M6.2 7.9l4.6 8.2M17.8 7.9l-4.6 8.2" />
        </svg>
      </span>
    </button>
  );
}

type FlowSlot = { slot: number; name: string; mode: string; users: { userId: string; name: string }[]; waiting?: boolean; signed?: { name: string; at: string } | null };
type FlowRes = { stockCode: string; slots: FlowSlot[] };

// 🔀 FLOW ลายเซ็น: Prepared -> Checked -> Checked -> Approved · ใครเซ็นช่องไหน (ไม่ใช้ = ข้าม)
//   reportId = เอกสารที่ส่งแล้ว (แสดงว่าเซ็นถึงช่องไหน / รอใคร) · ไม่มี = FLOW ของคลัง (เอกสารจะเดินตามนี้หลังกด REPORT)
export function FlowModal({ stkId, stockCode, title, reportId, onClose }: { stkId: number; stockCode: string; title?: string; reportId?: number; onClose: () => void }) {
  const [data, setData] = useState<FlowRes | null>(null);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // ⚡ เปิดค้างไว้ได้: มีคนเซ็น / ตั้ง FLOW ใหม่จากเครื่องอื่น = อัพเดทเอง (หัวข้อ minreport)
  const load = useCallback(() => {
    api<FlowRes>(reportId ? `/minreport/reports/${reportId}/flow` : `/minreport/flow/${stkId}`)
      .then((d) => (setData(d), setErr("")))
      .catch((e: Error) => setErr(e.message));
  }, [stkId, reportId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["minreport"], load);
  useEffect(() => {
    box.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const used = (data?.slots ?? []).filter((s) => s.mode !== "OFF" && s.users.length > 0);
  const signed = used.filter((s) => s.signed).length;
  const waiting = used.find((s) => s.waiting);
  return createPortal(
    <div className="mr-flow-bg" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} className="mr-flow-box" role="dialog" aria-modal="true" aria-label="SIGN FLOW" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mr-flow-head">
          <b>🔀 FLOW ลายเซ็น • {stockCode}</b>
          <span>{title ? `${title} · ` : ""}{reportId ? "สถานะเอกสาร" : "เอกสารจะส่งตามลำดับนี้หลังกด REPORT"}</span>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mr-flow-body">
          {err ? (
            <p className="mr-flow-empty">{err}</p>
          ) : !data ? (
            <p className="mr-flow-empty">LOADING...</p>
          ) : used.length === 0 ? (
            <p className="mr-flow-empty">คลัง {data.stockCode} ยังไม่ได้ตั้ง FLOW ลายเซ็น (USER MANAGEMENT › SETUP › SIGN FLOW)</p>
          ) : (
            <>
            {reportId && (
              <div className={`mr-flow-prog ${signed === used.length ? "is-done" : ""}`}>
                <b>{signed === used.length ? "✔ อนุมัติครบทุกลำดับแล้ว" : waiting ? `⏳ อยู่ที่ลำดับ ${used.indexOf(waiting) + 1} · ${waiting.name}` : "ยังไม่เริ่ม FLOW"}</b>
                <span>
                  อนุมัติแล้ว {signed} / {used.length} ลำดับ
                </span>
                <i style={{ "--p": used.length ? signed / used.length : 0 } as React.CSSProperties} />
              </div>
            )}
            <ol className="mr-steps">
              {data.slots.map((s, i) => {
                const off = s.mode === "OFF" || s.users.length === 0;
                const st = s.signed ? "is-done" : s.waiting ? "is-wait" : off ? "is-off" : "";
                return (
                  <li key={s.slot} className={st} style={{ animationDelay: `${i * 60}ms` }}>
                    <span className="mr-step-dot">{s.signed ? "✔" : s.slot}</span>
                    <div className="min-w-0">
                      <b>
                        {s.name}
                        {s.waiting && <em>รอเซ็น</em>}
                        {off && <em className="is-off">ไม่ใช้</em>}
                      </b>
                      {s.signed ? (
                        <small>
                          ✔ {s.signed.name} · {dt(s.signed.at)}
                        </small>
                      ) : (
                        !off && (
                          <small>
                            {s.mode === "ANY" ? "ใครก็ได้ 1 คน: " : ""}
                            {s.users.map((u) => u.name).join(" · ")}
                          </small>
                        )
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
