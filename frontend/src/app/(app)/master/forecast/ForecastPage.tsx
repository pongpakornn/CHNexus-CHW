"use client";

import { GroupRow, useCollapsed } from "@/components/tables/GroupRow";
import { ActionMenu } from "@/components/menus/ActionMenu";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { Pager } from "@/components/tables/Pager";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { CalcChoiceModal } from "@/components/modals/CalcChoiceModal";
import { useToast } from "@/components/notifications/Toasts";
import { MonthChart, type MonthPoint } from "@/components/charts/Charts";
import { PillSwitch } from "@/components/charts/ChartHeader";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { useDialogs } from "@/components/modals/Dialogs";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { useLive } from "@/lib/live";
import { useRouter } from "next/navigation";

type Month = { key: string; label: string };
type Row = { customer: string; partA: string; partNo: string; productName: string; forecast: number; order: number; delivery: number; month: string };
type Top = { rank: number; title: string; sub: string; order: number; forecast: number; percent: number; shareOfMonth: number };
type Src = "DIFF3" | "DIFF2";
type Summary = { year: number; updatedAt: string | null; diff3: MonthPoint[]; diff2: MonthPoint[]; customers: { diff3: number; diff2: number }; extra: { customer: string; forecast: number; order: number; delivery: number }[] };
const PAGE = 100; // แถวต่อหน้า (เหมือนหน้าคลัง) · ดึงจาก Server ทีละหน้า (ข้อมูลทุกเดือนมีหลายพันแถว)
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

// 📈 FORECAST / ORDER / DELIVERY (ForecastOrderView): กราฟทั้งปี + TOP 5 ORDER + ตารางตามเดือน (ALL MONTHS ได้) / Import / Template / Export
export default function ForecastPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const router = useRouter();
  const [months, setMonths] = useState<Month[] | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [tableMonth, setTableMonth] = useState("ALL");
  const [topMonth, setTopMonth] = useState("ALL");
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [chart, setChart] = useState<{ year: number; months: MonthPoint[]; top: Top[] } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 400);
  const verRef = useRef(0);
  const tokenRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const withCalcRef = useRef(true);
  const [choice, setChoice] = useState<{ title: string; text: string; calc: string; only: string } | null>(null);
  // 📊 กราฟ 2 แบบ: DIFF (3) = ลูกค้าที่ใช้ในระบบ (ยอดราย PART A ที่ Import) · DIFF (2) = ลูกค้าทั้งหมดจากไฟล์ FORECAST (ยอดสรุป)
  const reduce = useReducedMotion();
  const [src, setSrc] = useState<Src>("DIFF3");
  const [sum, setSum] = useState<Summary | null>(null);
  const sumRef = useRef<HTMLInputElement>(null);

  const loadMonths = useCallback(
    async (select?: string) => {
      try {
        const r = await api<{ canImport: boolean; months: Month[]; latest: string }>("/forecast/months");
        setMonths(r.months);
        setCanImport(r.canImport);
        if (select) {
          setTableMonth(select);
          setTopMonth(select);
        }
      } catch (e) {
        toast.show("ERROR", "โหลดข้อมูล Forecast / Order ไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(() => loadMonths(), 0);
    return () => clearTimeout(t);
  }, [loadMonths]);

  const loadRows = useCallback(async () => {
    const v = ++verRef.current;
    try {
      const month = tableMonth === "ALL" ? undefined : tableMonth;
      const [r, c] = await Promise.all([api<Row[]>("/forecast/rows", { query: { month, key: k, skip: page * PAGE, take: PAGE } }), api<{ total: number }>("/forecast/rows/count", { query: { month, key: k } })]);
      if (v !== verRef.current) return;
      // ข้อมูลลดลงจนหน้านี้ว่าง -> ไปหน้าสุดท้ายที่มี
      if (r.length === 0 && page > 0 && c.total > 0) return setPage(Math.ceil(c.total / PAGE) - 1);
      setRows(r);
      setTotal(c.total);
    } catch (e) {
      toast.show("ERROR", "โหลดรายการไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [tableMonth, k, page, toast]);

  const loadTop = useCallback(async () => {
    try {
      setChart(await api("/forecast/top", { query: { month: topMonth === "ALL" ? undefined : topMonth } }));
    } catch (e) {
      toast.show("ERROR", "โหลดกราฟไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [topMonth, toast]);

  useEffect(() => {
    if (!months) return;
    const t = setTimeout(loadRows, 0);
    return () => clearTimeout(t);
  }, [months, loadRows]);

  useEffect(() => {
    if (!months) return;
    const t = setTimeout(loadTop, 0);
    return () => clearTimeout(t);
  }, [months, loadTop]);

  const sumYear = chart?.year;
  const loadSum = useCallback(async () => {
    if (!sumYear) return;
    try {
      const r = await api<{ ready: boolean; data?: Summary }>("/forecast/summary", { query: { year: sumYear } });
      setSum(r.ready && r.data ? r.data : null);
    } catch {
      setSum(null);
    }
  }, [sumYear]);
  useEffect(() => {
    const t = setTimeout(loadSum, 0);
    return () => clearTimeout(t);
  }, [loadSum]);
  useLive(["forecast"], loadSum, 60000);

  async function importSummary(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/forecast/summary/import", file, { year: String(chart?.year ?? new Date().getFullYear()) });
      if (!(await dlg.confirm({ title: "IMPORT DIFF (2) / DIFF (3)", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/forecast/summary/apply", { method: "POST", body: pv.id });
      toast.show("Summary imported", r.message, "ok");
      await loadSum();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // 📄 แบ่งหน้าละ PAGE แถว · เปลี่ยนเดือน / คำค้นหา = กลับหน้าแรก (ข้อมูลอัปเดตแล้วหน้าเกิน = หน้าสุดท้าย)
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const curPage = Math.min(page, pages - 1);
  const goPage = (p: number) => {
    setPage(p);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // ⚡ เรียลไทม์ (8 วินาที): เครื่องอื่น Import -> โหลดใหม่ (กำลังเลื่อนอ่าน = รอ)
  useLive(
    ["data"],
    async () => {
      if ((scrollRef.current?.scrollTop ?? 0) > 2) return;
      const r = await api<{ token: string }>("/forecast/token");
      if (tokenRef.current && r.token !== tokenRef.current) {
        await loadMonths();
        loadRows();
        loadTop();
      }
      tokenRef.current = r.token;
    },
    15000,
  );

  const [collapsed, toggleGroup] = useCollapsed();
  const groups = useMemo(() => {
    const g: { key: string; items: Row[] }[] = [];
    for (const r of rows ?? []) {
      const gk = r.customer || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(r);
      else g.push({ key: gk, items: [r] });
    }
    return g;
  }, [rows]);

  async function startImport() {
    try {
      setChoice(await api("/forecast/import/choice"));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/forecast/import", file, { withCalc: String(withCalcRef.current) });
      if (!(await dlg.confirm({ title: "IMPORT FORECAST", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string; month: string }>("/forecast/import/apply", { method: "POST", body: pv.id });
      toast.show("Forecast imported", r.message, "ok");
      await loadMonths(r.month);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    const m = tableMonth === "ALL" ? (months && months.length ? months[months.length - 1].key : undefined) : tableMonth;
    const label = months?.find((x) => x.key === m)?.label ?? m ?? "";
    if (
      !(await dlg.confirm({
        title: "TEMPLATE EXCEL",
        ok: "YES",
        message: `ต้องการสร้างไฟล์ Template สำหรับนำเข้า Forecast / Order / Delivery ใช่หรือไม่?\n\n• ไฟล์จะมีรายการของเดือน ${label} ที่มีอยู่แล้วให้ (ไม่มีจะเป็นตารางว่าง)\n• กรอกหรือแก้ตัวเลขในไฟล์ แล้วนำเข้ากลับด้วยปุ่ม IMPORT`,
      }))
    )
      return;
    download("/forecast/template", { month: m }).catch((e) => toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + e.message, "error"));
  }

  if (!months) return <Loading />;
  const all = tableMonth === "ALL";
  const hasSum = !!sum && sum.diff2.some((m) => m.forecast + m.order + m.delivery > 0);
  const view: Src = hasSum ? src : "DIFF3";

  const monthOpts = [{ value: "ALL", label: "ALL MONTHS" }, ...months.map((m) => ({ value: m.key, label: m.label }))];

  return (
    <PageBody>
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title="FORECAST / ORDER / DELIVERY"
        subtitle={`${all ? "All months" : months.find((m) => m.key === tableMonth)?.label} • ${total.toLocaleString()} item(s)`}
        actions={
          <>
            <ActionMenu
              actions={[
                ...(months.length > 0
                  ? [
                      {
                        key: "export",
                        title: "EXPORT EXCEL",
                        detail: "ส่งออก Forecast / Order / Delivery เป็นไฟล์ Excel เลือกเดือนได้ (1 เดือน = 1 ชีท) ตามคำค้นหาที่กรองอยู่",
                        color: "#16a34a",
                        icon: "export" as const,
                        onClick: () => {
                          setPick(all ? months.map((m) => m.key) : [tableMonth]);
                          setExportOpen(true);
                        },
                      },
                    ]
                  : []),
                ...(canImport
                  ? [
                      {
                        key: "file",
                        title: "📂 FORECAST FILE",
                        detail: "เลือกไฟล์ FORECAST ของฝ่ายขายทั้งไฟล์ แล้วกรองลูกค้า / เดือนในหน้าเว็บ ตรวจยอดกับ DIFF (3) แล้ว IMPORT ได้เลย ไม่ต้องทำไฟล์ Excel · เพิ่ม Product ที่ไม่มีในระบบได้ในขั้นตอนเดียว",
                        color: "#2563eb",
                        icon: "import" as const,
                        onClick: () => router.push("/master/forecast/file"),
                      },
                      {
                        key: "template",
                        title: "TEMPLATE EXCEL",
                        detail: "ดาวน์โหลดไฟล์ต้นแบบสำหรับนำเข้า (มีรายการของเดือนที่เลือกอยู่ให้) กรอก / แก้ตัวเลขแล้วนำเข้ากลับด้วย IMPORT",
                        color: "#7c3aed",
                        icon: "template" as const,
                        onClick: template,
                      },
                      {
                        key: "import",
                        title: busy ? "IMPORTING..." : "IMPORT EXCEL",
                        detail: "นำเข้าไฟล์ Excel (.xlsx) ตามรูปแบบ Template ตรวจตัวอย่างก่อนยืนยัน คำนวณ MAX / MIN AUTO ได้",
                        color: "#0284c7",
                        icon: "import" as const,
                        busy,
                        onClick: startImport,
                      },
                      {
                        key: "summary",
                        title: "IMPORT DIFF (2) / (3)",
                        detail: "นำเข้าไฟล์ FORECAST (ที่มีชีท DIFF (2) และ DIFF (3)) เพื่อแสดงกราฟเปรียบเทียบ ลูกค้าทั้งหมด vs ที่ใช้ในระบบ · ไม่เปลี่ยนยอดราย PART A",
                        color: "#d97706",
                        icon: "import" as const,
                        busy,
                        onClick: () => sumRef.current?.click(),
                      },
                    ]
                  : []),
              ]}
            />
            {canImport && (
              <>
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
                <input
                  ref={sumRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) importSummary(f);
                  }}
                />
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card
          title={`FORECAST, ORDER & DELIVERY • ${chart?.year ?? ""}${src === "DIFF2" ? " • ALL CUSTOMERS" : ""}`}
          actions={
            hasSum ? (
              <PillSwitch
                label="Forecast source"
                value={src}
                onChange={setSrc}
                options={[
                  { v: "DIFF3", l: "DIFF (3)", title: `ลูกค้าที่ใช้ในระบบ (ยอดราย PART A ที่ Import) · ${sum?.customers.diff3 ?? 0} ลูกค้า` },
                  { v: "DIFF2", l: "DIFF (2)", title: `ลูกค้าทั้งหมดจากไฟล์ FORECAST · ${sum?.customers.diff2 ?? 0} ลูกค้า` },
                ]}
              />
            ) : undefined
          }
          bodyClass="p-4"
        >
          {!chart ? (
            <Loading />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: view === "DIFF2" ? 24 : -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: view === "DIFF2" ? -24 : 24 }}
                transition={{ duration: 0.32, ease: EASE }}
              >
                <MonthChart data={view === "DIFF2" && sum ? sum.diff2 : chart.months} year={chart.year} />
              </motion.div>
            </AnimatePresence>
          )}
        </Card>
        <Card
          title="TOP 5 ORDER"
          actions={
            <MenuSelect compact className="w-[200px]" value={topMonth} options={monthOpts} onChange={setTopMonth} />
          }
          bodyClass="p-4"
        >
          {!chart ? (
            <Loading />
          ) : chart.top.length === 0 ? (
            <Empty>ยังไม่มี Order</Empty>
          ) : (
            <div className="grid gap-2.5">
              {chart.top.map((t, i) => (
                <div key={t.rank} className="top-row" style={{ "--d": `${i * 70}ms` } as React.CSSProperties} title={`Forecast ${n0(t.forecast)}`}>
                  <span className={`top-rank ${t.rank === 1 ? "is-first" : ""}`}>{t.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13.5px] font-extrabold text-[#1e2a5a]">{t.title}</span>
                      <span className="shrink-0 text-[14px] font-black tabular-nums text-[#1e2a5a]">{n0(t.order)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold text-ink-soft">{t.sub}</span>
                      <span className="top-share">{t.shareOfMonth.toFixed(1)}%</span>
                    </div>
                    <div className="top-bar">
                      <i style={{ width: `${Math.max(3, t.percent)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {hasSum && sum && <CompareCard sum={sum} />}

      <Card
        title="ITEMS"
        actions={
          <>
            <MenuSelect compact className="w-[200px]" value={tableMonth} options={monthOpts} onChange={(v) => (setTableMonth(v), setPage(0))} />
          </>
        }
      >
        <div className="border-b border-line/60 p-3">
          <SearchBox value={key} onChange={(v) => (setKey(v), setPage(0))} placeholder="ค้นหา ลูกค้า / PART A / PART NO / ชื่อสินค้า" />
        </div>
        <div ref={scrollRef} className="max-h-[60vh] min-h-[300px] overflow-auto">
          {!rows ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <table className="data-table t-center w-full">
              <thead className="sticky top-0">
                <tr>
                  <th className="w-14">NO.</th>
                  {all && <th>MONTH</th>}
                  <th>PART A</th>
                  <th>PART NO</th>
                  <th>PRODUCT NAME</th>
                  <th className="text-right">FORECAST</th>
                  <th className="text-right">ORDER</th>
                  <th className="text-right">DELIVERY</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <Fragment key={`${g.key}-${gi}`}>
                    <GroupRow colSpan={all ? 8 : 7} label="CUSTOMER" value={g.key} count={g.items.length} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)} />
                    {!collapsed.has(g.key) && g.items.map((r, i) => (
                      <tr key={`${r.partA}-${r.month}-${i}`}>
                        <td className="text-ink-soft">{i + 1}</td>
                        {all && <td className="whitespace-nowrap text-xs">{r.month}</td>}
                        <td className="whitespace-nowrap">{r.partA}</td>
                        <td className="whitespace-nowrap">{r.partNo}</td>
                        <td className="min-w-[200px]">{r.productName}</td>
                        <td className="text-right">{n0(r.forecast)}</td>
                        <td className="text-right font-extrabold">{n0(r.order)}</td>
                        <td className="text-right">{n0(r.delivery)}</td>
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

      {/* 📥 IMPORT: คำนวณ MAX / MIN AUTO หรือ IMPORT อย่างเดียว */}
      <CalcChoiceModal
        choice={choice}
        onClose={() => setChoice(null)}
        onPick={(calc) => {
          withCalcRef.current = calc;
          fileRef.current?.click();
        }}
      />

      {/* 📤 EXPORT: เลือกเดือน (1 เดือน = 1 ชีท) - การ์ดเดือนแยกตามปี · ปุ่มลัด · สรุปจำนวนชีท */}
      <Modal
        open={exportOpen}
        wide
        title="📤 EXPORT FORECAST / ORDER / DELIVERY"
        onClose={() => setExportOpen(false)}
        footer={
          <>
            <span className="mr-auto text-xs font-bold text-ink-soft">{pick.length > 0 ? `${pick.length} SHEET(S) • 1 เดือน = 1 ชีท` : "เลือกอย่างน้อย 1 เดือน"}</span>
            <button className="fill-btn" onClick={() => setExportOpen(false)}>
              CANCEL
            </button>
            <button
              className="cta-btn is-green"
              disabled={pick.length === 0}
              onClick={() => {
                setExportOpen(false);
                download("/forecast/export", undefined, { months: pick, key: k })
                  .then((f) => toast.show("Export", `${f} • ${pick.length} ชีท`, "ok"))
                  .catch((e) => toast.show("ERROR", "Export ไม่สำเร็จ\n" + e.message, "error"));
              }}
            >
              📤 EXPORT ({pick.length})
            </button>
          </>
        }
      >
        {(() => {
          const allOn = months.length > 0 && pick.length === months.length;
          const years = [...new Set(months.map((m) => m.label.split(" ").pop() ?? ""))];
          const quick: [string, string[]][] = [
            ["LAST 3", months.slice(0, 3).map((m) => m.key)],
            ["LAST 6", months.slice(0, 6).map((m) => m.key)],
            ...years.map((y) => [`YEAR ${y}`, months.filter((m) => m.label.endsWith(y)).map((m) => m.key)] as [string, string[]]),
          ];
          const same = (a: string[]) => a.length === pick.length && a.every((x) => pick.includes(x));
          return (
            <div className="grid gap-4">
              {/* หัว: เลือกทั้งหมด (สวิตช์) + จำนวนที่เลือก + ปุ่มลัด */}
              <div className="fx-hero">
                <label className={`sw ${allOn ? "is-on" : ""}`}>
                  <input type="checkbox" className="sr-only" checked={allOn} onChange={(e) => setPick(e.target.checked ? months.map((m) => m.key) : [])} />
                  <span className="sw-track" />
                  ALL MONTHS
                </label>
                <span className="fx-count" key={pick.length}>
                  <b>{pick.length}</b> / {months.length} MONTHS
                </span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {quick.map(([label, keys]) => (
                    <button key={label} type="button" className={`flt-chip ${keys.length > 0 && same(keys) ? "is-on" : ""}`} onClick={() => setPick(keys)}>
                      {label}
                    </button>
                  ))}
                  <button type="button" className="fill-btn is-xs" disabled={pick.length === 0} onClick={() => setPick([])}>
                    ✕ CLEAR
                  </button>
                </span>
              </div>
              {k && <div className="text-xs font-bold text-accent">🔎 เฉพาะผลค้นหา: {k}</div>}
              {/* การ์ดเดือนแยกตามปี */}
              {years.map((y) => (
                <section key={y} className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <span className="fx-year">{y}</span>
                    <span className="h-px flex-1 bg-[#ece9f3]" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {months
                      .filter((m) => m.label.endsWith(y))
                      .map((m, i) => {
                        const on = pick.includes(m.key);
                        return (
                          <button
                            key={m.key}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            className={`fx-month ${on ? "is-on" : ""}`}
                            style={{ "--i": i } as React.CSSProperties}
                            onClick={() => setPick((p) => (on ? p.filter((x) => x !== m.key) : [...p, m.key]))}
                          >
                            <span className="fx-month-check" aria-hidden>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                            <b>{m.label.split(" ")[0]}</b>
                            <small>{y}</small>
                          </button>
                        );
                      })}
                  </div>
                </section>
              ))}
            </div>
          );
        })()}
      </Modal>
    </PageBody>
  );
}

// 📊 DIFF (2) vs DIFF (3): ยอดรายเดือนของ 2 กราฟ + ลูกค้าที่มีเฉพาะ DIFF (2) (ยอดที่เกินมา)
function CompareCard({ sum }: { sum: Summary }) {
  const [k, setK] = useState<"order" | "forecast" | "delivery">("order");
  const reduce = useReducedMotion();
  const rows = sum.diff3.map((m, i) => ({ label: m.label, a: m[k], b: sum.diff2[i]?.[k] ?? 0 }));
  const ta = rows.reduce((x, r) => x + r.a, 0),
    tb = rows.reduce((x, r) => x + r.b, 0);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  const extraMax = Math.max(1, ...sum.extra.map((e) => e[k]));
  return (
    <Card
      title={`DIFF (2) vs DIFF (3) • ${sum.year}`}
      actions={
        <PillSwitch
          label="Compare value"
          value={k}
          onChange={setK}
          options={[
            { v: "order", l: "ORDER" },
            { v: "forecast", l: "FORECAST" },
            { v: "delivery", l: "DELIVERY" },
          ]}
        />
      }
      bodyClass="p-4"
    >
      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="fc-cmp-chip is-a">
              DIFF (3) • {sum.customers.diff3} ลูกค้า • {n0(ta)}
            </span>
            <span className="fc-cmp-chip is-b">
              DIFF (2) • {sum.customers.diff2} ลูกค้า • {n0(tb)}
            </span>
            <span className="fc-cmp-chip is-d">
              +{n0(tb - ta)} ({ta ? (((tb - ta) / ta) * 100).toFixed(1) : "0"}%)
            </span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={k} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: EASE }} className="grid gap-1.5">
              {rows.map((r, i) => (
                <div key={r.label} className="fc-cmp-row" title={`DIFF (3) ${n0(r.a)} · DIFF (2) ${n0(r.b)} · ต่าง ${n0(r.b - r.a)}`}>
                  <span className="m">{r.label}</span>
                  <span className="bars">
                    <motion.i className="is-b" initial={{ scaleX: 0 }} animate={{ scaleX: r.b / max }} transition={{ duration: reduce ? 0 : 0.7, ease: EASE, delay: Math.min(i * 0.03, 0.4) }} />
                    <motion.i className="is-a" initial={{ scaleX: 0 }} animate={{ scaleX: r.a / max }} transition={{ duration: reduce ? 0 : 0.7, ease: EASE, delay: Math.min(i * 0.03, 0.4) + 0.05 }} />
                  </span>
                  <span className="v">
                    <b>{n0(r.b)}</b>
                    <small>{r.b - r.a ? `+${n0(r.b - r.a)}` : "–"}</small>
                  </span>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
          <p className="mt-2 text-[11px] font-semibold text-ink-soft">แถบเข้ม = DIFF (3) (ใช้ในระบบ) · แถบอ่อน = DIFF (2) (ลูกค้าทั้งหมด) · ตัวเลข = DIFF (2) และส่วนที่เกินมา</p>
        </div>
        <div className="min-w-0">
          <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#1f2350]">ลูกค้าที่มีเฉพาะ DIFF (2) • {sum.extra.length}</h4>
          {sum.extra.length === 0 ? (
            <Empty>ไม่มี</Empty>
          ) : (
            <div className="grid gap-1.5">
              {sum.extra.map((e, i) => (
                <div key={e.customer} className="top-row" style={{ "--d": `${i * 50}ms` } as React.CSSProperties}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-extrabold text-[#1e2a5a]">{e.customer}</span>
                      <span className="shrink-0 text-[13px] font-black tabular-nums text-[#1e2a5a]">{n0(e[k])}</span>
                    </div>
                    <div className="top-bar">
                      <i style={{ width: `${Math.max(3, (e[k] / extraMax) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] font-semibold text-ink-soft">
            Capacity / Max-Min ใช้ยอดราย PART A ที่ Import (DIFF (3)) · DIFF (2) ใช้ดูเปรียบเทียบเท่านั้น{sum.updatedAt ? ` · อัพเดท ${new Date(sum.updatedAt).toLocaleDateString("en-GB")}` : ""}
          </p>
        </div>
      </div>
    </Card>
  );
}
