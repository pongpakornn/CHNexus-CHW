"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";

// 📋 MIN REPORT : ชนิดข้อมูล + เอกสาร FM-EN-04-22 "Improvement Plan / All" (A4 แนวนอน · 7 รายการ / หน้า · แยกหน้าตาม Customer / Supplier)
//   + หน้าต่าง PREVIEW (เห็นทั้งแผ่น) -> EXPORT PDF (วาดในเครื่อง) / EXCEL (แบบฟอร์มเดียวกัน จาก Server: MinReportForm.cs)
//   ✍ เอกสารรายงานเดียว: ช่อง Prepared / Checked / Checked / Approved แสดงลายเซ็นที่ลงแล้ว · ช่องที่รอฉัน = กดเพื่อลงลายเซ็น
export type MinItem = {
  watchId: number;
  stkId: number;
  stockCode: string;
  partId: number;
  partCode: string;
  partName: string;
  /** บรรทัดที่ 1 / 2 ตามรูปแบบการแสดงของคลัง (SETUP › MIN REPORT) */
  title?: string | null;
  sub?: string | null;
  qty: number | null;
  stockBox: string | null;
  min: number | null;
  max: number | null;
  belowSince: string;
  lastSeen: string;
  days: number;
  test?: boolean;
  customer?: string | null;
  supplier?: string | null;
};

export type MinSign = { slot: number; userId: string; userName: string | null; signedAt: string };

export type MinHistory = {
  reportId: number;
  stockId: number;
  stockCode: string;
  partCode: string;
  partName: string;
  title?: string | null;
  sub?: string | null;
  qty: number | null;
  stockBox: string | null;
  minQty: number | null;
  maxQty: number | null;
  belowSince: string;
  daysStuck: number;
  reason: string;
  reasonType?: string | null;
  reportedBy: string;
  reporterName: string | null;
  reportedAt: string;
  resolvedAt: string | null;
  lastSeen?: string | null;
  customer?: string | null;
  supplier?: string | null;
  section?: string | null;
  /** null = คลังไม่มี FLOW · SIGNING = รอลงลายเซ็น · DONE = ลงนามครบ */
  flowStatus?: "SIGNING" | "DONE" | null;
  nextSlot?: number | null;
  doneAt?: string | null;
  signs?: MinSign[];
};

/** FLOW ลายเซ็นของเอกสาร 1 ช่อง (จาก /minreport/reports/{id}) */
export type SlotInfo = { slot: number; name: string; mode: "OFF" | "ANY" | "ONE"; users: { userId: string; name: string }[]; waiting: boolean; mine: boolean };
export type Signing = { slots: SlotInfo[]; busy: number; onSign: (slot: number) => void };

const p2 = (n: number) => String(n).padStart(2, "0");
export const dt = (s: string | null | undefined, time = true) => {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}${time ? ` ${p2(d.getHours())}:${p2(d.getMinutes())}` : ""}`;
};
export const n0 = (v: number | null | undefined) => (v === null || v === undefined ? "-" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 }));
export const days = (d: number) => dur(Number(d) * 86_400_000);
// ⏱ ระยะเวลา: "3 วัน 12 ชม. 30 นาที" (ไม่แสดงหน่วยที่เป็น 0)
export function dur(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m === 0) return "ไม่ถึง 1 นาที";
  const d = Math.floor(m / 1440),
    h = Math.floor((m % 1440) / 60),
    mi = m % 60;
  return [d ? `${d} วัน` : "", h ? `${h} ชม.` : "", mi ? `${mi} นาที` : ""].filter(Boolean).join(" ");
}
/** ระยะเวลาจาก from ถึง to (ไม่ส่ง to = ถึงตอนนี้ของ now) */
export const span = (from: string, to: string | null | undefined, now: number) => dur((to ? new Date(to).getTime() : now) - new Date(from).getTime());
/** เวลาปัจจุบัน (อัพเดททุก 30 วินาที) - 0 = ยังไม่เริ่ม (วาดครั้งแรก) */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), every);
    return () => (clearTimeout(t0), clearInterval(t));
  }, [every]);
  return now;
}
export const who = (h: MinHistory) => (h.reporterName ? `${h.reporterName} (${h.reportedBy})` : h.reportedBy);

const clean = (v: string | null | undefined) => (v && v.trim() !== "-" ? v.trim() : "");
/** บรรทัดที่ 1 (ตัวหนา) - ว่าง = "ไม่มีรหัส" */
export const titleOf = (r: { title?: string | null; partCode: string }) => clean(r.title ?? r.partCode) || "";
/** บรรทัดที่ 2 */
export const subOf = (r: { sub?: string | null; partName: string }) => (r.sub ?? r.partName ?? "").trim();
/** สาเหตุ + หมายเหตุที่เลือก (ตรงกับ Excel) */
export const reasonText = (r: MinHistory) => (!r.reasonType || r.reason.startsWith(r.reasonType) ? r.reason : `[${r.reasonType}] ${r.reason}`);
export const SLOT_NAMES = ["", "Prepared", "Checked", "Checked", "Approved"];

export type SheetData =
  | { kind: "pending"; stock: string; stuckDays: number; rows: MinItem[] }
  | { kind: "history"; stock: string; from: string; to: string; rows: MinHistory[]; single?: boolean };

// 📄 เอกสาร FM-EN-04-22 (ตรงกับ Excel ของ Server) - เลขที่เอกสาร / วันที่เริ่มใช้ ท้ายหน้า
export const DOC_NO = "FM-EN-04-22 / 0";
export const DOC_DATE = "05-03-62";
const PER_PAGE = 7;
// เส้นแบ่งคอลัมน์ตามแบบฟอร์มจริง: 1 No · 2-3 Problem · 4-5 Countermeasure · 6 Name · 7 Sect · 8-9 Plan · 10 Actual · 11-13 After
const COLS = [31, 161, 79, 176, 85, 66, 58, 31, 31, 56, 85, 85, 79];
type Row = { customer: string; supplier: string; problem: [string, string, string, string]; action: string; name: string; sect: string; plan: string; actual: string; after: string; signs: MinSign[] };

const num = (q: number | null, box: string | null, min: number | null, max: number | null) => `STOCK ${n0(q)}${box ? ` (${box} BOX)` : ""} · MIN ${n0(min)} · MAX ${n0(max)}`;
const headOf = (r: { title?: string | null; sub?: string | null; partCode: string; partName: string }) => {
  const t = titleOf(r) || "ไม่มีรหัส";
  const s = subOf(r);
  return s ? `${t}  ${s}` : t;
};
function rowsOf(data: SheetData, now: number): Row[] {
  if (data.kind === "pending")
    return data.rows.map((r) => ({
      customer: r.customer ?? "",
      supplier: r.supplier ?? "",
      problem: [headOf(r), `ค้างที่ค่า MIN ${span(r.belowSince, null, now)}`, `ตั้งแต่ ${dt(r.belowSince)} - ปัจจุบัน`, num(r.qty, r.stockBox, r.min, r.max)],
      action: "",
      name: "",
      sect: "",
      plan: "",
      actual: "",
      after: `ยังค้างที่ค่า MIN (รอระบุสาเหตุ)\nอัพเดทล่าสุด ${dt(r.lastSeen)}`,
      signs: [],
    }));
  return data.rows.map((r) => ({
    customer: r.customer ?? "",
    supplier: r.supplier ?? "",
    problem: [headOf(r), `ค้างที่ค่า MIN ${span(r.belowSince, r.resolvedAt, now)}`, `ตั้งแต่ ${dt(r.belowSince)} - ${r.resolvedAt ? dt(r.resolvedAt) : "ปัจจุบัน"}`, num(r.qty, r.stockBox, r.minQty, r.maxQty)],
    action: reasonText(r),
    name: r.reporterName || r.reportedBy,
    sect: r.section ?? "",
    plan: "",
    actual: r.resolvedAt ? dmy(r.resolvedAt) : "",
    after:
      (r.resolvedAt ? `กลับมาพ้นค่า MIN แล้ว ${dt(r.resolvedAt)}` : `ยังค้างที่ค่า MIN\nอัพเดทล่าสุด ${dt(r.lastSeen)}`) +
      `\nรายงาน ${dt(r.reportedAt)} (ค้างมา ${span(r.belowSince, r.reportedAt, now)})` +
      (r.flowStatus === "DONE" ? `\nลงนามครบ ${dt(r.doneAt)}` : r.flowStatus === "SIGNING" ? `\nรอลงนาม ${SLOT_NAMES[r.nextSlot ?? 0] ?? ""}` : ""),
    signs: r.signs ?? [],
  }));
}
const dmy = (s: string) => {
  const d = new Date(s);
  return `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)}`;
};

// แยกหน้าตาม Customer / Supplier ของสินค้า (อัตโนมัติ) · 7 รายการต่อหน้า
function pagesOf(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  rows.forEach((r) => {
    const k = `${r.customer}\u0000${r.supplier}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });
  const pages: { customer: string; supplier: string; rows: Row[]; start: number }[] = [];
  [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([, list]) => {
      for (let i = 0; i < list.length; i += PER_PAGE) pages.push({ customer: list[0].customer, supplier: list[0].supplier, rows: list.slice(i, i + PER_PAGE), start: i });
    });
  return pages.length ? pages : [{ customer: "", supplier: "", rows: [], start: 0 }];
}

// ช่องลายเซ็น 1 ช่อง: ลงแล้ว = รูป + ชื่อ / เวลา · รอฉัน = ปุ่มกดเซ็น (เฉพาะบนจอ ไม่ติดไปกับ PDF) · รอคนอื่น = ชื่อคนที่ต้องเซ็น
function SignCell({ slot, sign, info, signing, interactive, wide }: { slot: number; sign?: MinSign; info?: SlotInfo; signing?: Signing; interactive: boolean; wide?: boolean }) {
  const cls = `fm-sign ${info?.mine && interactive ? "is-mine" : ""} ${info?.waiting ? "is-wait" : ""}`;
  const body = sign ? (
    <div className="fm-signed">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/signature/${encodeURIComponent(sign.userId)}/image`} alt={sign.userName ?? sign.userId} draggable={false} />
      <span>
        {sign.userName ?? sign.userId}
        <br />
        {dt(sign.signedAt)}
      </span>
    </div>
  ) : info?.mine && interactive && signing ? (
    <button type="button" className="fm-sign-btn" disabled={signing.busy > 0} onClick={() => signing.onSign(slot)}>
      {signing.busy === slot ? "…" : "✍ คลิกเพื่อลงลายเซ็น"}
    </button>
  ) : info?.waiting && interactive ? (
    <span className="fm-sign-wait">
      รอ {info.users.map((u) => u.name).join(", ").slice(0, 60)}
    </span>
  ) : null;
  return (
    <td rowSpan={3} colSpan={wide ? 2 : 1} className={cls}>
      {body}
    </td>
  );
}

function Sheets({ data, now, signing, interactive = false }: { data: SheetData; now: number; signing?: Signing; interactive?: boolean }) {
  const pages = pagesOf(rowsOf(data, now));
  const subject =
    data.kind === "pending"
      ? `MIN REPORT : สินค้าค้างที่ค่า MIN ≥ ${data.stuckDays} วัน (รอระบุสาเหตุ)`
      : data.single && data.rows[0]
        ? `MIN REPORT : รายงานสาเหตุสินค้าค้างที่ค่า MIN (${dt(data.rows[0].reportedAt, false)})`
        : `MIN REPORT : ประวัติรายงานสาเหตุสินค้าค้างที่ค่า MIN (${dt(data.from, false)} - ${dt(data.to, false)})`;
  return (
    <>
      {pages.map((pg, pi) => {
        // ลายเซ็นแสดงเมื่อหน้านั้นมีรายงานเดียว (เอกสารรายงานเดียว)
        const one = pg.rows.length === 1 ? pg.rows[0] : null;
        const sg = (slot: number) => one?.signs.find((s) => s.slot === slot);
        const inf = (slot: number) => (one && signing ? signing.slots.find((s) => s.slot === slot) : undefined);
        return (
          <div key={pi} className="mr-page is-fm">
            <table className="fm-tb">
              <colgroup>
                {COLS.map((w, i) => (
                  <col key={i} style={{ width: `${(w / 1023) * 100}%` }} />
                ))}
              </colgroup>
              <tbody>
                <tr className="fm-h">
                  <td rowSpan={3} colSpan={2} className="fm-logo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/picklist/ch-logo.png" alt="CH. RADIATORS CO.,LTD." draggable={false} />
                  </td>
                  <td rowSpan={3} colSpan={2} className="fm-title">
                    Improvement Plan / All
                  </td>
                  <td colSpan={4} className="fm-kv is-top">
                    <span>Customer</span>: <b>{pg.customer || "-"}</b>
                  </td>
                  <td colSpan={2} className="fm-sg">
                    Prepared
                  </td>
                  <td className="fm-sg">Checked</td>
                  <td className="fm-sg">Checked</td>
                  <td className="fm-sg">Approved</td>
                </tr>
                <tr className="fm-h">
                  <td colSpan={4} className="fm-kv">
                    <span>Supplier</span>: <b>{pg.supplier || "-"}</b>
                  </td>
                  {[1, 2, 3, 4].map((s) => (
                    <SignCell key={s} slot={s} wide={s === 1} sign={sg(s)} info={inf(s)} signing={signing} interactive={interactive} />
                  ))}
                </tr>
                <tr className="fm-h">
                  <td colSpan={4} className="fm-kv is-bot">
                    <span>Other</span>: <b>{data.stock}</b>
                  </td>
                </tr>
                <tr className="fm-h">
                  <td colSpan={8} className="fm-subject">
                    Subject : <b>{subject}</b>
                  </td>
                </tr>
                <tr className="fm-th">
                  <th rowSpan={2}>No.</th>
                  <th rowSpan={2} colSpan={2} className="is-big">
                    Problem / Request
                  </th>
                  <th rowSpan={2} colSpan={2} className="is-big">
                    Countermeasure / Action
                  </th>
                  <th colSpan={2}>In Charge</th>
                  <th colSpan={3}>Finish</th>
                  <th rowSpan={2} colSpan={3} className="is-big">
                    After action / Evidence
                  </th>
                </tr>
                <tr className="fm-th">
                  <th>Name</th>
                  <th>Sect.</th>
                  <th colSpan={2}>Plan</th>
                  <th>Actual</th>
                </tr>
                {Array.from({ length: PER_PAGE }, (_, i) => {
                  const r = pg.rows[i];
                  return (
                    <tr key={i} className={`fm-row ${i === PER_PAGE - 1 ? "is-last" : ""}`}>
                      <td className="fm-c">{r ? pg.start + i + 1 : ""}</td>
                      <td colSpan={2} className="fm-prob">
                        {r && (
                          <>
                            <b>{r.problem[0]}</b>
                            <span className="fm-red">{r.problem[1]}</span>
                            <span>{r.problem[2]}</span>
                            <small>{r.problem[3]}</small>
                          </>
                        )}
                      </td>
                      <td colSpan={2} className="fm-txt">
                        <div className="fm-clip">{r?.action}</div>
                      </td>
                      <td className="fm-c fm-sm">{r?.name}</td>
                      <td className="fm-c fm-sm">{r?.sect}</td>
                      <td colSpan={2} className="fm-c fm-sm">
                        {r?.plan}
                      </td>
                      <td className="fm-c fm-sm">{r?.actual}</td>
                      <td colSpan={3} className="fm-txt">
                        <div className="fm-clip">{r?.after}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <footer className="fm-foot">
              <span>{DOC_NO}</span>
              <span className="fm-pg">
                {pi + 1} / {pages.length}
              </span>
              <span>{DOC_DATE}</span>
            </footer>
          </div>
        );
      })}
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

// 🖨 PREVIEW: แผ่นจริงย่อให้เห็นทั้งแผ่นพอดีหน้าต่าง (กว้าง + สูง) · ซูม 100% / พอดีจอ -> EXPORT PDF (สร้างในเครื่อง) / EXCEL (จาก Server)
export function ReportPreview({
  data,
  onClose,
  onExcel,
  onPdfDone,
  signing,
  note,
}: {
  data: SheetData | null;
  onClose: () => void;
  onExcel: () => Promise<void>;
  onPdfDone?: (rows: number) => void;
  signing?: Signing;
  note?: React.ReactNode;
}) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [fit, setFit] = useState(true);
  const [busy, setBusy] = useState<"" | "pdf" | "xl">("");
  const [render, setRender] = useState(false);
  const off = useRef<HTMLDivElement>(null);
  const live = useNow();
  // เวลาอ้างอิงของเอกสาร = ตอนเปิด PREVIEW (ไม่ขยับระหว่างดู)
  const [frozen, setFrozen] = useState(0);
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => setFrozen(Date.now()), 0);
    return () => clearTimeout(t);
  }, [data]);
  const now = frozen || live;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !data) return;
    const calc = () => {
      const w = (el.clientWidth - 24) / 1123;
      const h = (el.clientHeight - 24) / 794;
      setScale(fit ? Math.min(1.25, Math.max(0.2, Math.min(w, h))) : Math.min(1.25, Math.max(0.2, w)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, fit]);

  // EXPORT PDF: วาดแผ่นขนาดจริงนอกจอ แล้วแปลงทีละหน้า
  useEffect(() => {
    if (!render || !data) return;
    let stop = false;
    (async () => {
      await new Promise((r) => setTimeout(r, 250)); // รอรูปลายเซ็นโหลด
      if (stop || !off.current) return;
      try {
        const n = await sheetsToPdf(off.current, `MIN_REPORT_${data.stock}_${data.kind === "pending" ? "ALERT" : data.single ? "REPORT" : "HISTORY"}`);
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
      title={data ? `🖨 ${data.kind === "pending" ? "MIN REPORT • PREVIEW" : data.single ? "MIN REPORT • DOCUMENT" : "MIN REPORT HISTORY • PREVIEW"} • ${data.stock}` : ""}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-ink-soft">{note ?? (data ? `${data.rows.length} รายการ · ${DOC_NO} · A4 แนวนอน · แยกหน้าตาม Customer / Supplier` : "")}</span>
          <button className="cta-btn is-gray is-sm ml-auto" onClick={() => setFit((f) => !f)} title="สลับ พอดีหน้าต่าง / เต็มความกว้าง">
            {fit ? "⤢ เต็มความกว้าง" : "⤡ พอดีหน้าต่าง"}
          </button>
          <button className="cta-btn is-gray" onClick={onClose}>
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
      <div ref={box} className={`mr-preview ${fit ? "is-fit" : ""}`}>
        {data && (
          <div className="mr-stack" style={{ "--pv": scale, "--pw": `${1123 * scale}px`, "--ph": `${794 * scale}px` } as React.CSSProperties}>
            <Sheets data={data} now={now} signing={signing} interactive />
          </div>
        )}
      </div>
      {render &&
        data &&
        createPortal(
          <div ref={off} className="mr-offscreen" aria-hidden>
            <Sheets data={data} now={now} signing={signing} />
          </div>,
          document.body,
        )}
    </Modal>
  );
}
