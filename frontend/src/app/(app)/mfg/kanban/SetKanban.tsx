"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { cardCount, FlowChips, FlowEditor, isReady, n0, ReadyPill, Rise, useKanbanData, useRun, type Kanban, type KanbanData, type Step } from "./shared";

// 🧩 KANBAN CONTROL › SET KANBAN
//   step 1: form (part image area left · job data right) -> SAVE = Set Flow pops up right away
//   step 2: SET FLOW = zone + number of machines (N update points auto-created) -> saved = พร้อมใช้งาน
//   table: status พร้อมใช้งาน / ยังไม่พร้อมใช้งาน · ACTION = view / edit / SET FLOW / delete (server checks rights again)
type Form = { code: string; name: string; customer: string; perBox: string; orderQty: string; zone: string; note: string };
const EMPTY: Form = { code: "", name: "", customer: "", perBox: "100", orderQty: "1000", zone: "", note: "" };
const STATUSES = ["ALL", "READY", "NOT READY"] as const;
const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : 0);

function FlowModal({ k, options, canSave, onClose, onSaved }: { k: Kanban; options: KanbanData["options"]; canSave: boolean; onClose: () => void; onSaved: () => void }) {
  const run = useRun();
  const [zone, setZone] = useState(k.steps[0]?.zone ?? k.zone ?? "");
  const [steps, setSteps] = useState<Step[]>(k.steps.length ? k.steps : [{ zone: k.zone ?? "", point: "" }]);
  const [busy, setBusy] = useState(false);
  // number of machines = number of update points (1 - 20): grows / shrinks the list, new points use the selected zone
  const setCount = (n: number) => setSteps((s) => (n > s.length ? [...s, ...Array.from({ length: n - s.length }, () => ({ zone, point: "" }))] : s.slice(0, n)));
  const zoneOpts = options.zones.map((z) => ({ value: z, label: z }));
  const ok = steps.length > 0 && steps.every((s) => s.zone.trim() && s.point.trim());

  async function save() {
    setBusy(true);
    const r = await run(`/kanban/kanbans/${k.id}/flow`, "PUT", { steps });
    setBusy(false);
    if (r) onSaved();
  }

  return (
    <Modal
      open
      wide
      title={`🔀 SET FLOW • ${k.code}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs font-bold text-ink-soft">บันทึกแล้วสถานะจะเป็น &quot;พร้อมใช้งาน&quot;</span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          {canSave && (
            <button type="button" className="btn bg-accent min-w-[160px]" disabled={busy || !ok} onClick={save}>
              {busy ? "…" : "💾 SAVE FLOW"}
            </button>
          )}
        </>
      }
    >
      <div className="kb grid gap-4">
        {/* flow overview */}
        <div className="rounded-2xl border border-line/70 bg-[radial-gradient(120%_120%_at_0%_0%,#eff6ff,transparent_60%)] p-4">
          <p className="mb-2 text-[11px] font-extrabold uppercase text-ink-soft">
            ภาพรวม FLOW · {k.name} · {n0(steps.length)} จุด
          </p>
          <FlowChips steps={steps.filter((s) => s.point.trim())} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">ZONE (ค่าเริ่มต้นของจุดใหม่)</span>
            <ComboBox value={zone} onChange={setZone} options={zoneOpts} free={(t) => t.trim().toUpperCase().slice(0, 50) || null} disabled={!canSave} ariaLabel="ZONE" placeholder="เลือก / พิมพ์ ZONE" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">จำนวนเครื่องที่ต้องการสั่งผลิต (1 - 20)</span>
            <input className="field font-mono" type="number" min={1} max={20} readOnly={!canSave} value={steps.length} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <FlowEditor steps={steps} onChange={setSteps} options={options} disabled={!canSave} />
        {options.machines.length === 0 && <p className="text-xs font-bold text-ink-soft">ยังไม่มีเครื่องจักรใน Master Data › Machine Information · พิมพ์ชื่อจุดอัพเดทหน้างานเองได้</p>}
      </div>
    </Modal>
  );
}

export default function SetKanban() {
  const toast = useToast();
  const dlg = useDialogs();
  const run = useRun();
  const { data, reload } = useKanbanData();
  const [customers, setCustomers] = useState<{ code: string; name: string | null; isActive: boolean }[]>([]);
  const [f, setF] = useState<Form>(EMPTY);
  const [row, setRow] = useState<Kanban | null>(null);
  const [view, setView] = useState(false);
  const [flowFor, setFlowFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ALL");
  const formRef = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));

  useEffect(() => {
    api<{ rows: { code: string; name: string | null; isActive: boolean }[] }>("/master/customers")
      .then((r) => setCustomers(r.rows))
      .catch(() => setCustomers([]));
  }, []);

  const can = data?.can ?? { add: false, edit: false, delete: false };
  const all = useMemo(() => data?.kanbans ?? [], [data]);
  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    return all.filter((k) => (status === "ALL" || (status === "READY") === isReady(k)) && (!t || [k.code, k.name, k.customer, k.zone].some((v) => (v ?? "").toUpperCase().includes(t))));
  }, [all, q, status]);
  const counts = { ALL: all.length, READY: all.filter(isReady).length, "NOT READY": all.filter((k) => !isReady(k)).length };
  const custOpts = useMemo(() => customers.filter((c) => c.isActive || c.code === f.customer).map((c) => ({ value: c.code, label: c.code, sub: c.name ?? undefined })), [customers, f.customer]);
  const zoneOpts = useMemo(() => (data?.options.zones ?? []).map((z) => ({ value: z, label: z })), [data]);
  const flowK = all.find((k) => k.id === flowFor) ?? null;
  const cards = cardCount(int(f.orderQty), int(f.perBox));
  const ro = view;
  const showForm = can.add || !!row;

  function reset() {
    setRow(null);
    setView(false);
    setF(EMPTY);
  }
  function open(k: Kanban, asView: boolean) {
    setRow(k);
    setView(asView);
    setF({ code: k.code, name: k.name, customer: k.customer ?? "", perBox: String(k.perBox), orderQty: String(k.orderQty), zone: k.zone ?? "", note: k.note ?? "" });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    if (!f.code.trim() || !f.name.trim()) return toast.show("WARNING", "กรุณากรอกรหัสงาน และชื่องาน", "warn");
    if (!int(f.perBox) || !int(f.orderQty)) return toast.show("WARNING", "จำนวนชิ้นงานต่อกล่อง / จำนวนที่สั่งผลิต ต้องเป็นจำนวนเต็มมากกว่า 0", "warn");
    setBusy(true);
    const body = { code: f.code, name: f.name, customer: f.customer || null, perBox: int(f.perBox), orderQty: int(f.orderQty), zone: f.zone, note: f.note };
    const r = await run<{ id: number; message: string }>(row ? `/kanban/kanbans/${row.id}` : "/kanban/kanbans", row ? "PUT" : "POST", body);
    setBusy(false);
    if (!r) return;
    const isNew = !row;
    reset();
    await reload();
    if (isNew) setFlowFor(r.id); // new Kanban -> SET FLOW right away
  }

  async function remove(k: Kanban) {
    if (k.used > 0) return toast.show("ลบไม่ได้", `Kanban ${k.code} มีประวัติการใช้งานแล้ว (สะสมยอด / รับยอด / สั่งผลิต)`, "warn");
    if (!(await dlg.confirm({ title: "DELETE KANBAN", message: `ลบ Kanban "${k.code}" (${k.name}) ?`, ok: "DELETE", danger: true }))) return;
    if (await run(`/kanban/kanbans/${k.id}`, "DELETE")) {
      if (row?.id === k.id) reset();
      reload();
    }
  }

  const fld = (label: string, node: React.ReactNode, cls = "") => (
    <label className={`block min-w-0 ${cls}`}>
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      {node}
    </label>
  );

  return (
    <PageBody className="md-gray md-partner kb">
      <PageHeader icon="/icons/PickList.png" title="SET KANBAN" subtitle="KANBAN CONTROL · ขั้นตอนที่ 1 สร้าง Kanban → ขั้นตอนที่ 2 SET FLOW = พร้อมใช้งาน" />
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          {showForm && (
            <Rise>
              <div ref={formRef} className="scroll-mt-4">
                <Card title={view ? `👁 VIEW KANBAN` : row ? `✏️ EDIT KANBAN` : "＋ SET KANBAN"} actions={row ? <ReadyPill ready={isReady(row)} /> : undefined} bodyClass="p-4 md:p-5">
                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="kb-photo mx-auto w-full max-w-[220px]">
                      <div>
                        <b aria-hidden>📦</b>
                        <p className="mt-2 font-mono text-sm font-extrabold text-primary">{f.code || "KANBAN"}</p>
                        <p className="text-[11px] font-bold">รูปภาพงาน</p>
                      </div>
                    </div>
                    <div className="grid content-start gap-3 sm:grid-cols-2">
                      {fld("รหัสงาน (KANBAN CODE) *", <input className="field font-mono font-bold uppercase" readOnly={ro} maxLength={50} value={f.code} placeholder="เช่น WB-2488-01" onChange={(e) => set({ code: e.target.value.toUpperCase() })} />)}
                      {fld("ชื่องาน *", <input className="field" readOnly={ro} maxLength={200} value={f.name} placeholder="เช่น ฝาครอบเครื่องยนต์ TR-9" onChange={(e) => set({ name: e.target.value })} />)}
                      {fld("CUSTOMER", <ComboBox value={f.customer} onChange={(v) => set({ customer: v })} options={custOpts} disabled={ro} ariaLabel="CUSTOMER" placeholder="พิมพ์ค้นหา / เลือกลูกค้า" />)}
                      {fld("ZONE", <ComboBox value={f.zone} onChange={(v) => set({ zone: v })} options={zoneOpts} free={(t) => t.trim().toUpperCase().slice(0, 50) || null} disabled={ro} ariaLabel="ZONE" placeholder="เลือก / พิมพ์ ZONE" />)}
                      {fld("จำนวนชิ้นงานต่อกล่อง *", <input className="field font-mono" inputMode="numeric" readOnly={ro} value={f.perBox} onChange={(e) => set({ perBox: e.target.value.replace(/\D/g, "") })} />)}
                      {fld("จำนวนที่สั่งผลิต (ค่าเริ่มต้น) *", <input className="field font-mono" inputMode="numeric" readOnly={ro} value={f.orderQty} onChange={(e) => set({ orderQty: e.target.value.replace(/\D/g, "") })} />)}
                      {fld(
                        "จำนวน KANBAN",
                        <div className="kb-count">
                          {n0(cards)} ใบ
                          <small>
                            = {n0(int(f.orderQty))} ÷ {n0(int(f.perBox))} (ปัดขึ้น)
                          </small>
                        </div>,
                      )}
                      {fld("หมายเหตุ", <input className="field" readOnly={ro} maxLength={300} value={f.note} placeholder="เช่น งานเร่ง กะ 2" onChange={(e) => set({ note: e.target.value })} />)}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-center">
                    <span className="min-w-0 flex-1 text-xs font-bold text-ink-soft">
                      {row ? `UPDATE DATE ${stamp(row.updatedDate)}${row.updatedBy ? ` · ${row.updatedBy}` : ""}` : "บันทึกแล้วจะเปิด SET FLOW ต่อทันที"}
                    </span>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="btn-ghost min-w-[120px]" disabled={busy} onClick={reset}>
                        {row ? "✕ CLOSE" : "↺ RESET"}
                      </button>
                      {view ? (
                        can.edit && (
                          <button type="button" className="btn bg-accent min-w-[160px]" onClick={() => setView(false)}>
                            ✏ EDIT
                          </button>
                        )
                      ) : (
                        <button type="button" className={`btn min-w-[180px] ${row ? "bg-success" : "bg-accent"}`} disabled={busy} onClick={save}>
                          {busy ? "…" : row ? "💾 SAVE CHANGES" : "💾 SAVE + SET FLOW"}
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            </Rise>
          )}

          <Rise i={1}>
            <Card title={`ตาราง KANBAN • ${n0(rows.length)}`}>
              <div className="md-toolbar">
                <div className="md-seg" role="tablist" style={{ "--n": STATUSES.indexOf(status) } as React.CSSProperties}>
                  <span className="md-seg-glider" aria-hidden />
                  {STATUSES.map((s2) => (
                    <button key={s2} type="button" role="tab" aria-selected={status === s2} className={status === s2 ? "is-on" : ""} onClick={() => setStatus(s2)}>
                      {s2}
                      <b>{n0(counts[s2])}</b>
                    </button>
                  ))}
                </div>
                <SearchBox value={key} onChange={setKey} placeholder="ค้นหา CODE / ชื่องาน / CUSTOMER / ZONE" className="md-search ml-auto w-[340px] max-w-full" />
              </div>
              {rows.length === 0 ? (
                <Empty>{all.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการ Kanban"}</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="w-14 text-center">NO.</th>
                        <th>รหัสงาน</th>
                        <th>ชื่องาน</th>
                        <th>CUSTOMER</th>
                        <th>ต่อกล่อง</th>
                        <th>สั่งผลิต</th>
                        <th>FLOW</th>
                        <th>สถานะ</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((k, i) => (
                        <tr key={k.id} className={row?.id === k.id ? "is-picked" : ""}>
                          <td data-l="NO." className="text-center">
                            {i + 1}
                          </td>
                          <td data-l="รหัสงาน" className="font-mono font-extrabold">
                            {k.code}
                          </td>
                          <td data-l="ชื่องาน" className="text-left font-semibold">
                            {k.name}
                            {k.zone && <div className="text-[11px] font-bold text-ink-soft">{k.zone}</div>}
                          </td>
                          <td data-l="CUSTOMER" title={k.customerName ?? undefined}>
                            {k.customer || "-"}
                          </td>
                          <td data-l="ต่อกล่อง" className="font-mono">
                            {n0(k.perBox)}
                          </td>
                          <td data-l="สั่งผลิต" className="font-mono">
                            {n0(k.orderQty)}
                          </td>
                          <td data-l="FLOW" className="text-left">
                            <FlowChips steps={k.steps} />
                          </td>
                          <td data-l="สถานะ">
                            <ReadyPill ready={isReady(k)} />
                          </td>
                          <td data-l="ACTION">
                            <RowActions>
                              <RowAction kind="view" active={row?.id === k.id && view} onClick={() => (row?.id === k.id && view ? reset() : open(k, true))} />
                              {can.edit && <RowAction kind="edit" active={row?.id === k.id && !view} onClick={() => (row?.id === k.id && !view ? reset() : open(k, false))} />}
                              <button type="button" className="kb-pill is-blue cursor-pointer" onClick={() => setFlowFor(k.id)} title="SET FLOW">
                                SET FLOW
                              </button>
                              {can.delete && <RowAction kind="delete" title={k.used ? "มีประวัติการใช้งานแล้ว ลบไม่ได้" : "DELETE"} onClick={() => remove(k)} />}
                            </RowActions>
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
      {flowK && data && (
        <FlowModal
          k={flowK}
          options={data.options}
          canSave={can.edit || (can.add && !isReady(flowK))}
          onClose={() => setFlowFor(null)}
          onSaved={() => {
            setFlowFor(null);
            reload();
          }}
        />
      )}
    </PageBody>
  );
}
