"use client";

import { GroupRow, useCollapsed } from "@/components/ui/GroupRow";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { Pager } from "@/components/ui/Pager";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { MonthChart, type MonthPoint } from "@/components/ui/Charts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { useLive } from "@/lib/live";

type Month = { key: string; label: string };
type Row = { customer: string; partA: string; partNo: string; productName: string; forecast: number; order: number; delivery: number; month: string };
type Top = { rank: number; title: string; sub: string; order: number; forecast: number; percent: number; shareOfMonth: number };
const PAGE = 100; // แถวต่อหน้า (เหมือนหน้าคลัง) · ดึงจาก Server ทีละหน้า (ข้อมูลทุกเดือนมีหลายพันแถว)
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

// 📈 FORECAST / ORDER / DELIVERY (ForecastOrderView): กราฟทั้งปี + TOP 5 ORDER + ตารางตามเดือน (ALL MONTHS ได้) / Import / Template / Export
export default function ForecastPage() {
  const toast = useToast();
  const dlg = useDialogs();
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
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title={`FORECAST, ORDER & DELIVERY • ${chart?.year ?? ""}`} bodyClass="p-4">
          {!chart ? <Loading /> : <MonthChart data={chart.months} year={chart.year} />}
        </Card>
        <Card
          title="TOP 5 ORDER"
          actions={
            <MenuSelect className="w-[200px]" value={topMonth} options={monthOpts} onChange={setTopMonth} />
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

      <Card
        title="ITEMS"
        actions={
          <>
            <MenuSelect className="w-[200px]" value={tableMonth} options={monthOpts} onChange={(v) => (setTableMonth(v), setPage(0))} />
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
      <Modal open={!!choice} title={choice?.title ?? ""} onClose={() => setChoice(null)}>
        <p className="mb-4 whitespace-pre-line text-sm font-semibold">{choice?.text}</p>
        <div className="grid gap-2">
          {[
            [true, choice?.calc],
            [false, choice?.only],
          ].map(([calc, label]) => (
            <button
              key={String(calc)}
              className="rounded-xl border-2 border-line p-4 text-left font-extrabold text-primary hover:border-accent"
              onClick={() => {
                withCalcRef.current = calc as boolean;
                setChoice(null);
                fileRef.current?.click();
              }}
            >
              {label as string}
            </button>
          ))}
        </div>
      </Modal>

      {/* 📤 EXPORT: เลือกเดือน (1 เดือน = 1 ชีท) */}
      <Modal
        open={exportOpen}
        title="📤 EXPORT FORECAST / ORDER / DELIVERY"
        onClose={() => setExportOpen(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setExportOpen(false)}>
              CANCEL
            </button>
            <button
              className="btn bg-success"
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
        <p className="mb-3 text-sm font-semibold text-ink-soft">Tick ALL MONTHS or the months you want • one sheet per month{k ? ` • search: ${k}` : ""}</p>
        <label className="mb-2 flex items-center gap-2 font-extrabold">
          <input type="checkbox" checked={pick.length === months.length} onChange={(e) => setPick(e.target.checked ? months.map((m) => m.key) : [])} /> ALL MONTHS
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {months.map((m) => (
            <label key={m.key} className={`flex items-center gap-2 rounded-lg border p-2 text-sm font-bold ${pick.includes(m.key) ? "border-accent" : "border-line"}`}>
              <input type="checkbox" checked={pick.includes(m.key)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, m.key] : p.filter((x) => x !== m.key)))} />
              {m.label}
            </label>
          ))}
        </div>
      </Modal>
    </PageBody>
  );
}
