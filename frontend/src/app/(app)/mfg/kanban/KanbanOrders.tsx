"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { DateField } from "@/components/forms/DateField";
import { ClockField } from "@/components/forms/ClockField";
import { today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { cardCount, CardStack, FlowChips, FlowEditor, isReady, n0, Rise, useKanbanData, useRun, when, type Step } from "./shared";

// 🏭 KANBAN CONTROL › สั่งผลิต
//   pick a ready Kanban (filter by customer) · qty -> cards = qty / pcs per box (rounded up, shown as stacked cards) · planned start
//   FLOW: STANDARD = the Kanban's flow · TEMP = own points for this order only (the standard flow is not changed)
//   ?receipt=<id> (from สะสม / รับยอด) = Kanban + qty locked to the received qty · history: search / flow filter / delete (not started only)
type Mode = "STANDARD" | "TEMP";
const MODES: Mode[] = ["STANDARD", "TEMP"];
const FILTERS = ["ALL", "STANDARD", "TEMP"] as const;
const now5 = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, "0")}`;
};

export default function KanbanOrders() {
  const toast = useToast();
  const dlg = useDialogs();
  const run = useRun();
  const router = useRouter();
  const receiptId = Number(useSearchParams().get("receipt")) || null;
  const { data, reload } = useKanbanData();
  const [customer, setCustomer] = useState("");
  const [kid, setKid] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState(now5());
  const [mode, setMode] = useState<Mode>("STANDARD");
  const [temp, setTemp] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const can = data?.can ?? { add: false, edit: false, delete: false };

  const receipt = data?.receipts.find((r) => r.id === receiptId && r.status === "WAITING") ?? null;
  const ready = useMemo(() => (data?.kanbans ?? []).filter(isReady), [data]);
  const custOpts = useMemo(() => [...new Set(ready.map((k) => k.customer).filter((c): c is string => !!c))].sort().map((c) => ({ value: c, label: c })), [ready]);
  const usable = useMemo(() => ready.filter((k) => !customer || k.customer === customer), [ready, customer]);
  const sel = receipt ? (data?.kanbans.find((k) => k.id === receipt.kanbanId) ?? null) : (usable.find((k) => String(k.id) === kid) ?? null);
  const nQty = receipt ? receipt.qty : Number(qty || sel?.orderQty || 0);
  const steps = mode === "STANDARD" ? (sel?.steps ?? []) : temp;
  const cards = sel ? cardCount(nQty, sel.perBox) : 0;
  const zones = [...new Set(steps.map((s) => s.zone).filter(Boolean))];

  const orders = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (data?.orders ?? []).filter((o) => (filter === "ALL" || o.flowMode === filter) && (!t || [o.code, o.name, o.customer, `#${o.id}`].some((v) => (v ?? "").toUpperCase().includes(t))));
  }, [data, q, filter]);

  function pick(v: string) {
    setKid(v);
    setQty("");
    setMode("STANDARD");
    setTemp((ready.find((k) => String(k.id) === v)?.steps ?? []).map((s) => ({ ...s })));
  }
  function toTemp(m: Mode) {
    if (m === "TEMP" && temp.length === 0) setTemp((sel?.steps ?? []).map((s) => ({ ...s })));
    setMode(m);
  }

  async function submit() {
    if (!sel) return toast.show("WARNING", "กรุณาเลือก Kanban", "warn");
    if (!(nQty > 0)) return toast.show("WARNING", "กรุณากรอกจำนวนที่สั่งผลิต", "warn");
    if (steps.length === 0 || steps.some((s) => !s.zone.trim() || !s.point.trim())) return toast.show("WARNING", "กรุณากำหนดจุดใน FLOW ให้ครบ (ZONE + จุดอัพเดทหน้างาน)", "warn");
    if (
      !(await dlg.confirm({
        title: "ยืนยันการสั่งผลิต ?",
        message: `${sel.code} · ${n0(nQty)} ชิ้น → ${n0(cards)} ใบ Kanban\n${mode === "STANDARD" ? "FLOW มาตรฐาน" : "FLOW ชั่วคราวเฉพาะใบสั่งนี้"}: ${steps.map((s) => s.point).join(" › ")}`,
        ok: "สั่งผลิต",
      }))
    )
      return;
    setBusy(true);
    const r = await run("/kanban/orders", "POST", {
      kanbanId: sel.id,
      qty: nQty,
      flowMode: mode,
      plannedStart: date ? `${date}T${time || "00:00"}:00` : null,
      steps: mode === "TEMP" ? steps : null,
      receiptId: receipt?.id ?? null,
    });
    setBusy(false);
    if (!r) return;
    setQty("");
    setMode("STANDARD");
    if (receipt) router.replace("/mfg/kanban/orders");
    reload();
  }

  async function remove(id: number, code: string, started: boolean) {
    if (started) return toast.show("ลบไม่ได้", "ใบสั่งนี้เริ่มผลิตแล้ว", "warn");
    if (!(await dlg.confirm({ title: "ลบใบสั่งผลิต ?", message: `#${id} ${code}\nใบ Kanban ของใบสั่งนี้จะถูกลบ (ยอดที่รับไว้กลับไปรอสั่งผลิต)`, ok: "DELETE", danger: true }))) return;
    if (await run(`/kanban/orders/${id}`, "DELETE")) reload();
  }

  const lbl = (t: string) => <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{t}</span>;

  return (
    <PageBody className="md-gray md-partner kb">
      <PageHeader icon="/icons/ForecastOrder.png" title="สั่งผลิต" subtitle="KANBAN CONTROL · เปิดใบสั่งผลิต → แตกเป็นใบ Kanban ตามจำนวนต่อกล่อง" />
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          {can.add && (
            <Rise>
              <Card
                title={receipt ? `＋ สั่งผลิตจากยอดที่รับไว้ • ${receipt.code}` : "＋ เปิดใบสั่งผลิต"}
                actions={
                  receipt ? (
                    <Link href="/mfg/kanban/orders" className="btn-ghost">
                      ✕ ยกเลิก (ไม่ใช้ยอดที่รับไว้)
                    </Link>
                  ) : undefined
                }
                bodyClass="p-4 md:p-5"
                clip={false}
              >
                {receiptId && !receipt && <p className="mb-3 text-xs font-bold text-warning">ยอดที่เลือกถูกสั่งผลิตไปแล้ว หรือถูกคืนยอดแล้ว · เลือก Kanban เองด้านล่างได้</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="block min-w-0">
                    {lbl("CUSTOMER")}
                    <ComboBox value={receipt ? (sel?.customer ?? "") : customer} onChange={(v) => (setCustomer(v), setKid(""))} options={[{ value: "", label: "ลูกค้าทั้งหมด" }, ...custOpts]} disabled={!!receipt} ariaLabel="CUSTOMER" placeholder="ลูกค้าทั้งหมด" />
                  </label>
                  <label className="block min-w-0">
                    {lbl(`KANBAN (พร้อมใช้งาน ${n0(usable.length)} รายการ) *`)}
                    <ComboBox
                      value={sel ? String(sel.id) : ""}
                      onChange={pick}
                      options={usable.map((k) => ({ value: String(k.id), label: k.code, sub: `${k.name} · ${n0(k.perBox)}/กล่อง` }))}
                      disabled={!!receipt}
                      ariaLabel="KANBAN"
                      placeholder={usable.length ? "พิมพ์ค้นหา / เลือก Kanban" : "ยังไม่มี Kanban ที่พร้อมใช้งาน"}
                    />
                  </label>
                  <label className="block min-w-0">
                    {lbl("จำนวนที่สั่งผลิต (ชิ้น) *")}
                    <input className="field font-mono" inputMode="numeric" readOnly={!!receipt} value={receipt ? String(receipt.qty) : qty} placeholder={sel ? String(sel.orderQty) : "0"} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <div className="block min-w-0">
                    {lbl("จำนวน KANBAN (ปัดขึ้น)")}
                    <div className="kb-count">
                      <CardStack count={cards} />
                      <small>
                        = {n0(nQty)} ÷ {n0(sel?.perBox ?? 0)}
                      </small>
                    </div>
                  </div>
                  <DateField label="วันที่เริ่มตามแผน" value={date} onChange={setDate} />
                  <ClockField label="เวลาเริ่มตามแผน" value={time} onChange={setTime} />
                </div>

                <div className="mt-4 grid gap-3 rounded-2xl border border-line/70 p-3 md:p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[11px] font-extrabold uppercase text-ink-soft">รูปแบบ FLOW</span>
                    <div className="md-seg is-2" role="tablist" style={{ "--n": MODES.indexOf(mode) } as React.CSSProperties}>
                      <span className="md-seg-glider" aria-hidden />
                      {MODES.map((m) => (
                        <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : ""} disabled={!sel} onClick={() => toTemp(m)}>
                          {m === "STANDARD" ? "STANDARD FLOW" : "FLOW ชั่วคราว"}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs font-bold text-ink-soft">{mode === "STANDARD" ? "ใช้ FLOW หลักที่ตั้งไว้ตอน SET KANBAN" : "กำหนดจุดเฉพาะใบสั่งนี้ · ไม่ทับ FLOW มาตรฐาน"}</span>
                  </div>
                  {zones.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                      <span className="text-ink-soft">ZONE ที่เกี่ยวข้อง:</span>
                      {zones.map((z) => (
                        <span key={z} className="kb-pill is-blue">
                          {z}
                        </span>
                      ))}
                    </div>
                  )}
                  {!sel ? <Empty>เลือก Kanban ก่อน</Empty> : mode === "STANDARD" ? <FlowChips steps={steps} /> : <FlowEditor steps={temp} onChange={setTemp} options={data.options} />}
                </div>

                <div className="mt-4 flex justify-end">
                  <button type="button" className="btn bg-accent min-w-[200px]" disabled={busy || !sel} onClick={submit}>
                    {busy ? "…" : `🏭 สั่งผลิต ${cards ? `(${n0(cards)} ใบ)` : ""}`}
                  </button>
                </div>
              </Card>
            </Rise>
          )}

          <Rise i={1}>
            <Card title={`ประวัติใบสั่งผลิต • ${n0(orders.length)}/${n0(data.orders.length)}`}>
              <div className="md-toolbar">
                <div className="md-seg" role="tablist" style={{ "--n": FILTERS.indexOf(filter) } as React.CSSProperties}>
                  <span className="md-seg-glider" aria-hidden />
                  {FILTERS.map((f) => (
                    <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
                      {f}
                      <b>{n0(data.orders.filter((o) => f === "ALL" || o.flowMode === f).length)}</b>
                    </button>
                  ))}
                </div>
                <SearchBox value={key} onChange={setKey} placeholder="ค้นหา # / รหัส / ชื่องาน / ลูกค้า" className="md-search ml-auto w-[320px] max-w-full" />
              </div>
              {orders.length === 0 ? (
                <Empty>{data.orders.length ? "ไม่พบใบสั่งผลิตตามเงื่อนไข" : "ยังไม่มีใบสั่งผลิต"}</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th>ORDER</th>
                        <th>KANBAN</th>
                        <th>CUSTOMER</th>
                        <th>QTY</th>
                        <th>ใบ KANBAN</th>
                        <th>FLOW</th>
                        <th>เริ่มตามแผน</th>
                        <th>สั่งเมื่อ</th>
                        {can.delete && <th>ACTION</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const started = o.queue < o.cards;
                        return (
                          <tr key={o.id}>
                            <td data-l="ORDER" className="font-mono font-bold">
                              #{o.id}
                              {o.receiptId && <div className="kb-pill is-ok mt-1">รับยอด</div>}
                            </td>
                            <td data-l="KANBAN" className="text-left">
                              <b className="font-mono">{o.code}</b>
                              <div className="text-xs text-ink-soft">{o.name}</div>
                            </td>
                            <td data-l="CUSTOMER">{o.customer || "-"}</td>
                            <td data-l="QTY" className="font-mono">
                              {n0(o.qty)}
                            </td>
                            <td data-l="ใบ KANBAN">
                              <CardStack count={o.cards} />
                            </td>
                            <td data-l="FLOW" className="text-left">
                              <span className={`kb-pill mb-1 ${o.flowMode === "TEMP" ? "is-warn" : "is-blue"}`}>{o.flowMode === "TEMP" ? "FLOW ชั่วคราว" : "STANDARD"}</span>
                              <div>
                                <FlowChips steps={o.steps} />
                              </div>
                            </td>
                            <td data-l="เริ่มตามแผน" className="whitespace-nowrap text-xs">
                              {when(o.plannedStart)}
                            </td>
                            <td data-l="สั่งเมื่อ" className="whitespace-nowrap text-xs">
                              {when(o.createdAt)}
                              {o.createdBy && <div className="text-ink-soft">{o.createdBy}</div>}
                            </td>
                            {can.delete && (
                              <td data-l="ACTION">
                                <RowActions>
                                  <RowAction kind="delete" title={started ? "เริ่มผลิตแล้ว ลบไม่ได้" : "DELETE"} onClick={() => remove(o.id, o.code, started)} />
                                </RowActions>
                              </td>
                            )}
                          </tr>
                        );
                      })}
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
