"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { deptOf, f0, f1, f2, mcHrOf, sphOf, strokeOf, thisMonth, type PpPart } from "@/lib/pp";
import { DeptPicker, MonthPicker, ProcessChips } from "../../../pp/shared";
import "../../../pp/pp.css";

// 📋 MASTER DATA › PRODUCTION PLAN › MACHINE PRODUCTS (ตาราง Product ของเครื่อง = ตารางล่างของชีทเครื่องใน Excel)
//   เลือกเครื่อง -> เพิ่ม / แก้: PART A (STORE-PC = Product Code ของ Forecast) · PART B (STORE-SUB) · PROCESS CODE · Total Process · Pcs./Stroke · MC CT · STD MAN
//   คำนวณเอง: SPH = 3600 ÷ CT · PCS = Order (ไม่มี Order = Forecast) ของเดือนที่เลือก · Stroke = PCS × Total Process ÷ Pcs./Stroke · MC Hr = Stroke ÷ SPH
type Machine = { id: number; code: string; group: string; subGroup: string | null; active: boolean; parts: number; byPcs: boolean };
type Setup = { machines: Machine[]; can: { add: boolean; edit: boolean; delete: boolean } };
type Hit = { id: number; stock: string; code: string; pdCode: string; name: string; customer: string };
type Pick = { id: number; code: string; name: string; stock?: string } | null;
type Form = { a: Pick; b: Pick; process: string; tp: string; col: string; ct: string; man: string; active: boolean };
const EMPTY: Form = { a: null, b: null, process: "", tp: "1", col: "1", ct: "3", man: "1", active: true };
const n = (s: string) => Number(String(s).replace(/,/g, ""));

export default function MachineProducts() {
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const router = useRouter();
  const params = useSearchParams();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [dept, setDept] = useState(() => deptOf(params.get("dept")).code as string);
  const [mid, setMid] = useState(() => Number(params.get("m")) || 0);
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [rows, setRows] = useState<PpPart[] | null>(null);
  const [row, setRow] = useState<PpPart | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 150).trim().toUpperCase();
  const formRef = useRef<HTMLDivElement>(null);

  const lastRows = useRef("");
  const loadSetup = useCallback(async () => {
    try {
      const r = await api<Setup>("/pp/setup", { query: { dept } });
      setSetup(r);
      setMid((m) => (m && r.machines.some((x) => x.id === m) ? m : (r.machines.find((x) => x.active) ?? r.machines[0])?.id ?? 0));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      setSetup((s) => s ?? { machines: [], can: { add: false, edit: false, delete: false } });
    }
  }, [toast, dept]);
  const loadRows = useCallback(
    async (quiet = false) => {
      if (!mid) return;
      try {
        const r = await api<PpPart[]>("/pp/parts", { query: { machineId: mid, month } });
        if (sameData(lastRows, r) && quiet) return;
        setRows(r);
      } catch (e) {
        if (!quiet) toast.show("ERROR", "โหลดตาราง Product ไม่สำเร็จ\n" + (e as Error).message, "error");
        setRows((r) => r ?? []);
      }
    },
    [mid, month, toast],
  );
  useEffect(() => {
    const t = setTimeout(loadSetup, 0);
    return () => clearTimeout(t);
  }, [loadSetup]);
  useEffect(() => {
    const t = setTimeout(() => loadRows(), 0);
    return () => clearTimeout(t);
  }, [loadRows]);
  // ⚡ STD / Product เปลี่ยน · นำเข้า Forecast / Order (PCS)
  useLive(["pp", "forecast"], () => Promise.all([loadSetup(), loadRows(true)]));

  const can = setup?.can ?? { add: false, edit: false, delete: false };
  const machine = setup?.machines.find((m) => m.id === mid) ?? null;
  const shown = useMemo(() => (rows ?? []).filter((p) => !k || [p.partA, p.partB, p.pdCode, p.name, p.process, p.customer].some((x) => (x ?? "").toUpperCase().includes(k))), [rows, k]);
  const bp = !!setup?.machines.find((m) => m.id === mid)?.byPcs;
  const tot = useMemo(() => (rows ?? []).filter((p) => p.active).reduce((a, p) => ({ pcs: a.pcs + p.pcs, st: a.st + strokeOf(p, bp), hr: a.hr + mcHrOf(p, bp) }), { pcs: 0, st: 0, hr: 0 }), [rows, bp]);
  const procList = useMemo(() => [...new Set((rows ?? []).map((p) => p.process).filter(Boolean) as string[])].slice(0, 60), [rows]);
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));

  function chooseMachine(id: number) {
    setMid(id);
    setRows(null);
    reset();
    const p = new URLSearchParams(params.toString());
    p.set("dept", dept);
    p.set("m", String(id));
    router.replace(`?${p.toString()}`, { scroll: false });
  }
  function reset() {
    setRow(null);
    setF(EMPTY);
  }
  function open(p: PpPart) {
    setRow(p);
    setF({
      a: { id: p.partAId, code: p.partA, name: p.name },
      b: p.partBId ? { id: p.partBId, code: p.partB ?? "", name: p.name } : null,
      process: p.process ?? "",
      tp: String(p.tp),
      col: String(p.col),
      ct: String(p.ct),
      man: p.man == null ? "" : String(p.man),
      active: p.active,
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function save() {
    if (!machine) return toast.show("WARNING", "กรุณาเลือกเครื่องจักร", "warn");
    if (!f.a) return toast.show("WARNING", "กรุณาเลือก PART A (STORE-FG)", "warn");
    if (!(n(f.tp) > 0) || !(n(f.col) > 0) || !(n(f.ct) > 0)) return toast.show("WARNING", "Total Process / Pcs./Stroke / MC CT ต้องมากกว่า 0", "warn");
    setBusy(true);
    try {
      const body = { id: row?.id ?? 0, machineId: machine.id, sort: row?.sort ?? 0, partAId: f.a.id, partBId: f.b?.id ?? null, process: f.process.trim(), tp: n(f.tp), col: n(f.col), ct: n(f.ct), man: f.man.trim() ? n(f.man) : null, active: f.active };
      const r = await api<{ message: string }>("/pp/parts", { method: "POST", body });
      toast.show("SAVED", r.message, "ok");
      reset();
      loadRows(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: PpPart) {
    if (!(await dlg.confirm({ title: "DELETE PRODUCT", message: `ลบ ${p.partA}${p.partB ? " / " + p.partB : ""} ออกจาก ${machine?.code} ?`, ok: "DELETE", danger: true }))) return;
    try {
      const r = await api<{ message: string }>(`/pp/parts/${p.id}`, { method: "DELETE" });
      toast.show("DELETED", r.message, "ok");
      if (row?.id === p.id) reset();
      loadRows(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  // ค่าที่คำนวณเองของฟอร์ม (PCS ของ PART A เดิมในตาราง ถ้ามี)
  const prev = { pcs: rows?.find((p) => p.partAId === f.a?.id)?.pcs ?? 0, tp: n(f.tp) || 0, col: n(f.col) || 0, ct: n(f.ct) || 0 };
  const lab = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
  const showForm = !!machine && (can.add || !!row);

  return (
    <PageBody className="md-gray md-color-actions pp-page">
      <PageHeader
        icon="/icons/InventoryRegistration.png"
        title="PRODUCTION PLAN • MACHINE PRODUCTS"
        subtitle="MASTER DATA · ตาราง Product ของเครื่อง · PART A (STORE-FG) · PART B (STORE-SUB) · PROCESS CODE"
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <Link href={`/master/production-plan?dept=${dept}`} className="btn-ghost">
              ⚙ MACHINE STD
            </Link>
          </>
        }
      />
      <DeptPicker
        id="prod"
        value={dept}
        onChange={(c) => {
          setDept(c);
          setSetup(null);
          setRows(null);
          setMid(0);
          reset();
          router.replace(`?dept=${c}`, { scroll: false });
        }}
      />
      {!setup ? (
        <Loading />
      ) : setup.machines.length === 0 ? (
        <Card>
          <Empty>ยังไม่มีเครื่องจักร · เพิ่มที่ MASTER DATA › Machine STD ก่อน</Empty>
        </Card>
      ) : (
        <>
          <Card clip={false} bodyClass="p-3 md:p-4">
            <div className="pp-pickm">
              <label>
                <span className={lab}>MACHINE</span>
                <ComboBox
                  value={String(mid)}
                  options={setup.machines.map((m) => ({ value: String(m.id), label: m.code, sub: `${m.subGroup ?? m.group} · ${m.parts} items${m.active ? "" : " · INACTIVE"}` }))}
                  onChange={(v) => chooseMachine(Number(v))}
                  ariaLabel="Machine"
                />
              </label>
              <div className="pp-pickm-stats">
                <span>
                  ITEMS <b>{rows?.length ?? "–"}</b>
                </span>
                <span>
                  PCS <b>{f0(tot.pcs)}</b>
                </span>
                <span>
                  STROKE <b>{f0(tot.st)}</b>
                </span>
                <span>
                  MC HR <b>{f1(tot.hr)}</b>
                </span>
                <span>
                  SPH 100% <b>{f1(tot.hr ? tot.st / tot.hr : 0)}</b>
                </span>
              </div>
            </div>
          </Card>

          <AnimatePresence initial={false}>
            {showForm && (
              <motion.div ref={formRef} className="scroll-mt-4" key="form" variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" exit={{ opacity: 0 }}>
                <Card clip={false} title={row ? `✏️ EDIT PRODUCT • ${machine?.code}` : `＋ ADD PRODUCT • ${machine?.code}`} bodyClass="p-4 md:p-5">
                  <div className="pp-form is-prod">
                    <div className="is-wide">
                      <span className={lab}>PART A • STORE-FG (PRODUCT CODE) *</span>
                      <PartSearch kind="A" value={f.a} onChange={(a) => set({ a })} />
                    </div>
                    <div className="is-wide">
                      <span className={lab}>PART B • STORE-SUB</span>
                      <PartSearch kind="B" value={f.b} onChange={(b) => set({ b })} placeholder="พิมพ์ B-xxx / ว่าง = ชิ้นเดียวกับ PART A" />
                    </div>
                    <label className="is-wide">
                      <span className={lab}>PROCESS CODE</span>
                      <input className="field font-mono" maxLength={200} value={f.process} list="pp-proc" placeholder="PI#1^CU#1^CU#2^BN#1^ST&BN#2^RT^PI&CPI^SR 1/1" onChange={(e) => set({ process: e.target.value })} />
                      <datalist id="pp-proc">
                        {procList.map((p) => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      <span className={lab}>TOTAL PROCESS *</span>
                      <input className="field text-right font-bold" inputMode="decimal" value={f.tp} onChange={(e) => set({ tp: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>PCS./STROKE (COL) *</span>
                      <input className="field text-right font-bold" inputMode="decimal" value={f.col} onChange={(e) => set({ col: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>MC CT (SEC) *</span>
                      <input className="field text-right font-bold" inputMode="decimal" value={f.ct} onChange={(e) => set({ ct: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>STD MAN</span>
                      <input className="field text-right" inputMode="decimal" value={f.man} onChange={(e) => set({ man: e.target.value })} />
                    </label>
                  </div>
                  <div className="pp-auto">
                    <span>
                      SPH <b>{f0(sphOf(prev))}</b>
                      <em>3600 ÷ CT</em>
                    </span>
                    <span>
                      PCS <b>{f0(prev.pcs)}</b>
                      <em>{prev.pcs ? "Order / Forecast" : "หลังบันทึก"}</em>
                    </span>
                    <span>
                      STROKE <b>{f0(strokeOf(prev, bp))}</b>
                      <em>{bp ? "PCS ÷ Pcs/Stroke (Transfer)" : "PCS × Process ÷ Pcs/Stroke"}</em>
                    </span>
                    <span>
                      MC HR <b>{f2(mcHrOf(prev, bp))}</b>
                      <em>Stroke ÷ SPH</em>
                    </span>
                    {row && (
                      <button type="button" role="switch" aria-checked={f.active} className={`sw ${f.active ? "is-on" : ""}`} onClick={() => set({ active: !f.active })}>
                        <span className="sw-track" />
                        {f.active ? "ACTIVE" : "INACTIVE"}
                      </button>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line/60 pt-4">
                    <button type="button" className="btn-ghost min-w-[120px]" disabled={busy} onClick={reset}>
                      {row ? "✕ CANCEL" : "↺ RESET"}
                    </button>
                    {(row ? can.edit : can.add) && (
                      <button type="button" className={`btn min-w-[180px] ${row ? "bg-success" : "bg-accent"}`} disabled={busy} onClick={save}>
                        {busy ? "…" : row ? "💾 SAVE CHANGES" : "＋ ADD PRODUCT"}
                      </button>
                    )}
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={1}>
            <Card title={`PRODUCTS • ${machine?.code ?? ""} • ${shown.length}`} actions={<SearchBox value={key} onChange={setKey} placeholder="PART A / PART B / ชื่อ / PROCESS" className="w-[300px] max-w-full" />}>
              {!rows ? (
                <Loading />
              ) : shown.length === 0 ? (
                <Empty>{rows.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มี Product ของเครื่องนี้"}</Empty>
              ) : (
                <div className="pp-scroll pp-prod is-tall">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>NO.</th>
                        <th>PART A</th>
                        <th>PART B</th>
                        <th>NAME</th>
                        <th>CUSTOMER</th>
                        <th>PROCESS</th>
                        <th>TOTAL PROC.</th>
                        <th>PCS/STROKE</th>
                        <th>MC CT</th>
                        <th>SPH</th>
                        <th>STD MAN</th>
                        <th>PCS</th>
                        <th>STROKE</th>
                        <th>MC HR</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p, i) => (
                        <motion.tr
                          key={p.id}
                          className={`${p.active ? "" : "opacity-50"} ${p.pcs ? "" : "is-zero"} ${row?.id === p.id ? "is-picked" : ""}`}
                          initial={reduce || i > 24 ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: p.active ? 1 : 0.5, y: 0 }}
                          transition={{ duration: 0.3, ease: EASE, delay: Math.min(i * 0.02, 0.4) }}
                        >
                          <td className="n">{i + 1}</td>
                          <td className="code" title={`PD CODE ${p.pdCode}`}>
                            {p.partA}
                          </td>
                          <td className="code">{p.partB ?? "–"}</td>
                          <td className="t" title={p.name}>
                            {p.name}
                          </td>
                          <td>{p.customer}</td>
                          <td className="proc" title={p.process ?? ""}>
                            <ProcessChips code={p.process} />
                          </td>
                          <td>{p.tp}</td>
                          <td>{p.col}</td>
                          <td>{p.ct}</td>
                          <td>{f0(sphOf(p))}</td>
                          <td>{p.man ?? "–"}</td>
                          <td>
                            <b>{f0(p.pcs)}</b>
                            {p.pcsFrom && <em className={`pp-src is-${p.pcsFrom.toLowerCase()}`}>{p.pcsFrom === "ORDER" ? "O" : "F"}</em>}
                          </td>
                          <td className="st">{f0(strokeOf(p, bp))}</td>
                          <td className="hr">{f2(mcHrOf(p, bp))}</td>
                          <td>
                            <RowActions>
                              {can.edit && <RowAction kind="edit" active={row?.id === p.id} onClick={() => open(p)} />}
                              {can.delete && <RowAction kind="delete" onClick={() => remove(p)} />}
                            </RowActions>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={11}>TOTAL ACTIVE · SPH 100% = {f1(tot.hr ? tot.st / tot.hr : 0)}</td>
                        <td>{f0(tot.pcs)}</td>
                        <td>{f0(tot.st)}</td>
                        <td>{f2(tot.hr)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>
        </>
      )}
    </PageBody>
  );
}

// 🔎 เลือก PART A / PART B: พิมพ์รหัส / ชื่อ -> รายการเลื่อนลงนุ่ม ๆ · เลือกแล้วแสดงเป็นกล่องสีเขียว (กด เปลี่ยน ได้)
function PartSearch({ kind, value, onChange, placeholder }: { kind: "A" | "B"; value: Pick; onChange: (p: Pick) => void; placeholder?: string }) {
  const [key, setKey] = useState("");
  const [list, setList] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const kd = useDebounced(key, 220);
  useEffect(() => {
    if (!kd.trim()) return;
    let alive = true;
    api<Hit[]>("/pp/part-search", { query: { kind, key: kd } })
      .then((r) => {
        if (!alive) return;
        setList(r);
        setHi(0);
      })
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [kd, kind]);

  if (value)
    return (
      <div className="pp-picked">
        <div className="min-w-0 flex-1">
          <b>{value.code}</b>
          <span>{value.name}</span>
        </div>
        {value.stock && <em>{value.stock}</em>}
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => onChange(null)}>
          เปลี่ยน
        </button>
      </div>
    );
  const choose = (h: Hit) => {
    onChange({ id: h.id, code: h.code, name: h.name, stock: h.stock });
    setOpen(false);
    setKey("");
  };
  return (
    <div className="relative">
      <input
        className="field font-mono"
        placeholder={placeholder ?? (kind === "A" ? "พิมพ์ PART A (A-xxx) / PD CODE / ชื่อ" : "พิมพ์ PART B")}
        value={key}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setKey(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(list.length - 1, h + 1));
          else if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
          else if (e.key === "Enter" && list[hi]) {
            e.preventDefault();
            choose(list[hi]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        aria-label={kind === "A" ? "PART A" : "PART B"}
      />
      <AnimatePresence>
        {open && key.trim() && (
          <motion.ul className="pp-hits" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
            {list.length === 0 && <li className="empty">ไม่พบสินค้า</li>}
            {list.map((h, i) => (
              <li key={h.id + h.stock} style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                <button type="button" className={i === hi ? "is-hi" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(h)}>
                  <b>{h.code}</b>
                  <em>{h.stock}</em>
                  <span>
                    {h.name}
                    {h.customer ? ` · ${h.customer}` : ""} · PD {h.pdCode}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
