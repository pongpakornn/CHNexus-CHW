// 🏷️ ป้ายสถานะการสแกน (IN / OUT / RETURN / TEST / OUT (DEDUCT)) - วงรีสีอ่อน + จุดสี (ใช้ทั้งหน้าสแกนและหน้าต่างประวัติ / ADJUST)
const STATUS_COLOR: Record<string, string> = { IN: "var(--success)", OUT: "var(--scanout)", RETURN: "var(--return)", TEST: "var(--warning)" };

export function StatusPill({ status, deduct = false }: { status: string; deduct?: boolean }) {
  const key = (status ?? "").trim().toUpperCase().split(/\s|\(/)[0];
  return (
    <span className="sc-pill" style={{ "--c": deduct ? "var(--danger)" : (STATUS_COLOR[key] ?? "var(--primary)") } as React.CSSProperties}>
      <span className="sc-pill-dot" />
      {deduct ? "OUT (DEDUCT)" : status}
    </span>
  );
}
