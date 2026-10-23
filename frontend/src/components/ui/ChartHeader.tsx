"use client";

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
  return (
    <div className="inline-flex rounded-full border border-[#dbe4f5] bg-[#eef3fd] p-[3px]" role="group" aria-label="View">
      {(["chart", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`min-w-[72px] rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-all duration-300 active:scale-95 ${
            value === v ? "bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,.7)]" : "text-[#4b5b8f] hover:text-[#1f2350]"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
