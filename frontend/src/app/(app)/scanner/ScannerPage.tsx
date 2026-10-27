"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { api } from "@/lib/api";
import { hasThai, toEnglish } from "@/lib/thaiKeyboard";
import { AdjustModal } from "./AdjustModal";
import { DeductModal } from "./DeductModal";
import { DisplayModal } from "./DisplayModal";
import { HistoryModal } from "./HistoryModal";
import { ScopeModal } from "./ScopeModal";
import { CategoryPicker } from "../store/Toolbar";
import { StatusPill } from "./Pill";
import { qtyText, type ScanFormat, type ScannerContext, type ScanResult, type ScanRow, type Today } from "./types";
import { useLive } from "@/lib/live";

// 📷 MULTI-SCANNER (ScanInView + ScanInViewModel) - เงื่อนไขทั้งหมดอยู่ที่ API (ScanProcessor) หน้านี้ส่งบาร์โค้ด + โหมด แล้วแสดงผล
const SCOPE_KEY = "chr-scanner-scope"; // ฐานที่ยังไม่ให้ Admin กำหนดคลัง = จำคลังไว้ที่ Browser (แทนไฟล์ scanner_stock.txt)
const TURBO_MS = 120;
const MAX_WAIT_INCOMPLETE_MS = 1500;

type Modes = { out: boolean; return: boolean; remainder: boolean; test: boolean };
type Pending = { barcode: string; chosenStockId?: number; enteredQty?: number };

function readScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? "";
  } catch {
    return "";
  }
}

// ⌛ ป้ายยังมาไม่ครบ (ScanInViewModel.LooksIncomplete)
function looksIncomplete(raw: string, formats: ScanFormat[]) {
  const t = raw.trim();
  if (t.length < 3) return true;
  const split = (f: ScanFormat) => {
    let s = t;
    if (f.trimChars) {
      const chars = new Set(f.trimChars.split(""));
      let a = 0,
        b = s.length;
      while (a < b && chars.has(s[a])) a++;
      while (b > a && chars.has(s[b - 1])) b--;
      s = s.slice(a, b).trim();
    }
    return f.spaces ? s.split(/\s+/).filter(Boolean) : s.split(f.delimiter);
  };
  const withDelim = formats.filter((f) => !f.spaces && f.delimiter && t.includes(f.delimiter));
  if (withDelim.length === 0) return false;
  if (formats.some((f) => (f.spaces || (f.delimiter && t.includes(f.delimiter))) && split(f).length >= f.required)) return false;
  return withDelim.some((f) => split(f).length < f.minFields);
}

export default function ScannerPage() {
  const toast = useToast();
  const [ctx, setCtx] = useState<ScannerContext | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [modes, setModes] = useState<Modes>({ out: false, return: false, remainder: false, test: false });
  const [testRows, setTestRows] = useState<ScanRow[]>([]);
  const [last, setLast] = useState<ScanRow | null>(null);
  const [barcode, setBarcode] = useState("");
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [summaryStk, setSummaryStk] = useState<number | null>(null);
  const [choose, setChoose] = useState<{ result: ScanResult; pending: Pending } | null>(null);
  const [qtyAsk, setQtyAsk] = useState<{ result: ScanResult; pending: Pending } | null>(null);
  const [qtyValue, setQtyValue] = useState("");
  const [showScope, setShowScope] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [deductView, setDeductView] = useState<"deducted" | "not" | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const empRef = useRef<HTMLInputElement>(null);
  const deptRef = useRef<HTMLSelectElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChange = useRef(0);
  const lastScanAt = useRef(0);
  const modesRef = useRef(modes);
  const ctxRef = useRef(ctx);
  const sigRef = useRef<string | null>(null);
  useEffect(() => {
    modesRef.current = modes;
    ctxRef.current = ctx;
  }, [modes, ctx]);

  const focusScan = useCallback(() => setTimeout(() => inputRef.current?.focus(), 0), []);

  // 📌 LOCK SCAN: ช่องสแกนพร้อมรับตลอดเวลา (เปิดค้างไว้ จำค่าต่อเครื่อง)
  //   - กดปุ่ม / คลิกพื้นที่ว่างในหน้านี้เสร็จ = กลับมาที่ช่องสแกนเอง
  //   - ยิงเครื่องสแกนตอนเคอร์เซอร์ไม่ได้อยู่ในช่องไหน = ตัวอักษรเข้าช่องสแกนให้ (ไม่หายตัวแรก)
  //   - ไม่ยุ่งตอนพิมพ์ในช่องอื่น (EMPLOYEE / DEPARTMENT / ค้นหา) · ตอนเปิดหน้าต่าง / Dropdown / ปฏิทิน · ตอนลากเลือกข้อความ
  const [lockScan, setLockScan] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("scan-lock") === "0") queueMicrotask(() => setLockScan(false));
    } catch {
      /* ไม่มี storage = เปิดไว้ */
    }
  }, []);
  const toggleLock = () =>
    setLockScan((v) => {
      try {
        localStorage.setItem("scan-lock", v ? "0" : "1");
      } catch {
        /* ไม่จำก็ได้ */
      }
      if (!v) focusScan();
      return !v;
    });
  useEffect(() => {
    if (!lockScan) return;
    const editable = (el: Element | null) =>
      !!el && el !== inputRef.current && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);
    // มีหน้าต่าง / ป๊อปอัพเปิดอยู่ = ปล่อยให้ใช้งานหน้าต่างนั้น
    const busyUi = () => !!document.querySelector(".modal-bg, .dlg-bg, .menu-pop, [class*='is-open'], [aria-haspopup][aria-expanded='true']");
    const refocus = () => {
      const inp = inputRef.current;
      if (!inp || inp.disabled || document.hidden || busyUi() || editable(document.activeElement)) return;
      if (window.getSelection()?.toString()) return; // กำลังลากเลือกข้อความ
      if (document.activeElement !== inp) inp.focus({ preventScroll: true });
    };
    // คลิก / แตะเสร็จ -> รอปุ่มทำงาน (เปิดหน้าต่างก่อน) แล้วค่อยกลับช่องสแกน
    const up = () => setTimeout(refocus, 250);
    // ยิงสแกนตอนโฟกัสอยู่ที่ปุ่ม / พื้นที่ว่าง -> พาตัวอักษรเข้าช่องสแกน
    const key = (e: KeyboardEvent) => {
      const inp = inputRef.current;
      if (!inp || inp.disabled || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (e.key === " " && document.activeElement instanceof HTMLButtonElement) return; // Space = กดปุ่มด้วยคีย์บอร์ด
      if (document.activeElement === inp || editable(document.activeElement) || busyUi()) return;
      e.preventDefault();
      inp.focus({ preventScroll: true });
      onBarcodeChangeRef.current(inp.value + e.key);
    };
    // ช่องสแกนหลุดโฟกัสไปที่ปุ่ม / พื้นหลัง (เช่นแท็บกลับมา) -> กลับมาเอง
    const out = () => setTimeout(refocus, 400);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("focus", out);
    const inp = inputRef.current;
    inp?.addEventListener("blur", out);
    const t = setInterval(refocus, 1500);
    return () => {
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("focus", out);
      inp?.removeEventListener("blur", out);
      clearInterval(t);
    };
  }, [lockScan]);

  // ---------------------------------------------------------------- โหลดข้อมูล
  const loadContext = useCallback(async (m?: Modes) => {
    const mm = m ?? modesRef.current;
    const c = await api<ScannerContext>("/scanner/context", { query: { scope: readScope(), ...mm } });
    setCtx(c);
    setModes((cur) => {
      const next = { out: c.modes.out, return: c.modes.return, remainder: c.modes.remainder, test: c.modes.test };
      return cur.out === next.out && cur.return === next.return && cur.remainder === next.remainder && cur.test === next.test ? cur : next;
    });
    if (c.who.askDepartment) setDepartment((d) => (d && !c.who.departments.includes(d) ? "" : d));
    return c;
  }, []);

  const loadToday = useCallback(async (onlyIfChanged: boolean) => {
    const t = await api<Today>("/scanner/today", { query: { scope: readScope() } });
    if (onlyIfChanged && t.signature === sigRef.current) return;
    sigRef.current = t.signature;
    setToday(t);
  }, []);

  useEffect(() => {
    loadContext()
      .then(() => loadToday(false))
      .catch((e) => toast.show("ERROR", "ไม่สามารถโหลดรายชื่อคลังสำหรับแสกนได้\n" + e.message, "error"));
    focusScan();
  }, [loadContext, loadToday, focusScan, toast]);

  // 🔄 เรียลไทม์: ทุก 3 วินาทีดึงรายการวันนี้ (ไม่ดึงระหว่าง TEST MODE หรือภายใน 3 วินาทีหลังสแกน) + Admin เปลี่ยนคลังให้ -> ใช้เลย
  //    (ทันทีเมื่อมีการบันทึกจากเครื่องไหนก็ได้ + เช็คเองทุก 10 วินาที)
  useLive(
    ["data"],
    async () => {
      if (Date.now() - lastScanAt.current < 1500) return;
      const before = ctxRef.current;
      const c = await loadContext();
      if (before && before.scope.notAssigned && !c.scope.notAssigned) toast.show("MULTI-SCANNER", "Admin กำหนดคลังสแกนให้แล้ว ใช้งานได้เลย", "ok");
      if (!modesRef.current.test && !c.scope.notAssigned) await loadToday(true);
    },
    10000,
  );

  // 🎯 ตัวอักษรที่ยิงเข้ามาตอนโฟกัสไม่อยู่ในช่องพิมพ์ใด ๆ -> ส่งเข้าช่องสแกน (ป้ายไม่ขาดหัว)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      if (document.querySelector('[role="dialog"]')) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);

  // ---------------------------------------------------------------- สแกน
  function handle(r: ScanResult, p: Pending) {
    switch (r.kind) {
      case "Saved":
      case "SavedWarning":
      case "Test":
        if (r.item) {
          setLast(r.item);
          if (r.kind === "Test") setTestRows((l) => [r.item!, ...l].slice(0, 12));
          else {
            setToday((t) => (t ? { ...t, rows: [r.item!, ...t.rows] } : t));
            loadToday(false).catch(() => {});
          }
        }
        if (r.kind === "SavedWarning") toast.show(r.title ?? "WARNING", r.message ?? "", "warn");
        if (r.toastTitle) toast.show(r.toastTitle, r.toastMessage ?? "", r.toastOk ? "ok" : "warn");
        break;
      case "Error":
        toast.show(r.title ?? "ERROR", r.message ?? "", "error");
        break;
      case "Warning":
      case "Denied":
        toast.show(r.title ?? "WARNING", r.message ?? "", "warn");
        if (r.focus === "employee") setTimeout(() => empRef.current?.focus(), 0);
        if (r.focus === "department") setTimeout(() => deptRef.current?.focus(), 0);
        if (r.focus) return;
        break;
      case "Held":
        toast.show(r.title ?? "NOT DEDUCTED", r.message ?? "", "warn");
        break;
      case "Locked":
        setLocked(r.message ?? "");
        loadContext().catch(() => {});
        break;
      case "NeedStock":
        setChoose({ result: r, pending: p });
        return;
      case "NeedQty":
        setQtyValue("");
        setQtyAsk({ result: r, pending: { ...p, chosenStockId: p.chosenStockId ?? r.candidates?.[0]?.stkId } });
        return;
    }
    if (r.refreshDeduct) loadContext().catch(() => {});
    focusScan();
  }

  async function send(p: Pending) {
    const c = ctxRef.current;
    if (!c) return;
    if (c.scope.notAssigned) {
      setLocked(c.contacts);
      return;
    }
    lastScanAt.current = Date.now();
    setBusy(true);
    try {
      const r = await api<ScanResult>("/scanner/scan", {
        method: "POST",
        body: { ...p, ...modesRef.current, employeeId: employee, department, clientScope: readScope() },
      });
      handle(r, p);
    } catch (e) {
      toast.show("ERROR", "เกิดข้อผิดพลาด: " + (e as Error).message, "error");
    } finally {
      setBusy(false);
      lastScanAt.current = Date.now();
    }
  }

  function commit(raw: string) {
    if (timer.current) clearTimeout(timer.current);
    setBarcode("");
    if (raw.trim()) send({ barcode: raw });
  }

  const onBarcodeChangeRef = useRef<(v: string) => void>(() => {});
  useEffect(() => {
    onBarcodeChangeRef.current = onBarcodeChange;
  });
  function onBarcodeChange(v: string) {
    if (v && hasThai(v)) v = toEnglish(v);
    setBarcode(v);
    if (!v) return;
    // ✨ ป้ายที่ลงท้ายด้วย "piece" (เช่น StorePC) -> ตัดรอบทันที
    if (v.trimEnd().toLowerCase().endsWith("piece")) return commit(v);
    lastChange.current = Date.now();
    if (timer.current) clearTimeout(timer.current);
    const tick = () => {
      const cur = inputRef.current?.value ?? "";
      if (!cur.trim()) return;
      if (Date.now() - lastChange.current < MAX_WAIT_INCOMPLETE_MS && looksIncomplete(cur, ctxRef.current?.formats ?? [])) {
        timer.current = setTimeout(tick, 150);
        return;
      }
      commit(cur);
    };
    timer.current = setTimeout(tick, TURBO_MS);
  }

  // ---------------------------------------------------------------- โหมด (กฎเดียวกับ setter ใน ViewModel)
  function toggle(key: keyof Modes) {
    const m = { ...modes };
    if (key === "out") {
      if (m.out && ctx?.modes.outOnly) return;
      m.out = !m.out;
      if (m.out) m.return = false;
    } else if (key === "return") {
      m.return = !m.return;
      if (m.return) {
        m.out = ctx?.modes.outOnly ? m.out : false;
        m.remainder = false;
      }
    } else if (key === "remainder") {
      m.remainder = !m.remainder;
      if (m.remainder) m.return = false;
    } else m.test = !m.test;
    setModes(m);
    if (key === "test" && !m.test) setTestRows([]);
    loadContext(m).catch(() => {});
    focusScan();
  }

  // ---------------------------------------------------------------- แสดงผล
  const modeStatus = modes.out ? "OUT" : modes.return ? "RETURN" : "IN";
  const rows = useMemo(
    () => (today?.rows ?? []).filter((r) => r.status === modeStatus || (r.isDeductOut && modeStatus === "IN")),
    [today, modeStatus],
  );
  const scopeStocks = useMemo(
    () => (ctx ? (ctx.scope.auto ? ctx.stocks : ctx.stocks.filter((s) => ctx.scope.ids.includes(s.stkId))) : []),
    [ctx],
  );
  const summary = useMemo(() => (today?.summary ?? []).filter((s) => summaryStk == null || s.stkId === summaryStk), [today, summaryStk]);
  const multi = !!ctx?.scope.isMulti;
  const notAssigned = !!ctx?.scope.notAssigned;
  // สีประจำโหมด (ช่องสแกน / ป้ายโหมด / ตัวเลข QTY) + ชื่อโหมดบนหัว
  const tone = modes.test ? "var(--warning)" : modes.out ? "var(--scanout)" : modes.return ? "var(--return)" : modes.remainder ? "var(--teal)" : "var(--success)";
  const modeLabel = modes.test ? "TEST" : modes.out ? "OUT" : modes.return ? "RETURN" : modes.remainder ? "REMAINDER" : "IN";
  const codeHeader = ctx?.codeHeader ?? "PRODUCT CODE";

  if (!ctx) return <div className="grid h-full place-items-center text-ink-soft">⏳ LOADING...</div>;

  return (
    <div className="sc-page mx-auto flex max-w-[1800px] flex-col gap-4 p-3 md:p-5" style={{ "--tone": tone } as React.CSSProperties}>
      {/* หัวหน้า + ปุ่มโหมด / เครื่องมือ */}
      <section className="sc-card sc-in relative z-20 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="sc-logo grid size-12 shrink-0 place-items-center rounded-[16px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/MultiScanner.png" alt="" className="size-7 object-contain brightness-0 invert" />
          </span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight text-primary md:text-2xl">
              MULTI-SCANNER
              <span key={modeLabel} className="sc-chip">
                <span className="sc-dot" />
                {modeLabel}
              </span>
            </h2>
            <div className="mt-0.5 text-[12px] font-semibold text-ink-soft">ยิงบาร์โค้ด / QR เพื่อรับเข้า · จ่ายออก · คืน — ยอดคลังอัพเดททันทีทุกจอ</div>
          </div>
          <div className="sc-tools ml-auto flex flex-wrap gap-2">
            {ctx.buttons.scanOut && (
              <ModeBtn color="var(--scanout)" on={modes.out} icon="out" onClick={() => toggle("out")} disabled={notAssigned || (modes.out && ctx.modes.outOnly)}>
                {modes.out ? "CANCEL SCAN OUT" : "SCAN OUT"}
              </ModeBtn>
            )}
            {ctx.buttons.return && (
              <ModeBtn color="var(--return)" on={modes.return} icon="return" onClick={() => toggle("return")} disabled={notAssigned}>
                {modes.return ? "CANCEL RETURN" : "RETURN"}
              </ModeBtn>
            )}
            {ctx.buttons.remainder && (
              <ModeBtn color="var(--teal)" on={modes.remainder} icon="remainder" onClick={() => toggle("remainder")} disabled={notAssigned}>
                {modes.remainder ? "CANCEL REMAINDER" : "REMAINDER"}
              </ModeBtn>
            )}
            <ModeBtn color="var(--warning)" on={modes.test} icon="test" onClick={() => toggle("test")} disabled={notAssigned}>
              {modes.test ? "EXIT TEST" : "TEST MODE"}
            </ModeBtn>
            <span className="sc-sep hidden self-stretch sm:block" aria-hidden />
            <ToolBtn color="var(--info)" icon="history" onClick={() => setShowHistory(true)} disabled={notAssigned}>
              HISTORY
            </ToolBtn>
            {ctx.buttons.display && (
              <ToolBtn color="var(--accent)" icon="display" onClick={() => setShowDisplay(true)} disabled={notAssigned}>
                DISPLAY
              </ToolBtn>
            )}
            {ctx.buttons.deducted && (
              <ToolBtn color="var(--success)" icon="deducted" title="ป้ายที่รับเข้าแล้วตัดคลังต้นทางได้ วันนี้" count={ctx.counts.deductedToday} onClick={() => setDeductView("deducted")} disabled={notAssigned}>
                DEDUCTED
              </ToolBtn>
            )}
            {ctx.buttons.notDeducted && (
              <ToolBtn color="var(--danger)" icon="not" title="ป้ายที่ยังไม่รับเข้า รอผู้มีสิทธิ์ APPROVE" count={ctx.counts.notDeducted} alert={ctx.counts.notDeducted > 0} onClick={() => setDeductView("not")} disabled={notAssigned}>
                NOT DEDUCTED
              </ToolBtn>
            )}
            {ctx.buttons.adjust && (
              <ToolBtn color="var(--primary)" icon="adjust" onClick={() => setShowAdjust(true)} disabled={notAssigned}>
                ADJUST SCAN
              </ToolBtn>
            )}
          </div>
        </div>

        {/* แถบโหมดที่เปิดอยู่ (เลื่อนลงมา) */}
        <div className="mt-3 flex flex-col gap-2 empty:hidden">
          {modes.test && <Banner color="var(--warning)" icon="test">TEST MODE ACTIVE (NOT SAVED) — ทดลองสแกน ไม่บันทึกยอด</Banner>}
          {modes.out && <Banner color="var(--scanout)" icon="out">SCAN OUT MODE — ตัดสต็อกออก</Banner>}
          {modes.return && <Banner color="var(--return)" icon="return">RETURN MODE — คืนเหล็กเข้าคลัง (กรอกจำนวนเอง)</Banner>}
          {modes.remainder && <Banner color="var(--teal)" icon="remainder">REMAINDER MODE — กรอกจำนวนเศษเอง ไม่นับกล่อง</Banner>}
          {notAssigned && <Banner color="var(--danger)" icon="not">ยังไม่ได้เลือกคลังของ UserID นี้ กรุณาติดต่อ Admin</Banner>}
        </div>

        {/* ช่องสแกน + EMPLOYEE / DEPARTMENT + STOCK */}
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-2">
              <label className="sc-label">SCAN BARCODE</label>
              <button
                type="button"
                className={`sc-lock ${lockScan ? "is-on" : ""}`}
                onClick={toggleLock}
                aria-pressed={lockScan}
                title={lockScan ? "ช่องสแกนพร้อมรับตลอดเวลา (คลิก = ปิด)" : "เปิดให้ช่องสแกนพร้อมรับตลอดเวลา"}
              >
                {lockScan ? "📌 ALWAYS READY" : "📌 OFF"}
              </button>
            </div>
            <div className={`sc-scan ${busy ? "is-busy" : ""} ${notAssigned ? "is-off" : ""}`}>
              <svg viewBox="0 0 24 24" className="sc-scan-ic" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
              </svg>
              <input
                ref={inputRef}
                value={barcode}
                disabled={notAssigned}
                autoComplete="off"
                spellCheck={false}
                inputMode="none"
                placeholder={busy ? "กำลังบันทึก..." : "ยิงบาร์โค้ด / QR ที่นี่"}
                onChange={(e) => onBarcodeChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    commit(e.currentTarget.value);
                  }
                }}
                className="sc-scan-input"
              />
              <span className="sc-ready">
                <span className="sc-dot" />
                {busy ? "SAVING" : notAssigned ? "LOCKED" : "READY"}
              </span>
            </div>
          </div>
          {ctx.who.askEmployee && (
            <div className="lg:col-span-2">
              <label className="sc-label">
                EMPLOYEE ID <span className="font-semibold normal-case text-accent">{ctx.who.employeeHint}</span>
              </label>
              <input
                ref={empRef}
                value={employee}
                maxLength={30}
                onChange={(e) => setEmployee(e.target.value)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Tab") && (e.preventDefault(), focusScan())}
                className="field !h-14 !text-lg"
              />
            </div>
          )}
          {ctx.who.askDepartment && (
            <div className="lg:col-span-2">
              <label className="sc-label">
                DEPARTMENT <span className="font-semibold normal-case text-accent">{ctx.who.departmentHint}</span>
              </label>
              <select ref={deptRef} value={department} onChange={(e) => (setDepartment(e.target.value), focusScan())} className="field !h-14 !text-base">
                <option value="">-- เลือกแผนก --</option>
                {ctx.who.departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <div className={ctx.who.askEmployee && ctx.who.askDepartment ? "lg:col-span-3" : ctx.who.askEmployee || ctx.who.askDepartment ? "lg:col-span-5" : "lg:col-span-7"}>
            <label className="sc-label">STOCK</label>
            <button
              onClick={() => (notAssigned ? setLocked(ctx.contacts) : ctx.scope.canChange ? setShowScope(true) : null)}
              title={notAssigned ? "ยังไม่ได้กำหนดคลังสแกน กรุณาติดต่อ Admin" : ctx.scope.assignMode && !ctx.scope.canChange ? "Stocks are set by the Admin (User Management)" : "Choose the stocks to scan"}
              className={`sc-stock ${notAssigned ? "is-off" : ""} ${ctx.scope.canChange || notAssigned ? "is-click" : ""}`}
            >
              <span className="sc-stock-ic">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 9.5 12 4l9 5.5V20H3z" />
                  <path d="M7 20v-6h10v6M7 17h10" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="max-w-full truncate text-base font-extrabold">{ctx.scope.text}</span>
                {ctx.scope.subText && <span className="max-w-full truncate text-[11px] font-semibold opacity-75">{ctx.scope.subText}</span>}
              </span>
              {(ctx.scope.canChange || notAssigned) && (
                <svg viewBox="0 0 24 24" className="sc-stock-chev size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m9 6 6 6-6 6" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* รายการล่าสุด (สแกนใหม่ = การ์ดเด้ง + แสงวาบ) */}
      <section key={last?.time ?? "none"} className={`sc-card sc-last grid grid-cols-1 gap-4 p-4 sm:grid-cols-[150px_1fr] md:grid-cols-[180px_1fr_220px] ${last ? "has-scan" : ""}`}>
        <div className="sc-photo grid aspect-square place-items-center overflow-hidden rounded-2xl max-sm:mx-auto max-sm:w-40">
          {last?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={last.imageUrl} alt="" className="h-full w-full object-contain p-2" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <svg viewBox="0 0 24 24" className="size-12 text-[#cfcbe0]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          )}
        </div>
        <div className="min-w-0 self-center">
          <div className="sc-label">{codeHeader}</div>
          <div className="break-all text-2xl font-extrabold text-primary md:text-4xl">{last?.code || "-"}</div>
          <div className="sc-label mt-3">PART DESCRIPTION</div>
          <div className="text-base font-bold text-ink md:text-lg">{last?.partName || "-"}</div>
          {last && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {last.stockCode && <span className="sc-tag">🏬 {last.stockCode}</span>}
              <StatusPill status={last.status} deduct={last.isDeductOut} />
              <span className="text-[11px] font-bold text-ink-soft">{new Date(last.time).toLocaleTimeString("th-TH")}</span>
            </div>
          )}
        </div>
        <div className="sc-qty flex flex-col items-center justify-center rounded-2xl p-3 sm:col-span-2 md:col-span-1">
          <div className="sc-label !mb-0">{modes.out ? "QTY OUT" : "QTY IN"}</div>
          <div className="sc-qty-num text-5xl font-extrabold tabular-nums md:text-6xl">{last ? qtyText(last.qty) : "0"}</div>
        </div>
      </section>

      {/* ตารางวันนี้ + สรุป */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={`sc-card sc-in overflow-hidden ${modes.test ? "is-test" : ""}`} style={{ animationDelay: "80ms" }}>
          <div className="sc-tbl-head flex items-center justify-between gap-2 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
              <span className="sc-tbl-ic">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8" />
                </svg>
              </span>
              {modes.test ? "TEST SCAN RESULT (NOT SAVED)" : "DAILY SCAN ( IN / OUT )"}
            </h3>
            <span className="sc-count">{(modes.test ? testRows : rows).length.toLocaleString()} รายการ</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="data-table t-center w-full">
              <thead className="sticky top-0 z-[1]">
                <tr>
                  <th>{codeHeader}</th>
                  <th>QTY</th>
                  <th>STATUS</th>
                  <th>DATETIME</th>
                </tr>
              </thead>
              <tbody>
                {(modes.test ? testRows : rows).map((r, i) => (
                  <tr key={`${r.time}-${r.code}-${i}`} className="sc-row">
                    <td>
                      <div className="break-all font-extrabold text-primary">{r.code}</div>
                      {multi && <div className="text-[11px] font-bold text-accent">{r.stockCode}</div>}
                      <div className="text-[11px] font-medium text-ink-soft">{r.partName}</div>
                    </td>
                    <td className="text-right text-base font-extrabold tabular-nums">{qtyText(r.qty)}</td>
                    <td>
                      <StatusPill status={r.status} deduct={r.isDeductOut} />
                    </td>
                    <td className="whitespace-nowrap text-xs font-bold text-ink-soft">{new Date(r.time).toLocaleTimeString("th-TH")}</td>
                  </tr>
                ))}
                {(modes.test ? testRows : rows).length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyRow />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sc-card sc-in overflow-hidden" style={{ animationDelay: "140ms" }}>
          <div className="sc-tbl-head flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
              <span className="sc-tbl-ic">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
                </svg>
              </span>
              Daily Stock Movement Summary
            </h3>
            {multi && scopeStocks.length > 1 && (
              <CategoryPicker
                label="STOCK"
                allLabel="ALL STOCKS"
                options={scopeStocks.map((s) => s.code)}
                value={scopeStocks.find((s) => s.stkId === summaryStk)?.code ?? ""}
                onChange={(code) => setSummaryStk(scopeStocks.find((s) => s.code === code)?.stkId ?? null)}
              />
            )}
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="data-table t-center w-full">
              <thead className="sticky top-0 z-[1]">
                <tr>
                  <th>{summaryStk != null ? ctx.stocks.find((s) => s.stkId === summaryStk)?.codeHeader : codeHeader}</th>
                  <th>IN (FREQ.)</th>
                  <th>OUT (FREQ.)</th>
                  <th>IN (QTY)</th>
                  <th>OUT (QTY)</th>
                  <th>INVENTORY BALANCE</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={`${s.stkId}-${s.partId}-${s.partCode}`}>
                    <td>
                      <div className="break-all font-extrabold text-primary">{s.code}</div>
                      {multi && <div className="text-[11px] font-bold text-accent">{s.stockCode}</div>}
                    </td>
                    <td className="text-right tabular-nums">{s.inCount}</td>
                    <td className="text-right tabular-nums">{s.outCount}</td>
                    <td className="text-right font-extrabold tabular-nums text-success">{qtyText(s.totalInQty)}</td>
                    <td className="text-right font-extrabold tabular-nums text-danger">{qtyText(s.totalOutQty)}</td>
                    <td className="text-right text-base font-extrabold tabular-nums text-primary">{qtyText(s.finalStock)}</td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyRow />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 🏬 เลือกคลังตอนสินค้าอยู่หลายคลัง (StockPickerWindow.ShowChoose) */}
      <Modal open={!!choose} title={choose?.result.title ?? ""} onClose={() => (setChoose(null), focusScan())}>
        <p className="mb-4 whitespace-pre-line text-sm font-semibold">{choose?.result.message}</p>
        <div className="grid gap-2">
          {choose?.result.candidates?.map((c) => (
            <button
              key={c.stkId}
              className="flex items-center justify-between rounded-xl border-2 border-line p-4 text-left hover:border-accent hover:bg-surface-2"
              onClick={() => {
                const p = { ...choose.pending, chosenStockId: c.stkId };
                setChoose(null);
                send(p);
              }}
            >
              <span className="text-lg font-extrabold text-primary">{c.code}</span>
              <span className="text-sm text-ink-soft">{c.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* 🔢 กรอกจำนวน (เศษ / คืนเหล็ก) */}
      <Modal
        open={!!qtyAsk}
        title={qtyAsk?.result.title ?? ""}
        onClose={() => (setQtyAsk(null), focusScan())}
        footer={
          <>
            <button className="btn-ghost" onClick={() => (setQtyAsk(null), focusScan())}>
              CANCEL
            </button>
            <button className="btn bg-success" form="qty-form">
              CONFIRM
            </button>
          </>
        }
      >
        <form
          id="qty-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(qtyValue);
            if (!Number.isFinite(v) || v <= 0) return toast.show("WARNING", "กรุณากรอกจำนวนที่มากกว่า 0", "warn");
            if (!qtyAsk!.result.qtyDecimal && !Number.isInteger(v)) return toast.show("WARNING", "คลังนี้กรอกได้เฉพาะจำนวนเต็ม", "warn");
            const p = { ...qtyAsk!.pending, enteredQty: v };
            setQtyAsk(null);
            send(p);
          }}
        >
          <p className="mb-4 whitespace-pre-line text-sm font-semibold">{qtyAsk?.result.message}</p>
          <input
            autoFocus
            className="field !h-14 !text-center !text-2xl"
            inputMode="decimal"
            value={qtyValue}
            onChange={(e) => setQtyValue(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </form>
      </Modal>

      {/* ⛔ ยังไม่ได้กำหนดคลังสแกน */}
      <Modal open={locked !== null} title="NO SCAN STOCK" onClose={() => setLocked(null)}>
        <p className="whitespace-pre-line text-sm font-semibold">{locked || "ยังไม่ได้กำหนดคลังสแกน กรุณาติดต่อ Admin"}</p>
      </Modal>

      {showScope && (
        <ScopeModal
          ctx={ctx}
          onClose={() => (setShowScope(false), focusScan())}
          onSaved={async (serialized) => {
            try {
              localStorage.setItem(SCOPE_KEY, serialized);
            } catch {}
            setShowScope(false);
            await loadContext();
            sigRef.current = null;
            await loadToday(false);
            focusScan();
          }}
        />
      )}
      {showDisplay && (
        <DisplayModal
          onClose={() => (setShowDisplay(false), focusScan())}
          onSaved={async () => {
            setShowDisplay(false);
            await loadContext();
            sigRef.current = null;
            await loadToday(false);
            focusScan();
          }}
        />
      )}
      {showHistory && <HistoryModal onClose={() => (setShowHistory(false), focusScan())} />}
      {deductView && (
        <DeductModal
          deducted={deductView === "deducted"}
          onClose={() => (setDeductView(null), focusScan())}
          onChanged={() => {
            loadContext().catch(() => {});
            sigRef.current = null;
            loadToday(false).catch(() => {});
          }}
        />
      )}
      {showAdjust && (
        <AdjustModal
          onClose={() => (setShowAdjust(false), focusScan())}
          onChanged={() => {
            sigRef.current = null;
            loadToday(false).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

type Ic = "out" | "return" | "remainder" | "test" | "history" | "display" | "deducted" | "not" | "adjust";
const ICON: Record<Ic, React.ReactNode> = {
  out: <path d="M12 15V3m0 0L7 8m5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />,
  return: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  remainder: <path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" />,
  test: <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  display: <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" />,
  deducted: <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" />,
  not: <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />,
  adjust: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
};
function Svg({ icon, className = "size-4" }: { icon: Ic; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[icon]}
    </svg>
  );
}

// ปุ่มโหมด (SCAN OUT / RETURN / REMAINDER / TEST): ปิด = ขอบสี · เปิด = พื้นสีเต็ม + แสง + จุดกะพริบ
function ModeBtn({ color, on, icon, children, ...rest }: { color: string; on: boolean; icon: Ic; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`sc-mode ${on ? "is-on" : ""}`} style={{ "--c": color } as React.CSSProperties} aria-pressed={on} {...rest}>
      <Svg icon={icon} />
      {children}
      {on && <span className="sc-dot" />}
    </button>
  );
}

// ปุ่มเครื่องมือ (HISTORY / DISPLAY / DEDUCTED / NOT DEDUCTED / ADJUST): ปุ่มขาว ไอคอนสี · count = ป้ายจำนวน (alert = กะพริบเตือน)
function ToolBtn({ color, icon, count, alert, children, ...rest }: { color: string; icon: Ic; count?: number; alert?: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="sc-tool" style={{ "--c": color } as React.CSSProperties} {...rest}>
      <span className="sc-tool-ic">
        <Svg icon={icon} />
      </span>
      {children}
      {count !== undefined && <span className={`sc-badge ${alert ? "is-alert" : ""}`}>{count.toLocaleString()}</span>}
    </button>
  );
}

function EmptyRow() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-ink-soft">
      <svg viewBox="0 0 24 24" className="size-9 text-[#d4d0e2]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8" />
      </svg>
      <span className="text-sm font-bold">ยังไม่มีรายการ</span>
    </div>
  );
}

function Banner({ color, icon, children }: { color: string; icon: Ic; children: React.ReactNode }) {
  return (
    <div className="sc-banner" style={{ "--c": color } as React.CSSProperties}>
      <span className="sc-banner-ic">
        <Svg icon={icon} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      <span className="sc-dot" />
    </div>
  );
}
