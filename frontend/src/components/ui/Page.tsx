// โครงหน้าระบบ: หัวหน้า (ไอคอนสี + ชื่อ + ปุ่ม) การ์ด ตัวเลขสรุป ป้ายสถานะ
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {icon && (
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-primary shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} alt="" className="h-7 w-7 object-contain brightness-0 invert" />
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-xl font-extrabold tracking-tight text-primary md:text-2xl">{title}</h2>
        {subtitle && <div className="text-sm font-semibold text-ink-soft">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-3 md:p-5 ${className}`}>{children}</div>;
}

export function Card({
  title,
  actions,
  children,
  className = "",
  bodyClass = "",
  clip = true,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  /** false = เนื้อหาไม่ตัดขอบ (มี Dropdown / ปฏิทินในเนื้อการ์ดที่ต้องกางออกนอกการ์ด) */
  clip?: boolean;
}) {
  return (
    // หัวการ์ดไม่ตัดขอบ: Dropdown บนหัวการ์ดกางออกนอกการ์ดได้ · เนื้อหาด้านล่างยังตัดตามมุมมน
    // min-w-0: การ์ดไม่ยืดตามตารางที่กว้าง (ตารางย่อ / เป็นการ์ดในกล่องแทน)
    <section className={`min-w-0 rounded-2xl border border-line/60 bg-surface shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="relative z-20 flex flex-wrap items-center gap-2 rounded-t-2xl border-b border-line/60 px-4 py-3">
          {title && <h3 className="text-sm font-extrabold uppercase tracking-wide text-primary">{title}</h3>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`${clip ? "overflow-hidden" : ""} ${title || actions ? "rounded-b-2xl" : "rounded-2xl"} ${bodyClass}`}>{children}</div>
    </section>
  );
}

const TONE = {
  primary: "var(--primary)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
  accent: "var(--accent)",
};

export function Stat({
  label,
  value,
  tone = "primary",
  hint,
  onClick,
  active,
}: {
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof TONE;
  hint?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const color = TONE[tone];
  const El = onClick ? "button" : "div";
  return (
    <El
      onClick={onClick}
      className={`flex min-w-0 flex-col rounded-2xl border bg-surface p-4 text-left shadow-sm transition ${onClick ? "hover:-translate-y-0.5 hover:shadow-md" : ""} ${active ? "" : "border-line/60"}`}
      style={active ? { borderColor: color, boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="mt-1 text-2xl font-extrabold md:text-3xl" style={{ color }}>
        {value}
      </span>
      {hint && <span className="mt-0.5 text-xs font-semibold text-ink-soft">{hint}</span>}
    </El>
  );
}

export function Empty({ children = "ไม่พบรายการ" }: { children?: React.ReactNode }) {
  return <div className="py-12 text-center text-sm font-semibold text-ink-soft">{children}</div>;
}

export function Loading() {
  return <div className="py-12 text-center text-sm font-semibold text-ink-soft">⏳ LOADING...</div>;
}

export function Badge({ children, color = "var(--primary)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-extrabold text-white" style={{ background: color }}>
      {children}
    </span>
  );
}

// ช่องค้นหาแบบมีไอคอน
export function SearchBox({ value, onChange, placeholder = "ค้นหา...", className = "", fancy = false }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; fancy?: boolean }) {
  return (
    <div className={`group relative ${fancy ? "sb-fancy" : ""} ${className}`}>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-ink-soft transition-colors group-focus-within:text-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        className="field !h-10 !pl-10 !pr-9"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
      />
      {value && (
        <button type="button" className="search-x absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-[#eeecf3] text-ink-soft transition hover:bg-accent hover:text-white" onClick={() => onChange("")} aria-label="Clear">
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      )}
    </div>
  );
}
