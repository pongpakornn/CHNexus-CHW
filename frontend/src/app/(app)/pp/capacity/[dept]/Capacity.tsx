"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api } from "@/lib/api";
import { EASE, fadeOnly, panelIn, springSoft } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { DOW, calcMachine, deptOf, type Calc, dowOf, f0, f1, f2, mcHrOf, monthLabel, pc, sphOf, strokeOf, thisMonth, type PpActual, type PpMachine } from "@/lib/pp";
import { PpChart, Ring, type Series } from "../../PpChart";
import { conditionRows, EffPill, Kpi, MonthPicker, PpIcon, ProcessChips, usePpMonth } from "../../shared";
import { Seg } from "../../Seg";
import { ManStep, NumPick, type Preset, type Recent } from "./ActInput";
import "../../pp.css";

// 🏭 PRODUCTION PLAN › CAPACITY › <หน่วยงาน> (PRESS 1 · PRESS 2 · ASSEMBLY · PIPE PART · PIPE ASSY · PAINT PART) · 1 เครื่อง = 1 ชีทของ Excel
//   เลือกเครื่อง (ชิป) + เดือน · Condition / Plan / Actual · ตาราง Product (คำนวณเอง: PCS จาก Forecast / Order · SPH · Stroke · MC Hr)
//   M/C Plan รายวัน = อัตโนมัติจากวันทำงาน · M/C Actual = หน้างานกรอก Working hour / Stroke / Man -> %EFF คำนวณทันที -> SAVE
//   จอใหญ่ = ตารางรายวัน (คอลัมน์แรกติดซ้าย) · มือถือ = การ์ดรายวันกรอกง่าย · เครื่องอื่นบันทึก = อัพเดทเอง (ไม่ทับค่าที่กำลังพิมพ์)
const C = { plan: "#4f46e5", plan2: "#818cf8", act: "#0891b2", act2: "#67e8f9", eff: "#d97706" };
type Draft = Record<number, { hr: string; stroke: string; man: string }>;
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
const str = (v: number | null | undefined) => (v == null ? "" : String(+v.toFixed(2)));

export default function Capacity({ dept }: { dept: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const D = dept.toUpperCase();
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [draft, setDraft] = useState<Draft>({});
  const dirty = Object.keys(draft).length;
  const { res, data, calcs, reload } = usePpMonth(D, month, dirty > 0);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const qd = useDebounced(q, 150);
  const [metric, setMetric] = useState<"stroke" | "hr">("stroke");
  const [acc, setAcc] = useState(false);
  const chipBox = useRef<HTMLDivElement>(null);

  const mid = Number(params.get("m")) || 0;
  const machine = data?.machines.find((m) => m.id === mid) ?? data?.machines[0] ?? null;
  const canEdit = !!res?.can.actual;

  // ค่าที่กำลังแก้ (ยังไม่ SAVE) ผสมกับค่าที่บันทึกไว้ -> คำนวณใหม่ทันที
  const live = useMemo((): PpMachine | null => {
    if (!machine) return null;
    if (!dirty) return machine;
    const map = new Map<number, PpActual>(machine.actual.map((a) => [a.day, a]));
    for (const [d, v] of Object.entries(draft)) map.set(Number(d), { day: Number(d), hr: num(v.hr), stroke: num(v.stroke), man: num(v.man) });
    return { ...machine, actual: [...map.values()] };
  }, [machine, draft, dirty]);
  const c = useMemo(() => (live && data ? calcMachine(live, data) : null), [live, data]);

  function pick(id: number) {
    if (dirty) return toast.show("WARNING", "มี Actual ที่ยังไม่ได้ SAVE · กด SAVE หรือ CANCEL ก่อนเปลี่ยนเครื่อง", "warn");
    const p = new URLSearchParams(params.toString());
    p.set("m", String(id));
    p.set("month", month);
    router.replace(`?${p.toString()}`, { scroll: false });
  }
  function changeMonth(m: string) {
    if (dirty) return toast.show("WARNING", "มี Actual ที่ยังไม่ได้ SAVE · กด SAVE หรือ CANCEL ก่อนเปลี่ยนเดือน", "warn");
    setMonth(m);
    const p = new URLSearchParams(params.toString());
    p.set("month", m);
    router.replace(`?${p.toString()}`, { scroll: false });
  }
  // ชิปที่เลือกเลื่อนมาอยู่กลางแถบ
  useEffect(() => {
    const el = chipBox.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [machine?.id, reduce]);
  // ออกจากหน้าโดยยังไม่ SAVE = เตือน
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function edit(day: number, k: "hr" | "stroke" | "man", v: string) {
    if (!machine || !/^[0-9]*[.,]?[0-9]*$/.test(v.replace(/,/g, ""))) return;
    setDraft((d) => {
      const cur = machine.actual.find((a) => a.day === day);
      const base = d[day] ?? { hr: str(cur?.hr), stroke: str(cur?.stroke), man: str(cur?.man) };
      const next = { ...base, [k]: v };
      const same = next.hr === str(cur?.hr) && next.stroke === str(cur?.stroke) && next.man === str(cur?.man);
      const o = { ...d };
      if (same) delete o[day];
      else o[day] = next;
      return o;
    });
  }
  const val = (day: number, k: "hr" | "stroke" | "man") => draft[day]?.[k] ?? str(machine?.actual.find((a) => a.day === day)?.[k]);

  // 🕘 ค่าที่ผู้ใช้คนนี้เคยกรอก (ให้เลือกแทนพิมพ์) · โหลดใหม่เมื่อเปลี่ยนเครื่อง / หลัง SAVE
  const [recent, setRecent] = useState<Recent>({ hr: [], stroke: [], man: [] });
  const recentMid = machine?.id;
  const loadRecent = useCallback(() => {
    if (!recentMid || !canEdit) return;
    api<Recent>("/pp/recent", { query: { machineId: recentMid } })
      .then((r) => setRecent({ hr: r.hr ?? [], stroke: r.stroke ?? [], man: r.man ?? [] }))
      .catch(() => {});
  }, [recentMid, canEdit]);
  useEffect(loadRecent, [loadRecent]);
  const presets: Preset[] = useMemo(() => (data?.shifts ?? []).map((x) => ({ v: x.hours, label: x.name })), [data?.shifts]);

  async function save() {
    if (!machine || !dirty) return;
    const cells = Object.entries(draft).map(([d, v]) => ({ day: Number(d), hr: num(v.hr), stroke: num(v.stroke), man: num(v.man) }));
    if (cells.some((x) => [x.hr, x.stroke, x.man].some((n) => n != null && !isFinite(n)))) return toast.show("WARNING", "ตัวเลขไม่ถูกต้อง", "warn");
    if (cells.some((x) => x.hr != null && x.hr > 24)) return toast.show("WARNING", "Working hour ต้องไม่เกิน 24 ชม.", "warn");
    setSaving(true);
    try {
      const r = await api<{ message: string }>("/pp/actual", { method: "POST", body: { machineId: machine.id, month, cells } });
      toast.show("SAVED", r.message, "ok");
      setDraft({});
      loadRecent();
      await reload(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function cancel() {
    if (dirty && !(await dlg.confirm({ title: "CANCEL", message: `ยกเลิกการแก้ไข Actual ${dirty} วัน ?`, ok: "YES, CANCEL", danger: true }))) return;
    setDraft({});
  }

  const chips = useMemo(() => {
    const k = qd.trim().toUpperCase();
    return (data?.machines ?? []).filter((m) => !k || m.code.toUpperCase().includes(k) || m.group.toUpperCase().includes(k));
  }, [data, qd]);

  const header = (
    <PageHeader
      icon="/icons/Capacity.png"
      title={`CAPACITY • ${deptOf(D).name}`}
      subtitle={machine ? `${machine.code} · ${machine.subGroup ?? machine.group} · ${monthLabel(month).toUpperCase()}` : "CAPACITY PLANNING"}
      actions={<MonthPicker value={month} onChange={changeMonth} />}
    />
  );
  if (!data) return <PageBody className="pp-page">{header}<Loading /></PageBody>;
  if (!machine || !c || !live)
    return (
      <PageBody className="pp-page">
        {header}
        <Card>
          <Empty>ยังไม่มีเครื่องจักรของ {deptOf(D).name} · เพิ่มได้ที่ MASTER DATA › Production Plan › Machine STD</Empty>
        </Card>
      </PageBody>
    );

  const nd = data.days;
  const wd = new Set(data.workdays);
  const days = Array.from({ length: nd }, (_, i) => i + 1);
  const isHr = metric === "hr";
  const series: Series[] = acc
    ? [
        { key: "pacc", label: "PLAN ACC", kind: "line", color: C.plan, area: true, values: isHr ? c.planHrAcc : c.planAcc, fmt: isHr ? f1 : f0 },
        { key: "aacc", label: "ACTUAL ACC", kind: "line", color: C.act, area: true, values: isHr ? c.actHrAcc : c.actAcc, fmt: isHr ? f1 : f0 },
      ]
    : [
        { key: "act", label: isHr ? "ACTUAL HR. (A2)" : "ACTUAL STROKE (A1)", kind: "bar", color: C.act, color2: C.act2, values: isHr ? c.actHr : c.actStroke, fmt: isHr ? f2 : f0 },
        { key: "plan", label: isHr ? "PLAN HR. (P5)" : "PLAN STROKE (P2)", kind: "line", color: C.plan, dashed: true, values: isHr ? c.planHr : c.plan, fmt: isHr ? f2 : f0 },
      ];
  const load1 = c.sh[0] ? c.P1 / c.sh[0] : 0;
  const todayIdx = month === thisMonth() ? new Date().getDate() - 1 : -1;
  const rows = conditionRows(data);

  return (
    <PageBody className="pp-page">
      {header}

      {/* เลือกเครื่อง */}
      <div className="pp-chipbar">
        <button type="button" className="pp-chipnav" aria-label="Scroll left" onClick={() => chipBox.current?.scrollBy({ left: -320, behavior: reduce ? "auto" : "smooth" })}>
          ‹
        </button>
        <div ref={chipBox} className="pp-chips" role="group" aria-label="Machine">
          {chips.map((m, i) => (
            <motion.button
              key={m.id}
              type="button"
              className="pp-chip"
              aria-pressed={m.id === machine.id}
              onClick={() => pick(m.id)}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: Math.min(i * 0.025, 0.4) }}
            >
              {m.id === machine.id && <motion.span layoutId="pp-chip-on" className="pp-chip-on" transition={springSoft} />}
              <span className={`pp-chip-dot is-${toneOf(calcs.get(m.id))}`} aria-hidden />
              <span className="relative">{m.code}</span>
            </motion.button>
          ))}
          {chips.length === 0 && <span className="pp-hint m-0 px-2">ไม่พบเครื่อง</span>}
        </div>
        <button type="button" className="pp-chipnav" aria-label="Scroll right" onClick={() => chipBox.current?.scrollBy({ left: 320, behavior: reduce ? "auto" : "smooth" })}>
          ›
        </button>
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาเครื่อง / GROUP" className="pp-chipsearch" />
      </div>

      {data.workdaySource === "DEFAULT" && (
        <div className="pp-note">
          ⚠ ยังไม่ได้ตั้ง <b>Company Workdays</b> ของเดือนนี้ · ใช้ จันทร์–เสาร์ ({data.workdays.length} วัน) ไปก่อน
        </div>
      )}

      <MachineBanner key={machine.id} deptName={deptOf(D).name} code={machine.code} group={machine.subGroup ?? machine.group} month={month} c={c} parts={machine.parts.length} withPcs={machine.parts.filter((p) => p.pcs > 0).length} byPcs={machine.byPcs} />

      <div className="pp-hero">
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={0} className="pp-cal">
          <div className="head">
            <div>
              <h3>WORKDAYS • {monthLabel(month).toUpperCase()}</h3>
              <p>{data.workdaySource === "COMPANY" ? "จาก MASTER DATA › Company Workdays" : "ค่าเริ่มต้น จันทร์–เสาร์"}</p>
            </div>
            <div className="n">
              <b>{c.C1}</b>
              <span>วันทำงาน (C1)</span>
            </div>
          </div>
          <div className="grid7">
            {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d) => (
              <span key={d} className="dow">
                {d}
              </span>
            ))}
            {Array.from({ length: (dowOf(month, 1) + 6) % 7 }, (_, i) => (
              <span key={"e" + i} />
            ))}
            {days.map((d, i) => {
              const has = (c.actStroke[d - 1] ?? 0) > 0 || (c.actHr[d - 1] ?? 0) > 0;
              return (
                <motion.span
                  key={d}
                  className={`day ${wd.has(d) ? "is-on" : "is-off"} ${has ? "has-act" : ""} ${d - 1 === todayIdx ? "is-today" : ""}`}
                  title={`${d} ${monthLabel(month)}${wd.has(d) ? " · วันทำงาน" : " · วันหยุด"}${has ? ` · Actual ${f0(c.actStroke[d - 1])} stroke` : ""}`}
                  initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  whileHover={reduce ? undefined : { y: -3, scale: 1.08 }}
                  transition={{ type: "spring", stiffness: 380, damping: 22, delay: reduce ? 0 : Math.min(i * 0.014, 0.45) }}
                >
                  {d}
                </motion.span>
              );
            })}
          </div>
          <div className="pp-cal-legend">
            <span>
              <i className="is-on" />
              วันทำงาน
            </span>
            <span>
              <i className="is-off" />
              วันหยุด
            </span>
            <span>
              <i className="is-act" />
              มี Actual
            </span>
            {todayIdx >= 0 && (
              <span>
                <i className="is-today" />
                วันนี้
              </span>
            )}
          </div>
        </motion.div>
        <div className="pp-kpis is-2">
          <Kpi key={machine.id + "k0"} i={0} tone="plan" label="PLAN STROKE • P1" icon={<PpIcon k="plan" />} spark={c.plan} value={c.P1} fmt={f0} sub={`${f0(c.P2)} stroke/วัน (P2) · PCS ${f0(c.pcs)}`} frac={c.sh[0] ? Math.min(1, load1) : null} />
          <Kpi key={machine.id + "k1"} i={1} tone="act" label="ACTUAL STROKE • A1" icon={<PpIcon k="act" />} spark={c.actStroke} value={c.A1} fmt={f0} sub={`${pc(c.P1 ? c.A1 / c.P1 : 0)} ของแผน · ${f1(c.A2)} hr`} frac={c.P1 ? c.A1 / c.P1 : 0} />
          <Kpi key={machine.id + "k2"} i={2} tone="day" label="PLAN HR. • P4" icon={<PpIcon k="hr" />} spark={c.actHr} value={c.P4} fmt={f1} unit=" hr" sub={`${f2(c.P5)} hr/วัน · โหลด 1 กะ ${pc(load1)}`} frac={load1} />
          <Kpi
            key={machine.id + "k3"}
            i={3}
            tone={!c.A2 ? "mid" : c.A4 >= c.C4 ? "ok" : c.A4 >= c.C4 * 0.85 ? "mid" : "low"}
            label="EFF% • A4"
            icon={<PpIcon k="eff" />}
            spark={c.effDay}
            value={c.A4 * 100}
            fmt={(v) => v.toFixed(1)}
            unit="%"
            badge={c.A2 ? <EffPill a={c.A4} t={c.C4} /> : undefined}
            sub={`Target ${pc(c.C4)} · SPH ${f0(c.A3)} / ${f0(c.C3)}`}
            frac={c.C4 ? c.A4 / c.C4 : 0}
          />
        </div>
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
        <Card
          clip={false}
          title={`${machine.code} • PLAN vs ACTUAL`}
          actions={
            <>
              <Seg id="ca" value={acc ? "acc" : "day"} onChange={(v) => setAcc(v === "acc")} options={[{ v: "day", l: "DAILY" }, { v: "acc", l: "ACCUMULATED" }]} />
              <Seg id="cm" value={metric} onChange={setMetric} options={[{ v: "stroke", l: "STROKE" }, { v: "hr", l: "WORKING HR." }]} />
            </>
          }
          bodyClass="px-2 pb-3 pt-2 md:px-4"
        >
          <PpChart
            key={machine.id + (acc ? "a" : "d")}
            ariaLabel={`${machine.code} plan versus actual`}
            cats={days.map(String)}
            sub={days.map((d) => DOW[dowOf(month, d)].slice(0, 2))}
            off={days.map((d) => !wd.has(d))}
            today={todayIdx >= 0 ? todayIdx : undefined}
            empty={acc ? undefined : "ยังไม่มี Actual ของเดือนนี้ · กรอกที่ตาราง DAILY ด้านล่าง"}
            series={series}
            tipTitle={(i) => `${i + 1} ${monthLabel(month)} · ${DOW[dowOf(month, i + 1)]}${wd.has(i + 1) ? "" : " · วันหยุด"}`}
            tipExtra={(i) =>
              c.effDay[i] != null ? (
                <div className="r is-sum">
                  <span>%EFF</span>
                  <b>{pc(c.effDay[i])}</b>
                </div>
              ) : null
            }
          />
        </Card>
      </motion.div>

      <div className="pp-two is-cp">
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
          <Card title="CONDITION • PLAN • ACTUAL" actions={<span className="pp-tag">{machine.subGroup ?? machine.group}</span>}>
            <div className="pp-scroll">
              <table className="pp-cp">
                <thead>
                  <tr>
                    <th>CODE</th>
                    <th>ITEM</th>
                    <th>FORMULA</th>
                    <th>{monthLabel(month).toUpperCase()}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) =>
                    r.g ? (
                      <tr key={"g" + i} className="pp-grp">
                        <td colSpan={4}>{r.g}</td>
                      </tr>
                    ) : (
                      <tr key={r.code} className="pp-rise" style={{ "--i": i } as React.CSSProperties}>
                        <td className="code">{r.code}</td>
                        <td className="lab">{r.label}</td>
                        <td className="fx">{r.code === "C3" && !c.C3auto ? "STD (กำหนดเอง)" : r.fx}</td>
                        <td className={`val ${r.tone ? "pp-tone-" + r.tone(c) : ""}`}>{r.v!(c, null)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {res?.can.setup && (
              <div className="pp-cardfoot">
                <Link href={`/master/production-plan?dept=${D}`} className="btn-ghost">
                  ⚙ MACHINE STD
                </Link>
              </div>
            )}
          </Card>
        </motion.div>
        <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={1}>
          <ProductTable machine={machine} month={month} canSetup={!!res?.can.setup} />
        </motion.div>
      </div>

      <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.08 }} custom={0}>
        <Card
          title="DAILY • M/C PLAN vs M/C ACTUAL"
          actions={<span className="pp-hint m-0">{canEdit ? "กรอก Working hour / Stroke / Man ในแถว M/C ACTUAL แล้วกด SAVE · %EFF คำนวณเอง" : "ดูอย่างเดียว (ไม่มีสิทธิ์บันทึก Actual)"}</span>}
        >
          {/* จอใหญ่: ตารางรายวันแบบ Excel */}
          <div className="pp-scroll pp-daily-wrap">
            <table className="pp-daily">
              <thead>
                <tr>
                  <th className="pp-stick">ITEM</th>
                  {days.map((d) => (
                    <th key={d} className={wd.has(d) ? "" : "off"}>
                      {d}
                      <span>{DOW[dowOf(month, d)].slice(0, 2)}</span>
                    </th>
                  ))}
                  <th className="tot">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sec">
                  <td className="pp-stick">M/C PLAN · AUTO</td>
                  <td colSpan={nd + 1} />
                </tr>
                <DRow label="P1 Stroke • Daily" vals={c.plan} fmt={f0} tot={f0(c.P1)} wd={wd} cls="pl" />
                <DRow label="P1 Stroke • Acc" vals={c.planAcc} fmt={f0} tot={f0(c.planAcc[nd - 1])} wd={wd} cls="pl" />
                <DRow label="P4 Working Hr. • Daily" vals={c.planHr} fmt={f2} tot={f1(c.P4)} wd={wd} cls="pl" />
                <DRow label="P4 Working Hr. • Acc" vals={c.planHrAcc} fmt={f2} tot={f1(c.planHrAcc[nd - 1])} wd={wd} cls="pl" />
                <DRow label="C3 GSPH 100%" vals={days.map(() => c.C3)} fmt={f0} tot={f0(c.C3)} wd={wd} />
                <DRow label={`C4 GSPH ${pc(c.C4)}`} vals={days.map(() => c.C3 * c.C4)} fmt={f0} tot={f0(c.C3 * c.C4)} wd={wd} />
                <tr className="sec is-act">
                  <td className="pp-stick">M/C ACTUAL {canEdit ? "· INPUT" : ""}</td>
                  <td colSpan={nd + 1} />
                </tr>
                <InRow label="Working hour" k="hr" days={days} wd={wd} val={val} edit={edit} draft={draft} can={canEdit} tot={f2(c.A2)} recent={recent.hr} presets={presets} />
                <InRow label="Stroke" k="stroke" days={days} wd={wd} val={val} edit={edit} draft={draft} can={canEdit} tot={f0(c.A1)} recent={recent.stroke} />
                <InRow label="Man" k="man" days={days} wd={wd} val={val} edit={edit} draft={draft} can={canEdit} tot={f1(c.A5)} recent={recent.man} />
                <DRow label="A1 Stroke • Acc" vals={c.actAcc} fmt={f0} tot={f0(c.A1)} wd={wd} />
                <DRow label="A2 Working Hr. • Acc" vals={c.actHrAcc} fmt={f2} tot={f1(c.A2)} wd={wd} />
                <DRow label="A3 SPH" vals={c.sphDay} fmt={f0} tot={f0(c.A3)} wd={wd} />
                <tr>
                  <td className="pp-stick">A4 %EFF</td>
                  {c.effDay.map((v, i) => (
                    <td key={i} className={`${wd.has(i + 1) ? "" : "off"} ${v == null ? "" : "pp-tone-" + (v >= c.C4 ? "ok" : v >= c.C4 * 0.85 ? "mid" : "low")}`}>
                      {v == null ? "" : pc(v)}
                    </td>
                  ))}
                  <td className={`tot ${c.A2 ? "pp-tone-" + (c.A4 >= c.C4 ? "ok" : c.A4 >= c.C4 * 0.85 ? "mid" : "low") : ""}`}>{pc(c.A4)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* มือถือ: การ์ดรายวัน */}
          <div className="pp-daycards">
            {days.map((d) => {
              const e = c.effDay[d - 1];
              return (
                <div key={d} className={`pp-daycard ${wd.has(d) ? "" : "is-off"} ${draft[d] ? "is-dirty" : ""}`}>
                  <div className="h">
                    <b>{d}</b>
                    <span>
                      {DOW[dowOf(month, d)]} {wd.has(d) ? `· PLAN ${f0(c.plan[d - 1])}` : "· วันหยุด"}
                    </span>
                    {e != null && <em className={`pp-pill is-${e >= c.C4 ? "ok" : e >= c.C4 * 0.85 ? "mid" : "low"}`}>{pc(e)}</em>}
                  </div>
                  <div className="f">
                    {(["hr", "stroke", "man"] as const).map((k) => (
                      <label key={k}>
                        <span>{k === "hr" ? "WORKING HR." : k === "stroke" ? "STROKE" : "MAN"}</span>
                        {!canEdit ? (
                          <input className="field" readOnly value={val(d, k)} aria-label={`${k} day ${d}`} />
                        ) : k === "man" ? (
                          <ManStep value={val(d, k)} onChange={(v) => edit(d, k, v)} recent={recent.man} label={`MAN day ${d}`} />
                        ) : (
                          <NumPick className="field" value={val(d, k)} onChange={(v) => edit(d, k, v)} recent={k === "hr" ? recent.hr : recent.stroke} presets={k === "hr" ? presets : []} label={`${k} day ${d}`} />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {/* แถบ SAVE ลอยล่าง: แสดงเมื่อมีการแก้ไข */}
      <AnimatePresence>
        {dirty > 0 && (
          <motion.div className="pp-savebar" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
            <span>
              แก้ไข Actual <b>{dirty}</b> วัน · {machine.code}
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

function DRow({ label, vals, fmt, tot, wd, cls = "" }: { label: string; vals: (number | null)[]; fmt: (v: number) => string; tot: string; wd: Set<number>; cls?: string }) {
  return (
    <tr>
      <td className="pp-stick">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`${wd.has(i + 1) ? "" : "off"} ${cls}`}>
          {v == null ? "" : fmt(v)}
        </td>
      ))}
      <td className="tot">{tot}</td>
    </tr>
  );
}

function InRow({
  label,
  k,
  days,
  wd,
  val,
  edit,
  draft,
  can,
  tot,
  recent,
  presets,
}: {
  label: string;
  k: "hr" | "stroke" | "man";
  days: number[];
  wd: Set<number>;
  val: (d: number, k: "hr" | "stroke" | "man") => string;
  edit: (d: number, k: "hr" | "stroke" | "man", v: string) => void;
  draft: Draft;
  can: boolean;
  tot: string;
  recent: number[];
  presets?: Preset[];
}) {
  return (
    <tr className="in">
      <td className="pp-stick">
        <b>{label}</b>
      </td>
      {days.map((d) => (
        <td key={d} className={`${wd.has(d) ? "" : "off"} ${draft[d] ? "is-dirty" : ""}`}>
          {can ? (
            k === "man" ? (
              <ManStep value={val(d, k)} onChange={(v) => edit(d, k, v)} recent={recent} label={`${label} ${d}`} />
            ) : (
              <NumPick value={val(d, k)} onChange={(v) => edit(d, k, v)} recent={recent} presets={presets} label={`${label} ${d}`} />
            )
          ) : (
            val(d, k)
          )}
        </td>
      ))}
      <td className="tot">{tot}</td>
    </tr>
  );
}

// 📋 ตาราง Product ของเครื่อง (อ่านอย่างเดียว · แก้ที่ MASTER DATA › Machine Products): PCS จาก Order / Forecast ของเดือน
function ProductTable({ machine, month, canSetup }: { machine: PpMachine; month: string; canSetup: boolean }) {
  const [q, setQ] = useState("");
  const k = useDebounced(q, 150).trim().toUpperCase();
  const rows = machine.parts.filter((p) => !k || [p.partA, p.partB, p.pdCode, p.name, p.process].some((x) => (x ?? "").toUpperCase().includes(k)));
  const bp = machine.byPcs;
  const t = machine.parts.reduce((a, p) => ({ pcs: a.pcs + p.pcs, st: a.st + strokeOf(p, bp), hr: a.hr + mcHrOf(p, bp) }), { pcs: 0, st: 0, hr: 0 });
  return (
    <Card
      className="pp-fill"
      bodyClass="pp-fill-body"
      title={`PRODUCT • ${monthLabel(month).toUpperCase()} • ${machine.parts.length}`}
      actions={
        <>
          <SearchBox value={q} onChange={setQ} placeholder="PART A / PART B / ชื่อ / PROCESS" className="w-[240px] max-w-full" />
          {canSetup && (
            <Link href={`/master/production-plan/products?m=${machine.id}&month=${month}`} className="btn-ghost">
              ✏ EDIT
            </Link>
          )}
        </>
      }
    >
      {/* ตาราง Product ยืดเต็มความสูงของแถว (เท่าการ์ด CONDITION ด้านซ้าย) · เลื่อนภายในตาราง */}
      <div className="pp-prod-box">
      <div className="pp-scroll pp-prod">
        <table className="pp-table">
          <thead>
            <tr>
              <th>NO.</th>
              <th>PART A</th>
              <th>PART B</th>
              <th>NAME</th>
              <th>PROCESS</th>
              <th>TOTAL PROC.</th>
              <th>PCS/STROKE</th>
              <th>MC CT</th>
              <th>SPH</th>
              <th>PCS</th>
              <th>STROKE</th>
              <th>MC HR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id} className={p.pcs ? "" : "is-zero"}>
                <td className="n">{i + 1}</td>
                <td className="code">{p.partA}</td>
                <td className="code">{p.partB ?? "–"}</td>
                <td className="t" title={p.name}>
                  {p.name}
                </td>
                <td className="proc" title={p.process ?? ""}>
                  <ProcessChips code={p.process} />
                </td>
                <td>{f0(p.tp)}</td>
                <td>{f0(p.col)}</td>
                <td>{p.ct}</td>
                <td>{f0(sphOf(p))}</td>
                <td title={p.pcsFrom === "ORDER" ? "ยอด Order" : p.pcsFrom === "FORECAST" ? "ยอด Forecast (ยังไม่มี Order)" : "ไม่มียอด"}>
                  <b>{p.pcs ? f0(p.pcs) : "0"}</b>
                  {p.pcsFrom && <em className={`pp-src is-${p.pcsFrom.toLowerCase()}`}>{p.pcsFrom === "ORDER" ? "O" : "F"}</em>}
                </td>
                <td className="st">{f0(strokeOf(p, bp))}</td>
                <td className="hr">{f2(mcHrOf(p, bp))}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="pp-emptycell">
                  {machine.parts.length ? "ไม่พบรายการ" : "ยังไม่มี Product ของเครื่องนี้"}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9}>TOTAL ({machine.parts.length} ITEMS) · SPH 100% = {f1(t.hr ? t.st / t.hr : 0)}</td>
              <td>{f0(t.pcs)}</td>
              <td>{f0(t.st)}</td>
              <td>{f2(t.hr)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      </div>
      <p className="pp-hint px-4 pb-3">
        PCS = ยอด <em className="pp-src is-order">O</em> Order ของเดือน · ไม่มี Order = <em className="pp-src is-forecast">F</em> Forecast · SPH = 3600 ÷ MC CT · Stroke = {bp ? "PCS ÷ Pcs./Stroke (เครื่อง Transfer)" : "PCS × Total Process ÷ Pcs./Stroke"} · MC Hr = Stroke ÷ SPH
      </p>
    </Card>
  );
}

const toneOf = (c?: { A2: number; A4: number; C4: number }) => (!c || !c.A2 ? "none" : c.A4 >= c.C4 ? "ok" : c.A4 >= c.C4 * 0.85 ? "mid" : "low");

const SHIFT_SHORT = ["1 SHIFT", "1 SHIFT + OT", "2 SHIFT", "2 SHIFT + OT", "2 SHIFT + OT 6"];

// 🎛 แถบหัวเครื่อง: พื้นไล่สี + วงกลมลอย · ชื่อเครื่อง · กลุ่ม · ตัวเลขย่อ · วงแหวน Actual ÷ Plan ของเดือน
function MachineBanner({ deptName, code, group, month, c, parts, withPcs, byPcs }: { deptName: string; code: string; group: string; month: string; c: Calc; parts: number; withPcs: number; byPcs: boolean }) {
  const reduce = useReducedMotion();
  const done = c.actStroke.filter((v) => (v ?? 0) > 0).length;
  const need = c.sh.findIndex((v) => v != null && v >= c.P1);
  const prog = c.P1 ? c.A1 / c.P1 : 0;
  const stats: [string, string][] = [
    ["PRODUCTS", `${withPcs} / ${parts}`],
    ["PCS", f0(c.pcs)],
    ["SPH 100%", f0(c.C3)],
    ["ACTUAL DAYS", `${done} / ${c.C1}`],
    ["SHIFT NEED", need < 0 ? (c.P1 ? "OVER" : "–") : (SHIFT_SHORT[need] ?? `C${5 + need}`)],
  ];
  return (
    <motion.div className="pp-banner" initial={reduce ? false : { opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: EASE }}>
      <span className="blob b1" aria-hidden />
      <span className="blob b2" aria-hidden />
      <span className="blob b3" aria-hidden />
      <div className="tx">
        <motion.small initial={reduce ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}>
          {deptName} · {group} · {monthLabel(month).toUpperCase()}
          {byPcs && <em>TRANSFER · STROKE = PCS</em>}
        </motion.small>
        <motion.h2 initial={reduce ? false : { opacity: 0, y: 12, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}>
          {code}
        </motion.h2>
        <div className="stats">
          {stats.map(([k, v], i) => (
            <motion.span key={k} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.25 + i * 0.06 }}>
              <small>{k}</small>
              <b>{v}</b>
            </motion.span>
          ))}
        </div>
      </div>
      <div className="ring">
        <Ring
          frac={prog}
          color="#ffffff"
          color2="#a5f3fc"
          size={116}
          stroke={10}
          label={
            <>
              <b>{pc(prog)}</b>
              <small>ACTUAL / PLAN</small>
            </>
          }
        />
      </div>
    </motion.div>
  );
}
