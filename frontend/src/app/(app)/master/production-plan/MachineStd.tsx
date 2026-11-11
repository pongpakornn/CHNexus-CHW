"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { sameData, useLive } from "@/lib/live";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { deptOf, type PpShift } from "@/lib/pp";
import { useRouter, useSearchParams } from "next/navigation";
import { DeptPicker } from "../../pp/shared";
import "../../pp/pp.css";

// 📈 MASTER DATA › PRODUCTION PLAN › MACHINE STD
//   เครื่องจักรของหน่วยงาน (PRESS 1) + ค่า STD ที่ใช้คำนวณ: C2 Q'ty Line · C4 Target Eff · P7 STD Man Power/Line · C3 SPH 100% (เว้นว่าง = คำนวณจากตาราง Product)
//   PLAN SPH (C5-C9): ชั่วโมงต่อกะ · ค่ากลางของสูตร P8 (×1.023) / P9 (÷11) · ทุกการบันทึกลง Activity Log · จออื่นอัพเดทเอง
type Machine = { id: number; dept: string; code: string; group: string; subGroup: string | null; sort: number; qty: number; eff: number; man: number; sph: number | null; byPcs: boolean; active: boolean; parts: number; updatedBy: string | null; updatedAt: string };
type Data = { machines: Machine[]; shifts: PpShift[]; settings: Record<string, number>; can: { add: boolean; edit: boolean; delete: boolean } };
type Form = { code: string; group: string; subGroup: string; sort: string; qty: string; eff: string; man: string; sph: string; byPcs: boolean; active: boolean };
const EMPTY: Form = { code: "", group: "", subGroup: "", sort: "", qty: "1", eff: "85", man: "1", sph: "", byPcs: false, active: true };

export default function MachineStd() {
  const router = useRouter();
  const params = useSearchParams();
  const [DEPT, setDeptState] = useState(() => deptOf(params.get("dept")).code as string);
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const [data, setData] = useState<Data | null>(null);
  const [row, setRow] = useState<Machine | null>(null);
  const [view, setView] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 150).trim().toUpperCase();
  const [shifts, setShifts] = useState<PpShift[]>([]);
  const [factor, setFactor] = useState("1.023");
  const [perDay, setPerDay] = useState("11");
  const [stdDirty, setStdDirtyState] = useState(false);
  const stdDirtyRef = useRef(false);
  const setStdDirty = (v: boolean) => {
    stdDirtyRef.current = v;
    setStdDirtyState(v);
  };
  const formRef = useRef<HTMLDivElement>(null);

  const last = useRef("");
  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<Data>("/pp/setup", { query: { dept: DEPT } });
        if (sameData(last, r) && quiet) return;
        setData(r);
        // กำลังแก้ Plan SPH ค้างอยู่ = ไม่ทับค่าที่พิมพ์
        if (!stdDirtyRef.current) {
          setShifts(r.shifts);
          setFactor(String(r.settings.ManHourFactor ?? 1.023));
          setPerDay(String(r.settings.ManHourPerDay ?? 11));
        }
      } catch (e) {
        if (!quiet) toast.show("ERROR", "โหลด Machine STD ไม่สำเร็จ\n" + (e as Error).message, "error");
        setData((d) => d ?? { machines: [], shifts: [], settings: {}, can: { add: false, edit: false, delete: false } });
      }
    },
    [toast, DEPT],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["pp"], () => load(true));

  const can = data?.can ?? { add: false, edit: false, delete: false };
  const rows = useMemo(() => (data?.machines ?? []).filter((m) => !k || m.code.toUpperCase().includes(k) || m.group.toUpperCase().includes(k) || (m.subGroup ?? "").toUpperCase().includes(k)), [data, k]);
  const groups = useMemo(() => [...new Set((data?.machines ?? []).map((m) => m.group))], [data]);
  const ro = view;
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));

  function reset() {
    setRow(null);
    setView(false);
    setF(EMPTY);
  }
  function open(m: Machine, v: boolean) {
    setRow(m);
    setView(v);
    setF({ code: m.code, group: m.group, subGroup: m.subGroup ?? "", sort: String(m.sort), qty: String(m.qty), eff: String(+(m.eff * 100).toFixed(2)), man: String(m.man), sph: m.sph == null ? "" : String(m.sph), byPcs: m.byPcs, active: m.active });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function save() {
    const n = (s: string) => Number(s.replace(/,/g, ""));
    if (!f.code.trim()) return toast.show("WARNING", "กรุณากรอกชื่อเครื่องจักร", "warn");
    if (!f.group.trim()) return toast.show("WARNING", "กรุณากรอก GROUP", "warn");
    for (const [v, l] of [
      [f.qty, "Q'ty Line"],
      [f.eff, "Target Eff"],
      [f.man, "STD Man Power"],
    ] as const)
      if (!isFinite(n(v)) || v.trim() === "") return toast.show("WARNING", `${l} ไม่ถูกต้อง`, "warn");
    if (f.sph.trim() && !(n(f.sph) > 0)) return toast.show("WARNING", "SPH 100% ต้องมากกว่า 0 (เว้นว่าง = คำนวณเอง)", "warn");
    setBusy(true);
    try {
      const body = {
        id: row?.id ?? 0,
        dept: DEPT,
        code: f.code.trim(),
        group: f.group.trim().toUpperCase(),
        subGroup: f.subGroup.trim() || null,
        sort: f.sort.trim() ? n(f.sort) : row?.sort ?? (data?.machines.length ?? 0) + 1,
        qty: n(f.qty),
        eff: n(f.eff) / 100,
        man: n(f.man),
        sph: f.sph.trim() ? n(f.sph) : null,
        byPcs: f.byPcs,
        active: f.active,
      };
      const r = await api<{ message: string }>("/pp/machines", { method: "POST", body });
      toast.show("SAVED", r.message, "ok");
      reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: Machine) {
    if (!(await dlg.confirm({ title: "DELETE MACHINE", message: `ลบเครื่อง "${m.code}" พร้อมตาราง Product ${m.parts} รายการ ?\n(มี Actual แล้วลบไม่ได้ · เปลี่ยนเป็น INACTIVE แทน)`, ok: "DELETE", danger: true }))) return;
    try {
      const r = await api<{ message: string }>(`/pp/machines/${m.id}`, { method: "DELETE" });
      toast.show("DELETED", r.message, "ok");
      if (row?.id === m.id) reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  async function saveStd() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/pp/settings", { method: "POST", body: { shifts: shifts.map((s) => ({ ...s, hours: Number(s.hours) })), factor: Number(factor), perDay: Number(perDay) } });
      toast.show("SAVED", r.message, "ok");
      setStdDirty(false);
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const showForm = can.add || !!row;
  const lab = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";

  return (
    <PageBody className="md-gray md-color-actions pp-page">
      <PageHeader
        icon="/icons/64engine_motorFF.png"
        title="PRODUCTION PLAN • MACHINE STD"
        subtitle={`MASTER DATA · เครื่องจักร ${deptOf(DEPT).name} + Target Eff · Plan SPH · ค่าที่ใช้คำนวณ Capacity`}
        actions={
          <Link href={`/master/production-plan/products?dept=${DEPT}`} className="btn-ghost">
            📋 MACHINE PRODUCTS
          </Link>
        }
      />
      <DeptPicker
        id="std"
        value={DEPT}
        onChange={(c) => {
          setDeptState(c);
          setData(null);
          reset();
          router.replace(`?dept=${c}`, { scroll: false });
        }}
      />
      {!data ? (
        <Loading />
      ) : (
        <>
          {showForm && (
            <motion.div ref={formRef} className="scroll-mt-4" variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={0}>
              <Card title={row ? (view ? `👁 VIEW ${row.code}` : `✏️ EDIT ${row.code}`) : "＋ REGISTER MACHINE"} bodyClass="p-4 md:p-5">
                <div className="pp-form">
                  <label className="is-wide">
                    <span className={lab}>MACHINE *</span>
                    <input className="field font-bold" readOnly={ro} maxLength={50} value={f.code} placeholder="เช่น PROG 200-19" onChange={(e) => set({ code: e.target.value })} />
                  </label>
                  <label>
                    <span className={lab}>GROUP *</span>
                    <input className="field font-bold uppercase" readOnly={ro} maxLength={30} value={f.group} list="pp-groups" placeholder="GROUP 1" onChange={(e) => set({ group: e.target.value.toUpperCase() })} />
                    <datalist id="pp-groups">
                      {groups.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span className={lab}>SUB GROUP</span>
                    <input className="field" readOnly={ro} maxLength={30} value={f.subGroup} placeholder="Group 1.1" onChange={(e) => set({ subGroup: e.target.value })} />
                  </label>
                  <label>
                    <span className={lab}>SORT</span>
                    <input className="field" readOnly={ro} inputMode="numeric" value={f.sort} placeholder="ลำดับ" onChange={(e) => /^\d*$/.test(e.target.value) && set({ sort: e.target.value })} />
                  </label>
                  <label>
                    <span className={lab}>C2 • Q&apos;TY LINE / MC *</span>
                    <input className="field text-right font-bold" readOnly={ro} inputMode="decimal" value={f.qty} onChange={(e) => set({ qty: e.target.value })} />
                  </label>
                  <label>
                    <span className={lab}>C4 • TARGET EFF (%) *</span>
                    <input className="field text-right font-bold" readOnly={ro} inputMode="decimal" value={f.eff} onChange={(e) => set({ eff: e.target.value })} />
                  </label>
                  <label>
                    <span className={lab}>P7 • STD MAN / LINE *</span>
                    <input className="field text-right font-bold" readOnly={ro} inputMode="decimal" value={f.man} onChange={(e) => set({ man: e.target.value })} />
                  </label>
                  <label>
                    <span className={lab}>C3 • SPH 100% (กำหนดเอง)</span>
                    <input className="field text-right" readOnly={ro} inputMode="decimal" value={f.sph} placeholder="AUTO" onChange={(e) => set({ sph: e.target.value })} />
                  </label>
                  <div>
                    <span className={lab}>STROKE</span>
                    <div className="flex h-10 items-center">
                      <button type="button" role="switch" aria-checked={f.byPcs} disabled={ro} className={`sw ${f.byPcs ? "is-on" : ""}`} onClick={() => set({ byPcs: !f.byPcs })} title="เครื่อง Transfer: Stroke = PCS ÷ Pcs./Stroke (ไม่คูณ Total Process)">
                        <span className="sw-track" />
                        {f.byPcs ? "= PCS (TRANSFER)" : "= PCS × PROCESS"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className={lab}>STATUS</span>
                    <div className="flex h-10 items-center">
                      <button type="button" role="switch" aria-checked={f.active} disabled={ro || !row} className={`sw ${f.active ? "is-on" : ""}`} onClick={() => set({ active: !f.active })}>
                        <span className="sw-track" />
                        {f.active ? "ACTIVE" : "INACTIVE"}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-center">
                  <span className="min-w-0 flex-1 text-xs font-bold text-ink-soft">
                    {row ? `UPDATE ${stamp(row.updatedAt)}${row.updatedBy ? " · " + row.updatedBy : ""} · PRODUCTS ${row.parts}` : "C3 เว้นว่าง = ΣStroke ÷ ΣMC Hr จากตาราง Product (เหมือน Excel)"}
                  </span>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button type="button" className="btn-ghost min-w-[120px]" disabled={busy} onClick={reset}>
                      {row ? "✕ CANCEL" : "↺ RESET"}
                    </button>
                    {view ? (
                      can.edit && (
                        <button type="button" className="btn bg-accent min-w-[160px]" onClick={() => setView(false)}>
                          ✏ EDIT
                        </button>
                      )
                    ) : (
                      <button type="button" className={`btn min-w-[180px] ${row ? "bg-success" : "bg-accent"}`} disabled={busy} onClick={save}>
                        {busy ? "…" : row ? "💾 SAVE CHANGES" : "＋ MACHINE REGISTRATION"}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={1}>
            <Card title={`MACHINES • ${deptOf(DEPT).name} • ${rows.length}`} actions={<SearchBox value={key} onChange={setKey} placeholder="ค้นหาเครื่อง / GROUP" className="w-[280px] max-w-full" />}>
              {rows.length === 0 ? (
                <Empty>{data.machines.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีเครื่องจักร"}</Empty>
              ) : (
                <div className="overflow-auto">
                  <table className="data-table t-center w-full">
                    <thead className="sticky top-0">
                      <tr>
                        <th className="w-14">NO.</th>
                        <th>MACHINE</th>
                        <th>GROUP</th>
                        <th>Q&apos;TY LINE</th>
                        <th>TARGET EFF</th>
                        <th>STD MAN</th>
                        <th>SPH 100%</th>
                        <th>PRODUCTS</th>
                        <th>STATUS</th>
                        <th>UPDATE DATE</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m, i) => (
                        <motion.tr
                          key={m.id}
                          className={`${m.active ? "" : "opacity-60"} ${row?.id === m.id ? "is-picked" : ""}`}
                          initial={reduce ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: m.active ? 1 : 0.6, y: 0 }}
                          transition={{ duration: 0.3, ease: EASE, delay: Math.min(i * 0.025, 0.4) }}
                        >
                          <td>{i + 1}</td>
                          <td className="font-extrabold">{m.code}</td>
                          <td>
                            <b>{m.group}</b>
                            {m.subGroup && <span className="block text-[11px] text-ink-soft">{m.subGroup}</span>}
                          </td>
                          <td className="font-bold">{m.qty}</td>
                          <td className="font-bold">{(m.eff * 100).toFixed(1)}%</td>
                          <td className="font-bold">{m.man}</td>
                          <td>
                            {m.sph == null ? <span className="pp-tag">AUTO</span> : <b>{m.sph}</b>}
                            {m.byPcs && <span className="block text-[10px] font-bold text-ink-soft">STROKE = PCS</span>}
                          </td>
                          <td>
                            <Link className="pp-link" href={`/master/production-plan/products?dept=${DEPT}&m=${m.id}`}>
                              {m.parts}
                            </Link>
                          </td>
                          <td>
                            <span className={`md-status ${m.active ? "is-on" : ""}`}>{m.active ? "ACTIVE" : "INACTIVE"}</span>
                          </td>
                          <td className="whitespace-nowrap font-mono text-xs" title={m.updatedBy ? `โดย ${m.updatedBy}` : undefined}>
                            {stamp(m.updatedAt)}
                          </td>
                          <td>
                            <RowActions>
                              <RowAction kind="view" onClick={() => open(m, true)} />
                              {can.edit && <RowAction kind="edit" active={row?.id === m.id && !view} onClick={() => open(m, false)} />}
                              {can.delete && <RowAction kind="delete" onClick={() => remove(m)} />}
                            </RowActions>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={2}>
            <Card title="PLAN SPH (C5–C9) • ค่ากลางของสูตร" bodyClass="p-4 md:p-5">
              <div className="pp-shifts">
                {shifts.map((s, i) => (
                  <div key={s.id} className="pp-shift-in">
                    <b>C{5 + i}</b>
                    <input
                      className="field"
                      readOnly={!can.edit}
                      maxLength={80}
                      value={s.name}
                      aria-label={`Shift name C${5 + i}`}
                      onChange={(e) => {
                        setStdDirty(true);
                        setShifts((l) => l.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)));
                      }}
                    />
                    <label>
                      <input
                        className="field text-right font-bold"
                        readOnly={!can.edit}
                        inputMode="decimal"
                        value={String(s.hours)}
                        aria-label={`Hours C${5 + i}`}
                        onChange={(e) => {
                          if (!/^\d*\.?\d*$/.test(e.target.value)) return;
                          setStdDirty(true);
                          setShifts((l) => l.map((x) => (x.id === s.id ? { ...x, hours: e.target.value as unknown as number } : x)));
                        }}
                      />
                      <span>Hrs.</span>
                    </label>
                  </div>
                ))}
                <div className="pp-shift-in is-k">
                  <b>P8</b>
                  <span className="lbl">Total Man Hour/Day = P6 × P7 × C2 × </span>
                  <label>
                    <input className="field text-right font-bold" readOnly={!can.edit} inputMode="decimal" value={factor} onChange={(e) => (setStdDirty(true), setFactor(e.target.value))} aria-label="Man hour factor" />
                  </label>
                </div>
                <div className="pp-shift-in is-k">
                  <b>P9</b>
                  <span className="lbl">Req. Man Power = P8 ÷ </span>
                  <label>
                    <input className="field text-right font-bold" readOnly={!can.edit} inputMode="decimal" value={perDay} onChange={(e) => (setStdDirty(true), setPerDay(e.target.value))} aria-label="Man hour per day" />
                    <span>Hrs.</span>
                  </label>
                </div>
              </div>
              {can.edit && (
                <div className="mt-4 flex justify-end gap-2 border-t border-line/60 pt-4">
                  <button
                    type="button"
                    className="btn-ghost min-w-[120px]"
                    disabled={busy || !stdDirty}
                    onClick={() => {
                      setStdDirty(false);
                      if (data) {
                        setShifts(data.shifts);
                        setFactor(String(data.settings.ManHourFactor ?? 1.023));
                        setPerDay(String(data.settings.ManHourPerDay ?? 11));
                      }
                    }}
                  >
                    ↺ RESET
                  </button>
                  <button type="button" className="btn bg-success min-w-[180px]" disabled={busy || !stdDirty} onClick={() => saveStd()}>
                    {busy ? "…" : "💾 SAVE PLAN SPH"}
                  </button>
                </div>
              )}
            </Card>
          </motion.div>
        </>
      )}
    </PageBody>
  );
}
