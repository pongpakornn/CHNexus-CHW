"use client";

import { isTopOverlay, pushOverlay } from "@/lib/overlayStack";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// ✅ ยืนยัน / กรอกข้อความ / แจ้งผล (แทน DialogHelper.ShowConfirm / ShowTextInput / ShowSuccess ของ WPF) - ใช้แบบ await
//    หน้าตา: การ์ดกลางจอ + ไอคอนตามประเภทในวงสี + ปุ่มเต็มความกว้าง · เปิด = เด้งเข้า, ปิด = จางออก · Esc = ยกเลิก, Enter = ยืนยัน
type ConfirmOpt = { title?: string; message: React.ReactNode; ok?: string; danger?: boolean };
type PromptOpt = ConfirmOpt & { placeholder?: string; initial?: string; required?: string; multiline?: boolean; numeric?: boolean };
type AlertOpt = { title?: string; message: React.ReactNode; tone?: "ok" | "warn" | "error" };
type State =
  | { kind: "confirm"; opt: ConfirmOpt; resolve: (v: boolean) => void }
  | { kind: "prompt"; opt: PromptOpt; resolve: (v: string | null) => void }
  | { kind: "alert"; opt: AlertOpt; resolve: () => void }
  | null;

type Api = {
  confirm: (o: ConfirmOpt | string) => Promise<boolean>;
  prompt: (o: PromptOpt) => Promise<string | null>;
  alert: (o: AlertOpt | string) => Promise<void>;
};
const Ctx = createContext<Api | null>(null);

type Tone = { color: string; icon: React.ReactNode };
const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const ICON = {
  ask: svg(
    <>
      <path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4.3" />
      <path d="M12 18h.01" />
    </>,
  ),
  warn: svg(
    <>
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
    </>,
  ),
  ok: svg(<path d="M6 12.5l4 4 8-9" />),
  error: svg(<path d="M7 7l10 10M17 7L7 17" />),
  edit: svg(
    <>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>,
  ),
};

function toneOf(s: NonNullable<State>): Tone {
  if (s.kind === "alert") {
    const t = s.opt.tone ?? "ok";
    return t === "ok" ? { color: "#16a34a", icon: ICON.ok } : t === "warn" ? { color: "#f59e0b", icon: ICON.warn } : { color: "#e11d48", icon: ICON.error };
  }
  if (s.opt.danger) return { color: "#e11d48", icon: ICON.warn };
  return s.kind === "prompt" ? { color: "#2563eb", icon: ICON.edit } : { color: "#7c3aed", icon: ICON.ask };
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(null);
  const [leaving, setLeaving] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const leaveT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const open = useCallback((s: NonNullable<State>) => {
    clearTimeout(leaveT.current);
    setLeaving(false);
    setState(s);
  }, []);
  const confirm = useCallback((o: ConfirmOpt | string) => new Promise<boolean>((resolve) => open({ kind: "confirm", opt: typeof o === "string" ? { message: o } : o, resolve })), [open]);
  const prompt = useCallback(
    (o: PromptOpt) =>
      new Promise<string | null>((resolve) => {
        setText(o.initial ?? "");
        setErr("");
        open({ kind: "prompt", opt: o, resolve });
      }),
    [open],
  );
  const alert = useCallback((o: AlertOpt | string) => new Promise<void>((resolve) => open({ kind: "alert", opt: typeof o === "string" ? { message: o } : o, resolve })), [open]);

  // ตอบทันที แล้วค่อยเล่นอนิเมชันปิด (ระหว่างนั้นกดซ้ำไม่ได้)
  const close = useCallback(
    (ok: boolean) => {
      if (!state || leaving) return;
      if (state.kind === "confirm") state.resolve(ok);
      else if (state.kind === "alert") state.resolve();
      else {
        if (ok && state.opt.required && !text.trim()) return setErr(state.opt.required);
        state.resolve(ok ? text.trim() : null);
      }
      setLeaving(true);
      leaveT.current = setTimeout(() => {
        setState(null);
        setLeaving(false);
      }, 180);
    },
    [state, leaving, text],
  );

  const ovId = useRef<symbol | null>(null);
  const hasState = !!state;
  useEffect(() => {
    if (!hasState) return;
    const ov = pushOverlay();
    ovId.current = ov.id;
    return () => ov.pop();
  }, [hasState]);
  useEffect(() => {
    if (!state) return;
    const k = (e: KeyboardEvent) => {
      if (!ovId.current || !isTopOverlay(ovId.current)) return; // another overlay is on top
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter" && state.kind !== "prompt" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) close(true);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [state, close]);

  const tone = state ? toneOf(state) : null;
  const title = state?.opt.title ?? (state?.kind === "prompt" ? "INPUT" : state?.kind === "alert" ? "RESULT" : "CONFIRM");
  const okLabel = state?.kind === "alert" ? "OK" : (state?.opt.ok ?? "CONFIRM");
  const msg = state?.opt.message;
  const long = typeof msg !== "string" || msg.includes("\n");

  // ค่าเดิมทุกครั้ง: เปิด / ปิดหน้าต่างยืนยัน ไม่ทำให้หน้าที่ใช้ dialog โหลดใหม่
  const api = useMemo(() => ({ confirm, prompt, alert }), [confirm, prompt, alert]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {state && tone && (
        <div className={`dlg-bg fixed inset-0 z-[95] grid place-items-center p-4 ${leaving ? "is-leaving" : ""}`} onMouseDown={() => close(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dlg-title"
            className="dlg-card relative w-full max-w-[440px] rounded-[26px] bg-surface px-6 pb-6 pt-7 text-center"
            style={{ "--tone": tone.color } as React.CSSProperties}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="dlg-glow" aria-hidden />
            <button onClick={() => close(false)} className="dlg-x absolute right-4 top-4" aria-label="Close">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>

            <div className="dlg-icon mx-auto">{tone.icon}</div>
            <h3 id="dlg-title" className="mt-4 text-lg font-extrabold uppercase tracking-wide text-primary">
              {title}
            </h3>
            <div className={`mt-3 whitespace-pre-line text-[13.5px] font-semibold leading-relaxed text-ink-soft ${long ? "rounded-2xl bg-surface-2 px-4 py-3 text-left" : ""}`}>{msg}</div>

            {state.kind === "prompt" &&
              (state.opt.multiline ? (
                <textarea autoFocus rows={3} className="field mt-4" placeholder={state.opt.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
              ) : (
                <input
                  autoFocus
                  className="field mt-4 text-center"
                  inputMode={state.opt.numeric ? "decimal" : undefined}
                  placeholder={state.opt.placeholder}
                  value={text}
                  onChange={(e) => setText(state.opt.numeric ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && close(true)}
                />
              ))}
            {err && <div className="mt-2 text-sm font-bold text-danger">{err}</div>}

            <div className={`mt-6 grid gap-2.5 ${state.kind === "alert" ? "grid-cols-1" : "grid-cols-2"}`}>
              {state.kind !== "alert" && (
                <button className="dlg-btn dlg-cancel" onClick={() => close(false)}>
                  CANCEL
                </button>
              )}
              <button className="dlg-btn dlg-ok" onClick={() => close(true)} autoFocus={state.kind !== "prompt"}>
                {okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useDialogs() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialogs must be inside DialogProvider");
  return c;
}
