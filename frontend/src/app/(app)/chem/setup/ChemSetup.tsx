"use client";

import { ClockField } from "@/components/forms/ClockField";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, Empty, Loading, PageBody, SearchBox } from "@/components/layout/Page";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { api } from "@/lib/api";
import { stamp } from "@/lib/format";
import { sameData, useLive } from "@/lib/live";
import { EASE } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { CATEGORY, catOf, fmt, specText, statusOf, times, type ChemCan, type ChemParam } from "@/lib/chem";
import { ControlChart } from "../ControlChart";
import { ChemHero, PkSeg } from "../ui";
import "../chem.css";

// ⚙ CHEMICAL CONTROL › PARAMETER SETUP (ตั้งค่าพารามิเตอร์ควบคุม)
//   เพิ่มรายการตรวจวัดใหม่ได้เอง (รองรับการขยายในอนาคต): รหัส · ชื่อ (EN / TH) · บ่อ / กระบวนการ · หมวด · หน่วย
//   ขีดจำกัดข้อกำหนด (Spec Min / Max) · ขีดจำกัดควบคุม (LCL / UCL) · ค่าเป้าหมาย · ทศนิยม · กะ + เวลาตรวจวัด (เพิ่ม / ลบเวลาได้)
//   ตัวอย่างแผนภูมิแสดงเส้นขีดจำกัดจริงระหว่างตั้งค่า · มีผลการตรวจวัดแล้ว = ลบไม่ได้ (ปิดใช้งานแทน)
type Form = {
  code: string;
  name: string;
  nameTh: string;
  line: string;
  process: string;
  category: string;
  unit: string;
  specMin: string;
  specMax: string;
  lcl: string;
  ucl: string;
  target: string;
  decimals: string;
  shifts: "D" | "DN";
  day: string[];
  night: string[];
  method: string;
  formNo: string;
  sort: string;
  active: boolean;
};
const EMPTY: Form = { code: "", name: "", nameTh: "", line: "ED PAINT LINE", process: "", category: "CHEMICAL", unit: "", specMin: "", specMax: "", lcl: "", ucl: "", target: "", decimals: "2", shifts: "DN", day: ["08:30"], night: ["20:00"], method: "", formNo: "FM-PD-04-03/1", sort: "", active: true };
const nOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const numOk = (s: string) => /^-?\d*\.?\d*$/.test(s);

export default function ChemSetup() {
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const [d, setD] = useState<{ parameters: ChemParam[]; can: ChemCan } | null>(null);
  const [row, setRow] = useState<ChemParam | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const k = useDebounced(q, 150).trim().toUpperCase();
  const formRef = useRef<HTMLDivElement>(null);

  const last = useRef("");
  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<{ parameters: ChemParam[]; can: ChemCan }>("/chem/params");
        if (sameData(last, r) && quiet) return;
        setD(r);
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
      }
    },
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["chem"], () => load(true));

  const can = d?.can;
  const rows = useMemo(() => (d?.parameters ?? []).filter((p) => !k || [p.code, p.name, p.nameTh, p.process, p.category].some((x) => (x ?? "").toUpperCase().includes(k))), [d, k]);
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));
  const preview: ChemParam = {
    id: 0, code: f.code, name: f.name, nameTh: f.nameTh, line: f.line, process: f.process, category: f.category, unit: f.unit,
    specMin: nOrNull(f.specMin), specMax: nOrNull(f.specMax), lcl: nOrNull(f.lcl), ucl: nOrNull(f.ucl), target: nOrNull(f.target),
    decimals: Number(f.decimals) || 0, shifts: f.shifts, dayTimes: f.day.join(","), nightTimes: f.night.join(","), method: f.method, formNo: f.formNo, sort: 0, active: f.active, readings: 0, updatedBy: null, updatedAt: "",
  };
  // ตัวอย่างค่าเพื่อแสดงแผนภูมิระหว่างตั้งค่า (สุ่มรอบค่าเป้าหมาย · ไม่ได้บันทึก)
  const demo = useMemo(() => {
    const lo = preview.specMin ?? (preview.specMax != null ? 0 : 0);
    const hi = preview.specMax ?? (preview.specMin != null ? preview.specMin * 2 : 1);
    const mid = preview.target ?? (lo + hi) / 2;
    const amp = (hi - lo) / 3 || 1;
    return Array.from({ length: 24 }, (_, i) => +(mid + Math.sin(i * 1.7) * amp * 0.6 + Math.cos(i * 0.9) * amp * 0.35).toFixed(4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.specMin, f.specMax, f.target]);

  function reset() {
    setRow(null);
    setF(EMPTY);
  }
  function open(p: ChemParam) {
    setRow(p);
    const s = (v: number | null) => (v == null ? "" : String(v));
    setF({
      code: p.code, name: p.name, nameTh: p.nameTh ?? "", line: p.line, process: p.process ?? "", category: p.category, unit: p.unit ?? "",
      specMin: s(p.specMin), specMax: s(p.specMax), lcl: s(p.lcl), ucl: s(p.ucl), target: s(p.target), decimals: String(p.decimals), shifts: p.shifts,
      day: times(p.dayTimes), night: times(p.nightTimes), method: p.method ?? "", formNo: p.formNo ?? "", sort: String(p.sort), active: p.active,
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function save() {
    if (![f.specMin, f.specMax, f.lcl, f.ucl, f.target].every(numOk)) return toast.show("WARNING", "ตัวเลขไม่ถูกต้อง", "warn");
    setBusy(true);
    try {
      const body = {
        ...preview,
        id: row?.id ?? 0,
        code: f.code.trim().toUpperCase(),
        sort: f.sort.trim() ? Number(f.sort) : row?.sort ?? 0,
        dayTimes: f.day.filter(Boolean).join(","),
        nightTimes: f.shifts === "D" ? null : f.night.filter(Boolean).join(","),
      };
      const r = await api<{ message: string }>("/chem/params", { method: "POST", body });
      toast.show("SAVED", r.message, "ok");
      reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: ChemParam) {
    if (!(await dlg.confirm({ title: "DELETE PARAMETER", message: `ลบพารามิเตอร์ "${p.code}" ?\n(มีผลการตรวจวัดแล้วลบไม่ได้ · เปลี่ยนเป็น INACTIVE แทน)`, ok: "DELETE", danger: true }))) return;
    try {
      const r = await api<{ message: string }>(`/chem/params/${p.id}`, { method: "DELETE" });
      toast.show("DELETED", r.message, "ok");
      if (row?.id === p.id) reset();
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const lab = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
  const editable = !!can && (row ? can.setupEdit : can.add);
  // ช่องเวลาตรวจวัด (เรียกเป็นฟังก์ชัน ไม่ใช่ Component = พิมพ์แล้วโฟกัสไม่หลุด)
  const timeList = (key: "day" | "night", label: string) => (
    <div className="ch-times">
      <span className={lab}>{label}</span>
      <div className="list">
        {f[key].map((t, i) => (
          <span key={i} className="t">
            <ClockField label={`ครั้งที่ ${i + 1}`} clearable={false} value={t} disabled={!editable} onChange={(v) => v && set({ [key]: f[key].map((x, j) => (j === i ? v : x)) } as Partial<Form>)} className="w-[132px]" />
            {f[key].length > 1 && editable && (
              <button type="button" aria-label="ลบเวลา" onClick={() => set({ [key]: f[key].filter((_, j) => j !== i) } as Partial<Form>)}>
                ✕
              </button>
            )}
          </span>
        ))}
        {editable && f[key].length < 6 && (
          <button type="button" className="add" onClick={() => set({ [key]: [...f[key], key === "day" ? "13:30" : "01:00"] } as Partial<Form>)}>
            ＋ เวลา
          </button>
        )}
      </div>
    </div>
  );

  return (
    <PageBody className="md-gray md-color-actions ch-page">
      <ChemHero tag="CHEMICAL CONTROL · ED PAINT LINE" title={["Parameter", "Setup"]} sub="ตั้งค่าพารามิเตอร์ควบคุม · ขีดจำกัดข้อกำหนด / ขีดจำกัดควบคุม / เวลาตรวจวัด · เพิ่มรายการตรวจวัดใหม่ได้เอง" />
      {!d ? (
        <Loading />
      ) : (
        <>
          {(can?.add || row) && (
            <motion.div ref={formRef} className="scroll-mt-4" data-reveal="" style={{ "--i": 1 } as React.CSSProperties}>
              <Card title={row ? `✏️ แก้ไข ${row.code}` : "＋ เพิ่มพารามิเตอร์ควบคุมใหม่"} bodyClass="p-4 md:p-5">
                <div className="ch-setup">
                  <div className="ch-setup-form">
                    <label>
                      <span className={lab}>รหัส (CODE) *</span>
                      <input className="field font-mono font-bold uppercase" maxLength={30} value={f.code} disabled={!editable} placeholder="เช่น ZP-TA" onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
                    </label>
                    <label className="is-wide">
                      <span className={lab}>ชื่อพารามิเตอร์ (EN) *</span>
                      <input className="field font-bold" maxLength={150} value={f.name} disabled={!editable} placeholder="Zinc Phosphate · Total Acid (TA)" onChange={(e) => set({ name: e.target.value })} />
                    </label>
                    <label className="is-wide">
                      <span className={lab}>ชื่อภาษาไทย</span>
                      <input className="field" maxLength={200} value={f.nameTh} disabled={!editable} placeholder="น้ำยาฟอสเฟต · ค่า Total Acid" onChange={(e) => set({ nameTh: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>บ่อ / กระบวนการ</span>
                      <input className="field" maxLength={80} value={f.process} disabled={!editable} placeholder="Zinc Phosphate" onChange={(e) => set({ process: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>สายการผลิต</span>
                      <input className="field" maxLength={60} value={f.line} disabled={!editable} onChange={(e) => set({ line: e.target.value })} />
                    </label>
                    <div className="is-wide">
                      <span className={lab}>หมวด</span>
                      <div className="ch-catpick">
                        {Object.keys(CATEGORY).map((c) => (
                          <button key={c} type="button" disabled={!editable} className={f.category === c ? "is-on" : ""} style={{ "--c": catOf(c).color } as React.CSSProperties} onClick={() => set({ category: c })}>
                            {catOf(c).label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label>
                      <span className={lab}>หน่วย</span>
                      <input className="field" maxLength={20} value={f.unit} disabled={!editable} list="ch-units" placeholder="ml / pH / % / °C" onChange={(e) => set({ unit: e.target.value })} />
                      <datalist id="ch-units">
                        {["ml", "pH", "%", "°C", "µS/cm", "g/L", "pt"].map((u) => (
                          <option key={u} value={u} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      <span className={lab}>ทศนิยม</span>
                      <input className="field text-right" inputMode="numeric" value={f.decimals} disabled={!editable} onChange={(e) => /^\d?$/.test(e.target.value) && set({ decimals: e.target.value })} />
                    </label>
                    {(
                      [
                        ["specMin", "SPEC MIN (LSL)", "is-spec"],
                        ["specMax", "SPEC MAX (USL)", "is-spec"],
                        ["lcl", "LCL", "is-ctl"],
                        ["ucl", "UCL", "is-ctl"],
                        ["target", "TARGET", "is-target"],
                      ] as const
                    ).map(([key, l, cls]) => (
                      <label key={key} className={`ch-lim ${cls}`}>
                        <span className={lab}>{l}</span>
                        <input className="field text-right font-bold" inputMode="decimal" value={f[key]} disabled={!editable} placeholder="–" onChange={(e) => numOk(e.target.value) && set({ [key]: e.target.value } as Partial<Form>)} />
                      </label>
                    ))}
                    <div className="is-wide">
                      <span className={lab}>กะที่ตรวจวัด</span>
                      <PkSeg id="ch-sh" value={f.shifts} onChange={(v) => editable && set({ shifts: v })} options={[{ v: "DN", l: "กลางวัน + กลางคืน" }, { v: "D", l: "กลางวันเท่านั้น" }]} />
                    </div>
                    <div className="is-wide">
                      {timeList("day", "เวลาตรวจวัด · กะกลางวัน")}
                    </div>
                    {f.shifts === "DN" && (
                      <div className="is-wide">
                        {timeList("night", "เวลาตรวจวัด · กะกลางคืน")}
                      </div>
                    )}
                    <label className="is-wide">
                      <span className={lab}>วิธีตรวจวัด / หมายเหตุ</span>
                      <input className="field" maxLength={300} value={f.method} disabled={!editable} onChange={(e) => set({ method: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>เลขที่แบบฟอร์ม</span>
                      <input className="field" maxLength={30} value={f.formNo} disabled={!editable} onChange={(e) => set({ formNo: e.target.value })} />
                    </label>
                    <label>
                      <span className={lab}>ลำดับ</span>
                      <input className="field" inputMode="numeric" value={f.sort} disabled={!editable} placeholder="อัตโนมัติ" onChange={(e) => /^\d*$/.test(e.target.value) && set({ sort: e.target.value })} />
                    </label>
                    {row && (
                      <div>
                        <span className={lab}>สถานะ</span>
                        <button type="button" role="switch" aria-checked={f.active} disabled={!editable} className={`sw ${f.active ? "is-on" : ""}`} onClick={() => set({ active: !f.active })}>
                          <span className="sw-track" />
                          {f.active ? "ACTIVE" : "INACTIVE"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="ch-setup-preview">
                    <span className={lab}>ตัวอย่างแผนภูมิควบคุม</span>
                    <ControlChart
                      p={preview}
                      height={220}
                      ariaLabel="preview"
                      points={demo.map((v, i) => ({ key: String(i), label: String(i + 1), value: v, status: statusOf(preview, v), tip: <h4>ตัวอย่าง {fmt(preview, v)}</h4> }))}
                    />
                    <p>
                      SPEC {specText(preview)} {f.unit} · ค่าในกราฟเป็นตัวอย่างเพื่อดูเส้นขีดจำกัดเท่านั้น
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line/60 pt-4">
                  {row && <span className="mr-auto text-xs font-bold text-ink-soft">UPDATE {stamp(row.updatedAt)} {row.updatedBy ? `· ${row.updatedBy}` : ""} · ผลการตรวจวัด {row.readings} ค่า</span>}
                  <button type="button" className="cta-btn is-gray min-w-[120px]" disabled={busy} onClick={reset}>
                    {row ? "✕ CANCEL" : "↺ RESET"}
                  </button>
                  {editable && (
                    <button type="button" className={`cta-btn min-w-[200px] ${row ? "is-green" : "is-purple"}`} disabled={busy} onClick={save}>
                      {busy ? "…" : row ? "💾 SAVE CHANGES" : "＋ ADD PARAMETER"}
                    </button>
                  )}
                </div>
              </Card>
            </motion.div>
          )}

          <motion.div data-reveal="" style={{ "--i": 2 } as React.CSSProperties}>
            <Card title={`CONTROL PARAMETERS • ${rows.length}`} actions={<SearchBox value={q} onChange={setQ} placeholder="ค้นหารหัส / ชื่อ / บ่อ" className="w-[280px] max-w-full" />}>
              {rows.length === 0 ? (
                <Empty>ไม่พบรายการ</Empty>
              ) : (
                <div className="ch-scroll">
                  <table className="ch-table is-list" data-stack>
                    <thead>
                      <tr>
                        <th>NO.</th>
                        <th>CODE</th>
                        <th>PARAMETER</th>
                        <th>PROCESS</th>
                        <th>SPEC</th>
                        <th>LCL / UCL</th>
                        <th>TARGET</th>
                        <th>CHECK TIMES</th>
                        <th>READINGS</th>
                        <th>STATUS</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p, i) => (
                        <motion.tr
                          key={p.id}
                          className={`${p.active ? "" : "opacity-50"} ${row?.id === p.id ? "is-picked" : ""}`}
                          initial={reduce ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: p.active ? 1 : 0.5, y: 0 }}
                          transition={{ duration: 0.3, ease: EASE, delay: Math.min(i * 0.02, 0.4) }}
                        >
                          <td>{i + 1}</td>
                          <td>
                            <b className="ch-code" style={{ "--c": catOf(p.category).color } as React.CSSProperties}>
                              {p.code}
                            </b>
                          </td>
                          <td className="t">
                            <b>{p.name}</b>
                            <small>{p.nameTh}</small>
                          </td>
                          <td>{p.process}</td>
                          <td className="font-bold">
                            {specText(p)} {p.unit}
                          </td>
                          <td>
                            {fmt(p, p.lcl)} / {fmt(p, p.ucl)}
                          </td>
                          <td>{fmt(p, p.target)}</td>
                          <td className="tm">
                            ☀ {times(p.dayTimes).join(", ")}
                            {p.shifts === "DN" && <> · ☾ {times(p.nightTimes).join(", ")}</>}
                          </td>
                          <td>{p.readings.toLocaleString()}</td>
                          <td>
                            <span className={`md-status ${p.active ? "is-on" : ""}`}>{p.active ? "ACTIVE" : "INACTIVE"}</span>
                          </td>
                          <td>
                            <RowActions>
                              <RowAction kind={can?.setupEdit ? "edit" : "view"} active={row?.id === p.id} onClick={() => open(p)} />
                              {can?.delete && <RowAction kind="delete" onClick={() => remove(p)} />}
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
        </>
      )}
    </PageBody>
  );
}
