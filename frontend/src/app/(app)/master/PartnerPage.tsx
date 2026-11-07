"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { Pager } from "@/components/tables/Pager";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";

// 🗂 MASTER DATA › Customer Information / Supplier Information (หน้าเดียวใช้ทั้งสองตาราง: kind)
//   ตาราง: CODE · NAME · UPDATE DATE (DD-MM-YYYY:HH:mm:ss) · STATUS · ใช้ในสินค้า · ACTION (ดู / แก้ไข / ลบ)
//   เพิ่มใหม่ = ACTIVE อัตโนมัติ · รหัสที่มีสินค้าใช้อยู่: เปลี่ยนรหัส / ลบไม่ได้ (เปลี่ยนเป็น INACTIVE แทน) · Server ตรวจสิทธิ์ซ้ำทุกครั้ง
type Kind = "customers" | "suppliers";
type Row = { id: number; code: string; name: string | null; isActive: boolean; createdBy: string | null; createdDate: string; updatedBy: string | null; updatedDate: string; parts: number };
type Data = { label: string; can: { add: boolean; edit: boolean; delete: boolean }; rows: Row[] };
type Status = "ALL" | "ACTIVE" | "INACTIVE";
type Edit = { mode: "add" | "edit" | "view"; row?: Row };
const PAGE = 50;

const META: Record<Kind, { title: string; icon: string; hint: string }> = {
  customers: { title: "CUSTOMER INFORMATION", icon: "/icons/user.png", hint: "ข้อมูลลูกค้ากลางของทุกระบบ" },
  suppliers: { title: "SUPPLIER INFORMATION", icon: "/icons/StoreWarehouse.png", hint: "ข้อมูลผู้ขาย / ผู้ส่งของกลางของทุกระบบ" },
};

export function PartnerPage({ kind }: { kind: Kind }) {
  const toast = useToast();
  const dlg = useDialogs();
  const m = META[kind];
  const [data, setData] = useState<Data | null>(null);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 200);
  const [status, setStatus] = useState<Status>("ALL");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Edit | null>(null);

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

  async function remove(r: Row) {
    if (r.parts > 0) return toast.show("ลบไม่ได้", `${label} ${r.code} มีสินค้าใช้อยู่ ${r.parts.toLocaleString()} รายการ\nเปลี่ยนสถานะเป็น INACTIVE แทน`, "warn");
    if (!(await dlg.confirm({ title: `DELETE ${label}`, message: `ลบ ${label} "${r.code}"${r.name ? ` (${r.name})` : ""} ?`, ok: "DELETE" }))) return;
    try {
      const res = await api<{ message: string }>(`/master/${kind}/${r.id}`, { method: "DELETE" });
      toast.show("DELETED", res.message, "ok");
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  return (
    <PageBody className="md-gray">
      <PageHeader
        icon={m.icon}
        title={m.title}
        subtitle={`MASTER DATA · ${m.hint}`}
        actions={
          data?.can.add && (
            <button type="button" className="cta-btn is-green" onClick={() => setEdit({ mode: "add" })}>
              ＋ ADD {label}
            </button>
          )
        }
      />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mrs-tabs" role="tablist">
            {(["ALL", "ACTIVE", "INACTIVE"] as Status[]).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? "is-on" : ""} onClick={() => (setStatus(s), setPage(0))}>
                {s}
                <b>{counts[s].toLocaleString()}</b>
              </button>
            ))}
          </div>
          <SearchBox value={key} onChange={(v) => (setKey(v), setPage(0))} placeholder={`ค้นหา ${label} CODE / NAME`} className="ml-auto w-[280px] max-w-full" />
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
                    <tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
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
                          <RowAction kind="view" onClick={() => setEdit({ mode: "view", row: r })} />
                          {data.can.edit && <RowAction kind="edit" onClick={() => setEdit({ mode: "edit", row: r })} />}
                          {data.can.delete && <RowAction kind="delete" title={r.parts ? "มีสินค้าใช้อยู่ ลบไม่ได้ (เปลี่ยนเป็น INACTIVE แทน)" : "DELETE"} onClick={() => remove(r)} />}
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
      {edit && <PartnerModal kind={kind} label={label} edit={edit} canEdit={!!data?.can.edit} onEdit={() => setEdit((e) => (e ? { ...e, mode: "edit" } : e))} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), load(true))} />}
    </PageBody>
  );
}

// หน้าต่าง ดู / เพิ่ม / แก้ไข
function PartnerModal({ kind, label, edit, canEdit, onEdit, onClose, onSaved }: { kind: Kind; label: string; edit: Edit; canEdit: boolean; onEdit: () => void; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const r = edit.row;
  const ro = edit.mode === "view";
  const [code, setCode] = useState(r?.code ?? "");
  const [name, setName] = useState(r?.name ?? "");
  const [active, setActive] = useState(r?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const codeLocked = ro || (!!r && r.parts > 0);

  async function save() {
    if (!code.trim()) return toast.show("WARNING", `กรุณากรอก ${label} CODE`, "warn");
    setBusy(true);
    try {
      const body = { code: code.trim(), name: name.trim(), isActive: active };
      const res = await api<{ message: string }>(r ? `/master/${kind}/${r.id}` : `/master/${kind}`, { method: r ? "PUT" : "POST", body });
      toast.show("SAVED", res.message, "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={ro ? `👁 ${label} • ${r?.code}` : r ? `✏ EDIT ${label}` : `＋ ADD ${label}`}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            {ro ? "CLOSE" : "CANCEL"}
          </button>
          {ro ? (
            canEdit && (
              <button className="cta-btn is-purple" onClick={onEdit}>
                ✏ EDIT
              </button>
            )
          ) : (
            <button className="cta-btn is-green" onClick={save} disabled={busy}>
              {busy ? "…" : "💾 SAVE"}
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-3">
        <label className="fx">
          <span className="fx-cap">{label} CODE *</span>
          <input className="field fx-in font-mono font-bold uppercase" autoFocus={!codeLocked} readOnly={codeLocked} maxLength={50} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        {r && r.parts > 0 && !ro && <p className="-mt-1 text-xs font-bold text-warning">มีสินค้าใช้รหัสนี้ {r.parts.toLocaleString()} รายการ · เปลี่ยนรหัสไม่ได้ (แก้ชื่อ / สถานะได้)</p>}
        <label className="fx">
          <span className="fx-cap">{label} NAME</span>
          <input className="field fx-in" autoFocus={codeLocked && !ro} readOnly={ro} maxLength={200} value={name} placeholder="เติมทีหลังได้" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" role="switch" aria-checked={active} disabled={ro || !r} className={`sw ${active ? "is-on" : ""}`} onClick={() => setActive((v) => !v)}>
            <span className="sw-track" />
            {active ? "ACTIVE" : "INACTIVE"}
          </button>
          {!r && <span className="text-xs font-bold text-ink-soft">เพิ่มใหม่ = ACTIVE อัตโนมัติ</span>}
        </div>
        {r && (
          <div className="md-meta">
            <span>
              UPDATE DATE <b>{stamp(r.updatedDate)}</b> {r.updatedBy ? `· ${r.updatedBy}` : ""}
            </span>
            <span>
              CREATED <b>{stamp(r.createdDate)}</b> {r.createdBy ? `· ${r.createdBy}` : ""}
            </span>
            <span>
              USED IN PARTS <b>{r.parts.toLocaleString()}</b>
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
