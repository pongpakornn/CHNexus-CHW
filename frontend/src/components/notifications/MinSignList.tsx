"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { Empty, Loading } from "@/components/layout/Page";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { dt, n0 } from "@/components/print/MinReportSheet";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { openMinSign } from "@/lib/minSign";
import { useDebounced } from "@/lib/useDebounced";
import { FlowButton, FlowModal } from "@/components/notifications/MinPending";

// ✍ รายการเอกสาร MIN REPORT ที่อยู่ใน FLOW ลายเซ็น (การ์ด "รอลงลายเซ็น" ในหน้าต่าง PENDING · กระดิ่ง › ประวัติ MIN REPORT)
//   👁 = เปิดเอกสาร (ถึงคิวเรา = กดช่องของตัวเองเพื่อเซ็น)
export type SignItem = {
  reportId: number;
  stockId: number;
  stockCode: string;
  title: string | null;
  sub: string | null;
  partName: string | null;
  customer: string | null;
  supplier: string | null;
  qty: number | null;
  stockBox: string | null;
  min: number | null;
  max: number | null;
  reasonType: string | null;
  reason: string;
  reporterName: string | null;
  reportedBy: string;
  reportedAt: string;
  flowStatus: "SIGNING" | "DONE" | null;
  nextSlot: number | null;
  doneAt: string | null;
  slotName: string;
  signs: number;
  mine: boolean;
};

export function SignChip({ r }: { r: SignItem }) {
  if (r.flowStatus === "DONE") return <span className="mrp-flow is-done">✔ ลงนามครบ{r.doneAt ? ` · ${dt(r.doneAt)}` : ""}</span>;
  if (r.mine) return <span className="mrp-flow is-mine">✍ รอคุณเซ็น ({r.slotName})</span>;
  return (
    <span className="mrp-flow is-wait">
      ⏳ รอ {r.slotName} ({r.signs} ลงแล้ว)
    </span>
  );
}

export function SignList({ rows, showStock = false }: { rows: SignItem[]; showStock?: boolean }) {
  const [flow, setFlow] = useState<SignItem | null>(null); // 🔀 ดู FLOW: เอกสารเดินถึงช่องไหน / ใครเซ็นแล้ว
  return (
    <div className="mrp-list">
      {flow && <FlowModal stkId={flow.stockId} stockCode={flow.stockCode} title={flow.title ?? undefined} reportId={flow.reportId} onClose={() => setFlow(null)} />}
      {rows.map((r, i) => (
        <div
          key={r.reportId}
          className={`mrp-row is-hist is-sign ${r.flowStatus === "DONE" ? "is-ok" : r.mine ? "is-mine" : "is-wait"}`}
          style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
        >
          <div className="mrp-main">
            <span className="mrp-no">{i + 1}</span>
            <div className="mrp-part">
              <b className={r.title ? "" : "is-none"}>
                {showStock && <em className="mrp-stk">{r.stockCode}</em>}
                {r.title || "ไม่มีรหัส"}
              </b>
              <span>{r.sub || r.partName}</span>
              <small className="mrp-nline">
                STOCK {n0(r.qty)}
                {r.stockBox ? ` · ${r.stockBox} BOX` : ""} · MIN {n0(r.min)} · MAX {n0(r.max)}
              </small>
              <div className="mrp-tags">
                {r.customer && <i>CUSTOMER : {r.customer}</i>}
                {r.supplier && <i>SUPPLIER : {r.supplier}</i>}
              </div>
            </div>
            <div className="mrp-reason">
              <small>
                รายงาน {dt(r.reportedAt)} · {r.reporterName || r.reportedBy}
              </small>
              {r.reasonType && <em className="mrp-rtype">{r.reasonType}</em>}
              <p>{r.reasonType && r.reason.startsWith(r.reasonType) ? r.reason.slice(r.reasonType.length).replace(/^\s*·\s*/, "") || "-" : r.reason}</p>
            </div>
            <div className="mrp-state">
              <SignChip r={r} />
            </div>
            <RowActions className="mrp-act">
              <FlowButton onClick={() => setFlow(r)} title="ดู FLOW: เอกสารเดินถึงช่องไหน / ใครเซ็นแล้ว" />
              <RowAction kind="view" title={r.mine ? "เปิดเอกสาร แล้วกดช่องของคุณเพื่อลงลายเซ็น" : "เปิดเอกสาร (ลายเซ็น)"} onClick={() => openMinSign(r.reportId)} />
            </RowActions>
          </div>
        </div>
      ))}
    </div>
  );
}

// 📁 กระดิ่ง › ประวัติ MIN REPORT ของฉัน: รอฉันเซ็น · กำลังเดิน FLOW · ลงนามครบแล้ว (ย้อนหลังได้)
type Tab = "ALL" | "MINE" | "WAIT" | "DONE";
const TABS: [Tab, string][] = [
  ["MINE", "รอฉันเซ็น"],
  ["WAIT", "กำลังเดิน FLOW"],
  ["DONE", "ลงนามครบแล้ว"],
  ["ALL", "ทั้งหมด"],
];
const RANGES = [30, 90, 365];

export function MinSignHistory({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<SignItem[] | null>(null);
  const [tab, setTab] = useState<Tab>("DONE");
  const [days, setDays] = useState(90);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 300);

  const load = useCallback(() => {
    api<SignItem[]>("/minreport/sign/mine", { query: { days, key: k } })
      .then(setRows)
      .catch(() => setRows([]));
  }, [days, k]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["minreport"], load);

  const of = (t: Tab) => (rows ?? []).filter((r) => (t === "ALL" ? true : t === "MINE" ? r.mine : t === "WAIT" ? r.flowStatus === "SIGNING" && !r.mine : r.flowStatus === "DONE"));
  const list = of(tab);

  return (
    <Modal
      open
      size="xl"
      title="📁 MIN REPORT • ประวัติลายเซ็นของฉัน"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="mrp-foot-note">
            <i>i</i>รายงานที่คุณรายงาน / ลงลายเซ็น / อยู่ใน FLOW · 👁 = เปิดเอกสาร
          </span>
          <button className="cta-btn is-gray ml-auto" onClick={onClose}>
            CLOSE
          </button>
        </div>
      }
    >
      <div className="mrp is-soft">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mrs-tabs" role="tablist">
            {TABS.map(([t, txt]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
                {txt}
                <b>{of(t).length}</b>
              </button>
            ))}
          </div>
          <div className="mrs-tabs">
            {RANGES.map((d) => (
              <button key={d} type="button" className={days === d ? "is-on" : ""} onClick={() => setDays(d)}>
                {d === 365 ? "1 ปี" : `${d} วัน`}
              </button>
            ))}
          </div>
          <input className="mr-search" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ค้นหา คลัง / Part Code / สาเหตุ / ผู้รายงาน" />
        </div>
        {!rows ? <Loading /> : list.length === 0 ? <Empty>{tab === "MINE" ? "ไม่มีเอกสารที่รอคุณเซ็น 🎉" : "ไม่มีรายการ"}</Empty> : <SignList rows={list} showStock />}
      </div>
    </Modal>
  );
}
