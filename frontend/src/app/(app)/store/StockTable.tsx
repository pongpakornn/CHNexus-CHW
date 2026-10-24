"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, PageBody, PageHeader } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { StatCards, type CoilSum } from "./StatCards";
import { ShowCards } from "./ShowCards";
import { StatusLamp } from "./StatusLamp";
import { CategoryPicker, SearchField } from "./Toolbar";
import { STATUS_COLOR, type Counts, type Product, type Stock } from "./types";

type Meta = {
  stock: Stock;
  columns: string[];
  coilRowOrder: string[];
  coilSum: CoilSum;
  allLabel: string;
  groupLabel: string;
  categories: string[];
  counts: Counts;
  canEdit: boolean;
  canImport: boolean;
  hasCoilRegister: boolean;
};
type CoilRow = { coilId: number; partId: number; isMother: boolean; no: string; coilNo: string; motherCoil: string; weight: string; ton: string; received: string };
type Field = "max" | "min" | "qty" | "stockBox" | "stockPcs" | "remark";
type Live = { stock: boolean; settings?: string; structure?: string | null; coils?: string | null };

const PAGE = 100;
const MAX_SPEED = 200;

// ค่าที่จำไว้ในเครื่องนี้ (UiPrefs ของ WPF): SHOW CARD / SHOW COILS ต่อคลัง + ความเร็ว
const pref = {
  get(key: string, def: string) {
    try {
      return localStorage.getItem("store." + key) ?? def;
    } catch {
      return def;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem("store." + key, v);
    } catch {
      /* ไม่มีที่เก็บ = ไม่จำ */
    }
  },
};

// 📋 ตารางของคลัง (StoreMaxMinView): กรองสถานะ / กลุ่ม / ค้นหา, แก้ในตาราง, แถว Coil, Import / Export, SHOW PRODUCTION / SHOW CARD / SHOW COILS
//   คอลัมน์ = ที่คลังเปิดไว้ (ADD / EDIT STOCK) เรียงตามลำดับที่ติ๊ก + STATUS ท้ายสุด (คลังที่ใช้ MAX-MIN)
export function StockTable({ stkId, onBack, initialFilter = "" }: { stkId: number; onBack: () => void; initialFilter?: string }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<Product[] | null>(null);
  const [more, setMore] = useState(true);
  const [key, setKey] = useState("");
  const [cat, setCat] = useState("");
  const [filter, setFilter] = useState(["OVER_MAX", "UNDER_MIN", "NO_ORDER"].includes(initialFilter) ? initialFilter : "");
  const [production, setProduction] = useState(false);
  const [cards, setCards] = useState(false);
  const [showCoils, setShowCoils] = useState(false);
  const [speed, setSpeed] = useState(() => Math.min(MAX_SPEED, Math.max(1, Number(pref.get("ShowSpeed", "12")) || 12)));
  const [speedText, setSpeedText] = useState(String(speed));
  const [coils, setCoils] = useState<Record<number, CoilRow[] | "loading">>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 500);
  const tokenRef = useRef<string | null>(null);
  const liveRef = useRef<Live | null>(null);
  const editingRef = useRef(false);
  const pauseUntil = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const verRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<Product[] | null>(null);
  const coilsRef = useRef(coils);
  const showCoilsRef = useRef(showCoils);
  useEffect(() => {
    rowsRef.current = rows;
    coilsRef.current = coils;
    showCoilsRef.current = showCoils;
  }, [rows, coils, showCoils]);

  const loadMeta = useCallback(async () => {
    try {
      const m = await api<Meta>(`/store/${stkId}`);
      setMeta(m);
      // SHOW CARD (ค่าเริ่มต้นเปิด) / SHOW COILS (ค่าเริ่มต้นปิด) ตามที่จำไว้ของคลังนี้
      setCards(m.stock.cardStyle !== "OFF" && pref.get("ShowCards." + m.stock.code, "1") === "1");
      setShowCoils(m.stock.showCoilRows && m.hasCoilRegister && !m.stock.isLiveView && pref.get("ShowCoils." + m.stock.code, "0") === "1");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      onBack();
    }
  }, [stkId, toast, onBack]);

  const query = useCallback(
    (skip: number, take: number) => api<{ token: string | null; rows: Product[] }>(`/store/${stkId}/products`, { query: { key: k, cat, filter, skip, take } }),
    [stkId, k, cat, filter],
  );

  // SHOW PRODUCTION / SHOW CARD = โหลดทุกรายการ (วนครบทั้งคลัง) · ปกติ = ทีละหน้า
  const loadAll = production || cards;

  // โหลดใหม่ทั้งชุด (keep = จำนวนแถวที่แสดงอยู่ ใช้ตอนเรียลไทม์โหลดโครงตารางใหม่)
  const reload = useCallback(
    async (keep = 0) => {
      const v = ++verRef.current;
      const take = loadAll ? 100000 : Math.max(PAGE, keep);
      try {
        const r = await query(0, take);
        if (v !== verRef.current) return;
        setRows(r.rows);
        setMore(!loadAll && r.rows.length >= take);
        tokenRef.current = r.token;
      } catch (e) {
        if (v === verRef.current) toast.show("ERROR", "โหลดข้อมูลคลังไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [query, loadAll, toast],
  );

  useEffect(() => {
    const t = setTimeout(loadMeta, 0);
    return () => clearTimeout(t);
  }, [loadMeta]);

  useEffect(() => {
    const t = setTimeout(() => reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // 🧲 Coil ทั้งคลังครั้งเดียว -> แถว Coil ที่เปิดอยู่อัพเดท / SHOW COILS เปิดให้ทุกสินค้าที่มี Coil
  const refreshCoils = useCallback(async () => {
    const open = Object.keys(coilsRef.current).map(Number);
    if (!showCoilsRef.current && open.length === 0) return;
    try {
      const all = await api<Record<string, CoilRow[]>>(`/store/${stkId}/coils`);
      setCoils((cur) => {
        const n: Record<number, CoilRow[] | "loading"> = {};
        for (const id of Object.keys(cur).map(Number)) n[id] = all[id] ?? [];
        if (showCoilsRef.current) for (const id of Object.keys(all)) n[Number(id)] = all[id];
        return n;
      });
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, [stkId]);

  useEffect(() => {
    if (!showCoils) return;
    const t = setTimeout(refreshCoils, 0);
    return () => clearTimeout(t);
  }, [showCoils, refreshCoils]);

  // เลื่อนถึงท้ายตาราง -> โหลดเพิ่ม
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || loadingMore.current || !rows) return;
      loadingMore.current = true;
      const v = verRef.current;
      try {
        const r = await query(rows.length, PAGE);
        if (v !== verRef.current) return;
        setRows((cur) => [...(cur ?? []), ...r.rows]);
        setMore(r.rows.length >= PAGE);
      } finally {
        loadingMore.current = false;
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, rows, query]);

  // ⚡ ตัวเลขล่าสุด (ยอด / MAX / MIN / REMARK / สถานะ) - ไม่ทับช่องที่กำลังแก้
  const pullNumbers = useCallback(async () => {
    const r = await api<{ token: string; changed: boolean; counts: Counts; coilSum: CoilSum; rows?: Partial<Product>[] }>(`/store/${stkId}/numbers`, {
      query: { token: tokenRef.current },
    });
    tokenRef.current = r.token;
    if (!r.changed || !r.rows) return;
    const map = new Map(r.rows.map((x) => [x.partId, x]));
    setRows((cur) => cur?.map((p) => (map.has(p.partId) ? { ...p, ...map.get(p.partId) } : p)) ?? cur);
    setMeta((m) => (m ? { ...m, counts: r.counts, coilSum: r.coilSum } : m));
  }, [stkId]);

  // ⚡ เรียลไทม์ทุก 3 วินาที: ตัวเลข + ตั้งค่าคลัง / โครงตาราง / ทะเบียน Coil (StoreMaxMinView.AttachLiveStructure)
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || editingRef.current || !rowsRef.current) return;
      try {
        await pullNumbers();
        const now = await api<Live>(`/store/${stkId}/live`);
        const was = liveRef.current;
        liveRef.current = now;
        if (!now.stock) return onBack(); // คลังถูกลบ -> กลับหน้าการ์ดคลัง
        if (!was) return;
        if (now.settings !== was.settings) {
          await loadMeta(); // ตั้งค่าคลังเปลี่ยน -> ใช้ค่าล่าสุด (คอลัมน์ / หน่วย / ชื่อ ...)
          await reload(rowsRef.current?.length ?? 0);
        } else if (now.structure !== was.structure && !editingRef.current) await reload(rowsRef.current?.length ?? 0);
        if (now.coils !== was.coils) await refreshCoils();
      } catch {
        /* รอบหน้าลองใหม่ */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [stkId, pullNumbers, loadMeta, reload, refreshCoils, onBack]);

  // 🔁 SHOW PRODUCTION: เลื่อนตารางขึ้นวนไปเรื่อย ๆ แบบป้ายโฆษณา (ไม่กระโดดกลับบนสุด - แถวที่พ้นด้านบนต่อท้ายใหม่)
  //    หยุดชั่วคราว 5 วินาทีเมื่อผู้ใช้เลื่อน / คลิกตาราง และระหว่างแก้ไขช่อง · ตารางสั้นกว่าหน้าจอ = ไม่เลื่อน
  useEffect(() => {
    if (!production) return;
    let raf = 0;
    let last = performance.now();
    let pos = -1;
    const el = scrollRef.current;
    const touch = () => (pauseUntil.current = performance.now() + 5000);
    el?.addEventListener("wheel", touch, { passive: true });
    el?.addEventListener("pointerdown", touch);
    const step = (now: number) => {
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      const body = bodyRef.current;
      if (el && body) {
        const h = body.offsetHeight;
        const head = (body.previousElementSibling as HTMLElement | null)?.offsetHeight ?? 0;
        const shouldLoop = h + head > el.clientHeight;
        setLoop((cur) => (cur === shouldLoop ? cur : shouldLoop));
        if (shouldLoop && !editingRef.current && now > pauseUntil.current) {
          if (pos < 0 || Math.abs(el.scrollTop - pos) > 2) pos = el.scrollTop; // ผู้ใช้เลื่อนเอง -> ต่อจากตรงนั้น
          pos += speed * dt;
          if (pos >= h) pos -= h;
          el.scrollTop = pos;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener("wheel", touch);
      el?.removeEventListener("pointerdown", touch);
    };
  }, [production, speed]);

  const groups = useMemo(() => {
    const g: { key: string; items: Product[] }[] = [];
    for (const p of rows ?? []) {
      const gk = p.groupKey || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(p);
      else g.push({ key: gk, items: [p] });
    }
    return g;
  }, [rows]);

  if (!meta) return <Loading />;
  const s = meta.stock;
  const cols = meta.columns;
  const coilKeys = ["NO", ...meta.coilRowOrder];
  const header = (c: string) =>
    ({ NO: "NO.", IMAGE: "IMAGE", CUSTOMER: "CUSTOMER", CODE: "PD CODE", PARTA: "PART A", PARTB: "PART B", PARTNO: "PART NO", MODEL: "MODEL", NAME: "PRODUCT NAME", QTY: s.qtyHeader, BOX: s.boxHeader, PCS: "STOCK (PCS)", REMARK: "REMARK", STATUS: "STATUS" })[c] ?? c;
  const width = cols.reduce((a, c) => a + (c === "MAXMIN" ? 2 : 1), 0);
  const coilsOn = s.showCoilRows && meta.hasCoilRegister;

  async function save(p: Product, field: Field, value: string) {
    const original = { partCode: p.partCode, remark: p.remark, max: p.max, min: p.min, qty: p.qty, stockBox: p.stockBox, stockPcs: p.stockPcs };
    if ((original[field] ?? "") === value) return;
    const next = { ...original, [field]: value };
    setRows((cur) => cur?.map((x) => (x.partId === p.partId ? { ...x, [field]: value } : x)) ?? cur);
    editingRef.current = true; // ระหว่างบันทึก รอบเรียลไทม์ไม่ดึงค่ามาทับ
    try {
      await api(`/store/${stkId}/products/${p.partId}`, { method: "PUT", body: { ...next, original } });
      editingRef.current = false;
      tokenRef.current = null; // แก้ BOX / PCS แล้วอีกค่าคำนวณใหม่ใน SQL -> ดึงยอดล่าสุดมาแสดงทันที
      await pullNumbers().catch(() => undefined);
    } catch (e) {
      toast.show("ERROR", "ไม่สามารถบันทึกข้อมูลได้\n" + (e as Error).message, "error");
      reload(rowsRef.current?.length ?? 0);
    } finally {
      editingRef.current = false;
    }
  }

  // คลังที่นับ Coil: กด PD CODE -> เปิด / ปิด Master Coil / Coil ลูก ใต้แถวสินค้านั้น
  async function toggleCoils(p: Product) {
    if (!coilsOn) return;
    if (coils[p.partId]) {
      setCoils((c) => {
        const n = { ...c };
        delete n[p.partId];
        return n;
      });
      return;
    }
    setCoils((c) => ({ ...c, [p.partId]: "loading" }));
    try {
      const r = await api<CoilRow[]>(`/store/${stkId}/coils/${p.partId}`);
      setCoils((c) => ({ ...c, [p.partId]: r }));
    } catch (e) {
      setCoils((c) => {
        const n = { ...c };
        delete n[p.partId];
        return n;
      });
      toast.show("COIL", "โหลดรายการ Coil ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  function toggleShowCoils(on: boolean) {
    setShowCoils(on);
    pref.set("ShowCoils." + s.code, on ? "1" : "0");
    if (!on) setCoils({});
  }

  function toggleCards(on: boolean) {
    setCards(on);
    pref.set("ShowCards." + s.code, on ? "1" : "0");
  }

  function toggleProduction(on: boolean) {
    pauseUntil.current = 0;
    setProduction(on);
    if (!on && scrollRef.current) scrollRef.current.scrollTop = 0; // ลำดับกลับเป็นปกติ -> เริ่มดูจากแถวแรกสุด
  }

  function speedChange(v: string) {
    const t = v.replace(/\D/g, "").slice(0, 3);
    setSpeedText(t);
    const n = Number(t);
    if (n > 0) {
      const x = Math.min(MAX_SPEED, n);
      setSpeed(x);
      pref.set("ShowSpeed", String(x));
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; kind: string; summary: string }>(`/store/${stkId}/import`, file);
      if (!(await dlg.confirm({ title: "CONFIRM IMPORT", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>(`/store/${stkId}/import/apply`, { method: "POST", body: { id: pv.id, kind: pv.kind } });
      await dlg.alert({ title: "IMPORT", message: r.message });
      reload();
      loadMeta();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function template(coil: boolean) {
    const ok = await dlg.confirm({
      title: "TEMPLATE EXCEL",
      ok: "YES",
      message: coil
        ? `ต้องการสร้างไฟล์ Template สำหรับนำเข้า COIL LIST ของคลัง ${s.code} ใช่หรือไม่?\n\n• กรอก PRODUCT CODE / MASTER COIL / COIL NO / WEIGHT (KG.) ของ Coil ลูกแต่ละม้วน\n• นำเข้ากลับด้วยปุ่ม IMPORT EXCEL`
        : `ต้องการสร้างไฟล์ Template สำหรับ IMPORT EXCEL ของคลัง ${s.code} ใช่หรือไม่?\n\n• คอลัมน์ตามที่ ${s.code} แสดงในหน้านี้ + ข้อมูลสินค้าปัจจุบันใส่ไว้ให้แล้ว\n${s.countCoil ? "• คลังนับ Coil: 1 แถว = 1 Coil (เลข Coil / Master Coil / น้ำหนัก)\n" : ""}• แก้ตัวเลข / เพิ่มสินค้าใหม่ แล้วนำเข้ากลับด้วยปุ่ม IMPORT EXCEL`,
    });
    if (!ok) return;
    try {
      await download(`/store/${stkId}/template`, { coil });
    } catch (e) {
      toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  const c = meta.counts;
  // ดูสดจาก StorePC = ดูอย่างเดียว (รวม REMARK) · ไม่มีสิทธิ์ EDIT = แก้ได้เฉพาะ REMARK
  const editable = (f: Field) => (f === "remark" ? !s.isLiveView : meta.canEdit);
  const denied = (f: Field) => () =>
    s.isLiveView
      ? toast.show("READ ONLY", "คลังนี้แสดงข้อมูลสดจากโปรแกรมเดิม ดูได้อย่างเดียว", "warn")
      : f !== "remark" && toast.show("ACCESS DENIED", "คุณไม่มีสิทธิ์แก้ไขข้อมูลในคลังนี้ (แก้ไขได้เฉพาะ REMARK)", "warn");
  const edit = (p: Product, f: Field, extra: { align?: "right"; strong?: boolean; wide?: boolean; color?: string } = {}) => (
    <Edit
      key={f}
      value={p[f]}
      align={extra.align}
      strong={extra.strong}
      wide={extra.wide}
      color={extra.color}
      disabled={!editable(f)}
      onDenied={denied(f)}
      onEditing={(v) => (editingRef.current = v)}
      onSave={(v) => save(p, f, v)}
    />
  );

  const cell = (p: Product, col: string, no: number) => {
    switch (col) {
      case "NO":
        return <td key={col} className="text-center font-bold text-ink-soft">{no}</td>;
      case "IMAGE":
        return (
          <td key={col} className="w-20">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" className="h-14 w-14 rounded-lg bg-white object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-line">▣</div>
            )}
          </td>
        );
      case "CODE":
        return (
          <td key={col} className="whitespace-nowrap">
            <button
              className={`flex items-center gap-1.5 font-extrabold ${coilsOn ? "text-accent hover:underline" : "cursor-default text-primary"} ${p.stockStatus === "NO_CONFIG" ? "!text-[#adb5bd]" : ""}`}
              onClick={() => toggleCoils(p)}
              title={coilsOn ? "กดเพื่อดู Master Coil / Coil ลูก" : undefined}
            >
              {p.partCode}
              {coilsOn && <span className="text-[10px]">{coils[p.partId] ? "▲" : "▼"}</span>}
            </button>
          </td>
        );
      case "CUSTOMER":
        return <td key={col} className="font-bold">{p.customer}</td>;
      case "PARTA":
        return <td key={col} className="font-bold">{p.partA}</td>;
      case "PARTB":
        return <td key={col} className="font-bold">{p.partB}</td>;
      case "PARTNO":
        return <td key={col} className="font-bold">{p.partNo}</td>;
      case "MODEL":
        return <td key={col} className="font-bold">{p.model}</td>;
      case "NAME":
        return <td key={col} className="min-w-[240px] font-bold">{p.partName}</td>;
      case "MAXMIN":
        return (
          <Fragment key={col}>
            {edit(p, "max", { align: "right" })}
            {edit(p, "min", { align: "right" })}
          </Fragment>
        );
      case "QTY":
        return edit(p, "qty", { align: "right", strong: true, color: p.stockStatus === "NO_CONFIG" ? undefined : STATUS_COLOR(p.stockStatus) });
      case "BOX":
        return edit(p, "stockBox", { align: "right" });
      case "PCS":
        return edit(p, "stockPcs", { align: "right" });
      case "REMARK":
        return edit(p, "remark", { wide: true });
      case "STATUS":
        return (
          <td key={col} className="w-[90px] text-center align-middle">
            <StatusLamp status={p.stockStatus} size={28} className="align-middle" />
          </td>
        );
      default:
        return <td key={col} />;
    }
  };

  // 🧲 แถว Coil ใต้สินค้า (CoilRowsView): หัวคอลัมน์ -> แถบ Master Coil (จำนวน + น้ำหนัก + TON) -> Coil ลูกแถวละ 1 ม้วน
  const coilHead = (key: string) =>
    ({ NO: "NO.", COILNO: "COIL NO.", MOTHER: "MASTER COIL", WEIGHT: `WEIGHT (${s.unitDisplay}.)`, COIL: "STOCK (COIL)", TON: "WEIGHT (TON)", RECEIVED: "RECEIVED" })[key] ?? "";
  const coilCell = (key: string, r: CoilRow) => ({ NO: r.no, COILNO: r.coilNo, MOTHER: r.motherCoil, WEIGHT: r.weight, COIL: "1", TON: r.ton, RECEIVED: r.received })[key] ?? "";
  const coilPanel = (p: Product) => {
    const list = coils[p.partId];
    return (
      <tr className="hover:!bg-transparent">
        <td colSpan={width} className="!p-0">
          <div className="view-in mb-2.5 border-l-4 border-accent bg-[#fcfaff]">
            {list === "loading" ? (
              <div className="p-3 text-center text-xs font-bold text-ink-soft">⏳ LOADING COILS...</div>
            ) : !list || !list.some((r) => !r.isMother) ? (
              <div className="py-3.5 text-center text-[13px] font-bold text-ink-soft">ยังไม่มี Coil ในคลังของสินค้านี้ (สแกนรับเข้า หรือ Import COIL LIST)</div>
            ) : (
              <table className="w-full table-fixed text-[13px]">
                <thead>
                  <tr className="bg-accent text-white">
                    {coilKeys.map((kk) => (
                      <th key={kk} className={`h-[42px] !bg-accent !px-1 !text-center !text-[13px] !normal-case !tracking-normal ${kk === "NO" ? "w-[6%]" : ""}`}>
                        {coilHead(kk)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) =>
                    r.isMother ? (
                      <tr key={"m" + r.motherCoil} className="h-9 border-b border-[#eeeaf4] bg-[#f1e8f8]">
                        <td colSpan={coilKeys.length} className="!border-[#eeeaf4] !px-4 !py-0 !text-[13px] font-extrabold text-accent">
                          🧲 MASTER COIL : {r.motherCoil || "-"}
                          <span className="ml-5 font-semibold text-ink-soft">
                            {r.coilNo} • {r.weight} {s.unitDisplay} • {r.ton} TON
                          </span>
                        </td>
                      </tr>
                    ) : (
                      <tr key={r.coilId} className="h-12 border-b border-[#eeeaf4] transition-colors hover:bg-[#f6f0fd]">
                        {coilKeys.map((kk) => (
                          <td key={kk} className="break-words !border-[#eeeaf4] !px-1 !py-0 text-center !text-[13px] font-bold text-ink">
                            {coilCell(kk, r)}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // ตารางทั้งชุด (SHOW PRODUCTION วาดซ้ำต่อท้ายอีกชุดเพื่อวนต่อเนื่อง)
  const body = (copy: boolean) =>
    groups.map((g) => (
      <Fragment key={(copy ? "c-" : "") + g.key}>
        <tr className="cursor-pointer hover:!bg-transparent" onClick={() => setCollapsed((cur) => {
          const n = new Set(cur);
          if (n.has(g.key)) n.delete(g.key);
          else n.add(g.key);
          return n;
        })}>
          <td colSpan={width} className="!px-0 !py-1">
            <div className="flex h-[38px] items-center gap-1.5 rounded-[5px] border-l-2 border-accent bg-[#f3e5f5] pl-4 text-accent">
              <span className="text-sm font-bold">👥 {meta.groupLabel} :</span>
              <span className="text-[15px] font-extrabold">{g.key}</span>
              <span className="ml-3 rounded-xl bg-accent px-3 py-1 text-[10px] font-bold text-white">{g.items.length.toLocaleString()} ITEMS</span>
              <span className="ml-auto pr-4 text-[10px] text-ink-soft">{collapsed.has(g.key) ? "▼" : "▲"}</span>
            </div>
          </td>
        </tr>
        {!collapsed.has(g.key) &&
          g.items.map((p, i) => (
            <Fragment key={p.partId}>
              <tr className={p.stockStatus === "NO_CONFIG" ? "bg-[#f2f4f5] text-[#adb5bd] [&_img]:opacity-25" : ""}>{cols.map((col) => cell(p, col, i + 1))}</tr>
              {coils[p.partId] && coilPanel(p)}
            </Fragment>
          ))}
      </Fragment>
    ));

  const filterBtn = (f: string) => () => setFilter((cur) => (cur === f ? "" : f));
  const info = `${s.code} • ${s.name} • UNIT : ${s.unitDisplay}`;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/StoreMaxMin.png"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <button className="rounded-lg px-2 text-base text-ink-soft hover:bg-surface-2" onClick={onBack} title="ALL STOCKS">
              ←
            </button>
            {s.code}
            {s.isMain && <Badge>MAIN</Badge>}
            {s.isLiveView && <Badge color="var(--danger)">🔴 LIVE (READ ONLY)</Badge>}
          </span>
        }
        subtitle={
          <span title={info}>
            {info}
            {meta.canEdit || s.isLiveView ? "" : " • ดู / แก้ REMARK เท่านั้น"}
          </span>
        }
        actions={
          <>
            <button className="btn bg-success" onClick={() => download(`/store/${stkId}/export`, { key: k, cat, filter }).catch((e) => toast.show("ERROR", e.message, "error"))}>
              📤 EXPORT EXCEL
            </button>
            {meta.canImport && (
              <>
                <button className="btn bg-info" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? "⏳ IMPORTING..." : "📥 IMPORT EXCEL"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) doImport(f);
                  }}
                />
                <button className="btn-ghost" onClick={() => template(false)}>
                  📄 TEMPLATE
                </button>
                {s.countCoil && meta.hasCoilRegister && (
                  <button className="btn-ghost" onClick={() => template(true)}>
                    📄 COIL TEMPLATE
                  </button>
                )}
              </>
            )}
          </>
        }
      />

      {c && (
        <StatCards
          useMaxMin={s.useMaxMin}
          notSet={s.notSetButton}
          thirdText={s.thirdButtonText}
          counts={c}
          coilSum={meta.coilSum}
          filter={filter}
          showAllActive={filter === "" && !cat && !key}
          onFilter={(f) => filterBtn(f)()}
          onShowAll={() => (setKey(""), setCat(""), setFilter(""))}
        />
      )}

      {/* แถวเดียว: ค้นหา + หมวด + สวิตช์ SHOW (จอแคบตัดลงบรรทัดใหม่เอง) */}
      <div className="relative z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-[#e2e4f0] bg-surface px-4 py-3 shadow-[0_1px_2px_rgb(20_25_60/0.04),0_12px_30px_-24px_rgb(40_45_110/0.28)]">
        <SearchField value={key} onChange={setKey} placeholder="Search Part Code, Part Name, Part No or Customer..." />
        <CategoryPicker label={meta.groupLabel} allLabel={meta.allLabel} options={meta.categories} value={cat} onChange={setCat} />
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <Toggle label="SHOW PRODUCTION" on={production} onChange={toggleProduction} />
          {s.cardStyle !== "OFF" && <Toggle label="SHOW CARD" on={cards} onChange={toggleCards} />}
          {coilsOn && !s.isLiveView && <Toggle label="SHOW COILS" on={showCoils} onChange={toggleShowCoils} />}
          <label className="flex items-center gap-2 text-xs font-extrabold">
            SPEED
            <input
              className="field !w-16 !py-1.5 text-center font-bold"
              title="Scroll speed (1 = slowest, 200 = fastest)"
              inputMode="numeric"
              placeholder="1-200"
              value={speedText}
              onChange={(e) => speedChange(e.target.value)}
              onBlur={() => setSpeedText(String(speed))}
            />
          </label>
        </div>
      </div>

      {cards && rows && rows.length > 0 && <ShowCards rows={rows} stock={s} speed={speed} />}

      <div
        ref={scrollRef}
        className={`overflow-auto rounded-2xl border border-line/60 bg-surface shadow-sm ${production ? "max-h-[75vh] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "max-h-[calc(100dvh-330px)] min-h-[320px]"}`}
      >
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <table className="data-table w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                {cols.map((col) =>
                  col === "MAXMIN" ? (
                    <Fragment key={col}>
                      <th className="text-right">{s.maxHeader}</th>
                      <th className="text-right">{s.minHeader}</th>
                    </Fragment>
                  ) : (
                    <th key={col} className={["QTY", "BOX", "PCS"].includes(col) ? "text-right" : col === "STATUS" ? "text-center" : ""}>
                      {header(col)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody ref={bodyRef}>{body(false)}</tbody>
            {production && loop && <tbody aria-hidden>{body(true)}</tbody>}
          </table>
        )}
        {more && !loadAll && <div ref={sentinel} className="py-4 text-center text-xs text-ink-soft">⏳ LOADING MORE...</div>}
      </div>
    </PageBody>
  );
}

// สวิตช์ ON / OFF (SHOW PRODUCTION / SHOW CARD / SHOW COILS)
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-xs font-extrabold" aria-pressed={on}>
      {label}
      <span className={`relative flex h-7 w-16 items-center rounded-md px-1 text-[10px] font-bold text-white transition-colors ${on ? "bg-[#487bdb]" : "bg-[#373737]"}`}>
        <span className={`absolute top-0.5 h-6 w-7 rounded bg-[#f3f3f3] transition-all ${on ? "left-[calc(100%-30px)]" : "left-0.5"}`} />
        <span className={on ? "ml-1.5" : "ml-auto mr-1"}>{on ? "ON" : "OFF"}</span>
      </span>
    </button>
  );
}

// ✏️ ช่องที่แก้ในตาราง: คลิก -> พิมพ์ -> Enter / ออกจากช่อง = บันทึก, Esc = ยกเลิก
function Edit({
  value,
  onSave,
  onEditing,
  onDenied,
  disabled,
  align,
  strong,
  color,
  wide,
}: {
  value: string;
  onSave: (v: string) => void;
  onEditing: (v: boolean) => void;
  onDenied?: () => void;
  disabled?: boolean;
  align?: "right";
  strong?: boolean;
  color?: string;
  wide?: boolean;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const done = (commit: boolean) => {
    if (edit !== null && commit) onSave(edit.trim());
    setEdit(null);
    onEditing(false);
  };
  if (edit !== null)
    return (
      <td className="p-1">
        <input
          autoFocus
          className={`field py-1 font-black ${align === "right" ? "text-right" : ""} ${wide ? "min-w-[180px]" : "w-24"}`}
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(true);
            if (e.key === "Escape") done(false);
          }}
        />
      </td>
    );
  return (
    <td
      className={`font-bold ${align === "right" ? "text-right" : ""} ${disabled ? "" : "cursor-text hover:bg-accent-soft/40"} ${strong ? "text-base font-extrabold" : ""} ${wide ? "min-w-[160px]" : "whitespace-nowrap"}`}
      style={color ? { color } : undefined}
      title={disabled ? undefined : "คลิกเพื่อแก้ไข"}
      onDoubleClick={() => disabled && onDenied?.()}
      onClick={() => {
        if (disabled) return;
        onEditing(true);
        setEdit(value ?? "");
      }}
    >
      {value || "-"}
    </td>
  );
}
