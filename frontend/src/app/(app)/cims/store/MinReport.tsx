"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ActionMenu, type MenuAction } from "@/components/menus/ActionMenu";
import { Modal } from "@/components/modals/Modal";
import { DateRange } from "@/components/forms/DateRange";
import { Empty, Loading } from "@/components/layout/Page";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { useToast } from "@/components/notifications/Toasts";
import { IC, Ico, PendingRow, type ReasonGroup } from "@/components/notifications/MinPending";
import { SignList, type SignItem } from "@/components/notifications/MinSignList";
import { ReportPreview, SLOT_NAMES, dt, n0, reasonText, span, subOf, titleOf, useNow, type MinHistory, type MinItem, type SheetData } from "@/components/print/MinReportSheet";
import { api, download } from "@/lib/api";
import { openMinSign } from "@/lib/minSign";
import { refreshNotifications } from "@/lib/support";
import { daysAgo, today } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import type { Stock } from "./types";
import { TrackingModal } from "./MinTracking";

// 📋 ปุ่ม MIN REPORT ในหน้าคลัง (ทุกคลัง): PENDING REPORT (รอระบุสาเหตุ + กำลังเฝ้าดู) · REPORT HISTORY
//   ทุกแถว: 👁 PREVIEW (เอกสาร FM-EN-04-22 รายการเดียว) · ✎ REPORT (เลือกหมายเหตุ + รายละเอียด) · PREVIEW ทั้งหมด -> PDF / EXCEL
//   ประวัติ: 👁 = เอกสารพร้อมลายเซ็น (เซ็นช่องของตัวเองได้) · สถานะ FLOW (รอเซ็นช่องไหน / ลงนามครบ)
//   ⚡ เรียลไทม์: รายงาน / เซ็น / ตั้งค่าจากเครื่องอื่น = โหลดเฉพาะรายการนี้ใหม่ (หัวข้อ minreport)
type Pending = { ready: boolean; enabled: boolean; stuckDays: number; reasons?: string[]; reasonGroups?: ReasonGroup[]; items: MinItem[]; signing?: SignItem[] };

export function MinReportMenu({ stock: s, autoOpen = false }: { stock: Stock; autoOpen?: boolean }) {
  const toast = useToast();
  const [pend, setPend] = useState<Pending | null>(null);
  const [open, setOpen] = useState<"" | "pending" | "history" | "tracking">(autoOpen ? "pending" : ""); // จากกระดิ่ง (?mr=pending) = เปิดรายการรอรายงานให้เลย

  const load = useCallback(() => {
    api<Pending>(`/minreport/stock/${s.stkId}/pending`)
      .then((d) => (setPend(d), refreshNotifications()))
      .catch(() => undefined); // keep the last data: a failed reload must not close an open REPORT box
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
        ? `สินค้าที่ค้างที่ค่า MIN ≥ ${pend.stuckDays} วัน และยังไม่ระบุสาเหตุ (${late} รายการ) + รายการที่กำลังเฝ้าดู · 👁 PREVIEW · ✎ REPORT · PDF / EXCEL`
        : "คลังนี้ยังไม่เปิดการแจ้งเตือน MIN REPORT (Admin ตั้งได้ที่ SYSTEM CONFIGURATION › CIMS › MIN REPORT)",
      color: "#dc2626",
      icon: "alert",
      onClick: () => setOpen("pending"),
    },
    {
      key: "history",
      title: "REPORT HISTORY",
      detail: `ประวัติรายงานสาเหตุของคลัง ${s.code} (ใครรายงาน · ค้างตั้งแต่ - ถึงเมื่อไร · เพราะอะไร · ลายเซ็น) · เลือกช่วงวันที่ · PDF / EXCEL`,
      color: "#6750a4",
      icon: "calendar",
      onClick: () => setOpen("history"),
    },
    {
      key: "tracking",
      title: "MIN TRACKING",
      detail: `ติดตามสินค้าที่ใต้ MIN ของคลัง ${s.code}: ค้างตั้งแต่วันไหน · ยอดเริ่ม -> ตอนนี้ อัพเดทแล้วเท่าไร · ยอดรายวัน · รายงานกี่ครั้ง · ทำไมยังไม่กลับเป็นเขียว`,
      color: "#0891b2",
      icon: "formula",
      onClick: () => setOpen("tracking"),
    },
  ];

  // stock not set up for MIN REPORT (USER MANAGEMENT › SETUP › MIN REPORT) = no button at all · hidden until loaded (no flash)
  if (!pend || !pend.enabled) return null;
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
      {open &&
        createPortal(
          open === "pending" ? (
            <PendingModal stock={s} data={pend} reload={load} onClose={() => setOpen("")} />
          ) : open === "tracking" ? (
            <TrackingModal stock={s} onClose={() => setOpen("")} toastErr={(m) => toast.show("ERROR", m, "error")} />
          ) : (
            <HistoryModal stock={s} onClose={() => setOpen("")} toastErr={(m) => toast.show("ERROR", m, "error")} />
          ),
          document.body,
        )}
    </>
  );
}

function logPdf(stkId: number, kind: string, rows: number) {
  api(`/minreport/stock/${stkId}/pdf-log`, { method: "POST", body: { kind, rows } }).catch(() => {});
}


// ---------------------------------------------------------------- ⚠ PENDING REPORT
function PendingModal({ stock: s, data, reload, onClose }: { stock: Stock; data: Pending | null; reload: () => void; onClose: () => void }) {
  const now = useNow();
  const [preview, setPreview] = useState<{ sheet: SheetData; id?: number } | null>(null);
  const [tab, setTab] = useState<"late" | "watch" | "sign">("late");
  const late = data?.items.filter((i) => i.days >= data.stuckDays) ?? [];
  const watch = data?.items.filter((i) => i.days < data.stuckDays) ?? [];
  const signing = data?.signing ?? [];
  const mineN = signing.filter((r) => r.mine).length;
  const list = tab === "late" ? late : tab === "watch" ? watch : [];
  const oldest = data?.items[0];
  const sheet = (rows: MinItem[]): SheetData => ({ kind: "pending", stock: s.code, stuckDays: data?.stuckDays ?? 3, rows });

  return (
    <>
      <Modal
        open
        size="xl"
        title={`⚠ MIN REPORT • PENDING • ${s.code}`}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mrp-foot-note">
              <i>i</i>
              {data?.enabled ? `แสดง ${tab === "sign" ? signing.length : list.length} รายการ · แจ้งเตือนเมื่อค้างที่ค่า MIN ≥ ${data.stuckDays} วัน · เอกสาร FM-EN-04-22` : ""}
            </span>
            <button className="cta-btn is-purple ml-auto" disabled={!data?.enabled || !data.items.length} onClick={() => data && setPreview({ sheet: sheet(data.items) })}>
              🖨 PREVIEW ALL • PDF / EXCEL
            </button>
            <button className="cta-btn is-gray" onClick={onClose}>
              CLOSE
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
            <span>Admin เปิดได้ที่ SYSTEM CONFIGURATION › CIMS › MIN REPORT (เลือกคลัง · จำนวนวันที่ค้าง · แจ้งเตือนซ้ำทุกกี่นาที)</span>
          </div>
        ) : (
          <div className="mrp is-soft">
            <div className="mrp-stats">
              <button type="button" className={`mrp-stat is-red ${tab === "late" ? "is-on" : ""}`} onClick={() => setTab("late")}>
                <span className="mrp-stat-ic">
                  <Ico d={IC.cart} />
                </span>
                <span className="mrp-stat-tx">
                  <small>รอรายงาน</small>
                  <b>{late.length}</b>
                  <span>ค้างที่ค่า MIN ≥ {data.stuckDays} วัน</span>
                </span>
              </button>
              <button type="button" className={`mrp-stat is-amber ${tab === "watch" ? "is-on" : ""}`} onClick={() => setTab("watch")}>
                <span className="mrp-stat-ic">
                  <Ico d={IC.cal} />
                </span>
                <span className="mrp-stat-tx">
                  <small>กำลังเฝ้าดู</small>
                  <b>{watch.length}</b>
                  <span>ยังไม่ครบ {data.stuckDays} วัน</span>
                </span>
              </button>
              <button type="button" className={`mrp-stat is-violet ${tab === "sign" ? "is-on" : ""}`} onClick={() => setTab("sign")}>
                <span className="mrp-stat-ic">
                  <Ico d={IC.pen} />
                </span>
                <span className="mrp-stat-tx">
                  <small>รออนุมัติ / รอเซ็น</small>
                  <b>{signing.length}</b>
                  <span>{mineN ? `รอคุณเซ็น ${mineN} รายการ` : "รายงานที่ยังลงนามไม่ครบ"}</span>
                </span>
              </button>
              <div className="mrp-stat is-ink">
                <span className="mrp-stat-ic">
                  <Ico d={IC.clock} />
                </span>
                <span className="mrp-stat-tx">
                  <small>ค้างนานสุด</small>
                  <b className="is-dur">{oldest ? span(oldest.belowSince, null, now || Date.parse(oldest.lastSeen)) : "-"}</b>
                  <span>{oldest ? `${titleOf(oldest) || "ไม่มีรหัส"} · ตั้งแต่ ${dt(oldest.belowSince)}` : "ไม่มีรายการ"}</span>
                </span>
              </div>
            </div>

            <div key={tab} className="adm-pane">
            {tab === "sign" ? (
              signing.length === 0 ? (
                <Empty>ไม่มีเอกสารที่รอลงลายเซ็น 🎉</Empty>
              ) : (
                <SignList rows={signing} />
              )
            ) : list.length === 0 ? (
              <Empty>{tab === "late" ? "ไม่มีรายการที่ต้องรายงาน 🎉" : "ไม่มีรายการที่กำลังเฝ้าดู"}</Empty>
            ) : (
              <div className="mrp-list">
                {list.map((it, i) => (
                  <PendingRow
                    key={it.watchId}
                    no={i + 1}
                    item={it}
                    stuckDays={data.stuckDays}
                    reasons={data.reasons}
                    groups={data.reasonGroups}
                    now={now}
                    onPreview={() => setPreview({ sheet: sheet([it]), id: it.watchId })}
                    onReported={reload}
                  />
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </Modal>
      <ReportPreview
        data={preview?.sheet ?? null}
        onClose={() => setPreview(null)}
        onExcel={async () => void (await download(`/minreport/stock/${s.stkId}/export`, { kind: "pending", ...(preview?.id ? { id: preview.id } : {}) }))}
        onPdfDone={(n) => logPdf(s.stkId, "pending", n)}
      />
    </>
  );
}

// สถานะ FLOW ลายเซ็นของรายงาน
function FlowChip({ r }: { r: MinHistory }) {
  if (r.flowStatus === "DONE") return <span className="mrp-flow is-done">✔ ลงนามครบ</span>;
  if (r.flowStatus === "SIGNING")
    return (
      <span className="mrp-flow is-wait">
        ✍ รอ {SLOT_NAMES[r.nextSlot ?? 0]} ({r.signs?.length ?? 0} ลงแล้ว)
      </span>
    );
  return null;
}

// ---------------------------------------------------------------- 📋 REPORT HISTORY
function HistoryModal({ stock: s, onClose, toastErr }: { stock: Stock; onClose: () => void; toastErr: (m: string) => void }) {
  const now = useNow();
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
        title={`📋 MIN REPORT • HISTORY • ${s.code}`}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mrp-foot-note">
              <i>i</i>
              {rows ? `${rows.length} รายงาน · 👁 = เอกสารพร้อมลายเซ็น · เอกสาร FM-EN-04-22` : ""}
            </span>
            <button className="cta-btn is-purple ml-auto" disabled={!rows?.length} onClick={() => rows && setPreview({ kind: "history", stock: s.code, from, to, rows })}>
              🖨 PREVIEW ALL • PDF / EXCEL
            </button>
            <button className="cta-btn is-gray" onClick={onClose}>
              CLOSE
            </button>
          </div>
        }
      >
        <div className="mrp is-soft">
          <div className="flex flex-wrap items-center gap-3">
            <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
            <input className="mr-search" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ค้นหา Part Code / Part A / Part No / สาเหตุ / ผู้รายงาน" />
          </div>
          {!rows ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>ยังไม่มีรายงานในช่วงวันที่นี้</Empty>
          ) : (
            <div className="mrp-list">
              {rows.map((r, i) => {
                const title = titleOf(r);
                return (
                  <div key={r.reportId} className={`mrp-row is-hist ${r.resolvedAt ? "is-ok" : "is-late"}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                    <div className="mrp-main">
                      <span className="mrp-no">{i + 1}</span>
                      <div className="mrp-part">
                        <b className={title ? "" : "is-none"}>{title || "ไม่มีรหัส"}</b>
                        <span>{subOf(r)}</span>
                        <small className="mrp-nline">
                          STOCK {n0(r.qty)}
                          {r.stockBox ? ` · ${r.stockBox} BOX` : ""} · MIN {n0(r.minQty)} · MAX {n0(r.maxQty)}
                        </small>
                        <div className="mrp-tags">
                          {r.customer && <i>CUSTOMER : {r.customer}</i>}
                          {r.supplier && <i>SUPPLIER : {r.supplier}</i>}
                        </div>
                      </div>
                      <div className="mrp-period">
                        <small>ค้างที่ค่า MIN</small>
                        <b>{span(r.belowSince, r.resolvedAt, now || Date.parse(r.lastSeen ?? r.reportedAt))}</b>
                        <span>
                          {dt(r.belowSince)} → {r.resolvedAt ? dt(r.resolvedAt) : "ปัจจุบัน"}
                        </span>
                        <span>อัพเดทล่าสุด {dt(r.resolvedAt ?? r.lastSeen)}</span>
                      </div>
                      <div className="mrp-reason">
                        <small>
                          รายงาน {dt(r.reportedAt)} · {r.reporterName || r.reportedBy}
                          {r.section ? ` (${r.section})` : ""} · ตอนนั้นค้างมา {span(r.belowSince, r.reportedAt, 0)}
                        </small>
                        {r.reasonType && <em className="mrp-rtype">{r.reasonType}</em>}
                        <p>{r.reasonType && r.reason.startsWith(r.reasonType) ? r.reason.slice(r.reasonType.length).replace(/^\s*·\s*/, "") || "-" : reasonText(r)}</p>
                      </div>
                      <div className="mrp-state">
                        {r.resolvedAt ? <span className="is-ok">● กลับมาปกติ</span> : <span className="is-bad">● ยังค้างที่ MIN</span>}
                        <FlowChip r={r} />
                      </div>
                      <RowActions className="mrp-act">
                        <RowAction kind="view" title="เปิดเอกสาร (ลายเซ็น / ลงลายเซ็น)" onClick={() => openMinSign(r.reportId)} />
                      </RowActions>
                    </div>
                  </div>
                );
              })}
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
