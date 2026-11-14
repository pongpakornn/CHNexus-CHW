import { deviceName } from "./api";

// 🐞 ส่ง Error ของหน้าเว็บเข้า BUG LOG (POST /api/buglog/client) - ไม่รบกวนผู้ใช้ / ส่งไม่สำเร็จก็ช่างมัน
//   ข้อความเดิมซ้ำภายใน 30 วินาที = ไม่ส่งซ้ำ · สูงสุด 20 ครั้งต่อการเปิดหน้า (กันวนลูปยิง Server)
const sent = new Map<string, number>();
let count = 0;
const IGNORE = [/ResizeObserver loop/i, /Script error\.?$/i, /AbortError/i, /The user aborted a request/i, /NEXT_REDIRECT/, /NEXT_NOT_FOUND/];

export function reportBug(kind: string, message: string, detail?: string) {
  if (typeof window === "undefined" || !message) return;
  if (IGNORE.some((r) => r.test(message))) return;
  const key = `${kind}|${message}`;
  const now = Date.now();
  if ((sent.get(key) ?? 0) > now - 30_000 || count >= 20) return;
  sent.set(key, now);
  count++;
  fetch("/api/buglog/client", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json", "X-Client-Device": deviceName() },
    body: JSON.stringify({ kind, message: message.slice(0, 900), detail: detail?.slice(0, 6000), path: location.pathname + location.search }),
  }).catch(() => {});
}

// ดัก Error ทั้งหน้า (ครั้งเดียว): JavaScript error / Promise ที่ไม่ได้ดัก
//   ไฟล์ของหน้าเวอร์ชันเก่าหาย (หลังอัพเดทระบบ) = โหลดหน้าใหม่ให้เอง แทนที่จะค้าง
let installed = false;
export function installBugReporter() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const chunk = (m: string) => /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module/i.test(m);
  window.addEventListener("error", (e) => {
    const msg = e.message || String(e.error ?? "");
    if (chunk(msg)) return reloadOnce();
    reportBug("JS", msg, e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string; status?: number } | undefined;
    const msg = r?.message ?? String(r ?? "");
    if (chunk(msg)) return reloadOnce();
    // ApiError (4xx ที่ระบบแจ้งผู้ใช้อยู่แล้ว) ไม่ใช่ Bug ของหน้าเว็บ
    if (r && typeof r.status === "number" && r.status < 500) return;
    reportBug("PROMISE", msg, r?.stack);
  });
}

function reloadOnce() {
  try {
    // timestamp, not a flag: a long-lived tab can reload again after the next deploy, but never twice within 60 s (no loop)
    const last = Number(sessionStorage.getItem("chr-chunk-reload"));
    if (Number.isFinite(last) && Date.now() - last < 60_000) return;
    sessionStorage.setItem("chr-chunk-reload", String(Date.now()));
  } catch {
    /* ไม่มี storage = โหลดใหม่ครั้งเดียวตามปกติ */
  }
  location.reload();
}
