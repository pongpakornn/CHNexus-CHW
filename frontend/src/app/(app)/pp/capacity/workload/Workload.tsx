"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api, upload } from "@/lib/api";
import { PillSwitch } from "@/components/charts/ChartHeader";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { f0, f1, thisMonth } from "@/lib/pp";
import { Kpi, MonthPicker, PpIcon } from "../../shared";
import { EN, WL_FIELDS, WL_GROUPS, buildTable, deptTotals, refMap, savedHeads, signed, updOf, useWorkload, type WlCase, type WlField, type WlPlan } from "./wl";
import { WlCompare } from "./WlCompare";
import "../../pp.css";

// 👥 PRODUCTION PLAN › CAPACITY › WORKLOAD : สรุปอัตรากำลังคน แผน, ผล ประจำเดือน (Monthly man-power Plan & Actual) · แทนชีท "9. ManPower" ของ Excel Work load
//   สูตร / ข้อมูลอยู่ที่ ./wl.ts (ใช้ร่วมกับ DASHBOARD › WORKLOAD)
//   คนที่มีจริง (Current ของเดือน N · Actual ของเดือน N-1) = กรอกที่หน้านี้ แล้วกด SAVE · Capacity / Forecast / วันทำงานเปลี่ยน = อัพเดทเอง
//   📊 CASE 1 ตาม EXCEL = PDT / Direct / Production จากไฟล์ Work load (IMPORT WORK LOAD EXCEL) · ⚙ CASE 2 ตามระบบ = คำนวณจาก Forecast / Order ในระบบ
//   การ์ดเปรียบเทียบ (WlCompare) = ยอดทั้งสองแบบทีละหน่วยงาน + เหตุผลที่ตรง / ไม่ตรง
type Draft = Record<string, string>; // `${month}|${row}|${field}` -> ข้อความที่พิมพ์

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
const str = (v: number | null | undefined) => (v == null ? "" : String(+v.toFixed(2)));

export default function Workload() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length;
  const { res, err, load } = useWorkload(month, dirty > 0);
  // 📊 CASE 1 / ⚙ CASE 2 (จำไว้ในเครื่อง)
  const [cs, setCs] = useState<WlCase>(() => {
    try {
      return (localStorage.getItem("wl-case") as WlCase) || "EXCEL";
    } catch {
      return "EXCEL";
    }
  });
  const pickCase = (v: WlCase) => {
    setCs(v);
    try {
      localStorage.setItem("wl-case", v);
    } catch {
      /* ไม่เป็นไร */
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // ออกจากหน้าโดยยังไม่ SAVE = เตือน
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function changeMonth(m: string) {
    if (dirty) return toast.show("WARNING", "มีจำนวนคนที่ยังไม่ได้ SAVE · กด SAVE หรือ CANCEL ก่อนเปลี่ยนเดือน", "warn");
    setMonth(m);
    const p = new URLSearchParams(params.toString());
    p.set("month", m);
    router.replace(`?${p.toString()}`, { scroll: false });
  }

  const data = res?.data;
  const canEdit = !!res?.can.edit;
  const ms = data?.months ?? [];
  const prevM = ms[0]?.month ?? "";
  const curM = ms[1]?.month ?? "";

  const totals = useMemo(() => (data ? data.months.map((m) => deptTotals(m, data.shifts, data.settings)) : []), [data]);
  const saved = useMemo(() => savedHeads(data?.heads ?? []), [data]);
  // ค่าที่แสดง = ที่กำลังพิมพ์ (ถ้ามี) > ที่บันทึกไว้
  const headOf = useCallback(
    (m: string, row: string) => {
      const h = saved.get(`${m}|${row}`);
      const v = (f: WlField) => {
        const k = `${m}|${row}|${f}`;
        return k in draft ? (num(draft[k]) ?? 0) : (h?.[f] ?? 0);
      };
      return { direct: v("direct"), ind1: v("ind1"), ind2: v("ind2") };
    },
    [saved, draft],
  );
  const refs = useMemo(() => refMap(res?.refs), [res]);
  const hasRef = ms.some((m) => [...refs.keys()].some((k) => k.startsWith(m.month + "|")));
  const useXl = cs === "EXCEL" && hasRef;
  const refOf = useCallback((m: string, row: string) => refs.get(`${m}|${row}`), [refs]);
  const table = useMemo(() => (data ? buildTable(data, totals, headOf, useXl ? refOf : undefined) : null), [data, totals, headOf, useXl, refOf]);

  // 📥 IMPORT WORK LOAD EXCEL -> สรุป -> ยืนยัน
  async function importExcel(f: File) {
    setImporting(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/pp/workload/excel", f);
      if (!(await dlg.confirm({ title: "IMPORT WORK LOAD EXCEL", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/pp/workload/excel/apply", { method: "POST", body: pv.id });
      toast.show("IMPORTED", r.message, "ok");
      await load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setImporting(false);
    }
  }
  const upd = useMemo(() => updOf(data?.heads ?? [], curM), [data, curM]);

  const setCell = (m: string, row: string, f: WlField, v: string) => {
    const k = `${m}|${row}|${f}`;
    const orig = str(saved.get(`${m}|${row}`)?.[f]);
    setDraft((d) => {
      const n = { ...d };
      if (v.trim() === orig) delete n[k];
      else n[k] = v.replace(/[^\d.]/g, "");
      return n;
    });
  };
  const cellVal = (m: string, row: string, f: WlField) => {
    const k = `${m}|${row}|${f}`;
    return k in draft ? draft[k] : str(saved.get(`${m}|${row}`)?.[f]);
  };

  async function save() {
    if (!dirty || saving) return;
    // ส่งทีละเดือน: ทุกแถวที่มีการแก้ (ส่งครบ 3 ช่องของแถว)
    const byMonth = new Map<string, Set<string>>();
    for (const k of Object.keys(draft)) {
      const [m, row] = k.split("|");
      if (!byMonth.has(m)) byMonth.set(m, new Set());
      byMonth.get(m)!.add(row);
    }
    for (const k of Object.keys(draft)) {
      const v = num(draft[k]);
      if (v != null && (!isFinite(v) || v < 0 || v > 9999)) return toast.show("WARNING", "จำนวนคนต้องเป็นตัวเลข 0 - 9,999", "warn");
    }
    setSaving(true);
    try {
      const msgs: string[] = [];
      for (const [m, rows] of byMonth) {
        const cells = [...rows].map((row) => {
          const g = (f: WlField) => {
            const k = `${m}|${row}|${f}`;
            return k in draft ? num(draft[k]) : (saved.get(`${m}|${row}`)?.[f] ?? null);
          };
          return { row, direct: g("direct"), ind1: g("ind1"), ind2: g("ind2") };
        });
        const r = await api<{ message: string }>("/pp/workload/heads", { method: "POST", body: { month: m, cells } });
        msgs.push(r.message);
      }
      toast.show("SAVED", msgs.join("\n"), "ok");
      setDraft({});
      await load(true);
    } catch (e) {
      toast.show("ERROR", "บันทึกไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function cancel() {
    if (dirty && !(await dlg.confirm({ title: "CANCEL", message: `ยกเลิกการแก้ไขจำนวนคน ${dirty} ช่อง ?`, ok: "YES, CANCEL", danger: true }))) return;
    setDraft({});
  }

  const header = (
    <PageHeader
      icon="/icons/management.png"
      title="PRODUCTION PLAN • WORKLOAD"
      subtitle={`สรุปอัตรากำลังคน แผน, ผล ประจำเดือน ${curM ? EN(curM).toUpperCase() : ""} · Monthly man-power Plan & Actual`}
      actions={
        <>
          {res?.can.excel && (
            <>
              <button type="button" className="fill-btn" disabled={importing} onClick={() => fileRef.current?.click()} title="นำเข้ายอด PDT / Direct จากไฟล์ Work load (ชีท 9. ManPower) เป็น CASE 1 ตาม EXCEL">
                {importing ? "…" : "📥 IMPORT WORK LOAD EXCEL"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) importExcel(f);
                }}
              />
            </>
          )}
          <MonthPicker value={month} onChange={changeMonth} />
        </>
      }
    />
  );
  if (!data || !table)
    return (
      <PageBody className="pp-page">
        {header}
        {err ? <div className="pp-note">⚠ {err}</div> : <Loading />}
      </PageBody>
    );

  const N = table.tot.plans[0];
  const C = table.tot.cur;
  const gap = C.direct - N.direct;
  const edit = (m: string, row: string, f: WlField, label: string) =>
    canEdit ? (
      <input
        className={`pp-in wl-in ${`${m}|${row}|${f}` in draft ? "is-dirty" : ""}`}
        inputMode="decimal"
        aria-label={label}
        value={cellVal(m, row, f)}
        placeholder="0"
        onChange={(e) => setCell(m, row, f, e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const tds = [...(e.currentTarget.closest("tbody")?.querySelectorAll<HTMLInputElement>(`input[data-col="${m}-${f}"]`) ?? [])];
            tds[tds.indexOf(e.currentTarget) + 1]?.focus();
          }
        }}
        data-col={`${m}-${f}`}
      />
    ) : (
      f0(headOf(m, row)[f])
    );

  return (
    <PageBody className="pp-page">
      {header}
      {ms.some((m) => m.workdaySource === "DEFAULT") && (
        <div className="pp-note">
          ⚠ บางเดือนยังไม่ได้ตั้ง <b>Company Workdays</b> ({ms.filter((m) => m.workdaySource === "DEFAULT").map((m) => EN(m.month)).join(", ")}) · ใช้ จันทร์–เสาร์ ไปก่อน · ตั้งได้ที่ MASTER DATA › Company Workdays
        </div>
      )}

      {/* 📊 CASE 1 / ⚙ CASE 2: ที่มาของ PDT / Direct ในตาราง */}
      <div className={`wl-case ${useXl ? "is-xl" : "is-sys"}`}>
        <PillSwitch
          label="ที่มาของยอด"
          value={useXl ? "EXCEL" : "SYSTEM"}
          onChange={(v) => pickCase(v as WlCase)}
          options={[
            { v: "EXCEL", l: "📊 CASE 1 • ตาม EXCEL", title: hasRef ? "PDT / Direct / Production จากไฟล์ Work load" : "ยังไม่มียอด EXCEL ของเดือนนี้ (IMPORT WORK LOAD EXCEL)" },
            { v: "SYSTEM", l: "⚙ CASE 2 • ตามระบบ", title: "คำนวณจาก Forecast / Order ที่มีในระบบ + STD ของ Capacity" },
          ]}
        />
        <span>
          {useXl
            ? "PDT / Direct / Production = ยอดจากไฟล์ Work load ที่ Import (ตรงกับ Excel) · เดือน / หน่วยงานที่ไม่มีในไฟล์ใช้ยอดของระบบ"
            : cs === "EXCEL" && !hasRef
              ? "ยังไม่มียอด EXCEL ของเดือนเหล่านี้ · แสดงยอดของระบบ (กด IMPORT WORK LOAD EXCEL)"
              : "PDT / Direct = ระบบคำนวณจาก Forecast / Order ที่มีในระบบจริง + STD ของ Capacity (สูตรเดียวกับ Excel)"}
        </span>
      </div>

      <div className="pp-kpis">
        <Kpi i={0} tone="plan" icon={<PpIcon k="plan" />} label={`PLAN MAN • ${EN(curM).toUpperCase()}`} value={N.total} fmt={f1} unit=" คน" sub={`Direct ${f1(N.direct)} · Ind1 ${f0(N.ind1)} · Ind2 ${f0(N.ind2)}`} />
        <Kpi i={1} tone="act" icon={<PpIcon k="act" />} label={`CURRENT • UPDATE ${upd}`} value={C.total} fmt={f0} unit=" คน" sub={`Direct ${f0(C.direct)} · Ind1 ${f0(C.ind1)} · Ind2 ${f0(C.ind2)}`} frac={N.total ? C.total / N.total : null} />
        <Kpi
          i={2}
          tone={Math.round(gap) >= 0 ? "ok" : "low"}
          icon={<PpIcon k="eff" />}
          label="DIRECT • CURRENT − PLAN"
          value={gap}
          fmt={signed}
          unit=" คน"
          sub={Math.round(gap) >= 0 ? "คน Direct พอตามแผนเดือนนี้" : `คน Direct ขาด ${Math.abs(Math.round(gap))} คน ตามแผนเดือนนี้`}
        />
        <Kpi i={3} tone="day" icon={<PpIcon k="day" />} label={`PDT • ${ms[1].workdays.length} DAY`} value={N.pdt} fmt={f0} sub={`Plan Stroke / Production รวมทุกหน่วยงาน · ${EN(curM)}`} />
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={2}>
        <Card
          title={`9. MONTHLY MAN-POWER PLAN & ACTUAL • ${useXl ? "CASE 1 ตาม EXCEL" : "CASE 2 ตามระบบ"}`}
          actions={<span className="pp-hint m-0">{canEdit ? "กรอกจำนวนคนที่มีจริงในช่อง CURRENT / ACTUAL แล้วกด SAVE · Plan คำนวณจาก Capacity เอง" : "ดูอย่างเดียว (ไม่มีสิทธิ์แก้จำนวนคน)"}</span>}
          bodyClass="p-0"
        >
          <div className="pp-scroll wl-scroll">
            <table className="wl-table">
              <thead>
                <tr className="wl-h1">
                  <th className="wl-stick wl-year" rowSpan={3} colSpan={2}>
                    <span>YEAR</span>
                    {curM.slice(0, 4)}
                  </th>
                  <th colSpan={11} className="wl-mon is-prev">
                    {EN(prevM)} <span>N-1</span>
                  </th>
                  <th rowSpan={2} colSpan={4} className="wl-mon is-cur">
                    Current ({EN(curM).slice(0, 3)})<span>Update {upd}</span>
                  </th>
                  {ms.slice(1).map((m, i) => (
                    <th key={m.month} colSpan={6} className={`wl-mon ${i === 0 ? "is-n" : ""}`}>
                      {EN(m.month)} <span>N{i ? `+${i}` : ""}</span>
                    </th>
                  ))}
                </tr>
                <tr className="wl-h2">
                  <th colSpan={4} className="wl-blk">
                    Plan
                  </th>
                  <th className="is-day">{ms[0].workdays.length} Day</th>
                  <th>Actual</th>
                  <th colSpan={5} className="wl-blk">
                    Actual
                  </th>
                  {ms.slice(1).map((m) => (
                    <FragmentHead key={m.month} days={m.workdays.length} />
                  ))}
                </tr>
                <tr className="wl-h3">
                  <th className="wl-blk">PDT</th>
                  <th>Direct</th>
                  <th>Ind1</th>
                  <th>Ind2</th>
                  <th className="is-day">Total</th>
                  <th>Total</th>
                  <th className="wl-blk">Production</th>
                  <th>Direct</th>
                  <th>Ind1</th>
                  <th>Ind2</th>
                  <th className="is-cur">Total</th>
                  <th className="wl-blk">Direct</th>
                  <th>Ind1</th>
                  <th>Ind2</th>
                  <th className="is-cur">Total</th>
                  {ms.slice(1).map((m) => (
                    <SubHead key={m.month} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((x, i) => {
                  const g = WL_GROUPS.find((g) => g.grp === x.r.grp)!;
                  const first = i === 0 || table.rows[i - 1].r.grp !== x.r.grp;
                  return (
                    <tr key={x.r.key} className={`wl-row ${first ? "is-first" : ""}`} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                      {first && (
                        <td rowSpan={g.n} className="wl-stick wl-grp">
                          {x.r.grp}
                        </td>
                      )}
                      <td className="wl-stick wl-name">
                        <span>{x.r.name}</span>
                        {x.r.dept && <i title="ดึง PDT / Direct จาก Capacity">CAP</i>}
                      </td>
                      <PlanCells p={x.prevPlan} />
                      <td className="wl-blk">{f0(x.prevAct.prod)}</td>
                      {WL_FIELDS.map((f) => (
                        <td key={f} className="wl-edit">
                          {edit(prevM, x.r.key, f, `${x.r.name} ${f} ${EN(prevM)}`)}
                        </td>
                      ))}
                      <td className="is-cur">{f0(x.prevAct.total)}</td>
                      {WL_FIELDS.map((f, j) => (
                        <td key={f} className={`wl-edit ${j === 0 ? "wl-blk" : ""}`}>
                          {edit(curM, x.r.key, f, `${x.r.name} ${f} current`)}
                        </td>
                      ))}
                      <td className="is-cur">{f0(x.cur.total)}</td>
                      {x.plans.map((p, j) => (
                        <PlanCells key={j} p={p} />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="wl-tot">
                  <td className="wl-stick wl-totlab" colSpan={2}>
                    TOTAL
                  </td>
                  <PlanCells p={table.tot.prevPlan} total />
                  <td className="wl-blk">{f0(table.tot.prevAct.prod)}</td>
                  <td>{f0(table.tot.prevAct.direct)}</td>
                  <td>{f0(table.tot.prevAct.ind1)}</td>
                  <td>{f0(table.tot.prevAct.ind2)}</td>
                  <td className="is-sum">{f1(table.tot.prevAct.total)}</td>
                  <td className="wl-blk">{f0(C.direct)}</td>
                  <td>{f0(C.ind1)}</td>
                  <td>{f0(C.ind2)}</td>
                  <td className="is-sum">{f1(C.total)}</td>
                  {table.tot.plans.map((p, j) => (
                    <PlanCells key={j} p={p} total />
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="wl-legend">
            <span>
              <i className="is-day" /> Total แผน (Direct + Ind1 + Ind2)
            </span>
            <span>
              <i className="is-cur" /> คนที่มีจริง
            </span>
            <span>
              <b className="wl-pos">+n</b> / <b className="wl-neg">−n</b> Actual = คนที่มีจริง (Direct) − แผน (Direct) · ติดลบ = คนขาด
            </span>
            <span>{useXl ? "PDT / Direct / Production = ยอดในไฟล์ Work load (CASE 1)" : "PDT / Direct = Total P1 / P9 ของ Capacity · Production = Total A1 ของเดือนก่อน"}</span>
          </div>
        </Card>
      </motion.div>

      {/* 🔍 เปรียบเทียบ CASE 1 vs CASE 2 + เหตุผล */}
      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={3}>
        <WlCompare months={ms} totals={totals} refs={refs} notes={res?.notes ?? []} canEdit={!!res?.can.excel} onSaved={() => load(true)} />
      </motion.div>

      {/* แถบ SAVE ลอยล่าง: แสดงเมื่อมีการแก้ไข */}
      <AnimatePresence>
        {dirty > 0 && (
          <motion.div className="pp-savebar" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
            <span>
              แก้ไขจำนวนคน <b>{dirty}</b> ช่อง
            </span>
            <button type="button" className="btn-ghost" disabled={saving} onClick={cancel}>
              ✕ CANCEL
            </button>
            <button type="button" className="btn bg-success" disabled={saving} onClick={save}>
              {saving ? "…" : "💾 SAVE"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </PageBody>
  );
}

function FragmentHead({ days }: { days: number }) {
  return (
    <>
      <th colSpan={4} className="wl-blk">
        Plan
      </th>
      <th className="is-day">{days} Day</th>
      <th>Actual</th>
    </>
  );
}
function SubHead() {
  return (
    <>
      <th className="wl-blk">PDT</th>
      <th>Direct</th>
      <th>Ind1</th>
      <th>Ind2</th>
      <th className="is-day">Total</th>
      <th>Total</th>
    </>
  );
}
function PlanCells({ p, total }: { p: WlPlan; total?: boolean }) {
  const d = Math.round(p.diff);
  return (
    <>
      <td className="wl-blk">{f0(p.pdt)}</td>
      <td>{f1(p.direct)}</td>
      <td>{total ? f0(p.ind1) : f1(p.ind1)}</td>
      <td>{total ? f0(p.ind2) : f1(p.ind2)}</td>
      <td className={total ? "is-sum" : "is-day"}>{f1(p.total)}</td>
      <td className={total ? "" : d > 0 ? "wl-pos" : d < 0 ? "wl-neg" : "wl-zero"}>{total ? "" : signed(d)}</td>
    </>
  );
}
