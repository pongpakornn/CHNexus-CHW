"use client";

import { useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE, springSoft } from "@/lib/motion";
// หัวการ์ดกราฟ: ไอคอนวงกลมม่วง + ชื่อ + คำอธิบาย + ปุ่มด้านขวา และสวิตช์ CHART / TABLE แบบเม็ดยา
export function ChartHeader({ icon, title, subtitle, actions }: { icon: string; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line/60 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#8b7cf6] to-[#5b47e0] shadow-[0_6px_14px_-6px_rgba(91,71,224,.7)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt="" className="size-[22px] object-contain" />
      </span>
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-extrabold uppercase tracking-wide text-[#1f2350]">{title}</h3>
        {subtitle && <div className="text-xs font-semibold text-ink-soft">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export type ChartView = "chart" | "table";

export function ViewSwitch({ value, onChange }: { value: ChartView; onChange: (v: ChartView) => void }) {
  // พื้นน้ำเงินเลื่อนไปหาปุ่มที่เลือก (layoutId · แต่ละกราฟมีตัวของตัวเอง)
  const id = useId();
  return (
    <div className="inline-flex rounded-full border border-[#dbe4f5] bg-[#eef3fd] p-[3px]" role="group" aria-label="View">
      {(["chart", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`relative min-w-[72px] rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors duration-300 active:scale-95 ${value === v ? "text-white" : "text-[#4b5b8f] hover:text-[#1f2350]"}`}
        >
          {value === v && (
            <motion.span
              layoutId={`vs-${id}`}
              className="absolute inset-0 rounded-full bg-gradient-to-b from-[#2563eb] to-[#1d4ed8] shadow-[0_4px_12px_-4px_rgba(37,99,235,.7)]"
              transition={springSoft}
            />
          )}
          <span className="relative">{v}</span>
        </button>
      ))}
    </div>
  );
}

// 🎞 สลับ CHART ↔ TABLE แบบนุ่ม: ของเดิมเลื่อนออก + จาง แล้วของใหม่เลื่อนเข้าจากอีกฝั่ง (TABLE มาจากขวา · CHART มาจากซ้าย)
//   ลดการเคลื่อนไหว = จางสั้น ๆ อย่างเดียว · ค่าเวลา: เข้า 0.34 วิ · ออก 0.18 วิ (จบแล้วไม่ค้าง transform = ตัวอักษร / เส้นคมเหมือนเดิม)
export function ViewFade({ view, className, children }: { view: ChartView; className?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const dx = reduce ? 0 : view === "table" ? 28 : -28;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={view}
        className={className}
        initial={{ opacity: 0, x: dx }}
        animate={{ opacity: 1, x: 0, transition: { duration: reduce ? 0.15 : 0.34, ease: EASE } }}
        exit={{ opacity: 0, x: -dx * 0.6, transition: { duration: reduce ? 0.1 : 0.18, ease: EASE } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// 🔀 สวิตช์เม็ดยาแบบเลือกได้หลายค่า (เหมือน ViewSwitch) เช่น DIFF (3) / DIFF (2) ของกราฟ Forecast
export function PillSwitch<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; l: string; title?: string }[]; label: string }) {
  const id = useId();
  return (
    <div className="inline-flex flex-wrap rounded-full border border-[#dbe4f5] bg-[#eef3fd] p-[3px]" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          title={o.title}
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`relative rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide whitespace-nowrap transition-colors duration-300 active:scale-95 ${value === o.v ? "text-white" : "text-[#4b5b8f] hover:text-[#1f2350]"}`}
        >
          {value === o.v && (
            <motion.span
              layoutId={`ps-${id}`}
              className="absolute inset-0 rounded-full bg-gradient-to-b from-[#2563eb] to-[#1d4ed8] shadow-[0_4px_12px_-4px_rgba(37,99,235,.7)]"
              transition={springSoft}
            />
          )}
          <span className="relative">{o.l}</span>
        </button>
      ))}
    </div>
  );
}
