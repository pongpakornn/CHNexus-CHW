"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { Select } from "@/components/dropdowns/Select";
import { GroupRow, useCollapsed } from "@/components/tables/GroupRow";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";

// 🏭 MASTER DATA › PRODUCT CONTROL › Machine Information / Mold Information (one page, kind)
//   Form on top (REGISTER / EDIT / VIEW, like Customer Information) · table below grouped like Part Information:
//   machines by MACHINE TYPE · molds by owner (each CUSTOMER, then COMPANY) in ONE table · rights = MASTER DATA (server checks again)
type Kind = "machines" | "molds";
type Row = {
  id: number;
  code: string;
  name: string | null;
  status: string;
  zone: string | null;
  // machine
  type?: string;
  setupMin?: number | null;
  changeMoldMin?: number | null;
  speed?: number | null;
  // mold
  owner?: "CUSTOMER" | "COMPANY";
  customer?: string | null;
  customerName?: string | null;
  partsPerStroke?: number | null;
  createdBy: string | null;
  createdDate: string;
  updatedBy: string | null;
  updatedDate: string;
};
type Data = { can: { add: boolean; edit: boolean; delete: boolean }; rows: Row[] };
type Mode = "add" | "edit" | "view";
type Form = { code: string; name: string; type: string; zone: string; setup: string; change: string; speed: string; owner: string; customer: string; pps: string; status: string };
const EMPTY: Form = { code: "", name: "", type: "", zone: "", setup: "", change: "", speed: "", owner: "CUSTOMER", customer: "", pps: "", status: "ACTIVE" };

const META = {
  machines: { title: "MACHINE INFORMATION", label: "MACHINE", icon: "/icons/64engine_motorFF.png", hint: "ข้อมูลเครื่องจักร · จัดกลุ่มตาม MACHINE TYPE", tabs: ["ALL", "ACTIVE", "INACTIVE"] },
  molds: { title: "MOLD INFORMATION", label: "MOLD", icon: "/icons/Capacity.png", hint: "ข้อมูลแม่พิมพ์ · จัดกลุ่มตามเจ้าของ (CUSTOMER / COMPANY)", tabs: ["ALL", "CUSTOMER", "COMPANY"] },
} as const;
const STATUS_LABEL: Record<string, string> = { ACTIVE: "ACTIVE", REPAIR: "UNDER REPAIR", INACTIVE: "INACTIVE" };
const COMPANY = "COMPANY (CHR)";
const num = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString());
const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
const uniq = (a: (string | null | undefined)[]) => [...new Set(a.filter((x): x is string => !!x))].sort().map((v) => ({ value: v, label: v }));
const upper = (t: string) => t.trim().toUpperCase().slice(0, 50) || null;
const groupOf = (kind: Kind, r: Row) => (kind === "machines" ? r.type || "-" : r.owner === "COMPANY" ? COMPANY : r.customer || "-");

export function EquipmentPage({ kind }: { kind: Kind }) {
  const toast = useToast();
  const dlg = useDialogs();
  const m = META[kind];
  const mach = kind === "machines";
  const [data, setData] = useState<Data | null>(null);
  const [customers, setCustomers] = useState<{ code: string; name: string | null; isActive: boolean }[]>([]);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 200);
  const [tab, setTab] = useState<string>("ALL");
  const [collapsed, toggleGroup] = useCollapsed();
  const [mode, setMode] = useState<Mode>("add");
  const [row, setRow] = useState<Row | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));

  const load = useCallback(
    async (quiet = false) => {
      try {
        setData(await api<Data>(`/master/${kind}`));
      } catch (e) {
        if (quiet) return;
        toast.show("ERROR", `โหลด ${m.title} ไม่สำเร็จ\n` + (e as Error).message, "error");
        setData((d) => d ?? { can: { add: false, edit: false, delete: false }, rows: [] });
      }
    },
    [kind, m.title, toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["master"], () => load(true));
  useEffect(() => {
    if (mach) return;
    api<{ rows: { code: string; name: string | null; isActive: boolean }[] }>("/master/customers")
      .then((r) => setCustomers(r.rows))
      .catch(() => setCustomers([]));
  }, [mach]);

  const can = data?.can ?? { add: false, edit: false, delete: false };
  const all = useMemo(() => data?.rows ?? [], [data]);
  const inTab = useCallback((r: Row) => tab === "ALL" || (mach ? r.status === tab : r.owner === tab), [tab, mach]);
  const rows = useMemo(() => {
    const q = k.trim().toUpperCase();
    return all.filter(
      (r) => inTab(r) && (!q || [r.code, r.name, r.zone, r.type, r.customer, r.customerName].some((v) => (v ?? "").toUpperCase().includes(q))),
    );
  }, [all, k, inTab]);
  // groups: machine types A-Z · molds: customers A-Z then COMPANY last
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const g = groupOf(kind, r);
      map.set(g, [...(map.get(g) ?? []), r]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === COMPANY ? 1 : b === COMPANY ? -1 : a.localeCompare(b))).map(([key, items]) => ({ key, items }));
  }, [rows, kind]);
  const counts = Object.fromEntries(m.tabs.map((t) => [t, all.filter((r) => t === "ALL" || (mach ? r.status === t : r.owner === t)).length]));
  const typeOpts = useMemo(() => uniq(all.map((r) => r.type)), [all]);
  const zoneOpts = useMemo(() => uniq(all.map((r) => r.zone)), [all]);
  const custOpts = useMemo(() => customers.filter((c) => c.isActive || c.code === f.customer).map((c) => ({ value: c.code, label: c.code, sub: c.name ?? undefined })), [customers, f.customer]);

  const ro = mode === "view";
  function reset() {
    setMode("add");
    setRow(null);
    setF(EMPTY);
  }
  function open(r: Row, m2: Mode) {
    setMode(m2);
    setRow(r);
    setF({
      code: r.code,
      name: r.name ?? "",
      type: r.type ?? "",
      zone: r.zone ?? "",
      setup: r.setupMin == null ? "" : String(r.setupMin),
      change: r.changeMoldMin == null ? "" : String(r.changeMoldMin),
      speed: r.speed == null ? "" : String(r.speed),
      owner: r.owner ?? "CUSTOMER",
      customer: r.customer ?? "",
      pps: r.partsPerStroke == null ? "" : String(r.partsPerStroke),
      status: r.status,
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    if (!f.code.trim()) return toast.show("WARNING", `กรุณากรอก ${m.label} CODE`, "warn");
    if (mach && !f.type.trim()) return toast.show("WARNING", "กรุณาเลือก / กรอก MACHINE TYPE", "warn");
    if (!mach && f.owner === "CUSTOMER" && !f.customer) return toast.show("WARNING", "แม่พิมพ์ของลูกค้า กรุณาเลือก CUSTOMER", "warn");
    const nums = mach ? [f.setup, f.change, f.speed] : [f.pps];
    if (nums.some((s) => s.trim() !== "" && !(Number(s) >= 0))) return toast.show("WARNING", "ช่องตัวเลขกรอกได้เฉพาะตัวเลข 0 ขึ้นไป", "warn");
    const body = mach
      ? { code: f.code, name: f.name, type: f.type, zone: f.zone, setupMin: toNum(f.setup), changeMoldMin: toNum(f.change), speed: toNum(f.speed), status: f.status }
      : { code: f.code, name: f.name, owner: f.owner, customer: f.owner === "CUSTOMER" ? f.customer : null, zone: f.zone, partsPerStroke: toNum(f.pps), status: f.status };
    setBusy(true);
    try {
      const res = await api<{ message: string }>(row ? `/master/${kind}/${row.id}` : `/master/${kind}`, { method: row ? "PUT" : "POST", body });
      toast.show("SAVED", res.message, "ok");
      reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Row) {
    if (!(await dlg.confirm({ title: `DELETE ${m.label}`, message: `ลบ ${m.label} "${r.code}"${r.name ? ` (${r.name})` : ""} ?`, ok: "DELETE", danger: true }))) return;
    try {
      const res = await api<{ message: string }>(`/master/${kind}/${r.id}`, { method: "DELETE" });
      toast.show("DELETED", res.message, "ok");
      if (row?.id === r.id) reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const fld = (label: string, node: React.ReactNode, wide = false) => (
    <label className={`block min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      {node}
    </label>
  );
  const numIn = (v: string, on: (s: string) => void, ph: string) => (
    <input className="field font-mono" inputMode="decimal" readOnly={ro} value={v} placeholder={ph} onChange={(e) => on(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && !ro && save()} />
  );
  const cols = mach ? 11 : 10;
  const showForm = can.add || mode !== "add";

  return (
    <PageBody className="md-gray md-partner">
      <PageHeader icon={m.icon} title={m.title} subtitle={`MASTER DATA · ${m.hint}`} />
      <div className="flex flex-col gap-4">
        {showForm && (
          <div ref={formRef} className="scroll-mt-4">
            <Card
              title={mode === "edit" ? `✏️ EDIT ${m.label}` : mode === "view" ? `👁 VIEW ${m.label}` : `＋ REGISTER ${m.label}`}
              actions={row ? <span className="md-status is-on">{row.code}</span> : undefined}
              bodyClass="p-4 md:p-5"
            >
              <div className="reg-fields grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {mach
                  ? fld("MACHINE TYPE *", <ComboBox value={f.type} onChange={(v) => set({ type: v })} options={typeOpts} free={upper} disabled={ro} ariaLabel="MACHINE TYPE" placeholder="เลือก / พิมพ์ประเภทใหม่ เช่น PRESS 200T" />)
                  : fld(
                      "OWNER TYPE *",
                      ro ? (
                        <input className="field" readOnly value={f.owner} />
                      ) : (
                        <Select value={f.owner} onChange={(v) => set({ owner: v, customer: v === "COMPANY" ? "" : f.customer })} ariaLabel="OWNER TYPE" options={[{ value: "CUSTOMER", label: "CUSTOMER (ของลูกค้า)" }, { value: "COMPANY", label: "COMPANY (ของบริษัท)" }]} />
                      ),
                    )}
                {!mach &&
                  fld(
                    f.owner === "CUSTOMER" ? "CUSTOMER *" : "CUSTOMER",
                    <ComboBox value={f.customer} onChange={(v) => set({ customer: v })} options={custOpts} disabled={ro || f.owner === "COMPANY"} ariaLabel="CUSTOMER" placeholder={f.owner === "COMPANY" ? "แม่พิมพ์ของบริษัท (ไม่ต้องเลือก)" : "พิมพ์ค้นหา / เลือกลูกค้า"} />,
                  )}
                {fld(`${m.label} CODE *`, <input className="field font-mono font-bold uppercase" readOnly={ro} maxLength={50} value={f.code} placeholder={mach ? "เช่น PR-200-01" : "เช่น MD-0001"} onChange={(e) => set({ code: e.target.value.toUpperCase() })} onKeyDown={(e) => e.key === "Enter" && !ro && save()} />)}
                {fld(`${m.label} NAME`, <input className="field" readOnly={ro} maxLength={200} value={f.name} placeholder="เติมทีหลังได้" onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && !ro && save()} />, mach)}
                {fld(`${m.label} ZONE`, <ComboBox value={f.zone} onChange={(v) => set({ zone: v })} options={zoneOpts} free={upper} disabled={ro} ariaLabel={`${m.label} ZONE`} placeholder="เลือก / พิมพ์โซนใหม่" />)}
                {mach ? (
                  <>
                    {fld("STD SETUP TIME (MIN.)", numIn(f.setup, (v) => set({ setup: v }), "เช่น 30"))}
                    {fld("CHANGE MOLD TIME (MIN.)", numIn(f.change, (v) => set({ change: v }), "เช่น 45"))}
                    {fld("MACHINE SPEED (STROKE/HR)", numIn(f.speed, (v) => set({ speed: v.replace(".", "") }), "เช่น 600"))}
                  </>
                ) : (
                  fld("PARTS PER STROKE (ชิ้น/จังหวะ)", numIn(f.pps, (v) => set({ pps: v.replace(".", "") }), "เช่น 2"))
                )}
                {fld(
                  "STATUS",
                  ro ? (
                    <input className="field" readOnly value={STATUS_LABEL[f.status]} />
                  ) : (
                    <Select value={f.status} onChange={(v) => set({ status: v })} ariaLabel="STATUS" options={(mach ? ["ACTIVE", "INACTIVE"] : ["ACTIVE", "REPAIR", "INACTIVE"]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
                  ),
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  {row ? (
                    <div className="md-meta">
                      <span>
                        UPDATE DATE <b>{stamp(row.updatedDate)}</b> {row.updatedBy ? `· ${row.updatedBy}` : ""}
                      </span>
                      <span>
                        CREATED <b>{stamp(row.createdDate)}</b> {row.createdBy ? `· ${row.createdBy}` : ""}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-ink-soft">{mach ? "MACHINE CODE ห้ามซ้ำ · MACHINE TYPE ใช้จัดกลุ่มในตาราง" : "MOLD CODE ห้ามซ้ำ · แม่พิมพ์ของบริษัทไม่ต้องเลือก CUSTOMER"}</span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {mode !== "view" && (
                    <button type="button" className="btn-ghost min-w-[120px]" disabled={busy} onClick={reset}>
                      {mode === "edit" ? "✕ CANCEL" : "↺ RESET"}
                    </button>
                  )}
                  {mode === "view" ? (
                    can.edit && (
                      <button type="button" className="btn bg-accent min-w-[180px]" onClick={() => setMode("edit")}>
                        ✏ EDIT
                      </button>
                    )
                  ) : (
                    <button type="button" className={`btn min-w-[180px] ${mode === "edit" ? "bg-success" : "bg-accent"}`} disabled={busy} onClick={save}>
                      {busy ? "…" : mode === "edit" ? "💾 SAVE CHANGES" : `＋ ${m.label} REGISTRATION`}
                    </button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        <Card title={`${m.label}S • ${rows.length.toLocaleString()}`}>
          <div className="md-toolbar">
            <div className="md-seg" role="tablist" style={{ "--n": (m.tabs as readonly string[]).indexOf(tab) } as React.CSSProperties}>
              <span className="md-seg-glider" aria-hidden />
              {m.tabs.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={tab === s} className={tab === s ? "is-on" : ""} onClick={() => setTab(s)}>
                  {s}
                  <b>{(counts[s] ?? 0).toLocaleString()}</b>
                </button>
              ))}
            </div>
            <SearchBox value={key} onChange={setKey} placeholder={mach ? "ค้นหา CODE / NAME / TYPE / ZONE" : "ค้นหา CODE / NAME / CUSTOMER / ZONE"} className="md-search ml-auto w-[340px] max-w-full" />
          </div>
          {!data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>{all.length ? "ไม่พบรายการที่ค้นหา" : `ยังไม่มี ${m.label}`}</Empty>
          ) : (
            <div className="overflow-auto">
              <table className="data-table t-center w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-14 text-center">NO.</th>
                    <th>{m.label} CODE</th>
                    <th>{m.label} NAME</th>
                    {mach ? <th>MACHINE TYPE</th> : <th>OWNER</th>}
                    <th>ZONE</th>
                    {mach ? (
                      <>
                        <th>STD SETUP (MIN.)</th>
                        <th>CHANGE MOLD (MIN.)</th>
                        <th>SPEED (STROKE/HR)</th>
                      </>
                    ) : (
                      <>
                        <th>CUSTOMER</th>
                        <th>PCS / STROKE</th>
                      </>
                    )}
                    <th>STATUS</th>
                    <th>UPDATE DATE</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                      <GroupRow
                        colSpan={cols}
                        label={mach ? "MACHINE TYPE" : g.key === COMPANY ? "OWNER" : "CUSTOMER"}
                        value={g.key}
                        count={g.items.length}
                        collapsed={collapsed.has(g.key)}
                        onToggle={() => toggleGroup(g.key)}
                      />
                      {!collapsed.has(g.key) &&
                        g.items.map((r, i) => (
                          <tr key={r.id} className={`${r.status === "INACTIVE" ? "opacity-60" : ""} ${row?.id === r.id ? "is-picked" : ""}`}>
                            <td data-l="NO." className="text-center">
                              {i + 1}
                            </td>
                            <td data-l="CODE" className="font-mono font-extrabold">
                              {r.code}
                            </td>
                            <td data-l="NAME" className="font-semibold">
                              {r.name || <span className="text-ink-soft">-</span>}
                            </td>
                            {mach ? <td data-l="TYPE">{r.type}</td> : <td data-l="OWNER">{r.owner}</td>}
                            <td data-l="ZONE">{r.zone || "-"}</td>
                            {mach ? (
                              <>
                                <td data-l="STD SETUP (MIN.)" className="font-mono">
                                  {num(r.setupMin)}
                                </td>
                                <td data-l="CHANGE MOLD (MIN.)" className="font-mono">
                                  {num(r.changeMoldMin)}
                                </td>
                                <td data-l="SPEED (STROKE/HR)" className="font-mono">
                                  {num(r.speed)}
                                </td>
                              </>
                            ) : (
                              <>
                                <td data-l="CUSTOMER" title={r.customerName ?? undefined}>
                                  {r.customer || "-"}
                                </td>
                                <td data-l="PCS / STROKE" className="font-mono">
                                  {num(r.partsPerStroke)}
                                </td>
                              </>
                            )}
                            <td data-l="STATUS">
                              <span className={`md-status ${r.status === "ACTIVE" ? "is-on" : r.status === "REPAIR" ? "is-repair" : ""}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                            </td>
                            <td data-l="UPDATE DATE" className="whitespace-nowrap font-mono text-xs" title={r.updatedBy ? `โดย ${r.updatedBy}` : undefined}>
                              {stamp(r.updatedDate)}
                            </td>
                            <td data-l="ACTION">
                              <RowActions>
                                <RowAction kind="view" active={row?.id === r.id && mode === "view"} onClick={() => (row?.id === r.id && mode === "view" ? reset() : open(r, "view"))} />
                                {can.edit && <RowAction kind="edit" active={row?.id === r.id && mode === "edit"} onClick={() => (row?.id === r.id && mode === "edit" ? reset() : open(r, "edit"))} />}
                                {can.delete && <RowAction kind="delete" onClick={() => remove(r)} />}
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
      </div>
    </PageBody>
  );
}
