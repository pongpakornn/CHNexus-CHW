"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Empty, Loading } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { isoDate } from "@/lib/format";
import { tileStyle } from "@/lib/stockIcons";

type Customer = { customer: string; yearDays: number; monthsSet: number };
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const key = (y: number, m: number, d: number) => isoDate(new Date(y, m, d));

// 📅 วันทำงานของลูกค้า (WorkdayWindow): การ์ดลูกค้า -> ปฏิทิน 12 เดือน (กดวัน = วันทำงาน / กดซ้ำ = ยกเลิก บันทึกทันที)
export function WorkdayModal({ open, canEdit, onClose, onChanged }: { open: boolean; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [year, setYear] = useState(new Date().getFullYear());
  const [yearDir, setYearDir] = useState(0); // ทิศที่เปลี่ยนปี (อนิเมชันตัวเลขปี)
  const [customer, setCustomer] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [days, setDays] = useState<Set<string> | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const monthRefs = useRef<(HTMLDivElement | null)[]>([]);
  const today = isoDate(new Date());

  const loadCustomers = useCallback(async () => {
    setCustomers(null);
    try {
      setCustomers(await api<Customer[]>("/maxmin/workdays/customers", { query: { year } }));
    } catch (e) {
      toast.show("ERROR", "โหลดรายชื่อลูกค้าไม่สำเร็จ\n" + (e as Error).message, "error");
      setCustomers([]);
    }
  }, [year, toast]);

  const loadDays = useCallback(async () => {
    if (!customer) return;
    setDays(null);
    try {
      setDays(new Set(await api<string[]>("/maxmin/workdays", { query: { customer, year } })));
    } catch (e) {
      toast.show("ERROR", "โหลดวันทำงานไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [customer, year, toast]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => (customer ? loadDays() : loadCustomers()), 0);
    return () => clearTimeout(t);
  }, [open, customer, loadDays, loadCustomers]);

  // ปีปัจจุบัน -> เลื่อนไปที่เดือนนี้ให้เลย
  useEffect(() => {
    if (!days || year !== new Date().getFullYear()) return;
    monthRefs.current[new Date().getMonth()]?.scrollIntoView({ block: "nearest" });
  }, [days, year]);

  async function save(dates: string[], working: boolean) {
    if (dates.length === 0) return true;
    try {
      const r = await api<{ saved: string }>("/maxmin/workdays", { method: "POST", body: { customer, dates, working } });
      setSaved("✓ SAVED " + r.saved);
      onChanged();
      return true;
    } catch (e) {
      toast.show("Save failed", (e as Error).message, "error");
      return false;
    }
  }

  async function toggle(k: string) {
    if (!canEdit || !days) return;
    const on = !days.has(k);
    const next = new Set(days);
    if (on) next.add(k);
    else next.delete(k);
    setDays(next);
    if (!(await save([k], on)))
      setDays((cur) => {
        const s = new Set(cur);
        if (on) s.delete(k);
        else s.add(k);
        return s;
      });
  }

  // MON-FRI = วันจันทร์ - ศุกร์เป็นวันทำงาน / CLEAR = ล้างทั้งเดือน
  async function setMonth(m: number, weekdaysOnly: boolean) {
    if (!days) return;
    const before = days;
    const all = Array.from({ length: daysIn(year, m) }, (_, i) => new Date(year, m, i + 1));
    const toClear = all.map(isoDate).filter((k) => days.has(k));
    const toSet = weekdaysOnly ? all.filter((d) => d.getDay() !== 0 && d.getDay() !== 6).map(isoDate) : [];
    const next = new Set(days);
    toClear.forEach((k) => next.delete(k));
    toSet.forEach((k) => next.add(k));
    setDays(next);
    let ok = await save(toClear, false);
    if (ok && toSet.length) ok = await save(toSet, true);
    if (!ok) setDays(before);
  }

  async function template() {
    const who = customer ?? "ทุกลูกค้า";
    if (
      !(await dlg.confirm({
        title: "TEMPLATE EXCEL",
        ok: "YES",
        message: `ต้องการสร้างไฟล์ Template สำหรับ IMPORT WORKDAYS (${who} ปี ${year}) ใช่หรือไม่?\n\n• 1 แถว = 1 วันทำงาน (CUSTOMER / DATE) - วันทำงานที่มีอยู่แล้วใส่ไว้ให้\n• แก้แล้วนำเข้ากลับด้วยปุ่ม IMPORT WORKDAYS`,
      }))
    )
      return;
    download("/maxmin/workdays/template", { year, customer: customer ?? undefined }).catch((e) => toast.show("ERROR", e.message, "error"));
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const r = await upload<{ message: string }>("/maxmin/workdays/import", file);
      toast.show("Workdays imported", r.message, "ok");
      onChanged();
      if (customer) await loadDays();
      else await loadCustomers();
    } catch (e) {
      toast.show("Import failed", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const countMonth = (m: number) => (days ? [...days].filter((k) => k.startsWith(`${year}-${String(m + 1).padStart(2, "0")}`)).length : 0);
  const total = days ? [...days].filter((k) => k.startsWith(`${year}-`)).length : 0;

  const thisYear = new Date().getFullYear();
  const shiftYear = (n: number) => {
    setYearDir(n);
    setYear((y) => y + n);
  };

  return (
    <Modal
      open={open}
      size="xl"
      title={customer ? `📅 ${customer}` : "📅 CUSTOMER WORKDAYS"}
      onClose={onClose}
      footer={
        <>
          {customer && days && (
            <span className="mr-auto flex items-center gap-2 text-sm font-extrabold text-primary">
              <span className="wd-total">{total}</span> WORKDAYS IN {year}
            </span>
          )}
          {saved && (
            <span key={saved} className="wd-saved">
              {saved}
            </span>
          )}
          <button className="cta-btn is-gray" onClick={onClose}>
            CLOSE
          </button>
        </>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {customer && (
          <button className="fill-btn is-sm" onClick={() => setCustomer(null)}>
            ← ALL CUSTOMERS
          </button>
        )}
        {/* 📆 เลือกปี: ‹ ปี › (ตัวเลขเลื่อนตามทิศ) + กลับปีนี้ */}
        <div className="yr-pick">
          <button type="button" className="yr-arrow" onClick={() => shiftYear(-1)} aria-label="Previous year">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <span className="yr-box">
            <span key={year} className={`yr-num ${yearDir < 0 ? "from-left" : yearDir > 0 ? "from-right" : ""}`}>
              {year}
            </span>
          </span>
          <button type="button" className="yr-arrow" onClick={() => shiftYear(1)} aria-label="Next year">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        {year !== thisYear && (
          <button type="button" className="fill-btn is-sm" onClick={() => shiftYear(thisYear - year)}>
            THIS YEAR
          </button>
        )}
        <span className="text-xs font-semibold text-ink-soft">
          {customer ? (canEdit ? "Click a day = working day / click again = not working (saved automatically)" : "View only") : "Select a customer to set the working days of each month"}
        </span>
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="cta-btn is-purple" onClick={template}>
              📄 TEMPLATE
            </button>
            <button className="cta-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "⏳ IMPORTING..." : "📥 IMPORT WORKDAYS"}
            </button>
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
          </div>
        )}
      </div>

      {!customer ? (
        !customers ? (
          <Loading />
        ) : customers.length === 0 ? (
          <Empty>NO CUSTOMER - add CUSTOMER to the products in Inventory Registration first.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {customers.map((c, i) => {
              const col = c.monthsSet >= 12 ? "#16a34a" : c.monthsSet > 0 ? "#6750a4" : "#f59e0b";
              return (
                <button
                  key={c.customer}
                  type="button"
                  onClick={() => {
                    setSaved("");
                    setCustomer(c.customer);
                  }}
                  className="adm-card ch-card wd-cust"
                  style={{ "--c": col, animationDelay: `${Math.min(i, 12) * 40}ms` } as React.CSSProperties}
                >
                  <span className="adm-bar" />
                  <span className="adm-ic text-sm font-black text-white" style={tileStyle(col)}>
                    {c.customer.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] font-extrabold text-[#1f2350]">{c.customer}</span>
                    <span className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-extrabold tabular-nums" style={{ color: col }}>
                        {c.yearDays.toLocaleString()}
                      </span>
                      <span className="text-[10px] font-extrabold text-ink-soft">WORKDAYS {year}</span>
                    </span>
                    <span className="wd-prog" title={`${c.monthsSet} / 12 MONTHS SET`}>
                      <i style={{ width: `${(c.monthsSet / 12) * 100}%` }} />
                    </span>
                    <span className="mt-1 block text-[10px] font-extrabold text-ink-soft">{c.monthsSet} / 12 MONTHS SET</span>
                  </span>
                  <span className="ch-go" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : !days ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-3 text-[11px] font-extrabold text-ink-soft">
            <span className="wd-legend">
              <i className="wd-day is-on" /> WORKING DAY
            </span>
            <span className="wd-legend">
              <i className="wd-day" /> NOT WORKING
            </span>
            <span className="wd-legend">
              <i className="wd-day is-weekend" /> SAT / SUN
            </span>
            <span className="wd-legend">
              <i className="wd-day is-today" /> TODAY
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {MONTHS.map((name, m) => {
              const lead = new Date(year, m, 1).getDay();
              const n = countMonth(m);
              const dim = daysIn(year, m);
              return (
                <div
                  key={`${year}-${name}`}
                  ref={(el) => {
                    monthRefs.current[m] = el;
                  }}
                  className={`wd-month ${year === thisYear && m === new Date().getMonth() ? "is-now" : ""}`}
                  style={{ animationDelay: `${m * 35}ms` }}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold tracking-wide text-[#1f2350]">{name}</span>
                    <span className="wd-count" style={{ "--p": `${(n / dim) * 100}%` } as React.CSSProperties}>
                      {n} DAYS
                    </span>
                  </div>
                  {canEdit && (
                    <div className="mb-2 flex gap-1.5">
                      <button className="fill-btn is-xs" title="Set Monday - Friday as working days" onClick={() => setMonth(m, true)}>
                        MON-FRI
                      </button>
                      <button className="fill-btn is-xs is-danger" title="Clear this month" onClick={() => setMonth(m, false)}>
                        CLEAR
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {DOW.map((d) => (
                      <span key={d} className={`text-[10px] font-extrabold ${d === "SU" || d === "SA" ? "text-danger" : "text-ink-soft"}`}>
                        {d}
                      </span>
                    ))}
                    {Array.from({ length: lead }, (_, i) => (
                      <span key={`e${i}`} />
                    ))}
                    {Array.from({ length: dim }, (_, i) => {
                      const k = key(year, m, i + 1);
                      const on = days.has(k);
                      const dow = (lead + i) % 7;
                      const weekend = dow === 0 || dow === 6;
                      return (
                        <button
                          key={k}
                          disabled={!canEdit}
                          title={new Date(year, m, i + 1).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                          onClick={() => toggle(k)}
                          className={`wd-day ${on ? "is-on" : ""} ${weekend ? "is-weekend" : ""} ${k === today ? "is-today" : ""}`}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
