"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Empty, Loading } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { ClockField } from "@/components/forms/ClockField";
import { Select } from "@/components/dropdowns/Select";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { useLive } from "@/lib/live";

// ⏸ COMPANY WORKDAYS › BREAK TIMES: break / pause times per shift (production time counting stops inside these ranges)
//   ADD / EDIT / DELETE = EDIT right of the workday calendar (server checks again) · END earlier than START = crosses midnight
type Row = { id: number; name: string; shift: "DAY" | "NIGHT" | "ALL"; start: string; end: string; isActive: boolean; updatedBy: string | null; updatedDate: string };
type Form = { name: string; shift: string; start: string; end: string; active: boolean };
const EMPTY: Form = { name: "", shift: "DAY", start: "", end: "", active: true };
const SHIFTS = [
  { value: "DAY", label: "☀ DAY (กะเช้า)" },
  { value: "NIGHT", label: "🌙 NIGHT (กะดึก)" },
  { value: "ALL", label: "ALL (ทุกกะ)" },
];
const mins = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
/** break length in minutes (END <= START = next day) */
export const breakMinutes = (start: string, end: string) => (mins(end) - mins(start) + 1440) % 1440 || 1440;

export function BreakTimes() {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<{ canEdit: boolean; rows: Row[] } | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));

  const load = useCallback(
    async (quiet = false) => {
      try {
        setData(await api<{ canEdit: boolean; rows: Row[] }>("/maxmin/workdays/breaks"));
      } catch (e) {
        if (quiet) return;
        toast.show("ERROR", "โหลดเวลาพักไม่สำเร็จ\n" + (e as Error).message, "error");
        setData((d) => d ?? { canEdit: false, rows: [] });
      }
    },
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["maxmin"], () => load(true));

  const reset = () => (setEdit(null), setF(EMPTY));
  const pick = (r: Row) => (setEdit(r), setF({ name: r.name, shift: r.shift, start: r.start, end: r.end, active: r.isActive }));

  async function save() {
    if (!f.name.trim()) return toast.show("WARNING", "กรุณากรอกชื่อเวลาพัก (เช่น พักเที่ยง)", "warn");
    if (!f.start || !f.end) return toast.show("WARNING", "กรุณาเลือกเวลาเริ่ม และเวลาสิ้นสุด", "warn");
    if (f.start === f.end) return toast.show("WARNING", "เวลาเริ่มกับเวลาสิ้นสุดต้องไม่เท่ากัน", "warn");
    setBusy(true);
    try {
      const body = { name: f.name, shift: f.shift, start: f.start, end: f.end, isActive: f.active };
      const res = await api<{ message: string }>(edit ? `/maxmin/workdays/breaks/${edit.id}` : "/maxmin/workdays/breaks", { method: edit ? "PUT" : "POST", body });
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
    if (!(await dlg.confirm({ title: "DELETE BREAK", message: `ลบเวลาพัก "${r.name}" (${r.shift} ${r.start} - ${r.end}) ?`, ok: "DELETE", danger: true }))) return;
    try {
      const res = await api<{ message: string }>(`/maxmin/workdays/breaks/${r.id}`, { method: "DELETE" });
      toast.show("DELETED", res.message, "ok");
      if (edit?.id === r.id) reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const total = (s: string) => (data?.rows ?? []).filter((r) => r.isActive && (r.shift === s || r.shift === "ALL")).reduce((a, r) => a + breakMinutes(r.start, r.end), 0);

  return (
    <Card title={`⏸ BREAK TIMES • เวลาหยุดนับชั่วคราว`} bodyClass="p-4 md:p-5">
      <p className="mb-3 text-xs font-bold text-ink-soft">
        เวลาพัก / เบรค / หยุดอื่น ๆ ของบริษัท · ระบบผลิตจะหยุดนับเวลาในช่วงนี้อัตโนมัติ · เวลาสิ้นสุดน้อยกว่าเวลาเริ่ม = ข้ามเที่ยงคืน
        {data && data.rows.length > 0 && (
          <span className="ml-1 text-ink">
            · รวมต่อกะ: DAY <b>{total("DAY")}</b> นาที · NIGHT <b>{total("NIGHT")}</b> นาที
          </span>
        )}
      </p>
      {data?.canEdit && (
        <div className="mb-4 grid grid-cols-1 items-end gap-3 rounded-2xl border border-line/70 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">BREAK NAME *</span>
            <input className="field" maxLength={100} value={f.name} placeholder="เช่น พักเที่ยง / เบรคเช้า / ประชุม" onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">SHIFT *</span>
            <Select value={f.shift} onChange={(v) => set({ shift: v })} options={SHIFTS} ariaLabel="SHIFT" />
          </label>
          <ClockField label="START *" value={f.start} onChange={(v) => set({ start: v })} clearable={false} />
          <ClockField label="END *" value={f.end} onChange={(v) => set({ end: v })} clearable={false} />
          <div className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">STATUS</span>
            <div className="flex h-10 items-center">
              <button type="button" role="switch" aria-checked={f.active} className={`sw ${f.active ? "is-on" : ""}`} onClick={() => set({ active: !f.active })}>
                <span className="sw-track" />
                {f.active ? "ACTIVE" : "INACTIVE"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2 xl:col-span-1">
            {edit && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={reset}>
                ✕ CANCEL
              </button>
            )}
            <button type="button" className={`btn min-w-[140px] ${edit ? "bg-success" : "bg-accent"}`} disabled={busy} onClick={save}>
              {busy ? "…" : edit ? "💾 SAVE" : "＋ ADD BREAK"}
            </button>
          </div>
        </div>
      )}
      {!data ? (
        <Loading />
      ) : data.rows.length === 0 ? (
        <Empty>ยังไม่มีเวลาพัก</Empty>
      ) : (
        <div className="overflow-auto">
          <table className="data-table t-center w-full">
            <thead>
              <tr>
                <th className="w-14 text-center">NO.</th>
                <th>BREAK NAME</th>
                <th>SHIFT</th>
                <th>START</th>
                <th>END</th>
                <th>MINUTES</th>
                <th>STATUS</th>
                <th>UPDATE DATE</th>
                {data.canEdit && <th>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.id} className={`${r.isActive ? "" : "opacity-60"} ${edit?.id === r.id ? "is-picked" : ""}`}>
                  <td data-l="NO." className="text-center">
                    {i + 1}
                  </td>
                  <td data-l="BREAK NAME" className="font-semibold">
                    {r.name}
                  </td>
                  <td data-l="SHIFT" className="font-bold">
                    {r.shift}
                  </td>
                  <td data-l="START" className="font-mono font-bold">
                    {r.start}
                  </td>
                  <td data-l="END" className="font-mono font-bold">
                    {r.end}
                    {mins(r.end) <= mins(r.start) && <span className="ml-1 text-[10px] text-ink-soft">(+1 วัน)</span>}
                  </td>
                  <td data-l="MINUTES" className="font-mono">
                    {breakMinutes(r.start, r.end)}
                  </td>
                  <td data-l="STATUS">
                    <span className={`md-status ${r.isActive ? "is-on" : ""}`}>{r.isActive ? "ACTIVE" : "INACTIVE"}</span>
                  </td>
                  <td data-l="UPDATE DATE" className="whitespace-nowrap font-mono text-xs" title={r.updatedBy ? `โดย ${r.updatedBy}` : undefined}>
                    {stamp(r.updatedDate)}
                  </td>
                  {data.canEdit && (
                    <td data-l="ACTION">
                      <RowActions>
                        <RowAction kind="edit" active={edit?.id === r.id} onClick={() => (edit?.id === r.id ? reset() : pick(r))} />
                        <RowAction kind="delete" onClick={() => remove(r)} />
                      </RowActions>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
