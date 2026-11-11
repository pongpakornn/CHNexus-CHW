"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EASE, staggerDelay } from "@/lib/motion";
import { DEPTS, calcMachine, conditionCols, f0, f1, f2, monthLabel, pc, type Calc, type Col, type PpMonth, type Sum } from "@/lib/pp";
import { useToast } from "@/components/notifications/Toasts";
import { Ring, Spark, useCount } from "./PpChart";

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

// 📅 เลือกเดือน (‹ เดือน ›): ชื่อเดือนเลื่อนออก / เข้าตามทิศที่กด
export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const reduce = useReducedMotion();
  const [dir, setDir] = useState(1);
  const shift = (k: number) => {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m - 1 + k, 1);
    setDir(k);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="pp-month" role="group" aria-label="Month">
      <motion.button type="button" aria-label="Previous month" onClick={() => shift(-1)} whileTap={{ scale: 0.85, x: -2 }}>
        ‹
      </motion.button>
      <label>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.span
            key={value}
            custom={dir}
            initial={reduce ? false : { y: dir * 14, opacity: 0, filter: "blur(3px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={reduce ? undefined : { y: -dir * 14, opacity: 0, filter: "blur(3px)" }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {monthLabel(value).toUpperCase()}
          </motion.span>
        </AnimatePresence>
        <input type="month" value={value} onChange={(e) => e.target.value && (setDir(e.target.value > value ? 1 : -1), onChange(e.target.value))} aria-label="Select month" />
      </label>
      <motion.button type="button" aria-label="Next month" onClick={() => shift(1)} whileTap={{ scale: 0.85, x: 2 }}>
        ›
      </motion.button>
    </div>
  );
}

const TONE: Record<string, [string, string]> = {
  plan: ["#4f46e5", "#a5b4fc"],
  act: ["#0891b2", "#67e8f9"],
  day: ["#6750a4", "#c4b5fd"],
  ok: ["#059669", "#6ee7b7"],
  mid: ["#d97706", "#fcd34d"],
  low: ["#dc2626", "#fca5a5"],
};

// 🔢 การ์ดตัวเลข: ไอคอนไล่สี · ตัวเลขนับขึ้น · วงแหวน % (frac) · กราฟเล็กรายวัน (spark) · ชี้ = ยก + เรืองแสงตามสี
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
  icon,
  spark,
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
  icon?: React.ReactNode;
  spark?: (number | null)[];
}) {
  const reduce = useReducedMotion();
  const v = useCount(value);
  const [c, c2] = TONE[tone];
  return (
    <motion.div
      className={`pp-kpi is-${tone}`}
      style={{ "--k": c, "--k2": c2 } as React.CSSProperties}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={reduce ? undefined : { y: -3 }}
      transition={{ duration: 0.55, ease: EASE, delay: staggerDelay(i, 0.08) }}
    >
      <span className="pp-kpi-glow" aria-hidden />
      <div className="pp-kpi-main">
        <div className="l">
          <span className="ic">{icon ?? <i />}</span>
          {label}
          {badge}
        </div>
        <div className="v">
          {fmt(v)}
          {unit && <small>{unit}</small>}
        </div>
        <div className="s">{sub}</div>
        {spark && <Spark values={spark} color={c} />}
      </div>
      {frac != null && <Ring frac={frac} color={c} color2={c2} label={`${Math.round(Math.max(0, frac) * 100)}%`} />}
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
              <tr key={r.code} className="pp-rise" style={{ "--i": i } as React.CSSProperties}>
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

// 🖼 ไอคอนเส้น (SVG) ของการ์ดตัวเลข
const ICON: Record<string, React.ReactNode> = {
  plan: <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6.5A1.5 1.5 0 0 0 5 7.5v11A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 17.5 6H16M8.5 12h7M8.5 15.5h4.5" />,
  act: <path d="M4 20h16M6 20V9l6-5 6 5v11M9.5 20v-5h5v5M12 4v3" />,
  hr: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />,
  eff: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM12 12l7-7" />,
  day: <path d="M7 3v3M17 3v3M4 8.5h16M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5zM8 12.5h2M14 12.5h2M8 16h2" />,
  target: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
};
export const PpIcon = ({ k }: { k: keyof typeof ICON | string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {ICON[k] ?? ICON.plan}
  </svg>
);

// 🧩 Process Code เป็นชิปทีละขั้น (PI › CU › BN …) เกิน 5 ขั้น = +n · ชี้ = ดูโค้ดเต็ม
export function ProcessChips({ code }: { code: string | null }) {
  if (!code) return <span className="text-ink-soft">–</span>;
  const m = code.match(/^(.*?)\s+(\d+\/\d+)$/);
  const body = m ? m[1] : code;
  const ratio = m ? m[2] : "";
  const steps = body.split("^").filter(Boolean);
  return (
    <span className="pp-proc">
      {steps.slice(0, 5).map((st, i) => (
        <span key={i} className="st">
          {i > 0 && <i aria-hidden>›</i>}
          <em>{st}</em>
        </span>
      ))}
      {steps.length > 5 && <b>+{steps.length - 5}</b>}
      {ratio && <small>{ratio}</small>}
    </span>
  );
}

// 🏭 เลือกหน่วยงาน: ชิป 6 หน่วยงาน · พื้นไล่สีเลื่อนไหลไปหาตัวที่เลือก
export function DeptPicker({ value, onChange, id = "dept" }: { value: string; onChange: (code: string) => void; id?: string }) {
  return (
    <div className="pp-depts" role="tablist" aria-label="Department">
      {DEPTS.map((d) => (
        <button key={d.code} type="button" role="tab" aria-selected={value === d.code} className={value === d.code ? "is-on" : ""} onClick={() => onChange(d.code)} title={d.th}>
          {value === d.code && <motion.span layoutId={"pp-dept-" + id} className="pp-dept-on" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
          <span className="relative">{d.name}</span>
        </button>
      ))}
    </div>
  );
}
