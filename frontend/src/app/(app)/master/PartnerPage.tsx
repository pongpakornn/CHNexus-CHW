"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { Pager } from "@/components/tables/Pager";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";

// 🗂 MASTER DATA › Customer Information / Supplier Information (หน้าเดียวใช้ทั้งสองตาราง: kind)
//   ฟอร์มกรอกอยู่ด้านบนแบบ Product Control (REGISTER) · ตารางอยู่ด้านล่าง: CODE · NAME · STATUS · ใช้ในสินค้า · UPDATE DATE · ACTION (ดู / แก้ไข / ลบ)
//   👁 / ✏ ในตาราง = โหลดรายการขึ้นฟอร์มด้านบน (ดูอย่างเดียว / แก้ไข) · RESET = ล้างฟอร์มกลับเป็นเพิ่มใหม่
//   เพิ่มใหม่ = ACTIVE อัตโนมัติ · รหัสที่มีสินค้าใช้อยู่: เปลี่ยนรหัส / ลบไม่ได้ (เปลี่ยนเป็น INACTIVE แทน) · Server ตรวจสิทธิ์ซ้ำทุกครั้ง
type Kind = "customers" | "suppliers";
type Row = { id: number; code: string; name: string | null; isActive: boolean; createdBy: string | null; createdDate: string; updatedBy: string | null; updatedDate: string; parts: number };
type Data = { label: string; can: { add: boolean; edit: boolean; delete: boolean }; rows: Row[] };
type Status = "ALL" | "ACTIVE" | "INACTIVE";
type Mode = "add" | "edit" | "view";
const PAGE = 50;

const META: Record<Kind, { title: string; icon: string; hint: string }> = {
  customers: { title: "CUSTOMER INFORMATION", icon: "/icons/Customer.png", hint: "ข้อมูลลูกค้ากลางของทุกระบบ" },
  suppliers: { title: "SUPPLIER INFORMATION", icon: "/icons/Supplier.png", hint: "ข้อมูลผู้ขาย / ผู้ส่งของกลางของทุกระบบ" },
};

const STATUSES: Status[] = ["ALL", "ACTIVE", "INACTIVE"];

export function PartnerPage({ kind }: { kind: Kind }) {
  const toast = useToast();
  const dlg = useDialogs();
  const m = META[kind];
  const [data, setData] = useState<Data | null>(null);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 200);
  const [status, setStatus] = useState<Status>("ALL");
  const [page, setPage] = useState(0);
  // ฟอร์มด้านบน
  const [mode, setMode] = useState<Mode>("add");
  const [row, setRow] = useState<Row | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      try {
        setData(await api<Data>(`/master/${kind}`));
      } catch (e) {
        if (!quiet) toast.show("ERROR", `โหลด ${m.title} ไม่สำเร็จ\n` + (e as Error).message, "error");
        if (!quiet) setData((d) => d ?? { label: "", can: { add: false, edit: false, delete: false }, rows: [] });
      }
    },
    [kind, m.title, toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["master"], () => load(true)); // เครื่องอื่นเพิ่ม / แก้ = อัพเดทเอง

  const label = data?.label || (kind === "customers" ? "CUSTOMER" : "SUPPLIER");
  const can = data?.can ?? { add: false, edit: false, delete: false };
  const rows = useMemo(() => {
    const q = k.trim().toUpperCase();
    return (data?.rows ?? []).filter(
      (r) => (status === "ALL" || (status === "ACTIVE") === r.isActive) && (!q || r.code.includes(q) || (r.name ?? "").toUpperCase().includes(q)),
    );
  }, [data, k, status]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const counts = { ALL: data?.rows.length ?? 0, ACTIVE: data?.rows.filter((r) => r.isActive).length ?? 0, INACTIVE: data?.rows.filter((r) => !r.isActive).length ?? 0 };

  const ro = mode === "view";
  const codeLocked = ro || (!!row && row.parts > 0);

  function reset() {
    setMode("add");
    setRow(null);
    setCode("");
    setName("");
    setActive(true);
  }
  // 👁 / ✏ ในตาราง = ขึ้นฟอร์มด้านบน แล้วเลื่อนขึ้นไปหา
  function open(r: Row, m2: Mode) {
    setMode(m2);
    setRow(r);
    setCode(r.code);
    setName(r.name ?? "");
    setActive(r.isActive);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (m2 === "edit") setTimeout(() => codeRef.current?.focus(), 350);
  }

  async function save() {
    if (!code.trim()) return toast.show("WARNING", `กรุณากรอก ${label} CODE`, "warn");
    setBusy(true);
    try {
      const body = { code: code.trim(), name: name.trim(), isActive: active };
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
    if (r.parts > 0) return toast.show("ลบไม่ได้", `${label} ${r.code} มีสินค้าใช้อยู่ ${r.parts.toLocaleString()} รายการ\nเปลี่ยนสถานะเป็น INACTIVE แทน`, "warn");
    if (!(await dlg.confirm({ title: `DELETE ${label}`, message: `ลบ ${label} "${r.code}"${r.name ? ` (${r.name})` : ""} ?`, ok: "DELETE", danger: true }))) return;
    try {
      const res = await api<{ message: string }>(`/master/${kind}/${r.id}`, { method: "DELETE" });
      toast.show("DELETED", res.message, "ok");
      if (row?.id === r.id) reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const showForm = can.add || mode !== "add";

  return (
    <PageBody className="md-gray md-partner">
      <PageHeader icon={m.icon} title={m.title} subtitle={`MASTER DATA · ${m.hint}`} />
      <div className="flex flex-col gap-4">
        {/* ฟอร์มกรอกข้อมูล (แบบ Product Control): เพิ่มใหม่ / แก้ไข / ดู */}
        {showForm && (
          <div ref={formRef} className="scroll-mt-4">
            <Card
              title={mode === "edit" ? `✏️ EDIT ${label}` : mode === "view" ? `👁 VIEW ${label}` : `＋ REGISTER ${label}`}
              actions={mode !== "add" && row ? <span className={`md-status ${row.isActive ? "is-on" : ""}`}>{row.code}</span> : undefined}
              bodyClass="p-4 md:p-5"
            >
              <div className="reg-fields grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label} CODE *</span>
                  <input
                    ref={codeRef}
                    className="field font-mono font-bold uppercase"
                    readOnly={codeLocked}
                    maxLength={50}
                    value={code}
                    placeholder="เช่น CHW"
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && !ro && save()}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label} NAME</span>
                  <input className="field" readOnly={ro} maxLength={200} value={name} placeholder="เติมทีหลังได้" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !ro && save()} />
                </label>
                <div className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">STATUS</span>
                  <div className="flex h-10 items-center gap-2">
                    <button type="button" role="switch" aria-checked={active} disabled={ro || !row} className={`sw ${active ? "is-on" : ""}`} onClick={() => setActive((v) => !v)}>
                      <span className="sw-track" />
                      {active ? "ACTIVE" : "INACTIVE"}
                    </button>
                  </div>
                </div>
              </div>
              {row && row.parts > 0 && mode === "edit" && <p className="mt-2 text-xs font-bold text-warning">มีสินค้าใช้รหัสนี้ {row.parts.toLocaleString()} รายการ · เปลี่ยนรหัสไม่ได้ (แก้ชื่อ / สถานะได้)</p>}

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
                      <span>
                        USED IN PARTS <b>{row.parts.toLocaleString()}</b>
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-ink-soft">เพิ่มใหม่ = ACTIVE อัตโนมัติ · กด Enter เพื่อบันทึกได้</span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button type="button" className="btn-ghost min-w-[120px]" disabled={busy} onClick={reset}>
                    {mode === "add" ? "↺ RESET" : "✕ CANCEL"}
                  </button>
                  {mode === "view" ? (
                    can.edit && (
                      <button type="button" className="btn bg-accent min-w-[180px]" onClick={() => setMode("edit")}>
                        ✏ EDIT
                      </button>
                    )
                  ) : mode === "edit" ? (
                    <button type="button" className="btn bg-success min-w-[180px]" disabled={busy} onClick={save}>
                      {busy ? "…" : "💾 SAVE CHANGES"}
                    </button>
                  ) : (
                    <button type="button" className="btn bg-accent min-w-[180px]" disabled={busy} onClick={save}>
                      {busy ? "…" : `＋ ${label} REGISTRATION`}
                    </button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        <Card title={`${label}S • ${rows.length.toLocaleString()}`}>
          {/* แถบเครื่องมือ: มีระยะห่างจากขอบการ์ด */}
          <div className="md-toolbar">
            {/* แท็บสถานะ: แถบเทาเข้มเลื่อนไปหาแท็บที่เลือก */}
            <div className="md-seg" role="tablist" style={{ "--n": STATUSES.indexOf(status) } as React.CSSProperties}>
              <span className="md-seg-glider" aria-hidden />
              {STATUSES.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? "is-on" : ""} onClick={() => (setStatus(s), setPage(0))}>
                  {s}
                  <b>{counts[s].toLocaleString()}</b>
                </button>
              ))}
            </div>
            <SearchBox value={key} onChange={(v) => (setKey(v), setPage(0))} placeholder="ค้นหา CODE / NAME" className="md-search ml-auto w-[340px] max-w-full" />
          </div>
          {!data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>{data.rows.length ? "ไม่พบรายการที่ค้นหา" : `ยังไม่มี ${label}`}</Empty>
          ) : (
            <>
              <div className="overflow-auto">
                <table className="data-table t-center w-full">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="w-14 text-center">NO.</th>
                      <th>{label} CODE</th>
                      <th>{label} NAME</th>
                      <th>STATUS</th>
                      <th>USED IN PARTS</th>
                      <th>UPDATE DATE</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={r.id} className={`${r.isActive ? "" : "opacity-60"} ${row?.id === r.id ? "is-picked" : ""}`}>
                        <td className="text-center">{cur * PAGE + i + 1}</td>
                        <td className="font-mono font-extrabold">{r.code}</td>
                        <td className="font-semibold">{r.name || <span className="text-ink-soft">-</span>}</td>
                        <td>
                          <span className={`md-status ${r.isActive ? "is-on" : ""}`}>{r.isActive ? "ACTIVE" : "INACTIVE"}</span>
                        </td>
                        <td className="font-bold">{r.parts ? r.parts.toLocaleString() : "-"}</td>
                        <td className="whitespace-nowrap font-mono text-xs" title={r.updatedBy ? `โดย ${r.updatedBy}` : undefined}>
                          {stamp(r.updatedDate)}
                        </td>
                        <td>
                          <RowActions>
                            <RowAction kind="view" onClick={() => open(r, "view")} />
                            {can.edit && <RowAction kind="edit" active={row?.id === r.id && mode === "edit"} onClick={() => open(r, "edit")} />}
                            {can.delete && <RowAction kind="delete" title={r.parts ? "มีสินค้าใช้อยู่ ลบไม่ได้ (เปลี่ยนเป็น INACTIVE แทน)" : "DELETE"} onClick={() => remove(r)} />}
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && <Pager page={cur} pages={pages} total={rows.length} size={PAGE} onPage={setPage} />}
            </>
          )}
        </Card>
      </div>
    </PageBody>
  );
}
