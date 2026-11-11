"use client";

import { MonthField } from "@/components/forms/MonthField";
import { Fragment } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { fmt, type ChemParam, type Status } from "@/lib/chem";

// 🧪 CHEMICAL CONTROL · ชิ้นส่วนหน้าตา (ใช้ร่วมทุกหน้า)
//   ChemHero = แผงหัวหน้าแบบหน้าเลือกระบบ: ภาพเลื่อนเข้าจากขวาแล้วลอย · หัวข้อโผล่ทีละคำ · ขีดยืด · แสงกวาดผ่าน
//   SpecBar  = แถบมาตรวัด: ค่าอยู่ตรงไหนของช่วงมาตรฐาน (แดง = นอกข้อกำหนด · ส้ม = เกินขีดควบคุม · เขียว = ในเกณฑ์)
//   FlowMap  = แผนผังการอนุมัติ Start → ขั้นที่ 1..n (ชื่อผู้อนุมัติ) → Finish

export function ChemHero({ tag, title, sub, children }: { tag: string; title: string[]; sub: string; children?: React.ReactNode }) {
  let w = 0;
  return (
    <section className="sys-stage ch-hero" data-reveal="own">
      <div className="sys-hero">
        <div className="sys-hero-tx">
          <small>{tag}</small>
          <h2>
            {title.map((line) => (
              <span key={line} className="sys-line">
                {line.split(" ").map((word, i) => (
                  <span key={word + i} className="sys-word" style={{ "--w": w++ } as React.CSSProperties}>
                    {word}
                  </span>
                ))}
              </span>
            ))}
          </h2>
          <i aria-hidden />
          <p>{sub}</p>
          {children && <div className="ch-hero-x">{children}</div>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sys-hero-art ch-hero-art" src="/images/systems/chemical-control.webp" alt="" width={800} height={640} />
      </div>
    </section>
  );
}

// แถบมาตรวัด: ช่วงที่แสดง = Spec ± 25% · จุด = ค่าปัจจุบัน
export function SpecBar({ p, v, small }: { p: ChemParam; v: number | null | undefined; small?: boolean }) {
  const reduce = useReducedMotion();
  const lim = [p.specMin, p.specMax, p.lcl, p.ucl, p.target].filter((x): x is number => x != null);
  if (!lim.length) return null;
  let lo = Math.min(...lim, v ?? Infinity);
  let hi = Math.max(...lim, v ?? -Infinity);
  if (p.specMin == null) lo = Math.min(lo, 0);
  const span = hi - lo || 1;
  lo -= span * 0.18;
  hi += span * 0.18;
  if (p.specMin == null && lo < 0 && (v == null || v >= 0)) lo = 0;
  const x = (n: number) => `${Math.max(0, Math.min(100, ((n - lo) / (hi - lo)) * 100))}%`;
  const sMin = p.specMin ?? lo;
  const sMax = p.specMax ?? hi;
  const cMin = p.lcl ?? sMin;
  const cMax = p.ucl ?? sMax;
  return (
    <div className={`ch-gauge ${small ? "is-sm" : ""}`} aria-hidden>
      <div className="track">
        <span className="z-spec" style={{ left: x(sMin), width: `calc(${x(sMax)} - ${x(sMin)})` }} />
        <span className="z-ctl" style={{ left: x(cMin), width: `calc(${x(cMax)} - ${x(cMin)})` }} />
        {p.target != null && <span className="t" style={{ left: x(p.target) }} />}
        {v != null && isFinite(v) && (
          <motion.span className="m" initial={reduce ? false : { left: "0%", opacity: 0 }} animate={{ left: x(v), opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} />
        )}
      </div>
      {!small && (
        <div className="lbl">
          <span style={{ left: x(sMin) }}>{p.specMin != null ? fmt(p, p.specMin) : ""}</span>
          <span style={{ left: x(sMax) }}>{p.specMax != null ? fmt(p, p.specMax) : ""}</span>
        </div>
      )}
    </div>
  );
}

export type FlowNode = { slot: number; name: string; th: string; users: string[]; mode: string; done: { name: string; at: string; userId: string } | null; waiting: boolean };
const TH: Record<string, string> = { Prepared: "ผู้จัดทำ", Checked: "ผู้ตรวจสอบ", Reviewed: "ผู้ทบทวน", Approved: "ผู้อนุมัติ" };
export const roleTh = (n: string) => TH[n] ?? n;

// แผนผังการอนุมัติ (แบบ Workflow): Start → ขั้นอนุมัติ (หัวแถบ + ชื่อผู้อนุมัติ) → Finish
export function FlowMap({ nodes, started, finished, submittedBy }: { nodes: FlowNode[]; started: boolean; finished: boolean; submittedBy?: string | null }) {
  const reduce = useReducedMotion();
  const T = (i: number) => ({ duration: reduce ? 0 : 0.45, ease: EASE, delay: reduce ? 0 : 0.1 + i * 0.12 });
  return (
    <div className="ch-fm" role="list" aria-label="Approval flow">
      <motion.div className={`fm-end ${started ? "is-on" : ""}`} role="listitem" initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={T(0)}>
        <span className="ring">Start</span>
        <small>ส่งใบบันทึก</small>
        {submittedBy && <em>{submittedBy}</em>}
      </motion.div>
      {nodes.map((n, i) => (
        <Fragment key={n.slot}>
          <motion.span className={`fm-link ${n.done || n.waiting ? "is-on" : ""}`} aria-hidden initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={T(i + 0.5)} />
          <motion.div
            className={`fm-node ${n.done ? "is-done" : n.waiting ? "is-wait" : ""}`}
            role="listitem"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={T(i + 1)}
          >
            <div className="bar">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {n.done ? <path d="M20 12a8 8 0 1 1-4.5-7.2M20 5l-8 8-3-3" /> : n.waiting ? <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /> : <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />}
              </svg>
              <b>{n.name}</b>
              <span>{n.done ? "อนุมัติแล้ว" : n.waiting ? "รอดำเนินการ" : ""}</span>
            </div>
            <div className="body">
              <strong>{roleTh(n.name)}</strong>
              {n.done ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/signature/${encodeURIComponent(n.done.userId)}/image`} alt={n.done.name} />
                  <span className="who is-done">✓ {n.done.name}</span>
                  <small>{new Date(n.done.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
                </>
              ) : (
                <>
                  {n.users.slice(0, 3).map((u) => (
                    <span key={u} className="who">
                      {u}
                    </span>
                  ))}
                  {n.users.length > 3 && <small>+{n.users.length - 3} คน</small>}
                  <small>{n.mode === "ONE" ? "ผู้อนุมัติรายบุคคล" : n.users.length > 1 ? "คนใดคนหนึ่งในกลุ่ม" : ""}</small>
                </>
              )}
            </div>
          </motion.div>
        </Fragment>
      ))}
      <motion.span className={`fm-link ${finished ? "is-on" : ""}`} aria-hidden initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={T(nodes.length + 0.5)} />
      <motion.div className={`fm-end is-finish ${finished ? "is-on" : ""}`} role="listitem" initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={T(nodes.length + 1)}>
        <span className="ring">Finish</span>
        <small>เสร็จสิ้นการอนุมัติ</small>
      </motion.div>
    </div>
  );
}

export const statusIcon = (s: Status) => (s === "OK" ? "✓" : s === "WARN" ? "!" : s === "OUT" ? "✕" : "–");

// 🎚 ปุ่มสลับแบบ CIMS (pk-seg): พื้นขาวเลื่อนไหลไปหาตัวที่เลือก
export function PkSeg<T extends string>({ id, value, onChange, options }: { id: string; value: T; onChange: (v: T) => void; options: { v: T; l: React.ReactNode }[] }) {
  return (
    <div className="pk-seg ch-pkseg" role="tablist">
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={value === o.v} className={value === o.v ? "is-on" : ""} onClick={() => onChange(o.v)}>
          {value === o.v && <motion.span layoutId={"ch-seg-" + id} className="ch-pkseg-on" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
          <span className="relative">{o.l}</span>
        </button>
      ))}
    </div>
  );
}

// 📅 เลือกเดือนแบบ CIMS: ‹ [เดือน] › (ปุ่ม pk-step) · กดชื่อเดือน = เลือกจากปฏิทิน
export function MonthStep({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return <MonthField value={value} onChange={onChange} />;
}
