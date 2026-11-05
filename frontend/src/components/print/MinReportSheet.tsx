"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { useAuth } from "@/lib/auth";

// 📋 MIN REPORT : ชนิดข้อมูล + แผ่นรายงาน A4 แนวนอน (โลโก้ CHR แบบ Pick List) + หน้าต่าง PREVIEW -> EXPORT PDF / EXCEL
export type MinItem = {
  watchId: number;
  stkId: number;
  stockCode: string;
  partId: number;
  partCode: string;
  partName: string;
  qty: number | null;
  stockBox: string | null;
  min: number | null;
  max: number | null;
  belowSince: string;
  lastSeen: string;
  days: number;
  test?: boolean;
};

export type MinHistory = {
  reportId: number;
  stockId: number;
  stockCode: string;
  partCode: string;
  partName: string;
  qty: number | null;
  stockBox: string | null;
  minQty: number | null;
  maxQty: number | null;
  belowSince: string;
  daysStuck: number;
  reason: string;
  reportedBy: string;
  reporterName: string | null;
  reportedAt: string;
  resolvedAt: string | null;
};

const p2 = (n: number) => String(n).padStart(2, "0");
export const dt = (s: string | null | undefined, time = true) => {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}${time ? ` ${p2(d.getHours())}:${p2(d.getMinutes())}` : ""}`;
};
export const n0 = (v: number | null | undefined) => (v === null || v === undefined ? "-" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 }));
export const days = (d: number) => `${Number(d).toLocaleString("en-US", { maximumFractionDigits: 1 })} วัน`;
export const who = (h: MinHistory) => (h.reporterName ? `${h.reporterName} (${h.reportedBy})` : h.reportedBy);

export type SheetData =
  | { kind: "pending"; stock: string; stuckDays: number; rows: MinItem[] }
  | { kind: "history"; stock: string; from: string; to: string; rows: MinHistory[] };

const PER_PAGE = { pending: 14, history: 8 } as const;

// แผ่น A4 แนวนอน 1123 × 794 px (ตรงกับ 297 × 210 mm ที่ 96 dpi)
function Sheets({ data, printedBy }: { data: SheetData; printedBy: string }) {
  const per = PER_PAGE[data.kind];
  const pages: number[][] = [];
  for (let i = 0; i < Math.max(1, data.rows.length); i += per) pages.push(Array.from({ length: Math.min(per, data.rows.length - i) }, (_, k) => i + k));
  const now = dt(new Date().toISOString());
  const dayVals = data.kind === "pending" ? data.rows.map((r) => r.days) : data.rows.map((r) => Number(r.daysStuck));
  const maxD = dayVals.length ? Math.max(...dayVals) : 0;
  const avgD = dayVals.length ? dayVals.reduce((a, b) => a + b, 0) / dayVals.length : 0;
  return (
    <>
      {pages.map((idx, pi) => (
        <div key={pi} className="mr-page">
          <header className="mr-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/picklist/ch-logo.png" alt="CH. RADIATORS CO.,LTD." className="mr-logo" draggable={false} />
            <div className="mr-title">
              <b>{data.kind === "pending" ? "MIN STOCK ALERT REPORT" : "MIN STOCK REPORT HISTORY"}</b>
              <span>{data.kind === "pending" ? `รายงานสินค้าค้างที่ค่า MIN ≥ ${data.stuckDays} วัน (รอระบุสาเหตุ)` : "ประวัติรายงานสาเหตุสินค้าค้างที่ค่า MIN"}</span>
            </div>
            <dl className="mr-meta">
              <dt>STOCK</dt>
              <dd>{data.stock}</dd>
              <dt>{data.kind === "pending" ? "AS OF" : "PERIOD"}</dt>
              <dd>{data.kind === "pending" ? now : `${dt(data.from, false)} - ${dt(data.to, false)}`}</dd>
              <dt>PRINTED BY</dt>
              <dd>{printedBy}</dd>
              <dt>PAGE</dt>
              <dd>
                {pi + 1} / {pages.length}
              </dd>
            </dl>
          </header>
          {pi === 0 && (
            <div className="mr-sum">
              <span>
                <b>{data.rows.length}</b> รายการ
              </span>
              <span>
                ค้างนานสุด <b>{days(maxD)}</b>
              </span>
              <span>
                เฉลี่ย <b>{days(avgD)}</b>
              </span>
              <span className="mr-sum-note">CHR-Nexus · Store ( Max - Min ) · พิมพ์เมื่อ {now}</span>
            </div>
          )}
          <table className={`mr-tb is-${data.kind}`}>
            <thead>
              {data.kind === "pending" ? (
                <tr>
                  <th>NO</th>
                  <th>PART CODE</th>
                  <th>PART NAME</th>
                  <th>STOCK</th>
                  <th>BOX</th>
                  <th>MIN</th>
                  <th>MAX</th>
                  <th>BELOW MIN SINCE</th>
                  <th>DAYS</th>
                  <th>REASON (เขียนเพิ่ม)</th>
                </tr>
              ) : (
                <tr>
                  <th>NO</th>
                  <th>REPORTED</th>
                  <th>PART CODE / NAME</th>
                  <th>STOCK</th>
                  <th>MIN / MAX</th>
                  <th>SINCE</th>
                  <th>DAYS</th>
                  <th>REASON</th>
                  <th>REPORTED BY</th>
                  <th>NORMAL</th>
                </tr>
              )}
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="mr-empty">
                    ไม่มีรายการ
                  </td>
                </tr>
              )}
              {data.kind === "pending"
                ? idx.map((i) => {
                    const r = data.rows[i];
                    return (
                      <tr key={r.watchId} className={r.days >= data.stuckDays ? "is-late" : ""}>
                        <td>{i + 1}</td>
                        <td className="mr-code">{r.partCode}</td>
                        <td className="mr-name">{r.partName}</td>
                        <td>{n0(r.qty)}</td>
                        <td>{r.stockBox ?? "-"}</td>
                        <td>{n0(r.min)}</td>
                        <td>{n0(r.max)}</td>
                        <td>{dt(r.belowSince)}</td>
                        <td className="mr-days">{days(r.days)}</td>
                        <td className="mr-blank" />
                      </tr>
                    );
                  })
                : idx.map((i) => {
                    const r = data.rows[i];
                    return (
                      <tr key={r.reportId}>
                        <td>{i + 1}</td>
                        <td>{dt(r.reportedAt)}</td>
                        <td className="mr-name">
                          <b>{r.partCode}</b>
                          <br />
                          {r.partName}
                        </td>
                        <td>
                          {n0(r.qty)}
                          {r.stockBox ? ` · ${r.stockBox}` : ""}
                        </td>
                        <td>
                          {n0(r.minQty)} / {n0(r.maxQty)}
                        </td>
                        <td>{dt(r.belowSince)}</td>
                        <td className="mr-days">{days(Number(r.daysStuck))}</td>
                        <td className="mr-reason">
                          <div className="mr-rclip">{r.reason}</div>
                        </td>
                        <td>{who(r)}</td>
                        <td>{r.resolvedAt ? dt(r.resolvedAt) : "ยังค้าง"}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {pi === pages.length - 1 && (
            <div className="mr-sign">
              {["ผู้รายงาน / Reported by", "ผู้ตรวจสอบ / Checked by", "ผู้อนุมัติ / Approved by"].map((t) => (
                <div key={t}>
                  <span />
                  <b>{t}</b>
                  <small>วันที่ ........ / ........ / ............</small>
                </div>
              ))}
            </div>
          )}
          <footer className="mr-foot">
            <span>CH. RADIATORS CO.,LTD. · CHR-Nexus MIN REPORT</span>
            <span>
              {pi + 1} / {pages.length}
            </span>
          </footer>
        </div>
      ))}
    </>
  );
}

async function sheetsToPdf(root: HTMLElement, base: string) {
  const [{ jsPDF }, { toJpeg }] = await Promise.all([import("jspdf"), import("html-to-image")]);
  const pages = [...root.querySelectorAll<HTMLElement>(".mr-page")];
  if (pages.length === 0) throw new Error("ไม่มีหน้าให้ Export");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < pages.length; i++) {
    const img = await toJpeg(pages[i], { quality: 0.92, pixelRatio: 2.2, backgroundColor: "#ffffff" });
    if (i > 0) pdf.addPage("a4", "landscape");
    pdf.addImage(img, "JPEG", 0, 0, 297, 210);
  }
  const t = new Date();
  const name = `${base}_${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}_${p2(t.getHours())}${p2(t.getMinutes())}.pdf`;
  pdf.save(name);
  return name;
}

// 🖨 PREVIEW: แผ่นจริงย่อพอดีจอ (ทุกขนาดจอ) -> EXPORT PDF (สร้างในเครื่อง) / EXCEL (จาก Server)
export function ReportPreview({ data, onClose, onExcel, onPdfDone }: { data: SheetData | null; onClose: () => void; onExcel: () => Promise<void>; onPdfDone?: (rows: number) => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [busy, setBusy] = useState<"" | "pdf" | "xl">("");
  const [render, setRender] = useState(false);
  const off = useRef<HTMLDivElement>(null);
  const printedBy = me ? `${me.userName ?? me.userId} (${me.userId})` : "-";

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !data) return;
    const fit = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 8) / 1123)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // EXPORT PDF: วาดแผ่นขนาดจริงนอกจอ แล้วแปลงทีละหน้า
  useEffect(() => {
    if (!render || !data) return;
    let stop = false;
    (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (stop || !off.current) return;
      try {
        const n = await sheetsToPdf(off.current, `MIN_REPORT_${data.stock}_${data.kind === "pending" ? "ALERT" : "HISTORY"}`);
        toast.show("EXPORT PDF", `บันทึกไฟล์ ${n} แล้ว (${data.rows.length} รายการ)`, "ok");
        onPdfDone?.(data.rows.length);
      } catch (e) {
        toast.show("ERROR", "สร้าง PDF ไม่สำเร็จ\n" + (e as Error).message, "error");
      } finally {
        setRender(false);
        setBusy("");
      }
    })();
    return () => {
      stop = true;
    };
  }, [render, data, toast, onPdfDone]);

  async function excel() {
    setBusy("xl");
    try {
      await onExcel();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal
      open={!!data}
      size="xl"
      title={data ? `🖨 ${data.kind === "pending" ? "MIN REPORT • PREVIEW" : "MIN REPORT HISTORY • PREVIEW"} • ${data.stock}` : ""}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-ink-soft">{data ? `${data.rows.length} รายการ · A4 แนวนอน` : ""}</span>
          <button className="cta-btn is-gray ml-auto" onClick={onClose}>
            CLOSE
          </button>
          <button className="cta-btn is-green" onClick={excel} disabled={!!busy}>
            {busy === "xl" ? "…" : "📊 EXCEL"}
          </button>
          <button className="cta-btn is-red" onClick={() => (setBusy("pdf"), setRender(true))} disabled={!!busy}>
            {busy === "pdf" ? "กำลังสร้าง PDF…" : "⬇ EXPORT PDF"}
          </button>
        </div>
      }
    >
      <div ref={box} className="mr-preview">
        {data && (
          <div className="mr-stack" style={{ "--pv": scale, "--pw": `${1123 * scale}px`, "--ph": `${794 * scale}px` } as React.CSSProperties}>
            <Sheets data={data} printedBy={printedBy} />
          </div>
        )}
      </div>
      {render &&
        data &&
        createPortal(
          <div ref={off} className="mr-offscreen" aria-hidden>
            <Sheets data={data} printedBy={printedBy} />
          </div>,
          document.body,
        )}
    </Modal>
  );
}
