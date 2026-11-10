"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EASE, staggerDelay } from "@/lib/motion";
import { calcMachine, conditionCols, f0, f1, f2, monthLabel, pc, type Calc, type Col, type PpMonth, type Sum } from "@/lib/pp";
import { useToast } from "@/components/notifications/Toasts";
import { useCount } from "./PpChart";

// 📈 PRODUCTION PLAN: ข้อมูลทั้งเดือนของหน่วยงาน (โหลดครั้งเดียว คำนวณที่หน้าเว็บ) + อัพเดทเองเมื่อมีคนบันทึก (หัวข้อ "pp")
export type MonthRes = { data: PpMonth; can: { actual: boolean; setup: boolean } };

export function usePpMonth(dept: string, month: string, paused = false) {
  const toast = useToast();
  const [res, setRes] = useState<MonthRes | null>(null);
  const [err, setErr] = useState("");
  const seq = useRef(0);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      try {
        const r = await api<MonthRes>("/pp/month", { query: { dept, month } });
        if (my === seq.current) {
          setRes(r);
          setErr("");
        }
      } catch (e) {
        if (my !== seq.current) return;
        setErr((e as Error).message);
        if (!quiet) toast.show("ERROR", "โหลด Production Plan ไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [dept, month, toast],
  );
  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  // ⚡ เครื่องอื่นบันทึก Actual / แก้ STD = โหลดเงียบ ๆ (ระหว่างกำลังแก้ตาราง = ไม่ทับค่าที่พิมพ์ค้างไว้)
  useLive(["pp"], () => (pausedRef.current ? undefined : load(true)), 60_000);

  const calcs = useMemo(() => {
    const map = new Map<number, Calc>();
    if (res) for (const m of res.data.machines) map.set(m.id, calcMachine(m, res.data));
    return map;
  }, [res]);
  return { res, data: res?.data ?? null, calcs, err, reload: load };
}

// 📅 เลือกเดือน (‹ เดือน ›)
export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const shift = (k: number) => {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m - 1 + k, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="pp-month" role="group" aria-label="Month">
      <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>
        ‹
      </button>
      <label>
        <span>{monthLabel(value).toUpperCase()}</span>
        <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Select month" />
      </label>
      <button type="button" aria-label="Next month" onClick={() => shift(1)}>
        ›
      </button>
    </div>
  );
}

// 🔢 การ์ดตัวเลข (นับขึ้น + แถบเทียบเป้า)
export function Kpi({
  i,
  label,
  value,
  fmt,
  unit,
  sub,
  frac,
  tone = "plan",
  badge,
}: {
  i: number;
  label: string;
  value: number;
  fmt: (v: number) => string;
  unit?: string;
  sub: React.ReactNode;
  frac?: number | null;
  tone?: "plan" | "act" | "ok" | "mid" | "low" | "day";
  badge?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const v = useCount(value);
  return (
    <motion.div
      className={`pp-kpi is-${tone}`}
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE, delay: staggerDelay(i, 0.07) }}
    >
      <div className="l">
        <i />
        {label}
        {badge}
      </div>
      <div className="v">
        {fmt(v)}
        {unit && <small>{unit}</small>}
      </div>
      <div className="s">{sub}</div>
      {frac != null && (
        <div className="meter">
          <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0, Math.min(1, frac)) }} transition={{ duration: reduce ? 0 : 1, ease: EASE, delay: 0.15 + i * 0.07 }} />
        </div>
      )}
    </motion.div>
  );
}

export const EffPill = ({ a, t }: { a: number; t: number }) => {
  const tone = a >= t ? "ok" : a >= t * 0.85 ? "mid" : "low";
  return <span className={`pp-pill is-${tone}`}>{tone === "ok" ? "ON TARGET" : tone === "mid" ? "NEAR" : "BELOW"}</span>;
};

// 🧾 แถวของ Condition M/C (ชื่อ / สูตร / ค่า) - ใช้ทั้งตารางรวม (ทุกเครื่อง) และตารางเครื่องเดียว
export type Row = { g?: string; code?: string; label?: string; fx?: string; v?: (c: Sum, k: Col | null) => string; tone?: (c: Sum) => string };
export function conditionRows(d: PpMonth): Row[] {
  const factor = d.settings.ManHourFactor ?? 1.023;
  const perDay = d.settings.ManHourPerDay ?? 11;
  return [
    { g: "Condition M/C" },
    { code: "C1", label: "Working Day/Month", fx: d.workdaySource === "COMPANY" ? "Company Workdays" : "จ.–ส. (ยังไม่ตั้งวันทำงาน)", v: (c) => f0(c.C1) },
    { code: "C2", label: "Q'ty Line or MC", fx: "STD", v: (c) => f0(c.C2) },
    { code: "C3", label: "SPH 100%", fx: "ΣStroke ÷ ΣMC Hr", v: (c) => f1(c.C3) },
    { code: "C4", label: "Target Eff", fx: "STD", v: (c) => pc(c.C4) },
    ...d.shifts.map((s, i) => ({ code: "C" + (5 + i), label: s.name, fx: `${s.hours.toFixed(2)} Hrs.`, v: (c: Sum) => (c.sh[i] == null ? "–" : f0(c.sh[i])) })),
    { g: "Plan" },
    { code: "P1", label: "Stroke/Month (Order)", fx: "Σ Stroke (Forecast/Order)", v: (c) => f0(c.P1) },
    { code: "P2", label: "Stroke/Day", fx: "P1 ÷ C1", v: (c) => f0(c.P2) },
    { code: "P3", label: "Working Hr./Month (100%)", fx: "P1 ÷ C3", v: (c) => f1(c.P3) },
    { code: "P4", label: "Working Hr./Month", fx: "P3 ÷ C4", v: (c) => f1(c.P4) },
    { code: "P5", label: "Working Hr./Day", fx: "P4 ÷ C1", v: (c) => f2(c.P5) },
    { code: "P6", label: "Working Hr./Day/MC", fx: "P5 ÷ C2", v: (c) => f2(c.P6) },
    { code: "P7", label: "STD Man Power / Line", fx: "STD", v: (c) => f1(c.P7) },
    { code: "P8", label: "Total Man Hour/Day", fx: `P6 × P7 × C2 × ${factor}`, v: (c) => f2(c.P8) },
    { code: "P9", label: "Req. Man Power", fx: `P8 ÷ ${perDay}`, v: (c) => f2(c.P9) },
    { g: "Actual" },
    { code: "A1", label: "Actual Stroke/Month", fx: "Σ Stroke รายวัน", v: (c) => f0(c.A1) },
    { code: "A2", label: "Working Hr./Month", fx: "Σ Working hour", v: (c) => f1(c.A2) },
    { code: "A3", label: "Actual SPH", fx: "A1 ÷ A2", v: (c) => f1(c.A3) },
    { code: "A4", label: "Eff%", fx: "A3 ÷ C3", v: (c) => pc(c.A4), tone: (c) => (c.A2 ? (c.A4 >= c.C4 ? "ok" : c.A4 >= c.C4 * 0.85 ? "mid" : "low") : "") },
    { code: "A5", label: "Actual Man Power", fx: "เฉลี่ย / วัน", v: (c) => f1(c.A5) },
  ];
}

// 🧮 ตาราง Condition M/C ทุกเครื่อง (แบบชีท Press 1 table): หัวคอลัมน์ = กลุ่ม / เครื่อง / TOTAL · คอลัมน์แรกติดซ้ายเวลาเลื่อน
export function ConditionMatrix({ data, calcs, dept }: { data: PpMonth; calcs: Map<number, Calc>; dept: string }) {
  const cols = useMemo(() => conditionCols(data, calcs), [data, calcs]);
  const rows = useMemo(() => conditionRows(data), [data]);
  return (
    <div className="pp-scroll">
      <table className="pp-matrix">
        <thead>
          <tr>
            <th className="pp-stick">
              ITEM <span>{monthLabel(data.month).toUpperCase()}</span>
            </th>
            {cols.map((c) => (
              <th key={c.key} className={`is-${c.kind}`}>
                {c.kind === "machine" ? (
                  <Link href={`/pp/capacity/${dept.toLowerCase()}?m=${c.machine!.id}&month=${data.month}`} title="ดูรายละเอียด / บันทึก Actual">
                    {c.label}
                  </Link>
                ) : (
                  c.label
                )}
                <span>{c.sub}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) =>
            r.g ? (
              <tr key={"g" + i} className="pp-grp">
                <td className="pp-stick">{r.g}</td>
                <td colSpan={cols.length} />
              </tr>
            ) : (
              <tr key={r.code}>
                <td className="pp-stick">
                  <b>{r.code}</b>
                  {r.label}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`is-${c.kind} ${r.tone ? "pp-tone-" + r.tone(c.c) : ""}`}>
                    {r.v!(c.c, c)}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
