"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { Select } from "@/components/dropdowns/Select";
import { useCollapsed } from "@/components/tables/GroupRow";
import { FlowDiagram, type FlowColumn } from "@/components/flow/FlowDiagram";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import "./zones.css";

// 🏭 MASTER DATA › PRODUCT CONTROL › ZONE & WORKSTATION INFORMATION (script 74)
//   Production Zone -> Workstations (positions in the zone · optional machine · operators per station) · Line-side Store = end point of the zone
//   form on top: register ZONE / WORKSTATION / LINE-SIDE STORE · table: each zone with its workstations under it · PREVIEW = zone flow diagram
//   codes are fixed after register (Kanban flows keep the zone code) · rights = MASTER DATA (server checks again)
type Audit = { createdBy: string | null; createdDate: string; updatedBy: string | null; updatedDate: string };
type Zone = Audit & { id: number; code: string; name: string | null; storeId: number | null; storeCode: string | null; storeName: string | null; status: string; stations: number; operators: number };
type Station = Audit & { id: number; zoneId: number; zone: string; code: string; name: string | null; machine: string | null; machineName: string | null; operators: number; status: string };
type Store = Audit & { id: number; code: string; name: string | null; status: string; zones: number };
type Data = { can: { add: boolean; edit: boolean; delete: boolean }; zones: Zone[]; stations: Station[]; stores: Store[]; machines: { code: string; name: string | null; type: string; zone: string | null }[] };
type Kind = "ZONE" | "WORKSTATION" | "LINE-SIDE STORE";
type Form = { code: string; name: string; storeId: string; zoneId: string; machine: string; operators: string; status: string };
const KINDS: Kind[] = ["ZONE", "WORKSTATION", "LINE-SIDE STORE"];
const EMPTY: Form = { code: "", name: "", storeId: "", zoneId: "", machine: "", operators: "1", status: "ACTIVE" };
const TABS = ["ALL", "ACTIVE", "INACTIVE"] as const;
const PATH: Record<Kind, string> = { ZONE: "zones", WORKSTATION: "stations", "LINE-SIDE STORE": "stores" };
const n0 = (v: number) => v.toLocaleString();

/** zone flow: Kanban Post -> workstations (parallel) -> line-side store */
function zoneColumns(z: Zone, stations: Station[]): FlowColumn[] {
  const st = stations.filter((s) => s.zoneId === z.id && s.status === "ACTIVE");
  return [
    { key: "k", label: "KANBAN POST", sub: "จุดรับ Kanban", nodes: [{ id: "k", title: "KANBAN", sub: `ZONE ${z.code}`, color: "#7c3aed", icon: "📦" }] },
    {
      key: "w",
      label: `ZONE ${z.code}`,
      sub: z.name ?? `${st.length} สถานีงาน`,
      nodes: st.length
        ? st.map((s) => ({ id: `w${s.id}`, title: s.code, sub: s.name ?? s.machine ?? undefined, meta: [s.machine, `👤 ${s.operators} คน`].filter(Boolean).join(" · "), color: "#2563eb", icon: "🧑‍🔧" }))
        : [{ id: "w0", title: "ยังไม่มีสถานีงาน", sub: "เพิ่ม WORKSTATION ของโซนนี้", color: "#94a3b8", icon: "⚠", muted: true }],
    },
    {
      key: "s",
      label: "LINE-SIDE STORE",
      sub: "สโตร์ข้างไลน์",
      nodes: [z.storeCode ? { id: "s", title: z.storeCode, sub: z.storeName ?? undefined, color: "#15803d", icon: "🏬" } : { id: "s", title: "ยังไม่กำหนด", sub: "เลือกได้ที่ EDIT ZONE", color: "#94a3b8", icon: "🏬", muted: true }],
    },
  ];
}

export function ZonePage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [kind, setKind] = useState<Kind>("ZONE");
  const [mode, setMode] = useState<"add" | "edit" | "view">("add");
  const [editId, setEditId] = useState<number | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200);
  const [tab, setTab] = useState<(typeof TABS)[number]>("ALL");
  const [collapsed, toggle] = useCollapsed();
  const [preview, setPreview] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));

  const load = useCallback(
    async (quiet = false) => {
      try {
        setData(await api<Data>("/master/zones"));
      } catch (e) {
        if (quiet) return;
        toast.show("ERROR", "โหลด ZONE & WORKSTATION ไม่สำเร็จ\n" + (e as Error).message, "error");
        setData((d) => d ?? { can: { add: false, edit: false, delete: false }, zones: [], stations: [], stores: [], machines: [] });
      }
    },
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["master"], () => load(true));

  const can = data?.can ?? { add: false, edit: false, delete: false };
  const zones = useMemo(() => data?.zones ?? [], [data]);
  const stations = useMemo(() => data?.stations ?? [], [data]);
  const stores = useMemo(() => data?.stores ?? [], [data]);
  const ro = mode === "view";

  // table: zones (search hits the zone or one of its stations) · status tab filters both
  const groups = useMemo(() => {
    const t = q.trim().toUpperCase();
    const hit = (...v: (string | null)[]) => !t || v.some((x) => (x ?? "").toUpperCase().includes(t));
    const okTab = (s: string) => tab === "ALL" || s === tab;
    return zones
      .map((z) => {
        const all = stations.filter((s) => s.zoneId === z.id && okTab(s.status));
        const zoneHit = hit(z.code, z.name, z.storeCode, z.storeName);
        const items = zoneHit ? all : all.filter((s) => hit(s.code, s.name, s.machine, s.machineName));
        return { z, items, show: (okTab(z.status) || items.length > 0) && (zoneHit || items.length > 0) };
      })
      .filter((g) => g.show);
  }, [zones, stations, q, tab]);
  const counts = { ALL: zones.length, ACTIVE: zones.filter((z) => z.status === "ACTIVE").length, INACTIVE: zones.filter((z) => z.status === "INACTIVE").length };

  const zoneOpts = useMemo(() => zones.filter((z) => z.status === "ACTIVE" || String(z.id) === f.zoneId).map((z) => ({ value: String(z.id), label: z.code, sub: z.name ?? undefined })), [zones, f.zoneId]);
  const storeOpts = useMemo(
    () => [{ value: "", label: "— ไม่ระบุ —" }, ...stores.filter((s) => s.status === "ACTIVE" || String(s.id) === f.storeId).map((s) => ({ value: String(s.id), label: s.name ? `${s.code} · ${s.name}` : s.code }))],
    [stores, f.storeId],
  );
  // machines of the picked zone first, then the rest
  const machineOpts = useMemo(() => {
    const zc = zones.find((z) => String(z.id) === f.zoneId)?.code;
    return [...(data?.machines ?? [])]
      .sort((a, b) => Number(b.zone === zc) - Number(a.zone === zc) || a.code.localeCompare(b.code))
      .map((m) => ({ value: m.code, label: m.code, sub: [m.name, m.type, m.zone ? `ZONE ${m.zone}` : null].filter(Boolean).join(" · ") }));
  }, [data, zones, f.zoneId]);

  function reset(k: Kind = kind) {
    setKind(k);
    setMode("add");
    setEditId(null);
    setF(EMPTY);
  }
  const focusForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  function openZone(z: Zone, m: "edit" | "view") {
    setKind("ZONE");
    setMode(m);
    setEditId(z.id);
    setF({ ...EMPTY, code: z.code, name: z.name ?? "", storeId: z.storeId ? String(z.storeId) : "", status: z.status });
    focusForm();
  }
  function openStation(s: Station, m: "edit" | "view") {
    setKind("WORKSTATION");
    setMode(m);
    setEditId(s.id);
    setF({ ...EMPTY, code: s.code, name: s.name ?? "", zoneId: String(s.zoneId), machine: s.machine ?? "", operators: String(s.operators), status: s.status });
    focusForm();
  }
  function openStore(s: Store, m: "edit" | "view") {
    setKind("LINE-SIDE STORE");
    setMode(m);
    setEditId(s.id);
    setF({ ...EMPTY, code: s.code, name: s.name ?? "", status: s.status });
    focusForm();
  }
  function addStationTo(z: Zone) {
    reset("WORKSTATION");
    set({ zoneId: String(z.id) });
    focusForm();
  }

  async function save() {
    if (!f.code.trim()) return toast.show("WARNING", `กรุณากรอก ${kind} CODE`, "warn");
    if (kind === "WORKSTATION" && !f.zoneId) return toast.show("WARNING", "กรุณาเลือก ZONE ของสถานีงาน", "warn");
    if (kind === "WORKSTATION" && !(Number(f.operators) >= 1 && Number(f.operators) <= 99)) return toast.show("WARNING", "จำนวนพนักงานต่อสถานี ต้องเป็นตัวเลข 1 - 99", "warn");
    const body =
      kind === "ZONE"
        ? { code: f.code, name: f.name, storeId: f.storeId ? Number(f.storeId) : null, status: f.status }
        : kind === "WORKSTATION"
          ? { zoneId: Number(f.zoneId), code: f.code, name: f.name, machine: f.machine || null, operators: Number(f.operators), status: f.status }
          : { code: f.code, name: f.name, status: f.status };
    setBusy(true);
    try {
      const res = await api<{ message: string }>(editId ? `/master/${PATH[kind]}/${editId}` : `/master/${PATH[kind]}`, { method: editId ? "PUT" : "POST", body });
      toast.show("SAVED", res.message, "ok");
      const zoneId = kind === "WORKSTATION" && !editId ? f.zoneId : "";
      reset();
      if (zoneId) set({ zoneId }); // keep adding stations to the same zone
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: Kind, id: number, label: string) {
    if (!(await dlg.confirm({ title: `DELETE ${k}`, message: `ลบ ${k} "${label}" ?`, ok: "DELETE", danger: true }))) return;
    try {
      const res = await api<{ message: string }>(`/master/${PATH[k]}/${id}`, { method: "DELETE" });
      toast.show("DELETED", res.message, "ok");
      if (editId === id && kind === k) reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const fld = (label: string, node: React.ReactNode) => (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      {node}
    </label>
  );
  const statusField = fld(
    "STATUS",
    ro ? <input className="field" readOnly value={f.status} /> : <Select value={f.status} onChange={(v) => set({ status: v })} ariaLabel="STATUS" options={[{ value: "ACTIVE", label: "ACTIVE" }, { value: "INACTIVE", label: "INACTIVE" }]} />,
  );
  const codeField = (label: string, hint: string) =>
    fld(
      `${label} *`,
      <input
        className="field font-mono font-bold uppercase"
        readOnly={ro || !!editId}
        title={editId ? "รหัสแก้ไขไม่ได้หลังลงทะเบียน (FLOW / ข้อมูลอื่นอ้างอิงรหัสนี้)" : undefined}
        maxLength={50}
        value={f.code}
        placeholder={hint}
        onChange={(e) => set({ code: e.target.value.toUpperCase() })}
        onKeyDown={(e) => e.key === "Enter" && !ro && save()}
      />,
    );
  const nameField = (label: string, hint: string) =>
    fld(label, <input className="field" readOnly={ro} maxLength={200} value={f.name} placeholder={hint} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && !ro && save()} />);
  const editRow = kind === "ZONE" ? zones.find((z) => z.id === editId) : kind === "WORKSTATION" ? stations.find((s) => s.id === editId) : stores.find((s) => s.id === editId);
  const pz = zones.find((z) => z.id === preview) ?? null;
  const pzCols = useMemo(() => (pz ? zoneColumns(pz, stations) : []), [pz, stations]);
  const showForm = can.add || mode !== "add";

  return (
    <PageBody className="md-gray md-partner">
      <PageHeader icon="/icons/Capacity.png" title="ZONE & WORKSTATION INFORMATION" subtitle="MASTER DATA · Production Zone → Workstation (สถานีงาน) → Line-side Store (สโตร์ข้างไลน์)" />
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          {showForm && (
            <div ref={formRef} className="scroll-mt-4">
              <Card
                title={mode === "edit" ? `✏️ EDIT ${kind}` : mode === "view" ? `👁 VIEW ${kind}` : `＋ REGISTER ${kind}`}
                actions={
                  mode === "add" ? (
                    <div className="md-seg" role="tablist" aria-label="ประเภทที่ลงทะเบียน" style={{ "--n": KINDS.indexOf(kind) } as React.CSSProperties}>
                      <span className="md-seg-glider" aria-hidden />
                      {KINDS.map((k) => (
                        <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "is-on" : ""} onClick={() => reset(k)}>
                          {k}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="md-status is-on">{f.code}</span>
                  )
                }
                bodyClass="p-4 md:p-5"
              >
                <div className="reg-fields grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {kind === "ZONE" && (
                    <>
                      {codeField("ZONE CODE", "รหัสโซน (ห้ามซ้ำ)")}
                      {nameField("ZONE NAME", "ชื่อโซนการผลิต (ไม่บังคับ)")}
                      {fld("LINE-SIDE STORE", ro ? <input className="field" readOnly value={storeOpts.find((o) => o.value === f.storeId)?.label ?? "-"} /> : <Select value={f.storeId} onChange={(v) => set({ storeId: v })} ariaLabel="LINE-SIDE STORE" options={storeOpts} />)}
                      {statusField}
                    </>
                  )}
                  {kind === "WORKSTATION" && (
                    <>
                      {fld("ZONE *", <ComboBox value={f.zoneId} onChange={(v) => set({ zoneId: v })} options={zoneOpts} disabled={ro} ariaLabel="ZONE" placeholder={zoneOpts.length ? "เลือก ZONE ของสถานีงาน" : "ยังไม่มี ZONE · ลงทะเบียน ZONE ก่อน"} />)}
                      {codeField("WORKSTATION CODE", "รหัสสถานีงาน (ห้ามซ้ำ)")}
                      {nameField("WORKSTATION NAME", "ชื่อสถานีงาน / ตำแหน่ง (ไม่บังคับ)")}
                      {fld("MACHINE", <ComboBox value={f.machine} onChange={(v) => set({ machine: v })} options={machineOpts} disabled={ro} ariaLabel="MACHINE" placeholder={machineOpts.length ? "เลือกเครื่องจักร (ไม่บังคับ)" : "ยังไม่มีเครื่องจักรใน Machine Information"} mono />)}
                      {fld(
                        "OPERATORS (คนต่อสถานี) *",
                        <input className="field font-mono" inputMode="numeric" readOnly={ro} value={f.operators} placeholder="จำนวนพนักงาน 1 - 99" onChange={(e) => set({ operators: e.target.value.replace(/\D/g, "").slice(0, 2) })} onKeyDown={(e) => e.key === "Enter" && !ro && save()} />,
                      )}
                      {statusField}
                    </>
                  )}
                  {kind === "LINE-SIDE STORE" && (
                    <>
                      {codeField("LINE-SIDE STORE CODE", "รหัสสโตร์ข้างไลน์ (ห้ามซ้ำ)")}
                      {nameField("LINE-SIDE STORE NAME", "ชื่อ / ตำแหน่งสโตร์ข้างไลน์ (ไม่บังคับ)")}
                      {statusField}
                    </>
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-end">
                  <div className="min-w-0 flex-1">
                    {editRow ? (
                      <div className="md-meta">
                        <span>
                          UPDATE DATE <b>{stamp(editRow.updatedDate)}</b> {editRow.updatedBy ? `· ${editRow.updatedBy}` : ""}
                        </span>
                        <span>
                          CREATED <b>{stamp(editRow.createdDate)}</b> {editRow.createdBy ? `· ${editRow.createdBy}` : ""}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-ink-soft">
                        {kind === "ZONE"
                          ? "รหัสโซนห้ามซ้ำ และแก้ไขไม่ได้หลังลงทะเบียน · เพิ่มสถานีงานของโซนได้ที่ปุ่ม ＋ ในตาราง"
                          : kind === "WORKSTATION"
                            ? "เครื่องจักร 1 เครื่องมีหลายตำแหน่งได้ = ลงทะเบียนหลายสถานีงานบนเครื่องเดียวกัน"
                            : "ตัวเลือกปลายทางของโซน (ใช้เลือกอย่างเดียว · เชื่อมกับ CIMS ภายหลัง)"}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {mode !== "view" && (
                      <button type="button" className="btn-ghost min-w-[120px]" disabled={busy} onClick={() => reset()}>
                        {mode === "edit" ? "✕ CANCEL" : "↺ RESET"}
                      </button>
                    )}
                    {mode === "view" ? (
                      <>
                        <button type="button" className="btn-ghost min-w-[120px]" onClick={() => reset()}>
                          ✕ CLOSE
                        </button>
                        {can.edit && (
                          <button type="button" className="btn bg-accent min-w-[160px]" onClick={() => setMode("edit")}>
                            ✏ EDIT
                          </button>
                        )}
                      </>
                    ) : (
                      <button type="button" className={`btn min-w-[180px] ${mode === "edit" ? "bg-success" : "bg-accent"}`} disabled={busy} onClick={save}>
                        {busy ? "…" : mode === "edit" ? "💾 SAVE CHANGES" : `＋ ${kind} REGISTRATION`}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          )}

          <Card title={`ZONES & WORKSTATIONS • ${n0(zones.length)} ZONE · ${n0(stations.length)} สถานีงาน`}>
            <div className="md-toolbar">
              <div className="md-seg" role="tablist" style={{ "--n": TABS.indexOf(tab) } as React.CSSProperties}>
                <span className="md-seg-glider" aria-hidden />
                {TABS.map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={tab === s} className={tab === s ? "is-on" : ""} onClick={() => setTab(s)}>
                    {s}
                    <b>{n0(counts[s])}</b>
                  </button>
                ))}
              </div>
              <SearchBox value={key} onChange={setKey} placeholder="ค้นหา ZONE / WORKSTATION / MACHINE / LINE-SIDE STORE" className="md-search ml-auto w-[360px] max-w-full" />
            </div>
            {groups.length === 0 ? (
              <Empty>{zones.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มี ZONE · เริ่มจากลงทะเบียน ZONE ด้านบน"}</Empty>
            ) : (
              <div className="overflow-auto">
                <table className="data-table t-center w-full">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-14 text-center">NO.</th>
                      <th>CODE</th>
                      <th>NAME</th>
                      <th>MACHINE / LINE-SIDE STORE</th>
                      <th>OPERATORS</th>
                      <th>STATUS</th>
                      <th>UPDATE DATE</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(({ z, items }, gi) => (
                      <Fragment key={z.id}>
                        <tr className={`zn-zone ${z.status === "INACTIVE" ? "opacity-60" : ""} ${kind === "ZONE" && editId === z.id ? "is-picked" : ""}`}>
                          <td data-l="NO." className="text-center font-bold">
                            {gi + 1}
                          </td>
                          <td data-l="ZONE" className="text-left">
                            <button type="button" className="zn-toggle" aria-expanded={!collapsed.has(String(z.id))} onClick={() => toggle(String(z.id))}>
                              <span aria-hidden>{collapsed.has(String(z.id)) ? "▸" : "▾"}</span>
                              <b className="font-mono">ZONE {z.code}</b>
                            </button>
                          </td>
                          <td data-l="NAME" className="font-bold">
                            {z.name || <span className="text-ink-soft">-</span>}
                            <div className="text-[11px] font-bold text-ink-soft">{n0(z.stations)} สถานีงาน</div>
                          </td>
                          <td data-l="LINE-SIDE STORE">{z.storeCode ? <span className="zn-store">🏬 {z.storeCode}</span> : <span className="text-ink-soft">ยังไม่กำหนด</span>}</td>
                          <td data-l="OPERATORS" className="font-mono font-bold">
                            {n0(z.operators)}
                          </td>
                          <td data-l="STATUS">
                            <span className={`md-status ${z.status === "ACTIVE" ? "is-on" : ""}`}>{z.status}</span>
                          </td>
                          <td data-l="UPDATE DATE" className="whitespace-nowrap font-mono text-xs" title={z.updatedBy ? `โดย ${z.updatedBy}` : undefined}>
                            {stamp(z.updatedDate)}
                          </td>
                          <td data-l="ACTION">
                            <RowActions>
                              <button type="button" className="zn-pill" onClick={() => setPreview(z.id)} title="PREVIEW FLOW ของโซน">
                                👁 PREVIEW
                              </button>
                              {can.add && (
                                <button type="button" className="zn-pill is-blue" onClick={() => addStationTo(z)} title="เพิ่มสถานีงานในโซนนี้">
                                  ＋ STATION
                                </button>
                              )}
                              <RowAction kind="view" active={kind === "ZONE" && editId === z.id && mode === "view"} onClick={() => openZone(z, "view")} />
                              {can.edit && <RowAction kind="edit" active={kind === "ZONE" && editId === z.id && mode === "edit"} onClick={() => openZone(z, "edit")} />}
                              {can.delete && <RowAction kind="delete" title={z.stations ? "ยังมีสถานีงานในโซน ลบไม่ได้" : "DELETE"} onClick={() => remove("ZONE", z.id, z.code)} />}
                            </RowActions>
                          </td>
                        </tr>
                        {!collapsed.has(String(z.id)) &&
                          items.map((s) => (
                            <tr key={`s${s.id}`} className={`zn-station ${s.status === "INACTIVE" ? "opacity-60" : ""} ${kind === "WORKSTATION" && editId === s.id ? "is-picked" : ""}`}>
                              <td data-l="NO." className="text-center text-ink-soft">
                                ↳
                              </td>
                              <td data-l="WORKSTATION" className="text-left font-mono font-extrabold">
                                {s.code}
                              </td>
                              <td data-l="NAME" className="font-semibold">
                                {s.name || <span className="text-ink-soft">-</span>}
                              </td>
                              <td data-l="MACHINE" title={s.machineName ?? undefined}>
                                {s.machine ? <span className="font-mono">⚙ {s.machine}</span> : <span className="text-ink-soft">-</span>}
                              </td>
                              <td data-l="OPERATORS" className="font-mono">
                                👤 {n0(s.operators)}
                              </td>
                              <td data-l="STATUS">
                                <span className={`md-status ${s.status === "ACTIVE" ? "is-on" : ""}`}>{s.status}</span>
                              </td>
                              <td data-l="UPDATE DATE" className="whitespace-nowrap font-mono text-xs" title={s.updatedBy ? `โดย ${s.updatedBy}` : undefined}>
                                {stamp(s.updatedDate)}
                              </td>
                              <td data-l="ACTION">
                                <RowActions>
                                  <RowAction kind="view" active={kind === "WORKSTATION" && editId === s.id && mode === "view"} onClick={() => openStation(s, "view")} />
                                  {can.edit && <RowAction kind="edit" active={kind === "WORKSTATION" && editId === s.id && mode === "edit"} onClick={() => openStation(s, "edit")} />}
                                  {can.delete && <RowAction kind="delete" onClick={() => remove("WORKSTATION", s.id, s.code)} />}
                                </RowActions>
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`LINE-SIDE STORES • ${n0(stores.length)}`}>
            {stores.length === 0 ? (
              <Empty>ยังไม่มี LINE-SIDE STORE · ลงทะเบียนได้ที่แท็บ LINE-SIDE STORE ด้านบน</Empty>
            ) : (
              <div className="overflow-auto">
                <table className="data-table t-center w-full">
                  <thead>
                    <tr>
                      <th className="w-14 text-center">NO.</th>
                      <th>CODE</th>
                      <th>NAME</th>
                      <th>ใช้ใน ZONE</th>
                      <th>STATUS</th>
                      <th>UPDATE DATE</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map((s, i) => (
                      <tr key={s.id} className={`${s.status === "INACTIVE" ? "opacity-60" : ""} ${kind === "LINE-SIDE STORE" && editId === s.id ? "is-picked" : ""}`}>
                        <td data-l="NO." className="text-center">
                          {i + 1}
                        </td>
                        <td data-l="CODE" className="font-mono font-extrabold">
                          {s.code}
                        </td>
                        <td data-l="NAME" className="font-semibold">
                          {s.name || <span className="text-ink-soft">-</span>}
                        </td>
                        <td data-l="ใช้ใน ZONE" className="font-mono">
                          {n0(s.zones)}
                        </td>
                        <td data-l="STATUS">
                          <span className={`md-status ${s.status === "ACTIVE" ? "is-on" : ""}`}>{s.status}</span>
                        </td>
                        <td data-l="UPDATE DATE" className="whitespace-nowrap font-mono text-xs" title={s.updatedBy ? `โดย ${s.updatedBy}` : undefined}>
                          {stamp(s.updatedDate)}
                        </td>
                        <td data-l="ACTION">
                          <RowActions>
                            <RowAction kind="view" active={kind === "LINE-SIDE STORE" && editId === s.id && mode === "view"} onClick={() => openStore(s, "view")} />
                            {can.edit && <RowAction kind="edit" active={kind === "LINE-SIDE STORE" && editId === s.id && mode === "edit"} onClick={() => openStore(s, "edit")} />}
                            {can.delete && <RowAction kind="delete" title={s.zones ? "ถูกใช้อยู่ใน ZONE ลบไม่ได้" : "DELETE"} onClick={() => remove("LINE-SIDE STORE", s.id, s.code)} />}
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
      {pz && (
        <Modal open size="xl" title={`👁 PREVIEW FLOW • ZONE ${pz.code}`} onClose={() => setPreview(null)} footer={<button type="button" className="btn-ghost" onClick={() => setPreview(null)}>CLOSE</button>}>
          <FlowDiagram columns={pzCols} ariaLabel={`FLOW ของ ZONE ${pz.code}`} />
        </Modal>
      )}
    </PageBody>
  );
}
