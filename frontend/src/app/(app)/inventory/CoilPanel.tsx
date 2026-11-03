"use client";

import { useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";

export type CoilRow = { coilId: number; isMother: boolean; no: number; coilNo: string; motherCoil: string; weightKG: number; ton: number; received: string };

// 🧲 Coil ของสินค้าในคลัง (แบบหน้า STOCK-MAT): จัดกลุ่มตาม Master Coil
//   Master: ✏️ เปลี่ยนชื่อ (Coil ลูกเปลี่ยนตาม) · Coil ลูก: ✏️ แก้ COIL NO / MASTER / KG · 🗑 ลบ (เฉพาะที่ยังไม่เคยสแกน)
export function CoilPanel({
  rows,
  stkId,
  ptId,
  partCode,
  canEdit,
  canDelete,
  onChanged,
}: {
  rows: CoilRow[];
  stkId: number;
  ptId: number;
  partCode: string;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const dlg = useDialogs();
  const [edit, setEdit] = useState<{ id: number; coilNo: string; master: string; kg: string } | null>(null);
  const [rename, setRename] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const groups: { master: CoilRow; items: CoilRow[] }[] = [];
  for (const r of rows) {
    if (r.isMother) groups.push({ master: r, items: [] });
    else groups[groups.length - 1]?.items.push(r);
  }
  const totalKg = rows.filter((r) => !r.isMother).reduce((a, r) => a + r.weightKG, 0);
  const coilCount = rows.filter((r) => !r.isMother).length;

  async function run(fn: () => Promise<{ message: string }>) {
    setBusy(true);
    try {
      const r = await fn();
      toast.show("COIL", r.message, "ok");
      setEdit(null);
      setRename(null);
      onChanged();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = () =>
    edit && run(() => api(`/products/coils/${edit.id}`, { method: "PUT", body: { coilNo: edit.coilNo, masterCoil: edit.master, weightKg: edit.kg } }));

  const saveRename = () =>
    rename && rename.to.trim() && rename.to.trim() !== rename.from && run(() => api(`/products/${ptId}/coils/master`, { method: "POST", body: { stkId, from: rename.from, to: rename.to } }));

  async function remove(r: CoilRow) {
    const ok = await dlg.confirm({
      title: "DELETE COIL",
      danger: true,
      ok: "DELETE",
      message: `ลบ Coil ${r.coilNo} (${qty(r.weightKG)} KG) ของ ${partCode}?\n\nยอดคลังของสินค้าจะลดลง ${qty(r.weightKG)} KG\nลบได้เฉพาะ Coil ที่ลงทะเบียนผิดและยังไม่เคยถูกสแกน`,
    });
    if (ok) run(() => api(`/products/coils/${r.coilId}/delete`, { method: "POST" }));
  }

  if (coilCount === 0) return <div className="py-3 text-center text-xs font-bold text-ink-soft">ยังไม่มี Coil ในคลังของสินค้านี้</div>;

  return (
    <div className="cp">
      <div className="cp-sum">
        <span>🧲 {groups.length.toLocaleString()} MASTER</span>
        <span>{coilCount.toLocaleString()} COIL</span>
        <span>{qty(totalKg)} KG</span>
        <span>{qty(Math.round(totalKg / 10) / 100)} TON</span>
      </div>
      {groups.map((g, gi) => {
        const name = g.master.motherCoil;
        const renaming = rename?.from === name;
        return (
          <div key={name + gi} className="cp-group" style={{ animationDelay: `${gi * 40}ms` }}>
            <div className="cp-master">
              <span className="cp-tag">MASTER</span>
              {renaming ? (
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    className="field !h-8 w-48 !py-1"
                    autoFocus
                    value={rename.to}
                    onChange={(e) => setRename({ ...rename, to: e.target.value })}
                    onKeyDown={(e) => (e.key === "Enter" ? saveRename() : e.key === "Escape" && setRename(null))}
                  />
                  <button className="cta-btn is-purple is-sm" disabled={busy} onClick={saveRename}>
                    SAVE
                  </button>
                  <button className="fill-btn is-xs" onClick={() => setRename(null)}>
                    CANCEL
                  </button>
                </span>
              ) : (
                <b className="cp-mname">{name}</b>
              )}
              <span className="cp-meta">
                {g.items.length} COIL • {qty(g.items.reduce((a, r) => a + r.weightKG, 0))} KG
              </span>
              {canEdit && !renaming && (
                <span className="ml-auto">
                  <RowAction kind="edit" title="เปลี่ยนชื่อ MASTER COIL (Coil ลูกเปลี่ยนตาม)" onClick={() => (setEdit(null), setRename({ from: name, to: name }))} />
                </span>
              )}
            </div>
            {g.items.map((r) =>
              edit?.id === r.coilId ? (
                <div key={r.coilId} className="cp-row is-edit">
                  <span className="cp-no">{r.no}</span>
                  <label className="cp-f">
                    <span>COIL NO</span>
                    <input className="field !h-8 !py-1" autoFocus value={edit.coilNo} onChange={(e) => setEdit({ ...edit, coilNo: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                  </label>
                  <label className="cp-f">
                    <span>MASTER COIL</span>
                    <input className="field !h-8 !py-1" value={edit.master} placeholder="ว่าง = Master ทั้งม้วน" onChange={(e) => setEdit({ ...edit, master: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                  </label>
                  <label className="cp-f !w-28">
                    <span>WEIGHT (KG)</span>
                    <input className="field !h-8 !py-1" inputMode="decimal" value={edit.kg} onChange={(e) => setEdit({ ...edit, kg: e.target.value.replace(/[^\d.,]/g, "") })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                  </label>
                  <span className="ml-auto flex gap-2">
                    <button className="cta-btn is-purple is-sm" disabled={busy} onClick={saveEdit}>
                      💾 SAVE
                    </button>
                    <button className="fill-btn is-xs" onClick={() => setEdit(null)}>
                      CANCEL
                    </button>
                  </span>
                </div>
              ) : (
                <div key={r.coilId} className="cp-row">
                  <span className="cp-no">{r.no}</span>
                  <b className="min-w-[150px] text-[#1f2350]">{r.coilNo}</b>
                  <span className="w-28 text-right font-extrabold tabular-nums">{qty(r.weightKG)} KG</span>
                  <span className="text-ink-soft">{r.received}</span>
                  {(canEdit || canDelete) && (
                    <RowActions className="ml-auto">
                      {canEdit && (
                        <RowAction
                          kind="edit"
                          title="แก้ COIL NO / MASTER / KG"
                          onClick={() => (setRename(null), setEdit({ id: r.coilId, coilNo: r.coilNo, master: r.motherCoil && r.motherCoil !== r.coilNo ? r.motherCoil : "", kg: String(r.weightKG) }))}
                        />
                      )}
                      {canDelete && <RowAction kind="delete" title="ลบ Coil ที่ลงผิด (ยังไม่เคยสแกน)" onClick={() => remove(r)} />}
                    </RowActions>
                  )}
                </div>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
