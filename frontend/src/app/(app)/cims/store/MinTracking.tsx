"use client";

import { useCallback, useEffect, useState } from "react";
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
//   ⚡ เรียลไทม์: ยอดเปลี่ยน / รายงาน = โหลดใหม่เอง (หัวข้อ minreport)
type Day = { day: string; firstQty: number | null; lastQty: number | null; min: number | null; max: number | null; moves: number; updatedAt: string };
type Row = {
  watchId: number;
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
  const parts = [`🔴 ยังใต้ MIN: ยอด ${n0(q)} < MIN ${n0(r.min)}${short ? ` (ขาดอีก ${n0(short)})` : ""}`];
  if (r.moves === 0) parts.push("ยังไม่มีการอัพเดทยอดตั้งแต่ตกใต้ MIN");
  if (r.reportCount === 0) parts.push(r.days >= stuck ? `ค้างครบ ${stuck} วันแล้ว รอรายงานสาเหตุ` : `เฝ้าดู (ครบ ${stuck} วันจะแจ้งเตือน)`);
  else parts.push(`รายงานแล้ว ${r.reportCount} ครั้ง · ล่าสุด ${dt(r.lastReportAt)}${r.lastReason ? ` : ${r.lastReason}` : ""}`);
  return parts.join(" · ");
}

export function TrackingModal({ stock: s, onClose, toastErr }: { stock: Stock; onClose: () => void; toastErr: (m: string) => void }) {
  const now = useNow();
  const [from, setFrom] = useState(daysAgo(29));
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
      title={`📈 MIN TRACKING • ${s.code}`}
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
          <div className="mrp-list">
            {list.map((r, i) => {
              const title = titleOf(r);
              const q = r.resolvedAt ? (r.resolvedQty ?? r.qty) : (r.nowQty ?? r.qty);
              const stillUnder = !r.resolvedAt && (r.nowStatus == null || UNDER.has(r.nowStatus));
              const isOpen = open === r.watchId;
              return (
                <div key={r.watchId} className={`mrp-row is-hist mtk-row ${r.resolvedAt ? "is-ok" : "is-late"} ${isOpen ? "is-open" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <button type="button" className="mrp-main mtk-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.watchId)}>
                    <span className="mrp-no">{i + 1}</span>
                    <div className="mrp-part">
                      <b className={title ? "" : "is-none"}>{title || "ไม่มีรหัส"}</b>
                      <span>{subOf(r)}</span>
                      <div className="mrp-tags">{r.customer && <i>CUSTOMER : {r.customer}</i>}</div>
                    </div>
                    <div className="mrp-nums">
                      <span>
                        <small>เริ่ม</small>
                        <b>{n0(r.startQty ?? null)}</b>
                      </span>
                      <span>
                        <small>{r.resolvedAt ? "ตอนเขียว" : "ตอนนี้"}</small>
                        <b>{n0(q)}</b>
                      </span>
                      <span className={(diff(r.startQty, q) ?? 0) > 0 ? "mtk-up" : (diff(r.startQty, q) ?? 0) < 0 ? "mtk-down" : ""}>
                        <small>อัพเดท</small>
                        <b>{signed(diff(r.startQty, q))}</b>
                      </span>
                      <span className="is-min">
                        <small>MIN</small>
                        <b>{n0(r.min)}</b>
                      </span>
                      <span>
                        <small>MAX</small>
                        <b>{n0(r.max)}</b>
                      </span>
                    </div>
                    <div className="mrp-time">
                      <small>ใต้ MIN ตั้งแต่</small>
                      <b>{dt(r.belowSince)}</b>
                      <small>{r.resolvedAt ? `นาน ${span(r.belowSince, r.resolvedAt, now)}` : `ค้างมา ${span(r.belowSince, null, now)}`}</small>
                      <small>
                        อัพเดท {r.moves} ครั้ง · รายงาน {r.reportCount} ครั้ง
                      </small>
                    </div>
                  </button>
                  <p className={`mtk-why ${r.resolvedAt ? "is-ok" : stillUnder ? "is-bad" : "is-wait"}`}>
                    {!r.resolvedAt && !stillUnder ? "🟡 ยอดตอนนี้พ้น MIN แล้ว รอระบบปิดรอบเฝ้าดู (ไม่เกิน 5 นาที)" : why(r, data.stuckDays)}
                  </p>
                  <div className={`fold ${isOpen ? "" : "is-closed"}`}>
                    <div>
                      {r.daily.length === 0 ? (
                        <p className="mtk-note">ยังไม่มียอดรายวันของช่วงนี้ (เริ่มเก็บตั้งแต่ 14/11/2026)</p>
                      ) : (
                        <div className="mtk-days" role="table" aria-label="ยอดรายวัน">
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
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
