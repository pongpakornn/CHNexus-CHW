"use client";
import Link from "next/link";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Card, Empty, Loading, PageBody } from "@/components/layout/Page";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { api, download } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { EASE } from "@/lib/motion";
import { catOf, fmt, slotsOf, specText, stats, statusOf, thisMonth, type ChemAction, type ChemCan, type ChemParam, type ChemReading } from "@/lib/chem";
import { ControlChart, type ChartPoint } from "../ControlChart";
import { ChemHero, FlowMap, MonthStep, PkSeg, SpecBar } from "../ui";
import { DateField } from "@/components/forms/DateField";
import { ClockField } from "@/components/forms/ClockField";
import { RecentInput } from "@/components/forms/RecentInput";
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

const th = (d: string) => fmtDate(d, "th-TH", { day: "numeric", month: "short", year: "2-digit" }, "date");

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
  // 🕘 ค่าที่ผู้ใช้คนนี้เคยกรอกในบันทึกการแก้ไข (โหลดตอนเปิดหน้าต่าง)
  type Recent = { problem: string[]; before: number[]; after: number[]; correction: string[]; responsible: string[] };
  const [recent, setRecent] = useState<Recent | null>(null);
  const formOpen = !!form;
  const formParam = d?.parameter?.id;
  useEffect(() => {
    if (!formOpen || !formParam) return;
    let alive = true;
    api<Recent>("/chem/actions/recent", { query: { paramId: formParam } })
      .then((r) => alive && setRecent(r))
      .catch(() => alive && setRecent(null));
    return () => {
      alive = false;
    };
  }, [formOpen, formParam]);
  const recentOf = (k: keyof Recent) => (recent?.[k] ?? []).map((v) => String(v));
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Meta>("/chem/meta")
      .then((m) => {
        setMeta(m);
        setPid((cur) => cur || m.parameters[0]?.id || 0);
      })
      .catch((e: Error) => toast.show("ERROR", e.message, "error"));
  }, [toast]);
  const last = useRef("");
  const load = useCallback(
    async (quiet = false) => {
      if (!pid) return;
      try {
        const r = await api<Data>("/chem/chart", { query: { paramId: pid, month } });
        if (sameData(last, r) && quiet) return; // เรียลไทม์แต่ข้อมูลเดิม = ไม่วาดใหม่
        setD(r);
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
    <ChemHero tag="CHEMICAL CONTROL · ED PAINT LINE" title={["Control Chart", "& Approval"]} sub="แผนภูมิควบคุมรายเดือน · สถิติกระบวนการ · บันทึกการแก้ไข · อนุมัติตาม Flow">
      <MonthStep value={month} onChange={(m) => go(pid, m)} />
      <button type="button" className="cta-btn is-red" disabled={!d || pdf} onClick={exportPdf}>
        {pdf ? "…" : "⤓ EXPORT PDF"}
      </button>
      <button type="button" className="cta-btn is-green" disabled={!d} onClick={() => download("/chem/export/excel", { paramId: pid, month }).catch((e: Error) => toast.show("ERROR", e.message, "error"))}>
        ⤓ EXPORT EXCEL
      </button>
    </ChemHero>
  );
  if (!meta) return <PageBody className="ch-page">{header}<Loading /></PageBody>;

  return (
    <PageBody className="ch-page">
      {header}
      <Card clip={false} bodyClass="p-3 md:p-4" className="ch-reveal">
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
              <div className="ch-specs-gauge">
                <SpecBar p={p} v={rs.length ? rs[rs.length - 1].value : null} />
              </div>
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
          <div className="ch-stats" data-reveal="" style={{ "--i": 2 } as React.CSSProperties}>
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

          <motion.div data-reveal="" style={{ "--i": 2 } as React.CSSProperties}>
            <Card
              clip={false}
              title={`${p.code} • ${p.name}`}
              actions={<PkSeg id="ch-view" value={view} onChange={setView} options={[{ v: "ALL", l: "ALL" }, { v: "D", l: "DAY" }, ...(p.shifts === "DN" ? [{ v: "N" as const, l: "NIGHT" }] : [])]} />}
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
            <motion.div data-reveal="" style={{ "--i": 3 } as React.CSSProperties}>
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
              <motion.div data-reveal="" style={{ "--i": 4 } as React.CSSProperties}>
                <Approval d={d} busy={busy} onSubmit={() => act("/chem/sheets/submit", "SUBMITTED", { paramId: p.id, month })} onSign={(id) => act(`/chem/sheets/${id}/sign`, "SIGNED")} onReturn={async (id) => (await dlg.confirm({ title: "RETURN", message: "ตีกลับใบบันทึกเป็นฉบับร่าง (ล้างลายเซ็นทั้งหมด) ?", ok: "RETURN", danger: true })) && act(`/chem/sheets/${id}/return`, "RETURNED")} />
              </motion.div>

              <motion.div data-reveal="" style={{ "--i": 5 } as React.CSSProperties}>
                <Card
                  title={`บันทึกการแก้ไขและปรับค่าน้ำยา • ${d.actions.length}`}
                  actions={
                    d.can.record &&
                    !locked && (
                      <button type="button" className="cta-btn is-purple" onClick={() => setForm({ id: 0, date: `${month}-${String(Math.min(new Date().getDate(), nd)).padStart(2, "0")}`, checkTime: "", problem: "", before: "", after: "", correction: "", adjustTime: "", responsible: "" })}>
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
                                <RowAction kind="edit" active={form?.id === a.id} onClick={() => (form?.id === a.id ? setForm(null) : setForm({ id: a.id, date: a.date.slice(0, 10), checkTime: a.checkTime ?? "", problem: a.problem ?? "", before: a.before?.toString() ?? "", after: a.after?.toString() ?? "", correction: a.correction ?? "", adjustTime: a.adjustTime ?? "", responsible: a.responsible ?? "" }))} />
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
            {!form?.id && (
              <button type="button" className="cta-btn is-gray" onClick={() => setForm(null)}>
                CANCEL
              </button>
            )}
            <button type="button" className="cta-btn is-green" disabled={busy} onClick={saveForm}>
              💾 SAVE
            </button>
          </>
        }
      >
        {form && p && (
          <div className="ch-form">
            <div className="ch-fl">
              <span>วันที่</span>
              <DateField label="DATE" value={form.date} onChange={(v) => v && setForm({ ...form, date: v })} />
            </div>
            <div className="ch-fl">
              <span>เวลาที่ตรวจพบ</span>
              <ClockField label="TIME" value={form.checkTime} onChange={(v) => setForm({ ...form, checkTime: v })} />
            </div>
            <label className="is-wide">
              <span>ปัญหาที่พบในการตรวจสอบ</span>
              <RecentInput maxLength={500} value={form.problem} recent={recentOf("problem")} onChange={(v) => setForm({ ...form, problem: v })} ariaLabel="ปัญหาที่พบ" />
            </label>
            <label>
              <span>ค่าที่วัดได้ก่อนการแก้ไข ({p.unit})</span>
              <RecentInput className={`field text-right font-bold is-${statusOf(p, form.before === "" ? null : Number(form.before)).toLowerCase()}`} inputMode="decimal" value={form.before} recent={recentOf("before")} onChange={(v) => /^-?\d*\.?\d*$/.test(v) && setForm({ ...form, before: v })} ariaLabel="ค่าก่อนการแก้ไข" />
            </label>
            <label>
              <span>ค่าที่วัดได้หลังการแก้ไข ({p.unit})</span>
              <RecentInput className={`field text-right font-bold is-${statusOf(p, form.after === "" ? null : Number(form.after)).toLowerCase()}`} inputMode="decimal" value={form.after} recent={recentOf("after")} onChange={(v) => /^-?\d*\.?\d*$/.test(v) && setForm({ ...form, after: v })} ariaLabel="ค่าหลังการแก้ไข" />
            </label>
            <label className="is-wide">
              <span>วิธีการแก้ไข (จำนวนน้ำยาที่เติม)</span>
              <RecentInput maxLength={500} value={form.correction} recent={recentOf("correction")} placeholder="เช่น เติมน้ำยา FC-L4460 5 ลิตร" onChange={(v) => setForm({ ...form, correction: v })} ariaLabel="วิธีการแก้ไข" />
            </label>
            <div className="ch-fl">
              <span>เวลาที่ปรับค่าน้ำยา</span>
              <ClockField label="TIME" value={form.adjustTime} onChange={(v) => setForm({ ...form, adjustTime: v })} />
            </div>
            <label>
              <span>ผู้รับผิดชอบ</span>
              <RecentInput maxLength={200} value={form.responsible} recent={recentOf("responsible")} onChange={(v) => setForm({ ...form, responsible: v })} ariaLabel="ผู้รับผิดชอบ" />
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

// ✍ การอนุมัติ: แผนผัง Start → Prepared → Checked → Reviewed → Approved → Finish (ชื่อผู้อนุมัติ + ลายเซ็นที่ลงแล้ว) + ปุ่มของขั้นที่รอฉัน
function Approval({ d, busy, onSubmit, onSign, onReturn }: { d: Data; busy: boolean; onSubmit: () => void; onSign: (id: number) => void; onReturn: (id: number) => void }) {
  const steps = d.flow.filter((f) => f.active);
  const s = d.sheet;
  const st = s?.status ?? "DRAFT";
  const wait = steps.find((f) => f.waiting);
  return (
    <Card title="ขั้นตอนการอนุมัติ (APPROVAL FLOW)" actions={<span className={`ch-sheet-st is-${st.toLowerCase()}`}>{st === "APPROVED" ? "✓ APPROVED" : st === "SIGNING" ? "✍ อยู่ระหว่างอนุมัติ" : "DRAFT · ฉบับร่าง"}</span>}>
      <div className="ch-flow">
        {steps.length === 0 ? (
          <p className="ch-flow-none">ยังไม่ได้ตั้ง Flow การอนุมัติ · Admin ตั้งได้ที่ <Link href="/admin/setup/sign-flow-chem" className="underline">User Management › System Configuration › Chemical Control › Sign Flow</Link></p>
        ) : (
          <div className="ch-scroll">
            <FlowMap
              started={st !== "DRAFT"}
              finished={st === "APPROVED"}
              submittedBy={s?.submittedBy}
              nodes={steps.map((f) => ({ slot: f.slot, name: f.name, th: f.name, mode: f.mode, users: f.users.map((u) => u.name || u.userId), waiting: f.waiting, done: f.signed }))}
            />
          </div>
        )}
        <div className="ch-flow-act">
          {st === "DRAFT" && <span className="ch-hint">ตรวจสอบข้อมูลครบแล้วกดส่งเพื่อเริ่มขั้นตอนการอนุมัติ</span>}
          {st === "DRAFT" && d.can.record && (
            <button type="button" className="cta-btn is-purple" disabled={busy || steps.length === 0} onClick={onSubmit}>
              ➤ SUBMIT FOR APPROVAL
            </button>
          )}
          {st === "SIGNING" && !wait?.mine && <span className="ch-hint">รอ {wait?.name} ({wait?.users.map((u) => u.name).join(" / ")}) ลงลายเซ็น</span>}
          {st === "SIGNING" && wait?.mine && !d.mySign && <span className="ch-hint is-warn">ยังไม่มีลายเซ็นของคุณ · บันทึกที่ โปรไฟล์ › ลายเซ็นของฉัน</span>}
          {st === "SIGNING" && wait?.mine && (
            <>
              <button type="button" className="cta-btn is-gray" disabled={busy} onClick={() => onReturn(s!.id)}>
                ↩ RETURN
              </button>
              <button type="button" className="cta-btn is-green" disabled={busy || !d.mySign} onClick={() => onSign(s!.id)}>
                ✍ SIGN AS {wait.name.toUpperCase()}
              </button>
            </>
          )}
          {st === "APPROVED" && <span className="ch-hint is-ok">✓ อนุมัติครบทุกขั้นตอนแล้ว {s?.doneAt ? fmtDate(s.doneAt, "th-TH") : ""}</span>}
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
              <small>{f.signed ? fmtDate(f.signed.at, "th-TH", undefined, "date") : "วันที่ ……/……/……"}</small>
            </div>
          ))}
      </div>
      <div className="ps-foot">
        พิมพ์จาก CHR-Nexus · {new Date().toLocaleString("th-TH")} · สถานะเอกสาร {d.sheet?.status ?? "DRAFT"}
      </div>
    </>
  );
}
