"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api, download, upload } from "@/lib/api";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { f0, f1, thisMonth } from "@/lib/pp";
import { Kpi, MonthPicker, PpIcon } from "../../shared";
import { EN, buildTable, deptTotals, refMap, savedHeads, signed, updOf, useWorkload, type WlField } from "./wl";
import { WlGrid, WlLegend } from "./WlGrid";
import { ImportReview } from "@/components/import/ImportReview";
import type { ImportPreview } from "@/components/import/types";
import { PpImportPreview } from "../../PpImportPreview";
import "../../pp.css";

// 👥 PRODUCTION PLAN › CAPACITY › WORKLOAD : สรุปอัตรากำลังคน แผน, ผล ประจำเดือน (Monthly man-power Plan & Actual) · แทนชีท "9. ManPower" ของ Excel Work load
//   สูตร / ข้อมูลอยู่ที่ ./wl.ts (ใช้ร่วมกับ DASHBOARD › WORKLOAD)
//   คนที่มีจริง (Current ของเดือน N · Actual ของเดือน N-1) = กรอกที่หน้านี้ แล้วกด SAVE · Capacity / Forecast / วันทำงานเปลี่ยน = อัพเดทเอง
//   PDT / Direct / Production = ยอดตามไฟล์ Excel Work load (ตัดสินใจใช้ตาม Excel) · IMPORT WORK LOAD EXCEL / TEMPLATE
//   เดือนที่ยังไม่ได้ Import = ใช้ยอดที่ระบบคำนวณจาก Capacity ไปก่อน (มีแถบแจ้ง)
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [excelPv, setExcelPv] = useState<ImportPreview | null>(null);
  // 📥 IMPORT Current (คนที่มีจริง) จาก Template ช่องกรอก -> หน้าเตรียม IMPORT แบบ Forecast
  const curFile = useRef<HTMLInputElement>(null);
  const [curPv, setCurPv] = useState<File | null>(null);

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
  const missing = ms.filter((m) => ![...refs.keys()].some((k) => k.startsWith(m.month + "|"))).map((m) => m.month);
  const refOf = useCallback((m: string, row: string) => refs.get(`${m}|${row}`), [refs]);
  const table = useMemo(() => (data ? buildTable(data, totals, headOf, refOf) : null), [data, totals, headOf, refOf]);

  // 📥 IMPORT WORK LOAD EXCEL -> สรุป -> ยืนยัน
  async function importExcel(f: File) {
    setImporting(true);
    try {
      setExcelPv(await upload<ImportPreview>("/pp/workload/excel", f));
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
              <button
                type="button"
                className="fill-btn"
                onClick={() => download("/pp/workload/template", { month }).catch((e) => toast.show("ERROR", "สร้าง Template ไม่สำเร็จ\n" + (e as Error).message, "error"))}
                title="ดาวน์โหลด Template (ชีท 9. ManPower) ของเดือน N-1 ถึง N+3 · กรอก PDT / Direct แล้ว IMPORT กลับ"
              >
                📄 WORK LOAD TEMPLATE
              </button>
              <button type="button" className="fill-btn" disabled={importing} onClick={() => fileRef.current?.click()} title="นำเข้ายอด PDT / Direct / Production จากไฟล์ Work load (ชีท 9. ManPower) หรือไฟล์ Template">
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
              {excelPv && <ImportReview preview={excelPv} applyUrl="/pp/workload/excel/apply" onClose={() => setExcelPv(null)} onDone={() => { setExcelPv(null); load(true); }} />}
            </>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                className="fill-btn"
                onClick={() => download("/pp/workload/current/template", { month }).catch((e) => toast.show("ERROR", "สร้าง Template ไม่สำเร็จ\n" + (e as Error).message, "error"))}
                title="ดาวน์โหลด Template คนที่มีจริง (Current) ของเดือนนี้ · DIRECT / IND1 / IND2 ทุกหน่วยงาน · เดือนใส่ให้แล้ว"
              >
                📄 CURRENT TEMPLATE
              </button>
              <button
                type="button"
                className="fill-btn"
                onClick={() => (dirty ? toast.show("WARNING", "มีจำนวนคนที่ยังไม่ได้ SAVE · กด SAVE หรือ CANCEL ก่อน IMPORT", "warn") : curFile.current?.click())}
                title="นำเข้าคนที่มีจริงจากไฟล์ Template · ยอดเท่าเดิม = ไม่แตะ · ยอดต่าง = อัพเดท · ว่าง = คงยอดเดิม (ยังไม่มียอด = 0)"
              >
                📥 IMPORT CURRENT
              </button>
              <input
                ref={curFile}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setCurPv(f);
                }}
              />
              <PpImportPreview
                file={curPv}
                endpoint="/pp/workload/current/import"
                title="WORKLOAD • CURRENT (คนที่มีจริง)"
                onClose={() => setCurPv(null)}
                onDone={() => {
                  setCurPv(null);
                  load(true);
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
  const edit = (m: string, row: string, f: WlField, label: string) => (
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
    );

  return (
    <PageBody className="pp-page">
      {header}
      {ms.some((m) => m.workdaySource === "DEFAULT") && (
        <div className="pp-note">
          ⚠ บางเดือนยังไม่ได้ตั้ง <b>Company Workdays</b> ({ms.filter((m) => m.workdaySource === "DEFAULT").map((m) => EN(m.month)).join(", ")}) · ใช้ จันทร์–เสาร์ ไปก่อน · ตั้งได้ที่ MASTER DATA › Company Workdays
        </div>
      )}

      {missing.length > 0 && (
        <div className="pp-note">
          ⚠ ยังไม่ได้ Import ยอดไฟล์ Work load ของ {missing.map((m) => EN(m)).join(", ")} · เดือนนั้นใช้ยอดที่ระบบคำนวณจาก Capacity ไปก่อน · กด IMPORT WORK LOAD EXCEL
        </div>
      )}

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
          title="9. MONTHLY MAN-POWER PLAN & ACTUAL"
          actions={<span className="pp-hint m-0">{canEdit ? "กรอกจำนวนคนที่มีจริงในช่อง CURRENT / ACTUAL แล้วกด SAVE · Plan คำนวณจาก Capacity เอง" : "ดูอย่างเดียว (ไม่มีสิทธิ์แก้จำนวนคน)"}</span>}
          bodyClass="p-0"
        >
          <WlGrid table={table} ms={ms} upd={upd} cell={canEdit ? edit : undefined} />
          <WlLegend />
        </Card>
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

