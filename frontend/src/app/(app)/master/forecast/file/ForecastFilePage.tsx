"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Empty, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { Pager } from "@/components/tables/Pager";
import { useToast } from "@/components/notifications/Toasts";
import { CalcChoiceModal, type CalcChoice } from "@/components/modals/CalcChoiceModal";
import { api, download, upload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/useDebounced";
import { EASE } from "@/lib/motion";
import { MON, defaultMonths, hasMonthData, matcher, n0, type FFile, type FlatRow, type Met, type SendRow } from "./ff";
import { ImportPreview } from "./ImportPreview";

// 📂 FORECAST FILE (MASTER DATA › Forecast / Order): เลือกไฟล์ FORECAST ทั้งไฟล์ -> กรอง (ลูกค้า / เดือน / ค้นหา) -> IMPORT ได้เลย ไม่ต้องทำไฟล์ Excel
//   ลูกค้าเลือกตามรายชื่อในชีท DIFF (3) ให้ก่อน + ตรวจยอดรวมกับแถว Total ของ DIFF (3)
//   "ไม่อัพเดทแถวที่ไม่มียอดในเดือนที่เลือก" = แถวที่ FORECAST / ORDER / DELIVERY ว่างหรือ 0 ทั้งหมด ไม่นำเข้า (ยอดเดิมในระบบคงเดิม)
//   CUSTOMER CODE / NAME ปิดไว้ก่อน (ใช้ตอน EXPORT เท่านั้น · IMPORT ใช้ลูกค้าของสินค้าในระบบตาม PART A)
const PAGE = 100;
const METS: { k: Met; l: string }[] = [
  { k: "F", l: "FORECAST" },
  { k: "O", l: "ORDER" },
  { k: "D", l: "DELIVERY" },
  { k: "X", l: "DIFF" },
];
const val = (r: FlatRow, k: Met) => (k === "F" ? r.p.f : k === "O" ? r.p.o : k === "D" ? r.p.d : r.p.x)[r.m - 1];

export default function ForecastFilePage() {
  const toast = useToast();
  const reduce = useReducedMotion();
  const { me } = useAuth();
  const canImport = !!me && (me.userLevel === 1 || !!me.can.forecastImport);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<FFile | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [months, setMonths] = useState<Set<number>>(new Set());
  const [key, setKey] = useState("");
  const q = useDebounced(key, 250);
  const [skipEmpty, setSkipEmpty] = useState(false); // ค่าเริ่มต้นปิด = เงื่อนไข Import เดิม (ช่องว่าง = 0)
  const [mets, setMets] = useState<Record<Met, boolean>>({ F: true, O: true, D: true, X: false });
  const [custCols, setCustCols] = useState(false);
  const [page, setPage] = useState(0);
  const [choice, setChoice] = useState<CalcChoice | null>(null);
  const [run, setRun] = useState<{ withCalc: boolean; rows: SendRow[] } | null>(null);
  const [exporting, setExporting] = useState(false);

  async function read(f: File) {
    if (!/\.xlsx?m?$/i.test(f.name)) return toast.show("WARNING", "รองรับเฉพาะไฟล์ Excel (.xlsx)", "warn");
    setReading(f.name);
    try {
      const r = await upload<FFile>("/forecast/file/read", f);
      const refSet = new Set(r.ref?.names ?? []);
      const pick = r.sheets.filter((s) => !r.ref || refSet.has(s.name)).map((s) => s.name);
      setFile(r);
      setSel(new Set(pick));
      setMonths(defaultMonths(r.sheets.filter((s) => pick.includes(s.name))));
      setYear(r.year ?? new Date().getFullYear());
      setKey("");
      setCustCols(false);
      setPage(0);
      const parts = r.sheets.reduce((a, s) => a + s.parts.length, 0);
      toast.show(
        "อ่านไฟล์แล้ว",
        `${r.fileName}\n${r.sheets.length} ลูกค้า (Sheet) • ${parts.toLocaleString()} Part` + (r.ref ? `\nเลือกลูกค้าตามรายชื่อใน ${r.ref.name} ให้แล้ว (${pick.length} จาก ${r.sheets.length})` : "") + (r.skipped.length ? `\nไม่นำ Sheet ${r.skipped.join(", ")} มาใช้` : ""),
        "ok",
      );
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setReading(null);
    }
  }

  const sheets = useMemo(() => file?.sheets ?? [], [file]);
  const chosen = useMemo(() => sheets.filter((s) => sel.has(s.name)), [sheets, sel]);
  const avail = useMemo(() => [...new Set(chosen.flatMap((s) => s.months))].sort((a, b) => a - b), [chosen]);
  const selM = useMemo(() => avail.filter((m) => months.has(m)), [avail, months]);
  const refNames = useMemo(() => new Set(file?.ref?.names ?? []), [file]);
  const isRef = !!file?.ref && refNames.size === sel.size && [...sel].every((n) => refNames.has(n));

  // แถวทั้งหมดตามตัวกรอง (Part × เดือน)
  const flat = useMemo(() => {
    const mt = matcher(q);
    const out: FlatRow[] = [];
    for (const sh of chosen)
      for (const p of sh.parts) {
        if (mt && !mt(sh, p)) continue;
        for (const m of selM) {
          if (skipEmpty && !hasMonthData(p, m)) continue;
          out.push({ sh, p, m });
        }
      }
    return out;
  }, [chosen, selM, q, skipEmpty]);
  const tot = useMemo(() => {
    const t = { F: 0, O: 0, D: 0 };
    for (const r of flat) {
      t.F += r.p.f[r.m - 1] ?? 0;
      t.O += r.p.o[r.m - 1] ?? 0;
      t.D += r.p.d[r.m - 1] ?? 0;
    }
    return t;
  }, [flat]);
  const skippedEmpty = useMemo(() => {
    if (!skipEmpty) return 0;
    const mt = matcher(q);
    let n = 0;
    for (const sh of chosen) for (const p of sh.parts) if (!mt || mt(sh, p)) for (const m of selM) if (!hasMonthData(p, m)) n++;
    return n;
  }, [chosen, selM, q, skipEmpty]);

  // ✔ ตรวจยอดรวมกับแถว Total ของ DIFF (3)
  const refCheck = useMemo(() => {
    const rf = file?.ref;
    if (!rf?.total || !selM.length) return null;
    if (!isRef) return { tone: "", text: `ลูกค้าที่เลือกไม่ตรงกับรายชื่อใน ${rf.name} จึงยังเทียบยอดรวมไม่ได้ · กด "ตาม ${rf.name}" เพื่อใช้รายชื่อเดียวกัน` };
    if (q.trim()) return { tone: "", text: `กำลังค้นหาอยู่ ยอดรวมจึงเป็นเฉพาะรายการที่ค้นเจอ · ล้างช่องค้นหาเพื่อเทียบกับ ${rf.name}` };
    let rF = 0,
      rO = 0,
      rD = 0;
    for (const m of selM) {
      rF += rf.total.f[m - 1] ?? 0;
      rO += rf.total.o[m - 1] ?? 0;
      rD += rf.total.d[m - 1] ?? 0;
    }
    const dF = Math.round(tot.F - rF),
      dO = Math.round(tot.O - rO),
      dD = Math.round(tot.D - rD);
    if (!dF && !dO && !dD) return { tone: "is-ok", text: `✔ ตรงกับยอดรวมใน ${rf.name} ของเดือนที่เลือก: Forecast ${n0(rF)} · Order ${n0(rO)} · Delivery ${n0(rD)}` };
    const sg = (x: number) => (x > 0 ? "+" : "") + n0(x);
    return { tone: "is-bad", text: `⚠ ไม่ตรงกับ ${rf.name} ต่างกัน Forecast ${sg(dF)} · Order ${sg(dO)} · Delivery ${sg(dD)}` };
  }, [file, isRef, q, selM, tot]);

  const pages = Math.max(1, Math.ceil(flat.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = flat.slice(cur * PAGE, cur * PAGE + PAGE);
  const activeMets = METS.filter((x) => mets[x.k]);

  const toSend = (): SendRow[] =>
    flat.map((r) => ({ sheet: r.sh.name, customer: r.sh.name, partA: r.p.partA, partNo: r.p.partNo, name: r.p.partName, month: r.m, f: r.p.f[r.m - 1], o: r.p.o[r.m - 1], d: r.p.d[r.m - 1] }));

  async function startImport() {
    if (!flat.length) return toast.show("WARNING", "ยังไม่มีรายการที่จะนำเข้า (เลือกลูกค้า / เดือน)", "warn");
    try {
      setChoice(await api<CalcChoice>("/forecast/import/choice"));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function exportXlsx() {
    if (!flat.length || !activeMets.length) return toast.show("WARNING", "ยังไม่มีข้อมูลให้ส่งออก", "warn");
    setExporting(true);
    try {
      const names = chosen.map((s) => s.name);
      const fname = `Forecast_Order_${names.length === 1 ? names[0] : names.length + "Customers"}_${selM.map((m) => MON[m - 1]).join("-")}`;
      await download("/forecast/file/export", undefined, {
        fileName: fname,
        customer: custCols,
        f: mets.F,
        o: mets.O,
        d: mets.D,
        x: mets.X,
        rows: flat.map((r) => ({ code: r.sh.name, custName: r.sh.customer, partA: r.p.partA, partNo: r.p.partNo, name: r.p.partName, month: r.m, f: r.p.f[r.m - 1], o: r.p.o[r.m - 1], d: r.p.d[r.m - 1], x: r.p.x[r.m - 1] })),
      });
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setExporting(false);
    }
  }

  const toggleSheet = (n: string) => (setSel((s) => (s.has(n) ? new Set([...s].filter((x) => x !== n)) : new Set([...s, n]))), setPage(0));
  const toggleMonth = (m: number) => (setMonths((s) => (s.has(m) ? new Set([...s].filter((x) => x !== m)) : new Set([...s, m]))), setPage(0));

  if (!canImport)
    return (
      <PageBody>
        <Empty>คุณไม่มีสิทธิ์นำเข้า Forecast / Order</Empty>
      </PageBody>
    );

  return (
    <PageBody>
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title="FORECAST FILE"
        subtitle={file ? `${file.fileName} • ปี ${year} • ${flat.length.toLocaleString()} แถว` : "เลือกไฟล์ FORECAST ทั้งไฟล์ แล้วกรอง / IMPORT ได้เลย"}
        actions={
          <Link href="/master/forecast" className="fill-btn">
            ← FORECAST / ORDER
          </Link>
        }
      />

      {/* 1️⃣ เลือกไฟล์ (ลากมาวางได้) */}
      <div
        className={`ff-drop ${drag ? "is-over" : ""} ${file ? "is-loaded" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => !reading && fileRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileRef.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !reading) read(f);
        }}
      >
        <span className="ff-drop-ic" aria-hidden>
          {reading ? <i className="ff-spin" /> : "📂"}
        </span>
        <span className="min-w-0">
          <b>{reading ? `กำลังอ่านไฟล์ ${reading} …` : file ? file.fileName : "เลือกไฟล์ FORECAST (.xlsx)"}</b>
          <small>{reading ? "ไฟล์ใหญ่อาจใช้เวลาสักครู่ (อ่านที่ Server)" : file ? "กดเพื่อเลือกไฟล์ใหม่ หรือลากไฟล์มาวาง" : "กดเพื่อเลือก หรือลากไฟล์มาวางที่นี่ · 1 ชีท = 1 ลูกค้า (แบบไฟล์ FORECAST ของฝ่ายขาย)"}</small>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) read(f);
          }}
        />
      </div>

      <AnimatePresence initial={false}>
        {file && (
          <motion.div key={file.id} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="grid gap-4">
            {/* 2️⃣ ตัวกรอง */}
            <Card title="FILTER" bodyClass="p-4">
              <div className="grid gap-4">
                <div>
                  <div className="ff-lab">
                    <span>
                      ลูกค้า (Sheet) • {sel.size} จาก {sheets.length}
                      {isRef ? ` (ตาม ${file.ref?.name})` : ""}
                    </span>
                    {file.ref && (
                      <button type="button" className={`ff-mini ${isRef ? "is-on" : ""}`} onClick={() => (setSel(new Set(sheets.filter((s) => refNames.has(s.name)).map((s) => s.name))), setPage(0))}>
                        ตาม {file.ref.name}
                      </button>
                    )}
                    <button type="button" className="ff-mini" onClick={() => (setSel(new Set(sheets.map((s) => s.name))), setPage(0))}>
                      ทุก Sheet
                    </button>
                    <button type="button" className="ff-mini" onClick={() => (setSel(new Set()), setPage(0))}>
                      ไม่เลือก
                    </button>
                  </div>
                  <div className="ff-chips">
                    {sheets.map((s) => (
                      <button key={s.name} type="button" className={`ff-chip ${sel.has(s.name) ? "is-on" : ""}`} aria-pressed={sel.has(s.name)} onClick={() => toggleSheet(s.name)} title={s.customer}>
                        {s.name}
                        <small>{s.parts.length}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div>
                    <div className="ff-lab">
                      <span>เดือน • {selM.length ? selM.map((m) => MON[m - 1]).join(", ") : "ยังไม่ได้เลือก"}</span>
                      <button type="button" className="ff-mini" onClick={() => (setMonths(new Set(avail)), setPage(0))}>
                        ทุกเดือน
                      </button>
                      <button type="button" className="ff-mini" onClick={() => (setMonths(new Set()), setPage(0))}>
                        ล้าง
                      </button>
                    </div>
                    <div className="ff-chips">
                      {avail.map((m) => (
                        <button key={m} type="button" className={`ff-chip is-month ${months.has(m) ? "is-on" : ""}`} aria-pressed={months.has(m)} onClick={() => toggleMonth(m)}>
                          {MON[m - 1]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="ff-year">
                    <span className="ff-lab">ปีของไฟล์</span>
                    <input type="number" className="field" min={2000} max={2100} value={year} onChange={(e) => setYear(Math.max(2000, Math.min(2100, Number(e.target.value) || year)))} />
                    <small>{file.year ? `ระบบอ่านได้ ${file.year} (จากหัวคอลัมน์ DEC'${String(file.year - 1).slice(2)})` : "ไม่พบปีในไฟล์ - ตรวจสอบก่อน IMPORT"}</small>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <SearchBox value={key} onChange={(v) => (setKey(v), setPage(0))} placeholder="ค้นหา PART A / PART NO / ชื่อ / MODEL / ลูกค้า (คั่นหลายคำด้วย ,)" className="min-w-[240px] flex-1" />
                  <button type="button" role="switch" aria-checked={skipEmpty} className={`sw ${skipEmpty ? "is-on" : ""}`} onClick={() => (setSkipEmpty((v) => !v), setPage(0))}>
                    <span className="sw-track" />
                    ไม่อัพเดทแถวที่ไม่มียอดในเดือนที่เลือก
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="ff-lab !mb-0">
                    <span>ยอด</span>
                  </span>
                  {METS.map((x) => (
                    <button key={x.k} type="button" className={`ff-chip is-sm ${mets[x.k] ? "is-on" : ""}`} aria-pressed={mets[x.k]} onClick={() => setMets((m) => ({ ...m, [x.k]: !m[x.k] }))}>
                      {x.l}
                    </button>
                  ))}
                  <span className="ff-lab !mb-0 ml-2">
                    <span>คอลัมน์</span>
                  </span>
                  <button type="button" className={`ff-chip is-sm ${custCols ? "is-on" : ""}`} aria-pressed={custCols} onClick={() => setCustCols((v) => !v)} title="ใช้ตอน EXPORT · IMPORT ใช้ลูกค้าของสินค้าในระบบตาม PART A">
                    CUSTOMER CODE / NAME
                  </button>
                </div>

                <div className="ff-sum">
                  <span>
                    <small>แถว</small>
                    <b>{flat.length.toLocaleString()}</b>
                  </span>
                  <span>
                    <small>FORECAST</small>
                    <b>{n0(tot.F)}</b>
                  </span>
                  <span>
                    <small>ORDER</small>
                    <b>{n0(tot.O)}</b>
                  </span>
                  <span>
                    <small>DELIVERY</small>
                    <b>{n0(tot.D)}</b>
                  </span>
                  {skippedEmpty > 0 && (
                    <span className="is-mute">
                      <small>ไม่อัพเดท (ไม่มียอด)</small>
                      <b>{skippedEmpty.toLocaleString()}</b>
                    </span>
                  )}
                </div>
                {refCheck && <p className={`ff-ref ${refCheck.tone}`}>{refCheck.text}</p>}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" className="cta-btn is-green" disabled={exporting || !flat.length} onClick={exportXlsx}>
                    {exporting ? "…" : "📤 EXPORT EXCEL"}
                  </button>
                  <button type="button" className="cta-btn" disabled={!flat.length || !!run} onClick={startImport}>
                    📥 IMPORT {flat.length ? `(${flat.length.toLocaleString()} แถว)` : ""}
                  </button>
                </div>
              </div>
            </Card>

            {/* 3️⃣ ตาราง (แบบ Template FORECAST ORDER) */}
            <Card title={`ITEMS • ${flat.length.toLocaleString()}`} bodyClass="p-0">
              {flat.length === 0 ? (
                <Empty>{!sel.size ? "ยังไม่ได้เลือกลูกค้า" : !selM.length ? "ยังไม่ได้เลือกเดือน" : "ไม่พบรายการ"}</Empty>
              ) : (
                <>
                  <div className="ff-table-wrap">
                    <table className="ff-table">
                      <thead>
                        <tr>
                          <th>NO</th>
                          {custCols && (
                            <>
                              <th>CUSTOMER CODE</th>
                              <th>CUSTOMER NAME</th>
                            </>
                          )}
                          <th>PART A</th>
                          <th>PART NO</th>
                          <th>PRODUCT NAME</th>
                          <th>MONTH</th>
                          {activeMets.map((x) => (
                            <th key={x.k} className="is-num">
                              {x.l}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r, i) => (
                          <tr key={`${r.sh.name}|${r.p.no}|${r.p.partA}|${r.p.partNo}|${r.m}|${i}`} style={{ "--i": Math.min(i, 20) } as React.CSSProperties}>
                            <td data-label="NO" className="is-no">
                              {cur * PAGE + i + 1}
                            </td>
                            {custCols && (
                              <>
                                <td data-label="CUSTOMER CODE">{r.sh.name}</td>
                                <td data-label="CUSTOMER NAME" className="is-name">
                                  {r.sh.customer}
                                </td>
                              </>
                            )}
                            <td data-label="PART A" className={r.p.partA ? "is-pa" : "is-miss"}>
                              {r.p.partA || "ไม่มี PART A"}
                            </td>
                            <td data-label="PART NO" className="is-pn">
                              {r.p.partNo}
                            </td>
                            <td data-label="PRODUCT NAME" className="is-name">
                              {r.p.partName}
                              {!custCols && <small>{r.sh.name}</small>}
                            </td>
                            <td data-label="MONTH">{MON[r.m - 1]}</td>
                            {activeMets.map((x) => {
                              const v = val(r, x.k);
                              return (
                                <td key={x.k} data-label={x.l} className={`is-num ${v === 0 || v == null ? "is-z" : ""} ${x.k === "X" && (v ?? 0) < 0 ? "is-neg" : ""}`}>
                                  {x.k === "X" ? (v == null ? "" : v.toFixed(2)) : n0(v)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pages > 1 && (
                    <div className="p-3">
                      <Pager page={cur} pages={pages} total={flat.length} size={PAGE} onPage={setPage} />
                    </div>
                  )}
                </>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <CalcChoiceModal
        choice={choice}
        onClose={() => setChoice(null)}
        onPick={(withCalc) => setRun({ withCalc, rows: toSend() })}
        pickLabel="NEXT ▶"
      />
      {run && file && <ImportPreview file={file} year={year} withCalc={run.withCalc} rows={run.rows} onClose={() => setRun(null)} />}
    </PageBody>
  );
}
