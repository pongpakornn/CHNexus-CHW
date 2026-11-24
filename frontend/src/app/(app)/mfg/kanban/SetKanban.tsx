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
import { FlowPreview } from "./FlowPreview";
import { cardCount, FlowChips, FlowEditor, isReady, KanbanCard, n0, PartImg, ReadyPill, Rise, useKanbanData, useParts, useRun, type Kanban, type KanbanData, type Part, type Step } from "./shared";

// 🧩 KANBAN › KANBAN MANAGEMENT
//   step 1: form (part picture left · job data · card preview like the Pick List) -> SAVE = Set Flow pops up right away
//     CUSTOMER filters the parts · PART A / PART NO / PRODUCT NAME = one Part Information row: type to search, pick one = the other two + picture fill in
//   step 2: SET FLOW = zone + number of machines (N update points auto-created) -> saved = พร้อมใช้งาน
//   table: status พร้อมใช้งาน / ยังไม่พร้อมใช้งาน (รอ SET FLOW) · row click = preview · ACTION = view / edit / SET FLOW / delete (server checks rights again)
type Form = { code: string; partId: number | null; customer: string; perBox: string; orderQty: string; zone: string; note: string };
const EMPTY: Form = { code: "", partId: null, customer: "", perBox: "100", orderQty: "1000", zone: "", note: "" };
const STATUSES = ["ALL", "READY", "NOT READY"] as const;
const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : 0);
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

function FlowModal({ k, options, canSave, onClose, onSaved }: { k: Kanban; options: KanbanData["options"]; canSave: boolean; onClose: () => void; onSaved: () => void }) {
  const run = useRun();
  const [zone, setZone] = useState(k.steps[0]?.zone ?? k.zone ?? "");
  const [steps, setSteps] = useState<Step[]>(k.steps.length ? k.steps : [{ zone: k.zone ?? "", point: "" }]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  // number of machines = number of update points (1 - 20): grows / shrinks the list, new points use the selected zone
  const setCount = (n: number) => setSteps((s) => (n > s.length ? [...s, ...Array.from({ length: n - s.length }, () => ({ zone, point: "" }))] : s.slice(0, n)));
  const zoneOpts = options.zones.map((z) => ({ value: z, label: z, sub: options.zoneInfo.find((x) => x.code === z)?.name ?? undefined }));
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
          <button type="button" className="btn-ghost min-w-[130px]" disabled={!steps.some((s) => s.zone.trim())} onClick={() => setPreview(true)}>
            👁 PREVIEW
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
            ภาพรวม FLOW · {k.partA || k.code} · {n0(steps.length)} จุด
          </p>
          <FlowChips steps={steps.filter((s) => s.point.trim())} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">ZONE (ค่าเริ่มต้นของจุดใหม่)</span>
            <ComboBox
              value={zone}
              onChange={setZone}
              options={zoneOpts}
              free={options.zoneMaster ? undefined : (t) => t.trim().toUpperCase().slice(0, 50) || null}
              disabled={!canSave}
              ariaLabel="ZONE"
              placeholder={options.zoneMaster ? "เลือก ZONE" : "เลือก / พิมพ์ ZONE"}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">จำนวนจุดใน FLOW (1 - 20)</span>
            <input className="field font-mono" type="number" min={1} max={20} readOnly={!canSave} value={steps.length} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <FlowEditor steps={steps} onChange={setSteps} options={options} disabled={!canSave} />
        <p className="text-xs font-bold text-ink-soft">
          {options.zoneMaster
            ? "ZONE / สถานีงาน มาจาก Master Data › Zone & Workstation Information · เลือก ALL = งานกระจายไปทุกสถานีงานของโซนพร้อมกัน"
            : "ยังไม่มี Zone & Workstation Information · เลือกเครื่องจักร หรือพิมพ์ชื่อจุดเองได้"}
        </p>
      </div>
      {preview && <FlowPreview k={k} steps={steps.filter((s) => s.zone.trim())} options={options} onClose={() => setPreview(false)} />}
    </Modal>
  );
}

export default function SetKanban() {
  const toast = useToast();
  const dlg = useDialogs();
  const run = useRun();
  const { data, reload } = useKanbanData();
  const parts = useParts();
  const [customers, setCustomers] = useState<{ code: string; name: string | null; isActive: boolean }[]>([]);
  const [f, setF] = useState<Form>(EMPTY);
  const [row, setRow] = useState<Kanban | null>(null);
  const [view, setView] = useState(false);
  const [flowFor, setFlowFor] = useState<number | null>(null);
  const [previewFor, setPreviewFor] = useState<number | null>(null);
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
    return all.filter((k) => (status === "ALL" || (status === "READY") === isReady(k)) && (!t || [k.code, k.partA, k.partNo, k.name, k.customer, k.zone].some((v) => (v ?? "").toUpperCase().includes(t))));
  }, [all, q, status]);
  const counts = { ALL: all.length, READY: all.filter(isReady).length, "NOT READY": all.filter((k) => !isReady(k)).length };
  const custOpts = useMemo(() => customers.filter((c) => c.isActive || c.code === f.customer).map((c) => ({ value: c.code, label: c.code, sub: c.name ?? undefined })), [customers, f.customer]);
  const zoneOpts = useMemo(() => (data?.options.zones ?? []).map((z) => ({ value: z, label: z, sub: data?.options.zoneInfo.find((x) => x.code === z)?.name ?? undefined })), [data]);

  // parts of the picked customer (none picked = all) · each field shows its own text, the other two as the hint
  const part = useMemo(() => parts?.find((p) => p.id === f.partId) ?? null, [parts, f.partId]);
  const pool = useMemo(() => (parts ?? []).filter((p) => !f.customer || same(p.customer, f.customer)), [parts, f.customer]);
  const opts = useMemo(() => {
    const mk = (label: (p: Part) => string, sub: (p: Part) => string) => pool.filter((p) => label(p)).map((p) => ({ value: String(p.id), label: label(p), sub: sub(p) }));
    return {
      a: mk((p) => p.partA, (p) => [p.partNo, p.name, f.customer ? "" : p.customer].filter(Boolean).join(" · ")),
      no: mk((p) => p.partNo, (p) => [p.partA, p.name].filter(Boolean).join(" · ")),
      name: mk((p) => p.name, (p) => [p.partA, p.partNo].filter(Boolean).join(" · ")),
    };
  }, [pool, f.customer]);
  // pick a part = PART A / PART NO / PRODUCT NAME + picture follow · empty customer takes the part's customer
  const pickPart = (v: string) => {
    const p = parts?.find((x) => String(x.id) === v);
    if (!p) return set({ partId: null });
    set({ partId: p.id, ...(!f.customer && p.customer && customers.some((c) => same(c.code, p.customer)) ? { customer: customers.find((c) => same(c.code, p.customer))!.code } : {}) });
  };
  // another customer = the picked part no longer fits -> clear it
  const pickCustomer = (v: string) => set({ customer: v, ...(part && v && !same(part.customer, v) ? { partId: null } : {}) });

  const flowK = all.find((k) => k.id === flowFor) ?? null;
  const previewK = all.find((k) => k.id === previewFor) ?? null;
  const cards = cardCount(int(f.orderQty), int(f.perBox));
  const ro = view;
  const showForm = can.add || !!row;

  // preview = what is on the form now (old Kanban without a part keeps its saved names)
  const stage: 0 | 1 | 2 = row ? (isReady(row) ? 2 : 1) : 0;
  const filled = [f.code.trim(), f.partId, int(f.perBox), int(f.orderQty)].filter(Boolean).length;
  const pct = stage === 2 ? 100 : stage === 1 ? 66 : Math.round((filled / 4) * 33);
  const preview = {
    code: f.code,
    partId: f.partId,
    partA: part?.partA ?? (row && !f.partId ? row.partA : null),
    partNo: part?.partNo ?? (row && !f.partId ? row.partNo : null),
    name: part?.name ?? (row && !f.partId ? row.name : ""),
    customer: f.customer || null,
    zone: f.zone || null,
    perBox: int(f.perBox),
    cards,
  };

  function reset() {
    setRow(null);
    setView(false);
    setF(EMPTY);
  }
  function open(k: Kanban, asView: boolean) {
    setRow(k);
    setView(asView);
    setF({ code: k.code, partId: k.partId, customer: k.customer ?? "", perBox: String(k.perBox), orderQty: String(k.orderQty), zone: k.zone ?? "", note: k.note ?? "" });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    if (!f.code.trim()) return toast.show("WARNING", "กรุณากรอกรหัสงาน (KANBAN CODE)", "warn");
    if (!f.partId) return toast.show("WARNING", "กรุณาเลือก PART A / PART NO / PRODUCT NAME", "warn");
    if (!int(f.perBox) || !int(f.orderQty)) return toast.show("WARNING", "จำนวนชิ้นงานต่อกล่อง / จำนวนที่สั่งผลิต ต้องเป็นจำนวนเต็มมากกว่า 0", "warn");
    setBusy(true);
    const body = { code: f.code, partId: f.partId, customer: f.customer || null, perBox: int(f.perBox), orderQty: int(f.orderQty), zone: f.zone, note: f.note };
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
    if (!(await dlg.confirm({ title: "DELETE KANBAN", message: `ลบ Kanban "${k.code}" (${k.partA ?? k.name}) ?`, ok: "DELETE", danger: true }))) return;
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
  const partBox = (label: string, list: { value: string; label: string; sub?: string }[], has: boolean, aria: string) =>
    fld(
      label,
      <ComboBox
        value={f.partId && has ? String(f.partId) : ""}
        onChange={pickPart}
        options={list}
        disabled={ro || !parts}
        ariaLabel={aria}
        placeholder={!parts ? "กำลังโหลดรายการ PART…" : list.length ? `พิมพ์ค้นหา ${aria}` : f.customer ? `ลูกค้า ${f.customer} ยังไม่มี PART` : "ไม่มีรายการ PART"}
        mono={aria !== "PRODUCT NAME"}
      />,
    );

  return (
    <PageBody className="md-gray md-partner kb">
      <PageHeader icon="/icons/PickList.png" title="KANBAN MANAGEMENT" subtitle="KANBAN · ขั้นตอนที่ 1 สร้าง Kanban → ขั้นตอนที่ 2 SET FLOW = พร้อมใช้งาน" />
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          {showForm && (
            <Rise>
              <div ref={formRef} className="scroll-mt-4">
                <Card title={view ? `👁 VIEW KANBAN` : row ? `✏️ EDIT KANBAN` : "＋ CREATE KANBAN"} actions={row ? <ReadyPill ready={isReady(row)} /> : undefined} bodyClass="p-4 md:p-5">
                  <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] 2xl:grid-cols-[200px_minmax(0,1fr)_minmax(340px,400px)]">
                    <div className={`kb-photo mx-auto w-full max-w-[200px] ${preview.partId ? "has-img" : ""}`}>
                      {preview.partId ? (
                        <PartImg partId={preview.partId} />
                      ) : (
                        <div>
                          <b aria-hidden>📦</b>
                          <p className="mt-2 font-mono text-sm font-extrabold text-primary">{f.code || "KANBAN"}</p>
                          <p className="text-[11px] font-bold">รูปภาพงาน · เลือก PART แล้วแสดงเอง</p>
                        </div>
                      )}
                    </div>
                    <div className="grid content-start gap-3 sm:grid-cols-2">
                      {fld("รหัสงาน (KANBAN CODE) *", <input className="field font-mono font-bold uppercase" readOnly={ro} maxLength={50} value={f.code} placeholder="รหัส Kanban (A-Z, 0-9, -) ห้ามซ้ำ" onChange={(e) => set({ code: e.target.value.toUpperCase() })} />)}
                      {fld("CUSTOMER", <ComboBox value={f.customer} onChange={pickCustomer} options={custOpts} disabled={ro} ariaLabel="CUSTOMER" placeholder="พิมพ์ค้นหา / เลือกลูกค้า (กรอง PART ให้)" />)}
                      {fld(
                        "ZONE",
                        <ComboBox
                          value={f.zone}
                          onChange={(v) => set({ zone: v })}
                          options={zoneOpts}
                          free={data.options.zoneMaster ? undefined : (t) => t.trim().toUpperCase().slice(0, 50) || null}
                          disabled={ro}
                          ariaLabel="ZONE"
                          placeholder={data.options.zoneMaster ? (zoneOpts.length ? "เลือก ZONE" : "ยังไม่มี ZONE · เพิ่มที่ Master Data") : "เลือก / พิมพ์ ZONE"}
                        />,
                      )}
                      {partBox("PART A *", opts.a, !!part?.partA, "PART A")}
                      {partBox("PART NO", opts.no, !!part?.partNo, "PART NO")}
                      {partBox("PRODUCT NAME", opts.name, !!part?.name, "PRODUCT NAME")}
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
                      {fld("หมายเหตุ", <input className="field" readOnly={ro} maxLength={300} value={f.note} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" onChange={(e) => set({ note: e.target.value })} />)}
                      {row && !row.partId && !f.partId && <p className="text-xs font-bold text-warning sm:col-span-2">Kanban นี้สร้างก่อนมีช่อง PART · กรุณาเลือก PART A ก่อนบันทึก (เดิม: {row.name})</p>}
                    </div>
                    {/* card preview (like the Pick List label preview) + creation steps */}
                    <div className="grid content-start gap-3 rounded-2xl border border-line/70 bg-[radial-gradient(120%_100%_at_100%_0%,#eff6ff,transparent_60%)] p-3 lg:col-span-2 2xl:col-span-1">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">KANBAN PREVIEW</p>
                      <div className="grid place-items-center">
                        <KanbanCard k={preview} stage={stage} pct={pct} />
                      </div>
                      <ol className="kb-flow justify-center" aria-label="ขั้นตอนการสร้าง Kanban">
                        {["สร้าง Kanban", "SET FLOW", "พร้อมใช้งาน"].map((t, i) => (
                          <li key={t} className={`kb-chip ${i <= stage ? "is-first" : ""}`} aria-current={i === stage ? "step" : undefined}>
                            <b>{i < stage ? "✓" : i + 1}</b>
                            {t}
                          </li>
                        ))}
                      </ol>
                      <p className="text-center text-[11px] font-bold text-ink-soft">
                        {stage === 0 ? "บันทึกแล้ว Kanban ยังใช้งานไม่ได้ · ต้อง SET FLOW ก่อน" : stage === 1 ? "ยังไม่สามารถใช้งาน Kanban ได้ · กด SET FLOW เพื่อตั้งค่า" : "ตั้งค่า FLOW แล้ว · สั่งผลิตได้"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-center">
                    <span className="min-w-0 flex-1 text-xs font-bold text-ink-soft">
                      {row ? `UPDATE DATE ${stamp(row.updatedDate)}${row.updatedBy ? ` · ${row.updatedBy}` : ""}` : "บันทึกแล้วจะเปิด SET FLOW ต่อทันที"}
                    </span>
                    <div className="flex flex-wrap justify-end gap-2">
                      {row && stage === 1 && (
                        <button type="button" className="btn-ghost min-w-[140px]" onClick={() => setFlowFor(row.id)}>
                          🔀 SET FLOW
                        </button>
                      )}
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
                <SearchBox value={key} onChange={setKey} placeholder="ค้นหา CODE / PART A / PART NO / PRODUCT / CUSTOMER / ZONE" className="md-search ml-auto w-[360px] max-w-full" />
              </div>
              {rows.length === 0 ? (
                <Empty>{all.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการ Kanban"}</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="w-14 text-center">NO.</th>
                        <th>KANBAN CODE</th>
                        <th>PART A</th>
                        <th>PART NO</th>
                        <th>PRODUCT NAME</th>
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
                        <tr key={k.id} className={`cursor-pointer ${row?.id === k.id ? "is-picked" : ""}`} title="คลิกเพื่อดู PREVIEW" onClick={() => row?.id !== k.id && open(k, true)}>
                          <td data-l="NO." className="text-center">
                            {i + 1}
                          </td>
                          <td data-l="KANBAN CODE" className="font-mono font-extrabold">
                            {k.code}
                          </td>
                          <td data-l="PART A" className="text-left">
                            <span className="inline-flex items-center gap-2">
                              <span className="size-9 shrink-0 overflow-hidden rounded-lg border border-line/70 bg-white p-0.5">
                                <PartImg partId={k.partId} className="size-full !text-lg" />
                              </span>
                              <b className="font-mono">{k.partA || "-"}</b>
                            </span>
                          </td>
                          <td data-l="PART NO" className="font-mono">
                            {k.partNo || "-"}
                          </td>
                          <td data-l="PRODUCT NAME" className="text-left font-semibold">
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
                          <td data-l="ACTION" onClick={(e) => e.stopPropagation()}>
                            <RowActions>
                              <RowAction kind="view" active={row?.id === k.id && view} onClick={() => (row?.id === k.id && view ? reset() : open(k, true))} />
                              {can.edit && <RowAction kind="edit" active={row?.id === k.id && !view} onClick={() => (row?.id === k.id && !view ? reset() : open(k, false))} />}
                              <button type="button" className={`kb-pill cursor-pointer ${isReady(k) ? "is-blue" : "is-warn"}`} onClick={() => setFlowFor(k.id)} title="SET FLOW">
                                SET FLOW
                              </button>
                              <button type="button" className="kb-pill is-draft cursor-pointer" disabled={!isReady(k)} onClick={() => setPreviewFor(k.id)} title={isReady(k) ? "PREVIEW FLOW" : "ต้อง SET FLOW ก่อน"}>
                                👁 PREVIEW
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
      {previewK && data && <FlowPreview k={previewK} steps={previewK.steps} options={data.options} onClose={() => setPreviewFor(null)} />}
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
