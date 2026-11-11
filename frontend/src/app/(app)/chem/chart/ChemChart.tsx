"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Card, Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { api, download } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { catOf, fmt, slotsOf, specText, stats, statusOf, thisMonth, type ChemAction, type ChemCan, type ChemParam, type ChemReading } from "@/lib/chem";
import { MonthPicker } from "../../pp/shared";
import { Seg } from "../../pp/Seg";
import { ControlChart, type ChartPoint } from "../ControlChart";
import "../chem.css";

// 📈 CHEMICAL CONTROL › CONTROL CHART (แผนภูมิควบคุมรายเดือน + ใบบันทึก + อนุมัติ)
//   เลือกพารามิเตอร์ + เดือน -> สถิติ (n · Mean · σ · Min · Max · Cp · Cpk · นอกข้อกำหนด) · แผนภูมิควบคุม (ทั้งหมด / กลางวัน / กลางคืน)
//   ตารางผลการตรวจวัดรายวัน · บันทึกการแก้ไขและปรับค่าน้ำยา · FLOW ลายเซ็น Prepared → Checked → Reviewed → Approved
//   EXPORT PDF (ใบบันทึก A4 พร้อมลายเซ็น วาดในเครื่อง) / EXCEL (จาก Server)
type FlowStep = { slot: number; name: string; mode: string; active: boolean; users: { userId: string; name: string }[]; mine: boolean; waiting: boolean; signed: { userId: string; name: string; at: string } | null };
type Data = {
  parameter: ChemParam;
  month: string;
  readings: ChemReading[];
  actions: ChemAction[];
  sheet: { id: number; status: "DRAFT" | "SIGNING" | "APPROVED"; nextSlot: number | null; submittedAt: string | null; doneAt: string | null; submittedBy: string | null } | null;
  flow: FlowStep[];
  mySign: boolean;
  can: ChemCan;
};
type Meta = { parameters: ChemParam[] };
type Form = { id: number; date: string; checkTime: string; problem: string; before: string; after: string; correction: string; adjustTime: string; responsible: string };

const th = (d: string) => new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

export default function ChemChart() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pid, setPid] = useState(() => Number(params.get("p")) || 0);
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [d, setD] = useState<Data | null>(null);
  const [view, setView] = useState<"ALL" | "D" | "N">("ALL");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Meta>("/chem/meta")
      .then((m) => {
        setMeta(m);
        setPid((cur) => cur || m.parameters[0]?.id || 0);
      })
      .catch((e: Error) => toast.show("ERROR", e.message, "error"));
  }, [toast]);
  const load = useCallback(
    async (quiet = false) => {
      if (!pid) return;
      try {
        setD(await api<Data>("/chem/chart", { query: { paramId: pid, month } }));
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
      }
    },
    [pid, month, toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["chem"], () => load(true));
  // จากหน้า INSPECTION RECORD (นอกข้อกำหนด) = เปิดฟอร์มบันทึกการแก้ไขให้เลย
  const actDate = params.get("action");
  useEffect(() => {
    if (actDate && d && d.can.record && !form) setTimeout(() => setForm({ id: 0, date: actDate, checkTime: "", problem: "ค่าอยู่นอกข้อกำหนด", before: "", after: "", correction: "", adjustTime: "", responsible: "" }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actDate, d?.parameter.id]);

  const go = (p: number, m: string) => {
    setPid(p);
    setMonth(m);
    setD(null);
    router.replace(`?p=${p}&month=${m}`, { scroll: false });
  };

  const p = d?.parameter;
  const rs = useMemo(() => (d ? [...d.readings].sort((a, b) => `${a.date}${a.shift === "D" ? 0 : 1}${a.slot}`.localeCompare(`${b.date}${b.shift === "D" ? 0 : 1}${b.slot}`)) : []), [d]);
  const st = useMemo(() => (p ? stats(p, rs.map((r) => r.value)) : null), [p, rs]);
  const points: ChartPoint[] = useMemo(
    () =>
      !p
        ? []
        : rs
            .filter((r) => view === "ALL" || r.shift === view)
            .map((r) => ({
              key: String(r.id),
              label: String(new Date(r.date).getDate()),
              sub: `${r.shift === "D" ? "D" : "N"}${r.slot}`,
              value: r.value,
              status: statusOf(p, r.value),
              tip: (
                <>
                  <h4>
                    {th(r.date)} · {r.shift === "D" ? "กะกลางวัน" : "กะกลางคืน"} {r.time ?? ""}
                  </h4>
                  <div className="r">
                    <span>ค่าที่วัดได้</span>
                    <b>
                      {fmt(p, r.value)} {p.unit}
                    </b>
                  </div>
                  <div className="r">
                    <span>ผู้ตรวจวัด</span>
                    <b>{r.inspector ?? "–"}</b>
                  </div>
                </>
              ),
            })),
    [p, rs, view],
  );

  const locked = d?.sheet && d.sheet.status !== "DRAFT";
  const nd = p ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 0;
  const dayT = p ? slotsOf(p, "D") : [];
  const nightT = p ? slotsOf(p, "N") : [];
  const byKey = useMemo(() => new Map(rs.map((r) => [`${Number(r.date.slice(8, 10))}-${r.shift}-${r.slot}`, r])), [rs]);

  async function act(path: string, ok: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(path, { method: "POST", body });
      toast.show(ok, r.message, "ok");
      await load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function saveForm() {
    if (!form || !p) return;
    const n = (s: string) => (s.trim() === "" ? null : Number(s));
    await act("/chem/actions", "SAVED", { ...form, paramId: p.id, before: n(form.before), after: n(form.after) });
    setForm(null);
  }
  async function exportPdf() {
    if (!p || !sheetRef.current) return;
    setPdf(true);
    try {
      await new Promise((r) => setTimeout(r, 450)); // รอแผนภูมิในใบบันทึกวาดเสร็จ
      const [{ jsPDF }, { toJpeg }] = await Promise.all([import("jspdf"), import("html-to-image")]);
      const img = await toJpeg(sheetRef.current, { quality: 0.93, pixelRatio: 2, backgroundColor: "#ffffff" });
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      doc.addImage(img, "JPEG", 0, 0, 210, 297);
      doc.save(`CHEMICAL-${p.code}-${month}.pdf`);
      toast.show("EXPORT PDF", `CHEMICAL-${p.code}-${month}.pdf`, "ok");
    } catch (e) {
      toast.show("ERROR", "Export PDF ไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setPdf(false);
    }
  }

  const header = (
    <PageHeader
      icon="/icons/DashboardChart.png"
      title="CHEMICAL CONTROL • CONTROL CHART"
      subtitle="แผนภูมิควบคุม · ใบบันทึกผลการตรวจวัดประจำเดือน · บันทึกการแก้ไข · การอนุมัติ"
      actions={
        <>
          <MonthPicker value={month} onChange={(m) => go(pid, m)} />
          <button type="button" className="btn-ghost" disabled={!d || pdf} onClick={exportPdf}>
            {pdf ? "…" : "⤓ PDF"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!d}
            onClick={() => download("/chem/export/excel", { paramId: pid, month }).catch((e: Error) => toast.show("ERROR", e.message, "error"))}
          >
            ⤓ EXCEL
          </button>
        </>
      }
    />
  );
  if (!meta) return <PageBody className="ch-page">{header}<Loading /></PageBody>;

  return (
    <PageBody className="ch-page">
      {header}
      <Card clip={false} bodyClass="p-3 md:p-4">
        <div className="ch-pick">
          <label>
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">CONTROL PARAMETER</span>
            <ComboBox
              value={String(pid)}
              options={meta.parameters.map((x) => ({ value: String(x.id), label: `${x.code} · ${x.name}`, sub: `${x.process ?? ""} · SPEC ${specText(x)} ${x.unit ?? ""}` }))}
              onChange={(v) => go(Number(v), month)}
              ariaLabel="Parameter"
            />
          </label>
          {p && (
            <div className="ch-specs">
              <span style={{ "--c": catOf(p.category).color } as React.CSSProperties} className="is-cat">
                {catOf(p.category).label}
              </span>
              <span className="is-spec">
                SPEC <b>{specText(p)}</b> {p.unit}
              </span>
              <span className="is-ctl">
                UCL <b>{fmt(p, p.ucl)}</b> · LCL <b>{fmt(p, p.lcl)}</b>
              </span>
              <span className="is-target">
                TARGET <b>{fmt(p, p.target)}</b>
              </span>
              <span>
                {p.formNo} · {p.method}
              </span>
            </div>
          )}
        </div>
      </Card>

      {!d || !p || !st ? (
        <Loading />
      ) : (
        <>
          <div className="ch-stats">
            {[
              ["n", String(st.n), "ครั้งที่ตรวจวัด"],
              ["MEAN", fmt(p, st.n ? st.mean : null), p.unit ?? ""],
              ["σ", st.n > 1 ? st.sd.toFixed(3) : "–", "ส่วนเบี่ยงเบนมาตรฐาน"],
              ["MIN", fmt(p, st.min), p.unit ?? ""],
              ["MAX", fmt(p, st.max), p.unit ?? ""],
              ["Cp", st.cp == null ? "–" : st.cp.toFixed(2), "ความสามารถกระบวนการ"],
              ["Cpk", st.cpk == null ? "–" : st.cpk.toFixed(2), st.cpk == null ? "" : st.cpk >= 1.33 ? "ดีมาก (≥ 1.33)" : st.cpk >= 1 ? "พอใช้ (≥ 1.00)" : "ต้องปรับปรุง"],
              ["OUT", String(st.out), `นอกข้อกำหนด · เตือน ${st.warn}`],
            ].map(([k, v, s], i) => (
              <motion.div
                key={k}
                className={`ch-stat ${k === "OUT" && st.out ? "is-bad" : ""} ${k === "Cpk" && st.cpk != null ? (st.cpk >= 1.33 ? "is-good" : st.cpk < 1 ? "is-bad" : "is-mid") : ""}`}
                initial={reduce ? false : { opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease: EASE, delay: Math.min(i * 0.05, 0.4) }}
              >
                <small>{k}</small>
                <b>{v}</b>
                <span>{s}</span>
              </motion.div>
            ))}
          </div>

          <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" custom={1}>
            <Card
              clip={false}
              title={`${p.code} • ${p.name}`}
              actions={<Seg id="ch-view" value={view} onChange={setView} options={[{ v: "ALL", l: "ALL" }, { v: "D", l: "DAY" }, ...(p.shifts === "DN" ? [{ v: "N" as const, l: "NIGHT" }] : [])]} />}
              bodyClass="px-2 pb-3 pt-3 md:px-4"
            >
              <ControlChart key={p.id + view + month} p={p} points={points} ariaLabel={`${p.code} control chart`} />
              <div className="cc-legend">
                <span className="is-zone">ช่วงควบคุม (LCL – UCL)</span>
                <span className="is-spec">ขีดจำกัดข้อกำหนด (Spec)</span>
                <span className="is-ctl">ขีดจำกัดควบคุม (UCL / LCL)</span>
                <span className="is-target">ค่าเป้าหมาย</span>
                <span className="is-ok">● อยู่ในเกณฑ์</span>
                <span className="is-warn">● เกินขีดจำกัดควบคุม</span>
                <span className="is-out">● นอกข้อกำหนด</span>
              </div>
            </Card>
          </motion.div>

          <div className="ch-two">
            <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.05 }} custom={0}>
              <Card title={`ผลการตรวจวัดรายวัน • ${month}`}>
                <div className="ch-scroll ch-daywrap">
                  <table className="ch-table">
                    <thead>
                      <tr>
                        <th>DATE</th>
                        {dayT.map((t) => (
                          <th key={"d" + t}>☀ {t}</th>
                        ))}
                        {nightT.map((t) => (
                          <th key={"n" + t}>☾ {t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: nd }, (_, i) => i + 1).map((day) => {
                        const sun = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day).getDay() === 0;
                        return (
                          <tr key={day} className={`${sun ? "is-sun" : ""} ch-rise`} style={{ "--i": day } as React.CSSProperties}>
                            <td className="d">
                              {day}
                              <small>{new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day).toLocaleDateString("en-US", { weekday: "short" })}</small>
                            </td>
                            {[...dayT.map((_, k) => ["D", k + 1] as const), ...nightT.map((_, k) => ["N", k + 1] as const)].map(([s, k]) => {
                              const r = byKey.get(`${day}-${s}-${k}`);
                              const sv = r ? statusOf(p, r.value) : "NONE";
                              return (
                                <td key={s + k} className={`v is-${sv.toLowerCase()}`} title={r?.inspector ? `${r.inspector} · ${r.time ?? ""}` : undefined}>
                                  {r ? fmt(p, r.value) : ""}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>

            <div className="flex min-w-0 flex-col gap-4">
              <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.05 }} custom={1}>
                <Approval d={d} busy={busy} onSubmit={() => act("/chem/sheets/submit", "SUBMITTED", { paramId: p.id, month })} onSign={(id) => act(`/chem/sheets/${id}/sign`, "SIGNED")} onReturn={async (id) => (await dlg.confirm({ title: "RETURN", message: "ตีกลับใบบันทึกเป็นฉบับร่าง (ล้างลายเซ็นทั้งหมด) ?", ok: "RETURN", danger: true })) && act(`/chem/sheets/${id}/return`, "RETURNED")} />
              </motion.div>

              <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.05 }} custom={2}>
                <Card
                  title={`บันทึกการแก้ไขและปรับค่าน้ำยา • ${d.actions.length}`}
                  actions={
                    d.can.record &&
                    !locked && (
                      <button type="button" className="btn bg-accent" onClick={() => setForm({ id: 0, date: `${month}-${String(Math.min(new Date().getDate(), nd)).padStart(2, "0")}`, checkTime: "", problem: "", before: "", after: "", correction: "", adjustTime: "", responsible: "" })}>
                        ＋ CORRECTIVE ACTION
                      </button>
                    )
                  }
                >
                  {d.actions.length === 0 ? (
                    <Empty>ยังไม่มีบันทึกการแก้ไขในเดือนนี้</Empty>
                  ) : (
                    <div className="ch-actions">
                      {d.actions.map((a, i) => (
                        <motion.div key={a.id} className="ch-action" initial={reduce ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: EASE, delay: Math.min(i * 0.04, 0.3) }}>
                          <div className="h">
                            <b>{th(a.date)}</b>
                            <span>{a.checkTime ? `ตรวจพบ ${a.checkTime}` : ""}</span>
                            {d.can.edit && !locked && (
                              <RowActions className="ml-auto">
                                <RowAction kind="edit" onClick={() => setForm({ id: a.id, date: a.date.slice(0, 10), checkTime: a.checkTime ?? "", problem: a.problem ?? "", before: a.before?.toString() ?? "", after: a.after?.toString() ?? "", correction: a.correction ?? "", adjustTime: a.adjustTime ?? "", responsible: a.responsible ?? "" })} />
                                <RowAction kind="delete" onClick={async () => (await dlg.confirm({ title: "DELETE", message: "ลบบันทึกการแก้ไขนี้ ?", ok: "DELETE", danger: true })) && api<{ message: string }>(`/chem/actions/${a.id}`, { method: "DELETE" }).then((r) => (toast.show("DELETED", r.message, "ok"), load(true))).catch((e: Error) => toast.show("ERROR", e.message, "error"))} />
                              </RowActions>
                            )}
                          </div>
                          <p>{a.problem}</p>
                          <div className="vals">
                            <span className={`is-${statusOf(p, a.before).toLowerCase()}`}>ก่อน {fmt(p, a.before)}</span>
                            <i>→</i>
                            <span className={`is-${statusOf(p, a.after).toLowerCase()}`}>หลัง {fmt(p, a.after)}</span>
                          </div>
                          <p className="corr">
                            🧴 {a.correction ?? "–"} {a.adjustTime ? `· ปรับเวลา ${a.adjustTime}` : ""} {a.responsible ? `· ${a.responsible}` : ""}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </Card>
              </motion.div>
            </div>
          </div>

          {/* ใบบันทึก A4 สำหรับ EXPORT PDF (วาดนอกจอ) */}
          {pdf && (
            <div className="ch-print-host" aria-hidden>
              <div ref={sheetRef} className="ch-sheet">
                <PrintSheet d={d} st={st} month={month} nd={nd} dayT={dayT} nightT={nightT} byKey={byKey} points={points} />
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        open={!!form}
        title={form?.id ? "✏️ แก้ไขบันทึกการแก้ไข" : "＋ บันทึกการแก้ไขและปรับค่าน้ำยา"}
        onClose={() => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
              CANCEL
            </button>
            <button type="button" className="btn bg-success" disabled={busy} onClick={saveForm}>
              💾 SAVE
            </button>
          </>
        }
      >
        {form && p && (
          <div className="ch-form">
            <label>
              <span>วันที่</span>
              <input type="date" className="field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label>
              <span>เวลาที่ตรวจพบ</span>
              <input type="time" className="field" value={form.checkTime} onChange={(e) => setForm({ ...form, checkTime: e.target.value })} />
            </label>
            <label className="is-wide">
              <span>ปัญหาที่พบในการตรวจสอบ</span>
              <input className="field" maxLength={500} value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} />
            </label>
            <label>
              <span>ค่าที่วัดได้ก่อนการแก้ไข ({p.unit})</span>
              <input className={`field text-right font-bold is-${statusOf(p, form.before === "" ? null : Number(form.before)).toLowerCase()}`} inputMode="decimal" value={form.before} onChange={(e) => /^-?\d*\.?\d*$/.test(e.target.value) && setForm({ ...form, before: e.target.value })} />
            </label>
            <label>
              <span>ค่าที่วัดได้หลังการแก้ไข ({p.unit})</span>
              <input className={`field text-right font-bold is-${statusOf(p, form.after === "" ? null : Number(form.after)).toLowerCase()}`} inputMode="decimal" value={form.after} onChange={(e) => /^-?\d*\.?\d*$/.test(e.target.value) && setForm({ ...form, after: e.target.value })} />
            </label>
            <label className="is-wide">
              <span>วิธีการแก้ไข (จำนวนน้ำยาที่เติม)</span>
              <input className="field" maxLength={500} value={form.correction} placeholder="เช่น เติมน้ำยา FC-L4460 5 ลิตร" onChange={(e) => setForm({ ...form, correction: e.target.value })} />
            </label>
            <label>
              <span>เวลาที่ปรับค่าน้ำยา</span>
              <input type="time" className="field" value={form.adjustTime} onChange={(e) => setForm({ ...form, adjustTime: e.target.value })} />
            </label>
            <label>
              <span>ผู้รับผิดชอบ</span>
              <input className="field" maxLength={200} value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} />
            </label>
            <p className="is-wide text-xs font-bold text-ink-soft">
              SPEC {specText(p)} {p.unit} · UCL {fmt(p, p.ucl)} · LCL {fmt(p, p.lcl)}
            </p>
          </div>
        )}
      </Modal>
    </PageBody>
  );
}

// ✍ การอนุมัติ: ลำดับขั้น Prepared → Checked → Reviewed → Approved (แสดงลายเซ็นที่ลงแล้ว)
function Approval({ d, busy, onSubmit, onSign, onReturn }: { d: Data; busy: boolean; onSubmit: () => void; onSign: (id: number) => void; onReturn: (id: number) => void }) {
  const reduce = useReducedMotion();
  const steps = d.flow.filter((f) => f.active);
  const s = d.sheet;
  const st = s?.status ?? "DRAFT";
  const wait = steps.find((f) => f.waiting);
  return (
    <Card title="การอนุมัติใบบันทึก (SIGN FLOW)" actions={<span className={`ch-sheet-st is-${st.toLowerCase()}`}>{st === "APPROVED" ? "✓ APPROVED" : st === "SIGNING" ? "✍ SIGNING" : "DRAFT"}</span>}>
      <div className="ch-flow">
        {steps.length === 0 ? (
          <p className="ch-flow-none">ยังไม่ได้ตั้ง FLOW ลายเซ็น · Admin ตั้งได้ที่ User Management › SETUP › SIGN FLOW › CHEMICAL CONTROL</p>
        ) : (
          <div className="ch-steps">
            {steps.map((f, i) => (
              <motion.div
                key={f.slot}
                className={`ch-step ${f.signed ? "is-done" : f.waiting ? "is-wait" : ""}`}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE, delay: i * 0.08 }}
              >
                <span className="dot">{f.signed ? "✓" : i + 1}</span>
                <b>{f.name}</b>
                {f.signed ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/signature/${encodeURIComponent(f.signed.userId)}/image`} alt={f.signed.name} />
                    <small>
                      {f.signed.name}
                      <br />
                      {new Date(f.signed.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </small>
                  </>
                ) : (
                  <small>{f.mode === "ONE" ? f.users[0]?.name : `${f.users.length} คน (คนใดคนหนึ่ง)`}</small>
                )}
              </motion.div>
            ))}
          </div>
        )}
        <div className="ch-flow-act">
          {st === "DRAFT" && d.can.record && (
            <button type="button" className="btn bg-accent" disabled={busy || steps.length === 0} onClick={onSubmit}>
              ➤ SUBMIT FOR APPROVAL
            </button>
          )}
          {st === "SIGNING" && wait?.mine && (
            <>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => onReturn(s!.id)}>
                ↩ RETURN
              </button>
              <button type="button" className="btn bg-success" disabled={busy || !d.mySign} onClick={() => onSign(s!.id)} title={d.mySign ? undefined : "บันทึกลายเซ็นที่ โปรไฟล์ › ลายเซ็นของฉัน ก่อน"}>
                ✍ SIGN AS {wait.name.toUpperCase()}
              </button>
            </>
          )}
          {st === "SIGNING" && !wait?.mine && <span className="ch-hint">รอ {wait?.name} ลงลายเซ็น</span>}
          {st === "SIGNING" && wait?.mine && !d.mySign && <span className="ch-hint is-warn">ยังไม่มีลายเซ็นของคุณ · บันทึกที่ โปรไฟล์ › ลายเซ็นของฉัน</span>}
          {st !== "DRAFT" && <span className="ch-hint">ส่งโดย {s?.submittedBy ?? "–"} {s?.submittedAt ? `· ${new Date(s.submittedAt).toLocaleDateString("th-TH")}` : ""} · แก้ไขข้อมูลเดือนนี้ไม่ได้ระหว่างอนุมัติ</span>}
        </div>
      </div>
    </Card>
  );
}

// 🖨 ใบบันทึก A4 (Export PDF): หัวเอกสาร · มาตรฐาน · แผนภูมิ · ตารางรายวัน · สถิติ · บันทึกการแก้ไข · ลายเซ็น
function PrintSheet({ d, st, month, nd, dayT, nightT, byKey, points }: { d: Data; st: ReturnType<typeof stats>; month: string; nd: number; dayT: string[]; nightT: string[]; byKey: Map<string, ChemReading>; points: ChartPoint[] }) {
  const p = d.parameter;
  const [y, m] = month.split("-").map(Number);
  return (
    <>
      <div className="ps-head">
        <div>
          <small>CH RADIATORS CO., LTD. · CHEMICAL CONTROL · ED PAINT LINE</small>
          <h1>บันทึกผลการตรวจวัดค่าน้ำยาเคมี</h1>
          <h2>
            {p.name} {p.nameTh ? `· ${p.nameTh}` : ""}
          </h2>
        </div>
        <div className="r">
          <b>{p.formNo}</b>
          <span>ประจำเดือน {new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" })}</span>
          <span>รหัส {p.code}</span>
        </div>
      </div>
      <div className="ps-spec">
        <span>
          มาตรฐาน (SPEC) <b>{specText(p)}</b> {p.unit}
        </span>
        <span>
          UCL <b>{fmt(p, p.ucl)}</b>
        </span>
        <span>
          LCL <b>{fmt(p, p.lcl)}</b>
        </span>
        <span>
          TARGET <b>{fmt(p, p.target)}</b>
        </span>
        <span>{p.method}</span>
      </div>
      <div className="ps-chart">
        <ControlChart p={p} points={points.map((x) => ({ ...x, tip: null }))} height={250} ariaLabel="chart" />
      </div>
      <div className="ps-body">
        <table className="ps-table">
          <thead>
            <tr>
              <th>วันที่</th>
              {dayT.map((t) => (
                <th key={"d" + t}>กลางวัน {t}</th>
              ))}
              {nightT.map((t) => (
                <th key={"n" + t}>กลางคืน {t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: nd }, (_, i) => i + 1).map((day) => (
              <tr key={day}>
                <td>{day}</td>
                {[...dayT.map((_, k) => ["D", k + 1] as const), ...nightT.map((_, k) => ["N", k + 1] as const)].map(([s, k]) => {
                  const r = byKey.get(`${day}-${s}-${k}`);
                  return (
                    <td key={s + k} className={r ? `is-${statusOf(p, r.value).toLowerCase()}` : ""}>
                      {r ? fmt(p, r.value) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ps-side">
          <h3>สรุปผล</h3>
          {[
            ["จำนวนครั้ง (n)", String(st.n)],
            ["ค่าเฉลี่ย", fmt(p, st.n ? st.mean : null)],
            ["σ", st.n > 1 ? st.sd.toFixed(3) : "–"],
            ["ต่ำสุด / สูงสุด", `${fmt(p, st.min)} / ${fmt(p, st.max)}`],
            ["Cp / Cpk", `${st.cp == null ? "–" : st.cp.toFixed(2)} / ${st.cpk == null ? "–" : st.cpk.toFixed(2)}`],
            ["นอกข้อกำหนด", `${st.out} ครั้ง`],
          ].map(([k, v]) => (
            <div key={k} className="ps-kv">
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
          <h3>บันทึกการแก้ไข</h3>
          {d.actions.length === 0 ? (
            <p className="ps-none">ไม่มี</p>
          ) : (
            d.actions.slice(0, 8).map((a) => (
              <div key={a.id} className="ps-act">
                <b>
                  {new Date(a.date).getDate()}/{m} {a.checkTime ?? ""}
                </b>{" "}
                {a.problem} · {fmt(p, a.before)} → {fmt(p, a.after)} · {a.correction} {a.responsible ? `(${a.responsible})` : ""}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="ps-signs">
        {d.flow
          .filter((f) => f.active)
          .map((f) => (
            <div key={f.slot} className="ps-sign">
              <span>{f.name}</span>
              <div className="img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {f.signed && <img src={`/api/signature/${encodeURIComponent(f.signed.userId)}/image`} alt="" crossOrigin="anonymous" />}
              </div>
              <b>{f.signed?.name ?? "………………………"}</b>
              <small>{f.signed ? new Date(f.signed.at).toLocaleDateString("th-TH") : "วันที่ ……/……/……"}</small>
            </div>
          ))}
      </div>
      <div className="ps-foot">
        พิมพ์จาก CHR-Nexus · {new Date().toLocaleString("th-TH")} · สถานะเอกสาร {d.sheet?.status ?? "DRAFT"}
      </div>
    </>
  );
}
