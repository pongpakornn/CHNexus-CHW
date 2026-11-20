"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { DateRange } from "@/components/forms/DateRange";
import { Empty, Loading } from "@/components/layout/Page";
import { dt, n0, span, subOf, titleOf, useNow } from "@/components/print/MinReportSheet";
import { api } from "@/lib/api";
import { daysAgo, today } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import type { Stock } from "./types";

// 📈 MIN TRACKING (ปุ่ม MIN REPORT ของคลัง): ติดตามการเคลื่อนไหวของสินค้าที่อยู่ใต้ MIN
//   ทุกช่วงที่ใต้ MIN ในช่วงวันที่เลือก: ยังค้าง (แดง) / กลับเป็นเขียวแล้ว (เขียว) · ยอดตอนเริ่ม -> ตอนนี้ · อัพเดทกี่ครั้ง · รายงานกี่ครั้ง
//   ยังไม่เขียว = บอกเหตุผล (ยอด < MIN ขาดอีกเท่าไร · รายงานล่าสุดว่าอะไร) · กดแถว = ยอดรายวัน (วันไหน ยอดต้นวัน -> ล่าสุด · อัพเดทกี่ครั้ง · MIN / MAX)
//   ตารางหน้าตาเดียวกับตาราง Store (data-table store-table) · กาง / พับด้วย .fold (grid-template-rows + opacity) ไม่แตะความสูงตรง ๆ
//   ⚡ เรียลไทม์: ยอดเปลี่ยน / รายงาน = โหลดใหม่เอง (หัวข้อ minreport)
type Day = { day: string; firstQty: number | null; lastQty: number | null; min: number | null; max: number | null; moves: number; updatedAt: string };
type Row = {
  watchId: number;
  partId: number;
  supplier?: string | null;
  lastMoveAt: string | null;
  nextAlertAt: string | null;
  partCode: string;
  partName: string;
  title?: string | null;
  sub?: string | null;
  customer?: string | null;
  qty: number | null;
  nowQty: number | null;
  nowStatus: string | null;
  min: number | null;
  max: number | null;
  startQty: number | null;
  resolvedQty: number | null;
  belowSince: string;
  lastSeen: string;
  resolvedAt: string | null;
  days: number;
  reportCount: number;
  lastReportAt: string | null;
  lastReason: string | null;
  lastReporter: string | null;
  moves: number;
  daily: Day[];
};
type Res = { tracking: boolean; stuckDays: number; rows: Row[] };

const UNDER = new Set(["UNDER_MIN", "OUT_OF_STOCK"]);
const dd = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);
const signed = (v: number | null) => (v == null ? "-" : `${v > 0 ? "+" : ""}${n0(v)}`);

// เหตุผลที่ยังไม่เขียว (หรือเขียวแล้วเมื่อไร)
function why(r: Row, stuck: number) {
  if (r.resolvedAt) return `🟢 กลับเป็นเขียวแล้ว ${dt(r.resolvedAt)}${r.resolvedQty != null ? ` · ยอดตอนนั้น ${n0(r.resolvedQty)}` : ""}`;
  const q = r.nowQty ?? r.qty;
  const short = q != null && r.min != null ? Math.max(0, r.min - q) : null;
  const parts = [`🔴 ยังอยู่ที่ MIN: ยอด ${n0(q)} ≤ MIN ${n0(r.min)}${short ? ` (ขาดอีก ${n0(short)})` : ""}`];
  if (r.moves === 0) parts.push("ยังไม่มีการอัพเดทยอดตั้งแต่ตกใต้ MIN");
  if (r.reportCount === 0) parts.push(r.days >= stuck ? `ค้างครบ ${stuck} วันแล้ว รอรายงานสาเหตุ` : `เฝ้าดู (ครบ ${stuck} วันจะแจ้งเตือน)`);
  else {
    parts.push(`รายงานแล้ว ${r.reportCount} ครั้ง · ล่าสุด ${dt(r.lastReportAt)}${r.lastReason ? ` : ${r.lastReason}` : ""}`);
    // 🔁 ยังใต้ MIN = เตือนให้รายงานซ้ำทุกวัน จนกว่ายอดจะพ้น MIN
    if (r.nextAlertAt) parts.push(`เตือนให้รายงานซ้ำทุกวันจนกว่ายอดจะเกิน MIN · ครั้งถัดไป ${dt(r.nextAlertAt)}`);
  }
  return parts.join(" · ");
}

export function TrackingModal({ stock: s, onClose, toastErr }: { stock: Stock; onClose: () => void; toastErr: (m: string) => void }) {
  const now = useNow();
  const [from, setFrom] = useState(daysAgo(364)); // ประวัติ: ทุกรายการที่เคยใต้ MIN ในรอบ 1 ปี (เปลี่ยนช่วงได้)
  const [to, setTo] = useState(today());
  const [key, setKey] = useState("");
  const k = useDebounced(key, 300);
  const [data, setData] = useState<Res | null>(null);
  const [show, setShow] = useState<"all" | "open" | "ok">("all");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    api<Res>(`/minreport/stock/${s.stkId}/tracking`, { query: { from, to, key: k } })
      .then(setData)
      .catch((e: Error) => (toastErr(e.message), setData({ tracking: false, stuckDays: 3, rows: [] })));
  }, [s.stkId, from, to, k, toastErr]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["minreport", `store:${s.stkId}`], load);

  const rows = data?.rows ?? [];
  const nOpen = rows.filter((r) => !r.resolvedAt).length;
  const list = rows.filter((r) => (show === "all" ? true : show === "open" ? !r.resolvedAt : !!r.resolvedAt));

  return (
    <Modal
      open
      size="xl"
      title={`📈 MIN HISTORY • TRACKING • ${s.code}`}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="mrp-foot-note">
            <i>i</i>
            {data ? `${rows.length} รายการ · ยังใต้ MIN ${nOpen} · กลับเป็นเขียว ${rows.length - nOpen} · กดแถวเพื่อดูยอดรายวัน` : ""}
          </span>
          <button className="cta-btn is-gray ml-auto" onClick={onClose}>
            CLOSE
          </button>
        </div>
      }
    >
      <div className="mrp is-soft">
        <div className="flex flex-wrap items-center gap-3">
          <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
          <input className="mr-search" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ค้นหา Part Code / Part A / Part No / ชื่อ" />
          <div className="mtk-seg" role="group" aria-label="สถานะ">
            {(
              [
                ["all", `ทั้งหมด (${rows.length})`],
                ["open", `🔴 ยังใต้ MIN (${nOpen})`],
                ["ok", `🟢 เขียวแล้ว (${rows.length - nOpen})`],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" className={show === v ? "is-on" : ""} aria-pressed={show === v} onClick={() => setShow(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {data && !data.tracking && <p className="mtk-note">ยอดรายวันจะเริ่มเก็บหลังรันสคริปต์ database/nexus/47_Min_Tracking.sql</p>}
        {!data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty>ไม่มีสินค้าที่อยู่ใต้ MIN ในช่วงวันที่นี้</Empty>
        ) : (
          <div className="mt-3 max-h-[60dvh] overflow-auto rounded-2xl border border-line/60 bg-surface shadow-sm">
            <table className="data-table store-table t-center w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-16">NO</th>
                  <th className="text-left">PRODUCT</th>
                  <th className="text-right">เริ่ม</th>
                  <th className="text-right">ตอนนี้</th>
                  <th className="text-right">อัพเดท</th>
                  <th className="text-right">MIN</th>
                  <th className="text-right">MAX</th>
                  <th>ใต้ MIN ตั้งแต่</th>
                  <th className="text-left">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const title = titleOf(r);
                  const q = r.resolvedAt ? (r.resolvedQty ?? r.qty) : (r.nowQty ?? r.qty);
                  const stillUnder = !r.resolvedAt && (r.nowStatus == null || UNDER.has(r.nowStatus));
                  const isOpen = open === r.watchId;
                  const dq = diff(r.startQty, q);
                  const toggle = () => setOpen(isOpen ? null : r.watchId);
                  return (
                    <Fragment key={r.watchId}>
                      <tr
                        className={`mat-row cursor-pointer ${isOpen ? "is-open" : ""}`}
                        aria-expanded={isOpen}
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                      >
                        <td className="text-center font-bold text-ink-soft">
                          <span className="inline-flex items-center gap-2">
                            <span className={`row-chev ${isOpen ? "is-open" : ""}`} aria-hidden>
                              <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 3l5 5-5 5" />
                              </svg>
                            </span>
                            {i + 1}
                          </span>
                        </td>
                        <td className="min-w-[240px] text-left">
                          <div className="flex items-center gap-2">
                            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white" aria-hidden>
                              {r.partId > 0 && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={`/api/images/part/${r.partId}`} alt="" loading="lazy" decoding="async" draggable={false} className="size-12 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
                              )}
                            </span>
                            <div className="min-w-0">
                              <b className={`block font-extrabold ${title ? "text-primary" : "text-ink-soft"}`}>{title || "ไม่มีรหัส"}</b>
                              <span className="block font-semibold">{subOf(r)}</span>
                              {(r.customer || r.supplier) && (
                                <small className="block text-ink-soft">{[r.customer && `CUSTOMER : ${r.customer}`, r.supplier && `SUPPLIER : ${r.supplier}`].filter(Boolean).join(" · ")}</small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="text-right font-bold tabular-nums">{n0(r.startQty ?? null)}</td>
                        <td className="text-right font-bold tabular-nums">{n0(q)}</td>
                        <td className={`text-right font-bold tabular-nums ${(dq ?? 0) > 0 ? "mtk-up" : (dq ?? 0) < 0 ? "mtk-down" : ""}`}>{signed(dq)}</td>
                        <td className="text-right font-bold tabular-nums">{n0(r.min)}</td>
                        <td className="text-right font-bold tabular-nums">{n0(r.max)}</td>
                        <td className="whitespace-nowrap text-[12px] font-semibold">
                          {dt(r.belowSince)}
                          <small className="block text-ink-soft">{r.resolvedAt ? `ถึง ${dt(r.resolvedAt)} · นาน ${span(r.belowSince, r.resolvedAt, now)}` : `ค้างมา ${span(r.belowSince, null, now)}`}</small>
                          <small className="block text-ink-soft">
                            อัพเดท {r.moves} ครั้ง · รายงาน {r.reportCount} ครั้ง
                          </small>
                        </td>
                        <td className="min-w-[260px] text-left">
                          <p className={`mtk-why !m-0 ${r.resolvedAt ? "is-ok" : stillUnder ? "is-bad" : "is-wait"}`}>
                            {!r.resolvedAt && !stillUnder ? "🟡 ยอดตอนนี้พ้น MIN แล้ว รอระบบปิดรอบเฝ้าดู (ไม่เกิน 5 นาที)" : why(r, data.stuckDays)}
                          </p>
                        </td>
                      </tr>
                      {/* ยอดรายวัน: .fold = grid-template-rows 1fr/0fr + opacity (ไม่แตะ height / top) · contain กันไม่ให้ re-layout ทั้งตาราง */}
                      <tr className="hover:!bg-transparent">
                        <td colSpan={9} className="!border-0 !p-0">
                          <div className={`fold ${isOpen ? "" : "is-closed"}`} style={{ contain: "layout paint" }} aria-hidden={!isOpen}>
                            <div>
                              {/* ค้างไว้ในหน้าตลอด -> พับลงแล้วเนื้อหาไม่หายก่อนแอนิเมชันจบ */}
                              {(r.daily.length === 0 ? (
                                  <p className="mtk-note px-4 pb-3">ยังไม่มียอดรายวันของช่วงนี้ (เริ่มเก็บตั้งแต่ 14/11/2026)</p>
                                ) : (
                                  <div className="mtk-days px-4 pb-3" role="table" aria-label="ยอดรายวัน">
                                    <div className="mtk-d is-head" role="row">
                                      <span>วันที่</span>
                                      <span>ยอดต้นวัน</span>
                                      <span>ยอดล่าสุด</span>
                                      <span>เปลี่ยน</span>
                                      <span>อัพเดท</span>
                                      <span>MIN</span>
                                      <span>MAX</span>
                                      <span>ขาด MIN</span>
                                    </div>
                                    {r.daily.map((d) => {
                                      const ch = diff(d.firstQty, d.lastQty);
                                      const short = d.lastQty != null && d.min != null ? d.min - d.lastQty : null;
                                      return (
                                        <div key={d.day} className="mtk-d" role="row">
                                          <span data-l="วันที่">{dd(d.day)}</span>
                                          <span data-l="ยอดต้นวัน">{n0(d.firstQty)}</span>
                                          <span data-l="ยอดล่าสุด">{n0(d.lastQty)}</span>
                                          <span data-l="เปลี่ยน" className={ch && ch > 0 ? "mtk-up" : ch && ch < 0 ? "mtk-down" : ""}>
                                            {signed(ch)}
                                          </span>
                                          <span data-l="อัพเดท">{d.moves} ครั้ง</span>
                                          <span data-l="MIN">{n0(d.min)}</span>
                                          <span data-l="MAX">{n0(d.max)}</span>
                                          <span data-l="ขาด MIN" className={short != null && short > 0 ? "mtk-down" : "mtk-up"}>
                                            {short == null ? "-" : short > 0 ? n0(short) : "✔ ครบ"}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
