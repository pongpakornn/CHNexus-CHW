"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { tileStyle } from "@/lib/stockIcons";

export type CalcChoice = { title: string; text: string; calc: string; only: string };

// 📥 IMPORT FORECAST & ORDER: เลือก "คำนวณ MAX / MIN ด้วย" หรือ "IMPORT อย่างเดียว" (หน้า Forecast / Order และ Max-Min Cal)
//    การ์ดแบบหน้าต่างเลือกคลังของ Multi-Scanner: แถบสี · ไอคอนในกรอบ · วงเลือกมุมขวาบนเติมสี + วาดเครื่องหมายถูก · ชี้ = ยกขึ้น
//    กดการ์ด = เลือก · กด SELECT FILE = เลือกไฟล์ Excel (ดับเบิลคลิกการ์ด = เลือกไฟล์ทันที)
const CARDS = [
  {
    calc: true,
    color: "#e11d48",
    tag: "IMPORT + CALCULATE",
    points: ["นำเข้า FORECAST / ORDER / DELIVERY", "คำนวณ MAX / MIN ใหม่ให้อัตโนมัติ", "ยอด MAX / MIN ในคลังเปลี่ยนตามผลคำนวณ"],
    icon: "M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z",
  },
  {
    calc: false,
    color: "#0284c7",
    tag: "IMPORT ONLY",
    points: ["นำเข้า FORECAST / ORDER / DELIVERY", "ไม่คำนวณ MAX / MIN", "MAX / MIN ในคลังคงเดิม"],
    icon: "M12 16V4M7 9l5-5 5 5M4 17v3h16v-3",
  },
] as const;

export function CalcChoiceModal({ choice, onClose, onPick }: { choice: CalcChoice | null; onClose: () => void; onPick: (calc: boolean) => void }) {
  const [sel, setSel] = useState<boolean | null>(null);
  useEffect(() => {
    if (choice) queueMicrotask(() => setSel(null));
  }, [choice]);

  const go = (calc: boolean) => {
    onClose();
    onPick(calc);
  };

  return (
    <Modal
      open={!!choice}
      wide
      title={choice?.title ?? ""}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-xs font-extrabold text-ink-soft">
            {sel == null ? "เลือกวิธี IMPORT" : sel ? "⚡ IMPORT + คำนวณ MAX / MIN" : "📥 IMPORT อย่างเดียว"}
          </span>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" disabled={sel == null} onClick={() => sel != null && go(sel)}>
            📂 SELECT FILE
          </button>
        </>
      }
    >
      {choice?.text && <p className="mb-4 whitespace-pre-line text-sm font-semibold text-ink-soft">{choice.text}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((c, i) => {
          const on = sel === c.calc;
          const label = c.calc ? choice?.calc : choice?.only;
          return (
            <div
              key={c.tag}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              onClick={() => setSel(c.calc)}
              onDoubleClick={() => go(c.calc)}
              onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), on ? go(c.calc) : setSel(c.calc))}
              className={`sk-card card-in group ${on ? "is-on" : ""}`}
              style={{ "--c": c.color, animationDelay: `${i * 70}ms` } as React.CSSProperties}
            >
              <div className="sk-bar" />
              <span className="sk-check" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>

              <div className="relative flex items-start gap-3 pr-8">
                <span className="sk-tile grid size-12 shrink-0 place-items-center rounded-[15px]" style={tileStyle(c.color)}>
                  <svg viewBox="0 0 24 24" className="size-7 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={c.icon} />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <span className="sk-badge" style={{ background: c.color }}>
                    {c.tag}
                  </span>
                  <div className="mt-1.5 text-[15px] font-extrabold leading-snug text-[#1f2350]">{label}</div>
                </div>
              </div>

              <ul className="relative mt-4 grid gap-1.5 text-xs font-semibold text-ink-soft">
                {c.points.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    {p}
                  </li>
                ))}
              </ul>

              <svg viewBox="0 0 24 24" className="sk-art pointer-events-none absolute -right-3 -bottom-3 size-24" fill="none" stroke={c.color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={c.icon} />
              </svg>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
