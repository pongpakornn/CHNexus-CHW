"use client";

import { Select } from "@/components/dropdowns/Select";
import { roundLabel, type Round, type Scope } from "./edp";

// 🏭 แถบเลือก วันที่ · กะ · รอบ (ใช้ร่วมทุกหน้า EDP) · กะ: แถบเลื่อนไปหาปุ่มที่เลือก
export function EdpBar({
  date,
  onDate,
  shift,
  onShift,
  shifts = ["DAY", "NIGHT", "ALL"],
  rounds,
  round,
  onRound,
  children,
}: {
  date: string;
  onDate: (d: string) => void;
  shift: Scope;
  onShift: (s: Scope) => void;
  shifts?: Scope[];
  rounds?: Round[];
  round?: number | null;
  onRound?: (r: number | null) => void;
  children?: React.ReactNode;
}) {
  const step = (n: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + n);
    onDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };
  const idx = Math.max(0, shifts.indexOf(shift));
  return (
    <div className="edp-bar">
      <div className="edp-date">
        <button type="button" onClick={() => step(-1)} aria-label="วันก่อนหน้า">
          ‹
        </button>
        <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} aria-label="วันที่แผน" />
        <button type="button" onClick={() => step(1)} aria-label="วันถัดไป">
          ›
        </button>
      </div>
      <div className="edp-seg" style={{ "--n": idx, "--c": shifts.length } as React.CSSProperties} role="tablist">
        <span className="edp-seg-glider" aria-hidden />
        {shifts.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={shift === s} className={shift === s ? "is-on" : ""} onClick={() => onShift(s)}>
            {s === "DAY" ? "☀ DAY" : s === "NIGHT" ? "🌙 NIGHT" : "ALL"}
          </button>
        ))}
      </div>
      {rounds && onRound && shift !== "ALL" && (
        <div className="w-[230px] max-w-full">
          <Select
            value={round == null ? "" : String(round)}
            onChange={(v) => onRound(v === "" ? null : +v)}
            ariaLabel="รอบการผลิต"
            options={[{ value: "", label: "ทั้งกะ (ทุกรอบ)" }, ...rounds.filter((r) => r.shift === shift).map((r) => ({ value: String(r.roundId), label: roundLabel(r) }))]}
          />
        </div>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
