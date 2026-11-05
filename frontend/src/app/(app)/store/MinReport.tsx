"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionMenu, type MenuAction } from "@/components/menus/ActionMenu";
import { Modal } from "@/components/modals/Modal";
import { DateRange } from "@/components/forms/DateRange";
import { Empty, Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { MinItemCard } from "@/components/notifications/MinReportAlert";
import { ReportPreview, days, dt, n0, who, type MinHistory, type MinItem, type SheetData } from "@/components/print/MinReportSheet";
import { api, download } from "@/lib/api";
import { daysAgo, today } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import type { Stock } from "./types";

// 📋 ปุ่ม MIN REPORT ในหน้าคลัง (ทุกคลัง): รายงานที่แจ้งเตือนอยู่ (ยังไม่ระบุสาเหตุ) · ประวัติรายงาน -> PREVIEW PDF / EXCEL
type Pending = { ready: boolean; enabled: boolean; stuckDays: number; items: MinItem[] };

export function MinReportMenu({ stock: s }: { stock: Stock }) {
  const toast = useToast();
  const [pend, setPend] = useState<Pending | null>(null);
  const [open, setOpen] = useState<"" | "pending" | "history">("");

  const load = useCallback(() => {
    api<Pending>(`/minreport/stock/${s.stkId}/pending`)
      .then(setPend)
      .catch(() => setPend(null));
  }, [s.stkId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["minreport"], load);

  const late = pend?.items.filter((i) => i.days >= pend.stuckDays).length ?? 0;
  const actions: MenuAction[] = [
    {
      key: "pending",
      title: late ? `PENDING REPORT (${late})` : "PENDING REPORT",
      detail: pend?.enabled
        ? `สินค้าที่ค้างที่ค่า MIN ≥ ${pend.stuckDays} วัน และยังไม่ระบุสาเหตุ (${late} รายการ) + รายการที่กำลังเฝ้าดู · กด REPORT เพื่อระบุสาเหตุ · PREVIEW PDF / EXCEL`
        : "คลังนี้ยังไม่เปิดการแจ้งเตือน MIN REPORT (Admin ตั้งได้ที่ User Management › SETUP › MIN REPORT)",
      color: "#dc2626",
      icon: "alert",
      onClick: () => setOpen("pending"),
    },
    {
      key: "history",
      title: "REPORT HISTORY",
      detail: `ประวัติรายงานสาเหตุของคลัง ${s.code} (ใครรายงาน · เมื่อไร · ค้างกี่วัน · เพราะอะไร) · เลือกช่วงวันที่ · PREVIEW PDF / EXCEL`,
      color: "#6750a4",
      icon: "calendar",
      onClick: () => setOpen("history"),
    },
  ];

  return (
    <>
      <ActionMenu
        actions={actions}
        caption={["MIN REPORT", late ? `⚠ รอรายงาน ${late} รายการ` : "แจ้งเตือน · ประวัติ"]}
        fabColor={late ? "linear-gradient(145deg,#f87171,#dc2626)" : "linear-gradient(145deg,#fb923c,#ea580c)"}
        label="MIN REPORT"
        fab={
          <span className="relative grid place-items-center">
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 4h8M9 2.8h6v2.4H9z" />
              <path d="M6.5 4H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-1.5" />
              <path d="M8 16.5l2.5-3 2.5 2 3-4.5" />
            </svg>
            {late > 0 && <span className="mr-badge">{late > 99 ? "99+" : late}</span>}
          </span>
        }
      />
      {open === "pending" && <PendingModal stock={s} data={pend} reload={load} onClose={() => setOpen("")} />}
      {open === "history" && <HistoryModal stock={s} onClose={() => setOpen("")} toastErr={(m) => toast.show("ERROR", m, "error")} />}
    </>
  );
}

function logPdf(stkId: number, kind: string, rows: number) {
  api(`/minreport/stock/${stkId}/pdf-log`, { method: "POST", body: { kind, rows } }).catch(() => {});
}

function PendingModal({ stock: s, data, reload, onClose }: { stock: Stock; data: Pending | null; reload: () => void; onClose: () => void }) {
  const [preview, setPreview] = useState<SheetData | null>(null);
  const late = data?.items.filter((i) => i.days >= data.stuckDays) ?? [];
  const watch = data?.items.filter((i) => i.days < data.stuckDays) ?? [];
  return (
    <>
      <Modal
        open
        size="xl"
        title={`⚠ PENDING REPORT • ${s.code}`}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-ink-soft">{data?.enabled ? `แจ้งเตือนเมื่อค้างที่ MIN ≥ ${data.stuckDays} วัน` : ""}</span>
            <button className="cta-btn is-gray ml-auto" onClick={onClose}>
              CLOSE
            </button>
            <button className="cta-btn is-purple" disabled={!data?.enabled || !data.items.length} onClick={() => data && setPreview({ kind: "pending", stock: s.code, stuckDays: data.stuckDays, rows: data.items })}>
              🖨 PREVIEW PDF / EXCEL
            </button>
          </div>
        }
      >
        {!data ? (
          <Loading />
        ) : !data.ready ? (
          <Empty>ฐานข้อมูลยังไม่มีตาราง MIN REPORT</Empty>
        ) : !data.enabled ? (
          <div className="mr-off">
            <b>คลัง {s.code} ยังไม่เปิดการแจ้งเตือน MIN REPORT</b>
            <span>Admin เปิดได้ที่ User Management › SETUP › MIN REPORT (เลือกคลัง · จำนวนวันที่ค้าง · แจ้งเตือนซ้ำทุกกี่นาที)</span>
          </div>
        ) : data.items.length === 0 ? (
          <Empty>ไม่มีสินค้าที่ค้างอยู่ที่ค่า MIN ในคลังนี้ 🎉</Empty>
        ) : (
          <div className="grid gap-4">
            <section className="grid gap-2">
              <h4 className="mr-h4 is-red">
                รอรายงาน · ค้าง ≥ {data.stuckDays} วัน <span>{late.length}</span>
              </h4>
              {late.length === 0 ? <p className="text-sm font-bold text-ink-soft">ไม่มีรายการที่ต้องรายงาน</p> : late.map((it) => <MinItemCard key={it.watchId} item={it} stuckDays={data.stuckDays} showStock={false} onReported={reload} />)}
            </section>
            {watch.length > 0 && (
              <section className="grid gap-2">
                <h4 className="mr-h4">
                  กำลังเฝ้าดู · ยังไม่ครบ {data.stuckDays} วัน <span>{watch.length}</span>
                </h4>
                {watch.map((it) => (
                  <MinItemCard key={it.watchId} item={it} stuckDays={data.stuckDays} showStock={false} onReported={reload} />
                ))}
              </section>
            )}
          </div>
        )}
      </Modal>
      <ReportPreview
        data={preview}
        onClose={() => setPreview(null)}
        onExcel={async () => void (await download(`/minreport/stock/${s.stkId}/export`, { kind: "pending" }))}
        onPdfDone={(n) => logPdf(s.stkId, "pending", n)}
      />
    </>
  );
}

function HistoryModal({ stock: s, onClose, toastErr }: { stock: Stock; onClose: () => void; toastErr: (m: string) => void }) {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [key, setKey] = useState("");
  const k = useDebounced(key, 300);
  const [rows, setRows] = useState<MinHistory[] | null>(null);
  const [preview, setPreview] = useState<SheetData | null>(null);

  const load = useCallback(() => {
    api<MinHistory[]>(`/minreport/stock/${s.stkId}/history`, { query: { from, to, key: k } })
      .then(setRows)
      .catch((e: Error) => (toastErr(e.message), setRows([])));
  }, [s.stkId, from, to, k, toastErr]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["minreport"], load);

  return (
    <>
      <Modal
        open
        size="xl"
        title={`📋 REPORT HISTORY • ${s.code}`}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-ink-soft">{rows ? `${rows.length} รายงาน` : ""}</span>
            <button className="cta-btn is-gray ml-auto" onClick={onClose}>
              CLOSE
            </button>
            <button className="cta-btn is-purple" disabled={!rows?.length} onClick={() => rows && setPreview({ kind: "history", stock: s.code, from, to, rows })}>
              🖨 PREVIEW PDF / EXCEL
            </button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
            <input className="mr-search" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ค้นหา Part Code / Name / สาเหตุ / ผู้รายงาน" />
          </div>
          {!rows ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>ยังไม่มีรายงานในช่วงวันที่นี้</Empty>
          ) : (
            <div className="mr-hist">
              {rows.map((r) => (
                <div key={r.reportId} className="mr-hrow">
                  <div className="mr-hwhen">
                    <b>{dt(r.reportedAt)}</b>
                    <small>{who(r)}</small>
                  </div>
                  <div className="mr-hpart">
                    <b>{r.partCode}</b>
                    <span>{r.partName}</span>
                    <small>
                      STOCK {n0(r.qty)}
                      {r.stockBox ? ` · ${r.stockBox} BOX` : ""} · MIN {n0(r.minQty)} · MAX {n0(r.maxQty)}
                    </small>
                  </div>
                  <div className="mr-hdays">
                    <span className="mr-days">{days(Number(r.daysStuck))}</span>
                    <small>ตั้งแต่ {dt(r.belowSince)}</small>
                  </div>
                  <div className="mr-hreason">{r.reason}</div>
                  <div className={`mr-hstate ${r.resolvedAt ? "is-ok" : ""}`}>{r.resolvedAt ? `● ปกติแล้ว ${dt(r.resolvedAt)}` : "● ยังค้างที่ MIN"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
      <ReportPreview
        data={preview}
        onClose={() => setPreview(null)}
        onExcel={async () => void (await download(`/minreport/stock/${s.stkId}/export`, { kind: "history", from, to, key: k }))}
        onPdfDone={(n) => logPdf(s.stkId, "history", n)}
      />
    </>
  );
}
