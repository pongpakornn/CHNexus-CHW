"use client";

import { RowAction, RowActions } from "@/components/ui/RowAction";
import { GroupRow, useCollapsed } from "@/components/ui/GroupRow";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ChoiceCard, Glyph, GLYPH } from "@/components/ui/ChoiceCard";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { Pager } from "@/components/ui/Pager";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { FormulaModal } from "./FormulaModal";
import type { CalcData, CalcRow, Stock } from "./types";
import { WorkdayModal } from "./WorkdayModal";
import { useLive } from "@/lib/live";

const PAGE = 100; // แถวต่อหน้า (เหมือนหน้าคลัง)
const PREF = "MaxMinCalc.Stock";
type ImportMode = "DAYS" | "CALC" | "ONLY";

function readPref() {
  try {
    return Number(localStorage.getItem(PREF)) || 0;
  } catch {
    return 0;
  }
}

// 📐 MAX-MIN CALCULATOR (MaxMinCalculatorView): เลือกคลัง / สูตร + AUTO CALC / MAX-MIN (DAYS) ต่อสินค้า / วันทำงานลูกค้า / Import / คำนวณ
//   ผลคำนวณเขียนลงค่า MAX / MIN ของหน้า Store (Max-Min) ของคลังนั้นโดยตรง
export default function MaxMinPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [stocks, setStocks] = useState<Stock[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [stk, setStk] = useState(0);
  const [data, setData] = useState<CalcData | null>(null);
  const [key, setKey] = useState("");
  const k = useDebounced(key, 400);
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [pickFormula, setPickFormula] = useState<number | null>(null);
  const [pickAuto, setPickAuto] = useState(false);
  const [editing, setEditing] = useState<CalcRow | null>(null);
  const [dayMax, setDayMax] = useState("");
  const [dayMin, setDayMin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [workdayOpen, setWorkdayOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [choice, setChoice] = useState<{ title: string; text: string; calc: string; only: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<ImportMode>("DAYS");
  const verRef = useRef(0);
  const tokenRef = useRef("");
  const editingRef = useRef<CalcRow | null>(null);
  const stock = stocks?.find((s) => s.stkId === stk) ?? null;

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    api<{ canEdit: boolean; stocks: Stock[] }>("/maxmin/stocks")
      .then((r) => {
        setStocks(r.stocks);
        setCanEdit(r.canEdit);
        const last = readPref();
        setStk(r.stocks.find((s) => s.stkId === last)?.stkId ?? r.stocks[0]?.stkId ?? 0);
      })
      .catch((e) => {
        toast.show("ERROR", "โหลดรายชื่อคลังไม่สำเร็จ\n" + e.message, "error");
        setStocks([]);
      });
  }, [toast]);

  // live = รอบเรียลไทม์: คงจำนวนแถวที่แสดง / ไม่ขึ้น Error
  const load = useCallback(
    async (live = false) => {
      if (!stk) return;
      const v = ++verRef.current;
      try {
        const r = await api<CalcData>("/maxmin/rows", { query: { stk, key: k } });
        if (v !== verRef.current) return;
        setData(r);
        setPickFormula(r.formula.formulaId);
        setPickAuto(r.setting.autoCalc);
        if (!live) setPage(0);
      } catch (e) {
        if (!live) toast.show("ERROR", "โหลดข้อมูล Max-Min Calculator ไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [stk, k, toast],
  );

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // ⚡ เรียลไทม์ 8 วินาที: กำลังแก้แถวอยู่ = รอจนเสร็จ
  useEffect(() => {
    tokenRef.current = "";
  }, [stk]);
  useLive(
    stk ? ["data", `store:${stk}`] : [],
    async () => {
      if (!stk || editingRef.current) return;
      const r = await api<{ token: string }>("/maxmin/token", { query: { stk } });
      if (tokenRef.current && r.token !== tokenRef.current) load(true);
      tokenRef.current = r.token;
    },
    15000,
  );

  // 📄 แสดงทีละหน้า (PAGE แถว) + ปุ่มเปลี่ยนหน้าแบบหน้าคลัง · ข้อมูลอัปเดตแล้วหน้าเกิน = ไปหน้าสุดท้ายที่มี
  const total = data?.rows.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const curPage = Math.min(page, pages - 1);
  const goPage = (p: number) => {
    setPage(p);
    listRef.current?.scrollTo({ top: 0 });
  };

  const [collapsed, toggleGroup] = useCollapsed();
  const groups = useMemo(() => {
    const g: { key: string; items: CalcRow[] }[] = [];
    for (const r of (data?.rows ?? []).slice(curPage * PAGE, (curPage + 1) * PAGE)) {
      const last = g[g.length - 1];
      if (last && last.key === r.group) last.items.push(r);
      else g.push({ key: r.group, items: [r] });
    }
    return g;
  }, [data, curPage]);

  function changeStock(id: number) {
    setStk(id);
    setData(null);
    clearForm();
    try {
      localStorage.setItem(PREF, String(id));
    } catch {
      /* ไม่เป็นไร */
    }
  }

  function clearForm() {
    setEditing(null);
    setDayMax("");
    setDayMin("");
  }

  // EDIT: กดครั้งที่ 1 แสดงข้อมูลด้านบนให้แก้ / กดซ้ำแถวเดิม = ยกเลิก
  function edit(r: CalcRow) {
    if (editing?.ptId === r.ptId) return clearForm();
    setEditing(r);
    setDayMax(String(r.dayMax));
    setDayMin(String(r.dayMin));
    setTimeout(() => (document.getElementById("mm-daymax") as HTMLInputElement | null)?.select(), 0);
  }

  const settingDirty =
    !!data && canEdit && pickFormula !== null && (pickFormula !== data.formula.formulaId || pickAuto !== data.setting.autoCalc || data.setting.formulaId === null);

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const saveSetting = () =>
    run("setting", async () => {
      const r = await api<{ message: string }>("/maxmin/setting", { method: "POST", body: { stk, formulaId: pickFormula, autoCalc: pickAuto } });
      toast.show("Saved", r.message, "ok");
      await load();
    });

  async function saveDays() {
    if (!editing) return;
    const dmax = /^\d+$/.test(dayMax) ? Number(dayMax) : -1;
    const dmin = /^\d+$/.test(dayMin) ? Number(dayMin) : -1;
    if (dmax <= 0 || dmin < 0) return toast.show("WARNING", "MAX (DAYS) ต้องมากกว่า 0 และ MIN (DAYS) ต้องไม่ติดลบ", "warn");
    if (dmin > dmax) return toast.show("WARNING", "MIN (DAYS) ต้องไม่มากกว่า MAX (DAYS)", "warn");
    await run("days", async () => {
      const r = await api<{ message: string }>("/maxmin/days", { method: "POST", body: { stk, ptId: editing.ptId, dayMax: dmax, dayMin: dmin } });
      clearForm();
      toast.show("Saved", r.message, "ok");
      await load(true);
    });
  }

  async function reset(r: CalcRow) {
    if (!stock) return;
    if (!(await dlg.confirm({ title: "RESET MAX / MIN", message: `ล้างค่า MAX / MIN ของ ${r.partNo} ในคลัง ${stock.code}?\n\nหน้า Store (Max-Min) จะแสดงเป็น "-"`, ok: "RESET", danger: true }))) return;
    await run("reset", async () => {
      const x = await api<{ message: string }>("/maxmin/reset", { method: "POST", body: { stk, ptId: r.ptId } });
      toast.show("Reset", x.message, "ok");
      await load(true);
    });
  }

  async function calculate() {
    if (!stock) return;
    if (
      !(await dlg.confirm({
        title: "CALCULATE NOW",
        ok: "CALCULATE",
        message: `คำนวณ MAX / MIN ของคลัง ${stock.code} ใหม่ทั้งหมด?\n\nค่า MAX / MIN เดิมในหน้า Store (Max-Min) จะถูกแทนที่ด้วยค่าที่คำนวณได้
(สินค้าที่ยังไม่มี Order จะไม่ถูกเปลี่ยน)`,
      }))
    )
      return;
    await run("calc", async () => {
      const r = await api<{ message: string }>("/maxmin/calculate", { method: "POST", body: stk });
      toast.show("Max-Min calculated", r.message, "ok");
      await load(true);
    });
  }

  async function startForecastImport() {
    try {
      setChoice(await api("/forecast/import/choice"));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  function pickFile(mode: ImportMode) {
    modeRef.current = mode;
    fileRef.current?.click();
  }

  async function doImport(file: File) {
    await run("import", async () => {
      const pv = await upload<{ id: string; summary: string; title: string }>("/maxmin/import", file, { stk: String(stk), mode: modeRef.current });
      if (!(await dlg.confirm({ title: pv.title, message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/maxmin/import/apply", { method: "POST", body: pv.id });
      toast.show("Imported", r.message, "ok");
      await load(true);
    });
  }

  async function template(kind: "DAYS" | "FORECAST") {
    if (!stock || !data) return;
    setTemplateOpen(false);
    const mon = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const days = kind === "DAYS";
    if (days && data.rows.length === 0) return toast.show("WARNING", `ยังไม่มีสินค้าในตารางของคลัง ${stock.code} ให้สร้าง Template`, "warn");
    const message = days
      ? `ต้องการตั้งค่า MAX / MIN ของคลัง ${stock.code} ด้วยไฟล์ Template นี้ใช่หรือไม่?\n\n• ไฟล์จะมีสินค้าตามตาราง ${data.rows.length.toLocaleString()} รายการ พร้อมค่า MAX / MIN (DAY) ปัจจุบัน\n• กรอกหรือแก้ค่าในไฟล์ แล้วนำเข้ากลับด้วยปุ่ม IMPORT SET MAX MIN`
      : `ต้องการสร้างไฟล์ Template สำหรับนำเข้า Forecast / Order / Delivery ใช่หรือไม่?\n\n• ไฟล์จะมีรายการของเดือน ${mon} ที่มีอยู่แล้วให้ (ไม่มีจะเป็นตารางว่าง)\n• กรอกหรือแก้ตัวเลขในไฟล์ แล้วนำเข้ากลับด้วยปุ่ม IMPORT FORECAST & ORDER\n• ระบบตรวจสอบสินค้าด้วย PART A อย่างเดียว · ตอนนำเข้าเลือกได้: IMPORT + คำนวณ MAX / MIN AUTO หรือ IMPORT อย่างเดียว`;
    if (!(await dlg.confirm({ title: days ? "TEMPLATE • SET MAX MIN" : "TEMPLATE • FORECAST", message, ok: "YES" }))) return;
    run("template", async () => {
      const f = await download("/maxmin/template", { stk, kind, key: days ? k : undefined });
      toast.show("Template", `สร้างไฟล์ Template แล้ว\n${f}`, "ok");
    });
  }

  if (!stocks) return <Loading />;
  if (stocks.length === 0)
    return (
      <PageBody>
        <Empty>ไม่มีคลังที่คุณมีสิทธิ์ดู</Empty>
      </PageBody>
    );

  const unit = data?.unit ?? stock?.unit ?? "";

  return (
    <PageBody>
      <PageHeader
        icon="/icons/CalculatorMxMn.png"
        title="MAX-MIN CALCULATOR"
        subtitle={data ? `${(data.order ? "ORDER : " + data.order : "NO ORDER IMPORTED") + "   •   LAST CALC : " + (data.setting.lastCalc ?? "-")}` : "LOADING..."}
        actions={
          <>
            <ActionMenu
              caption={["MAX-MIN", "FORMULAS · WORKDAYS · CALC"]}
              fab={
                <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="5" y="3" width="14" height="18" rx="2.5" />
                  <path d="M8.5 7h7M8.5 11.5h1M12 11.5h1M15.5 11.5h0M8.5 15h1M12 15h1M15.5 15v2.5" />
                </svg>
              }
              fabColor="linear-gradient(145deg, #8b6fd6, #6750a4)"
              label="เมนูคำนวณ Max-Min"
              actions={[
                ...(canEdit
                  ? [{ key: "formula", title: "FORMULAS", detail: "ตั้งสูตรคำนวณ MAX / MIN (แหล่งยอด, จำนวนวัน, การปัดเศษ) เลือกใช้ต่อคลังได้", color: "#6750a4", icon: "formula" as const, onClick: () => setFormulaOpen(true) }]
                  : []),
                { key: "workdays", title: "WORKDAYS", detail: "ปฏิทินวันทำงานของแต่ละเดือน ใช้หาค่าเฉลี่ยต่อวันในการคำนวณ", color: "#0891b2", icon: "calendar" as const, onClick: () => setWorkdayOpen(true) },
                ...(canEdit
                  ? [
                      {
                        key: "calc",
                        title: busy === "calc" ? "CALCULATING..." : "CALCULATE NOW",
                        detail: "คำนวณ MAX / MIN ของคลังนี้ทันทีตามสูตรที่เลือก แล้วบันทึกเข้า Store (Max-Min)",
                        color: "#e11d48",
                        icon: "calc" as const,
                        busy: busy === "calc",
                        disabled: !!busy || !data,
                        onClick: calculate,
                      },
                    ]
                  : []),
              ]}
            />
            <ActionMenu
              caption={["EXCEL", "TEMPLATE · IMPORT"]}
              label="เมนู Excel Max-Min"
              actions={[
                {
                  key: "template",
                  title: "TEMPLATE EXCEL",
                  detail: "ไฟล์สำหรับกรอก IMPORT SET MAX MIN / IMPORT FORECAST & ORDER",
                  color: "#7c3aed",
                  icon: "template" as const,
                  disabled: !data || !!busy,
                  onClick: () => setTemplateOpen(true),
                },
                ...(canEdit
                  ? [
                      { key: "forecast", title: "IMPORT FORECAST & ORDER", detail: "นำเข้ายอด Forecast / Order จาก Excel เพื่อใช้คำนวณ MAX / MIN", color: "#0284c7", icon: "import" as const, disabled: !!busy, onClick: startForecastImport },
                      { key: "setmm", title: "IMPORT SET MAX MIN", detail: "นำเข้าจำนวนวันของ MAX / MIN รายสินค้าจาก Excel (ตาม Template)", color: "#16a34a", icon: "import" as const, disabled: !!busy, onClick: () => pickFile("DAYS") },
                    ]
                  : []),
              ]}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) doImport(f);
              }}
            />
          </>
        }
      />

      {/* คลัง + สูตร + AUTO CALC */}
      <Card clip={false} className="relative z-30" bodyClass="grid gap-3 p-4 lg:grid-cols-[200px_1fr_auto] lg:items-end">
        <div className="grid gap-1">
          <span className="text-[11px] font-extrabold uppercase text-ink-soft">STOCK</span>
          <MenuSelect value={String(stk)} options={stocks.map((s) => ({ value: String(s.stkId), label: s.code, title: s.name }))} onChange={(v) => changeStock(Number(v))} />
        </div>
        <div className="grid gap-1">
          <span className="text-[11px] font-extrabold uppercase text-ink-soft">FORMULA</span>
          <MenuSelect disabled={!canEdit || !data} value={pickFormula == null ? "" : String(pickFormula)} options={(data?.formulas ?? []).map((f) => ({ value: String(f.formulaId), label: f.displayName, title: f.describe }))} onChange={(v) => setPickFormula(Number(v))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* AUTO CALC = สวิตช์ (คำนวณใหม่เองหลัง IMPORT FORECAST & ORDER) */}
          <label className={`sw ${pickAuto ? "is-on" : ""}`} title="คำนวณ MAX / MIN ใหม่อัตโนมัติหลังนำเข้า Forecast / Order">
            <input type="checkbox" className="sr-only" disabled={!canEdit} checked={pickAuto} onChange={(e) => setPickAuto(e.target.checked)} />
            <span className="sw-track" />
            AUTO CALC
          </label>
          {canEdit && (
            <button className="cta-btn is-purple" disabled={!settingDirty || !!busy} onClick={saveSetting}>
              💾 SAVE
            </button>
          )}
          <span className={`sw-pill ${data?.setting.autoCalc ? "is-on" : ""}`}>{data?.setting.autoCalc ? "AUTO CALC : ON" : "AUTO CALC : OFF"}</span>
        </div>
        {data && (
          <div
            className="rounded-xl bg-surface-2 px-3 py-2 text-xs font-bold text-primary lg:col-span-3"
            title={`Default: MAX ${data.formula.defDayMax} days / MIN ${data.formula.defDayMin} days / ${data.formula.defWorkdays} workdays`}
          >
            {data.formula.name} : {data.formula.describe}
          </div>
        )}
      </Card>

      {/* ฟอร์มแก้ MAX / MIN (DAYS) */}
      {canEdit && (
        <Card bodyClass="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_120px_120px_auto] lg:items-end">
          {(
            [
              ["CUSTOMER", editing?.group],
              ["PART NO", editing?.partNo],
              ["PRODUCT NAME", editing?.partName],
            ] as const
          ).map(([l, v]) => (
            <label key={l} className="grid gap-1">
              <span className="text-[11px] font-extrabold uppercase text-ink-soft">{l}</span>
              <input className="field bg-surface-2" readOnly value={v ?? ""} placeholder={l === "CUSTOMER" ? "กด EDIT ที่แถวในตาราง" : ""} />
            </label>
          ))}
          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase text-ink-soft">MAX (DAYS)</span>
            <input
              id="mm-daymax"
              className="field"
              inputMode="numeric"
              readOnly={!editing}
              value={dayMax}
              onChange={(e) => setDayMax(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && saveDays()}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase text-ink-soft">MIN (DAYS)</span>
            <input
              className="field"
              inputMode="numeric"
              readOnly={!editing}
              value={dayMin}
              onChange={(e) => setDayMin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && saveDays()}
            />
          </label>
          <div className="flex gap-2">
            <button className="fill-btn" onClick={clearForm}>
              CLEAR
            </button>
            <button className="cta-btn is-purple" disabled={!editing || !!busy} onClick={saveDays}>
              💾 SAVE
            </button>
          </div>
        </Card>
      )}

      <Card title={`${total.toLocaleString()} ITEMS`} actions={<SearchBox value={key} onChange={setKey} placeholder="ค้นหา ลูกค้า / PART NO / PD CODE / PART A / ชื่อสินค้า" className="w-72 max-w-full" />}>
        <div ref={listRef} className="max-h-[65vh] min-h-[300px] overflow-auto">
          {!data ? (
            <Loading />
          ) : total === 0 ? (
            <Empty />
          ) : (
            <table className="data-table t-center w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-14 text-center">NO.</th>
                  <th>PART NO</th>
                  <th>PRODUCT NAME</th>
                  <th className="text-right">PACKSIZE</th>
                  <th className="text-center">MAX (DAYS)</th>
                  <th className="text-center">MIN (DAYS)</th>
                  <th className="text-right">MAX ({unit})</th>
                  <th className="text-right">MIN ({unit})</th>
                  <th className="text-center">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <Fragment key={`${g.key}-${gi}`}>
                    <GroupRow colSpan={9} label="CUSTOMER" value={g.key} count={g.items.length} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)} />
                    {!collapsed.has(g.key) && g.items.map((r) => (
                      <tr key={r.ptId} className={editing?.ptId === r.ptId ? "bg-accent-soft" : ""}>
                        <td className="text-center text-ink-soft">{r.no}</td>
                        <td className="whitespace-nowrap">{r.partNo}</td>
                        <td className="min-w-[200px]">{r.partName}</td>
                        <td className="text-right">{r.packSize.toLocaleString()}</td>
                        <td className={`text-center ${r.hasOwnDays ? "font-extrabold" : "text-ink-soft"}`} title={r.hasOwnDays ? "" : "Formula default"}>
                          {r.dayMax}
                        </td>
                        <td className={`text-center ${r.hasOwnDays ? "font-extrabold" : "text-ink-soft"}`}>{r.dayMin}</td>
                        <td className="text-right font-extrabold text-success">{r.qtyMax}</td>
                        <td className="text-right font-extrabold text-danger">{r.qtyMin}</td>
                        <td className="whitespace-nowrap text-center">
                          <RowActions>
                            <RowAction kind="edit" active={editing?.ptId === r.ptId} title={editing?.ptId === r.ptId ? "CANCEL" : "EDIT MAX / MIN (DAY)"} disabled={!canEdit} onClick={() => edit(r)} />
                            <RowAction kind="reset" title="RESET = ใช้ค่าตามสูตร" disabled={!canEdit || !!busy} onClick={() => reset(r)} />
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > PAGE && (
          <div className="border-t border-line/60 pt-4">
            <Pager page={curPage} pages={pages} total={total} size={PAGE} onPage={goPage} />
          </div>
        )}
      </Card>

      <FormulaModal open={formulaOpen} stock={stock} selectId={data?.formula.formulaId} canEdit={canEdit} onClose={() => setFormulaOpen(false)} onChanged={() => load(true)} />
      <WorkdayModal open={workdayOpen} canEdit={canEdit} onClose={() => setWorkdayOpen(false)} onChanged={() => load(true)} />

      {/* 📄 TEMPLATE EXCEL: เลือกก่อนว่าจะเตรียมไฟล์ของปุ่มไหน (การ์ดแบบหน้า Store) */}
      <Modal open={templateOpen} wide title="📄 TEMPLATE EXCEL" onClose={() => setTemplateOpen(false)}>
        <p className="mb-4 text-sm font-semibold text-ink-soft">Stock {stock?.code} • choose the import you want to prepare a file for</p>
        <div className="grid gap-3 md:grid-cols-2">
          <ChoiceCard
            color="#16a34a"
            icon={<Glyph d={GLYPH.days} />}
            title="SET MAX / MIN"
            detail={`Products of the table (${total.toLocaleString()}) with current MAX (DAY) / MIN (DAY). Fill MAX / MIN (DAY) or (BOX), FORECAST / ORDER / DELIVERY in any column.`}
            meta="USE WITH: 📥 IMPORT SET MAX MIN"
            onClick={() => template("DAYS")}
          />
          <ChoiceCard
            delay={1}
            color="#0284c7"
            icon={<Glyph d={GLYPH.chart} />}
            title="FORECAST / ORDER / DELIVERY"
            detail="One row per PART A + month (this month's rows already filled in). Products are checked by PART A only; CUSTOMER / PART NO / PRODUCT NAME come from the system."
            meta="USE WITH: 📊 IMPORT FORECAST & ORDER (both choices)"
            onClick={() => template("FORECAST")}
          />
        </div>
      </Modal>

      {/* 📊 IMPORT FORECAST & ORDER: คำนวณ MAX / MIN AUTO หรือ IMPORT อย่างเดียว */}
      <Modal open={!!choice} wide title={choice?.title ?? ""} onClose={() => setChoice(null)}>
        <p className="mb-4 whitespace-pre-line text-sm font-semibold">{choice?.text}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              ["CALC", choice?.calc, "#e11d48", GLYPH.calc, "IMPORT + CALCULATE"],
              ["ONLY", choice?.only, "#0284c7", GLYPH.upload, "IMPORT ONLY"],
            ] as const
          ).map(([mode, label, col, d, tag], i) => (
            <ChoiceCard
              key={mode}
              delay={i}
              color={col}
              icon={<Glyph d={d} />}
              title={label}
              meta={tag}
              onClick={() => {
                setChoice(null);
                pickFile(mode);
              }}
            />
          ))}
        </div>
      </Modal>
    </PageBody>
  );
}
