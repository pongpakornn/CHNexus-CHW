"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { useDebounced } from "@/lib/useDebounced";
import { CardStack, formulaCards, formulaOf, n0, Rise, useKanbanData, useRun, when, type Kanban } from "./shared";

// 📥 KANBAN › สะสมยอด / รับยอด (one page)
//   สะสมยอด: sales scan history (+qty) per Kanban · target per Kanban + AUTO (reaches target = received automatically)
//   รับยอด : accumulated >= target -> RECEIVE moves the target qty to "รอสั่งผลิต" (extra stays accumulated)
//   รอสั่งผลิต: สั่งผลิต (opens the order page with this qty) · คืนยอด (back to accumulated)
function TargetBox({ k, canEdit }: { k: Kanban; canEdit: boolean }) {
  const run = useRun();
  const [v, setV] = useState(String(k.target)); // parent keys this box by target -> resets when the saved target changes
  const save = (target: number, auto: boolean) => run(`/kanban/kanbans/${k.id}/rule`, "PUT", { target, auto });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block w-[150px]">
        <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">ยอดที่กำหนด (ชิ้น)</span>
        <input
          className="field font-mono"
          inputMode="numeric"
          readOnly={!canEdit}
          value={v}
          onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
          onBlur={() => canEdit && Number(v || 0) !== k.target && save(Number(v || 0), k.auto)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <button type="button" role="switch" aria-checked={k.auto} disabled={!canEdit} className={`sw ${k.auto ? "is-on" : ""}`} onClick={() => save(Number(v || 0), !k.auto)} title="AUTO = ถึงยอดที่กำหนดแล้วรับยอดให้อัตโนมัติ">
        <span className="sw-track" />
        AUTO {k.auto ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export default function StockReceive() {
  const toast = useToast();
  const dlg = useDialogs();
  const run = useRun();
  const { data, reload } = useKanbanData();
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200);
  const [scanK, setScanK] = useState("");
  const [qty, setQty] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const can = data?.can ?? { add: false, edit: false, delete: false };

  const kanbans = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (data?.kanbans ?? []).filter((k) => !t || [k.code, k.partA, k.partNo, k.name, k.customer].some((v) => (v ?? "").toUpperCase().includes(t)));
  }, [data, q]);
  const waiting = useMemo(() => (data?.receipts ?? []).filter((r) => r.status === "WAITING"), [data]);
  const history = useMemo(() => (data?.receipts ?? []).filter((r) => r.status === "ORDERED").slice(0, 30), [data]);
  const kOpts = useMemo(() => (data?.kanbans ?? []).map((k) => ({ value: String(k.id), label: k.code, sub: k.name })), [data]);

  async function addScan() {
    if (!scanK) return toast.show("WARNING", "กรุณาเลือก Kanban", "warn");
    if (!(Number(qty) > 0)) return toast.show("WARNING", "กรุณากรอกจำนวน (มากกว่า 0)", "warn");
    setBusy(true);
    const r = await run("/kanban/scans", "POST", { kanbanId: Number(scanK), qty: Number(qty), ref });
    setBusy(false);
    if (r) {
      setQty("");
      setRef("");
      reload();
    }
  }

  async function receive(k: Kanban) {
    const extra = k.acc - k.target;
    if (!(await dlg.confirm({ title: `รับยอด ${n0(k.target)} ชิ้น ?`, message: `${k.code} · ยอดสะสม ${n0(k.acc)} ชิ้น${extra > 0 ? `\nส่วนเกิน ${n0(extra)} ชิ้นยังสะสมอยู่หน้านี้` : ""}`, ok: "RECEIVE" }))) return;
    if (await run("/kanban/receipts", "POST", { kanbanId: k.id, qty: k.target })) reload();
  }

  async function giveBack(id: number, code: string, n: number) {
    if (!(await dlg.confirm({ title: "คืนยอด ?", message: `คืน ${code} ${n0(n)} ชิ้นกลับไปที่ยอดสะสม`, ok: "RETURN", danger: true }))) return;
    if (await run(`/kanban/receipts/${id}`, "DELETE")) reload();
  }

  async function delScan(id: number, code: string, n: number) {
    if (!(await dlg.confirm({ title: "ลบประวัติยอดสะสม ?", message: `${code} +${n0(n)} ชิ้น`, ok: "DELETE", danger: true }))) return;
    if (await run(`/kanban/scans/${id}`, "DELETE")) reload();
  }

  return (
    <PageBody className="md-gray md-partner kb">
      <PageHeader icon="/icons/MultiScanner.png" title="สะสมยอด / รับยอด" subtitle="KANBAN · สะสมยอดขาย (StockFG) → ถึงยอดที่กำหนด = รับยอด → รอสั่งผลิต" />
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          {/* waiting for production order */}
          <Rise>
            <Card title={`📦 ยอดรอสั่งผลิต • ${n0(waiting.length)}`}>
              {waiting.length === 0 ? (
                <Empty>ยังไม่มียอดรอสั่งผลิต · กดรับยอดจากยอดสะสมด้านล่าง</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead>
                      <tr>
                        <th>KANBAN</th>
                        <th>CUSTOMER</th>
                        <th>QTY</th>
                        <th>ใบ KANBAN</th>
                        <th>รับเมื่อ</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waiting.map((r) => (
                        <tr key={r.id}>
                          <td data-l="KANBAN" className="text-left">
                            <b className="font-mono">{r.code}</b> {r.isAuto && <span className="kb-pill is-blue ml-1">AUTO</span>}
                            <div className="text-xs text-ink-soft">{r.name}</div>
                          </td>
                          <td data-l="CUSTOMER">{r.customer || "-"}</td>
                          <td data-l="QTY" className="font-mono font-bold">
                            {n0(r.qty)}
                          </td>
                          <td data-l="ใบ KANBAN">
                            <CardStack count={formulaCards(r.qty, r.perBox, formulaOf(data.kanbans.find((k) => k.id === r.kanbanId), data.formulas))} />
                          </td>
                          <td data-l="รับเมื่อ" className="whitespace-nowrap text-xs">
                            {when(r.receivedAt)}
                            {r.receivedBy && <div className="text-ink-soft">{r.receivedBy}</div>}
                          </td>
                          <td data-l="ACTION">
                            <div className="flex flex-wrap justify-center gap-2">
                              {can.delete && (
                                <button type="button" className="btn-ghost" onClick={() => giveBack(r.id, r.code, r.qty)}>
                                  ↩ คืนยอด
                                </button>
                              )}
                              {can.add && (
                                <Link href={`/mfg/kanban/orders?receipt=${r.id}`} className="btn bg-accent">
                                  สั่งผลิต →
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </Rise>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* accumulated per Kanban */}
            <Rise i={1}>
              <Card title={`ยอดสะสมต่อ KANBAN • ${n0(kanbans.length)}`} actions={<SearchBox value={key} onChange={setKey} placeholder="ค้นหา CODE / PART / PRODUCT NAME" className="w-[240px] max-w-full" />} bodyClass="p-3 md:p-4">
                {kanbans.length === 0 ? (
                  <Empty>{data.kanbans.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มี Kanban · สร้างที่ KANBAN MANAGEMENT"}</Empty>
                ) : (
                  <div className="grid gap-3">
                    {kanbans.map((k) => {
                      const ready = k.target > 0 && k.acc >= k.target;
                      const pct = k.target > 0 ? Math.min(100, (k.acc / k.target) * 100) : 0;
                      return (
                        <div key={k.id} className={`kb-acc ${ready ? "is-ready" : ""}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <b className="font-mono">{k.code}</b>
                            <span className="min-w-0 truncate text-sm font-semibold">{k.name}</span>
                            <span className="text-xs font-bold text-ink-soft">{k.customer || ""}</span>
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <TargetBox key={`${k.id}-${k.target}`} k={k} canEdit={can.edit} />
                            <div className="min-w-[180px] flex-1">
                              <div className="mb-1 flex justify-between text-xs font-bold">
                                <span className="text-ink-soft">ยอดสะสม</span>
                                <span className={`font-mono ${ready ? "text-success" : ""}`}>
                                  {n0(k.acc)} / {n0(k.target)}
                                </span>
                              </div>
                              <span className="kb-track block">
                                <span className={`kb-fill block ${ready ? "is-ok" : ""}`} style={{ width: `${pct}%` }} />
                              </span>
                            </div>
                            {can.add && (
                              <button type="button" className="btn bg-accent min-w-[120px]" disabled={!ready} onClick={() => receive(k)} title={ready ? "" : "ยอดสะสมยังไม่ถึงยอดที่กำหนด"}>
                                ✔ รับยอด
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </Rise>

            {/* add accumulated qty + history */}
            <Rise i={2}>
              <Card title="＋ บันทึกยอดสะสม (สแกนขาย)" bodyClass="p-4" clip={false}>
                {can.add && (
                  <div className="grid gap-3">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">KANBAN *</span>
                      <ComboBox value={scanK} onChange={setScanK} options={kOpts} ariaLabel="KANBAN" placeholder="พิมพ์ค้นหา / เลือก Kanban (CODE / PART)" />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block min-w-0">
                        <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">จำนวนที่ขายออก *</span>
                        <input className="field font-mono" inputMode="numeric" value={qty} placeholder="จำนวนชิ้น" onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && addScan()} />
                      </label>
                      <label className="block min-w-0">
                        <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">เลขที่เอกสาร</span>
                        <input className="field font-mono uppercase" maxLength={50} value={ref} placeholder="เลขที่เอกสารอ้างอิง (ถ้ามี)" onChange={(e) => setRef(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && addScan()} />
                      </label>
                    </div>
                    <button type="button" className="btn bg-accent" disabled={busy} onClick={addScan}>
                      {busy ? "…" : "＋ เพิ่มยอดสะสม"}
                    </button>
                  </div>
                )}
                <p className="mb-2 mt-4 text-[11px] font-extrabold uppercase text-ink-soft">ประวัติล่าสุด</p>
                {data.scans.length === 0 ? (
                  <Empty>ยังไม่มีประวัติ</Empty>
                ) : (
                  <ul className="grid max-h-[420px] gap-1.5 overflow-auto">
                    {data.scans.slice(0, 50).map((s) => (
                      <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line/60 px-3 py-2 text-sm">
                        <b className="font-mono">{s.code}</b>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                          {s.ref || "-"} · {when(s.at)}
                          {s.by ? ` · ${s.by}` : ""}
                        </span>
                        <b className="font-mono text-success">+{n0(s.qty)}</b>
                        {can.delete && (
                          <button type="button" className="kb-step-x" aria-label="ลบ" onClick={() => delScan(s.id, s.code, s.qty)}>
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
          </div>

          <Rise i={3}>
            <Card title={`ประวัติการรับยอด (สั่งผลิตแล้ว) • ${n0(history.length)}`}>
              {history.length === 0 ? (
                <Empty>—</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead>
                      <tr>
                        <th>KANBAN</th>
                        <th>QTY</th>
                        <th>รับเมื่อ</th>
                        <th>ใบสั่งผลิต</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((r) => (
                        <tr key={r.id}>
                          <td data-l="KANBAN" className="text-left">
                            <b className="font-mono">{r.code}</b> <span className="text-xs text-ink-soft">{r.name}</span>
                          </td>
                          <td data-l="QTY" className="font-mono">
                            {n0(r.qty)}
                          </td>
                          <td data-l="รับเมื่อ" className="text-xs">
                            {when(r.receivedAt)}
                          </td>
                          <td data-l="ใบสั่งผลิต">
                            <span className="kb-pill is-ok">#{r.orderId}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </Rise>
        </div>
      )}
    </PageBody>
  );
}
