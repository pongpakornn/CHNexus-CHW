"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { Empty, Loading, PageBody } from "@/components/layout/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { useLive } from "@/lib/live";
import { StatCards, type CoilSum } from "./StatCards";
import { ActionMenu, type MenuAction } from "@/components/menus/ActionMenu";
import { ProductCard, useMobile, type CardLabels } from "./MobileCards";
import { ShowCards } from "./ShowCards";
import { StockHeader } from "./StockHeader";
import { ProductRow, type CoilRow, type CoilState, type RowActions, type RowCfg } from "./TableRows";
import { CategoryPicker, Pager, SearchField, type Suggestion } from "./Toolbar";
import { type Counts, type Product, type Stock } from "./types";
import { MinReportMenu } from "./MinReport";
import { Layout3DButton } from "./Layout3DButton";
import { ManageDock } from "./ManageDock";
import { PickingExport, type PickData, type PickingReq } from "@/app/(app)/master/product/PickingExport";
import { ImportReview } from "@/components/import/ImportReview";
import type { ImportPreview } from "@/components/import/types";
import { AddCoilModal, AdjustCoilModal, EditCoilModal, ManageBar, ManageHistoryModal, type ManageMode } from "./CoilManage";

type Meta = {
  stock: Stock;
  columns: string[];
  /** ➕ ช่องกรอกเพิ่มเองของคลัง (key = CF12) */
  customFields?: { key: string; label: string; type: string }[];
  coilRowOrder: string[];
  coilSum: CoilSum;
  allLabel: string;
  groupLabel: string;
  categories: string[];
  counts: Counts;
  canEdit: boolean;
  canImport: boolean;
  canEditQty?: boolean;
  hasCoilRegister: boolean;
  coilRemark?: boolean;
  /** 🧲 ปุ่ม MANAGE STOCK (EDIT + APPROVE ของคลังนับ Coil) */
  canManage?: boolean;
};
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
// ⚡ แถว / การ์ดที่ตัวเลขเพิ่งเปลี่ยน (สแกน / แก้จากเครื่องอื่น) = กระพริบสีเขียวอ่อนครั้งเดียว - แตะ DOM ตรง ไม่วาดตารางใหม่
function flashRows(ids: number[]) {
  requestAnimationFrame(() => {
    for (const id of ids)
      document.querySelectorAll<HTMLElement>(`[data-pid="${id}"]`).forEach((el) => {
        el.classList.remove("live-flash");
        void el.offsetWidth; // เริ่มอนิเมชันใหม่ถ้าเปลี่ยนติดกัน
        el.classList.add("live-flash");
        el.addEventListener("animationend", () => el.classList.remove("live-flash"), { once: true });
      });
  });
}

export function StockTable({ stkId, onBack, initialFilter = "", openMinReport = false }: { stkId: number; onBack: () => void; initialFilter?: string; openMinReport?: boolean }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const selfRef = useRef<Set<number>>(new Set()); // แถวที่ผู้ใช้เพิ่งแก้เอง (ไม่กระพริบซ้ำ)
  const [rows, setRows] = useState<Product[] | null>(null);
  const [page, setPage] = useState(0); // หน้าที่แสดง (ละ PAGE รายการ)
  const [key, setKey] = useState("");
  const [cat, setCat] = useState("");
  const [filter, setFilter] = useState(["OVER_MAX", "UNDER_MIN", "NO_ORDER"].includes(initialFilter) ? initialFilter : "");
  const [production, setProduction] = useState(false);
  const [cards, setCards] = useState(false);
  const [showCoils, setShowCoils] = useState(false);
  const [speed, setSpeed] = useState(() => Math.min(MAX_SPEED, Math.max(1, Number(pref.get("ShowSpeed", "12")) || 12)));
  const [speedText, setSpeedText] = useState(String(speed));
  const [coils, setCoils] = useState<Record<number, CoilState>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<Set<number>>(new Set());
  const [animOpen, setAnimOpen] = useState<Set<number>>(new Set()); // แถว Coil ที่เพิ่งกดเปิด (เล่นอนิเมชันกางลง)
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);
  // 🧲 MANAGE STOCK: โหมด (ADD / ADJUST / HIDE) + หน้าต่างที่เปิดอยู่
  const [manage, setManage] = useState<ManageMode>("");
  const manageAllowed = !!meta?.canManage && meta?.stock.showManageStock !== false;
  const [mAdd, setMAdd] = useState<Product | null>(null);
  const [mCoil, setMCoil] = useState<{ kind: "edit" | "adjust"; row: CoilRow } | null>(null);
  const [mHistory, setMHistory] = useState(false);
  const [hideBusy, setHideBusy] = useState<number | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set()); // HIDE mode: ticked PartIDs
  // เปลี่ยนตัวกรอง (การ์ด MAX / MIN / ... / หมวด / ค้นหา): ระหว่างโหลด = ตารางจางลง (out) -> ได้ข้อมูล = แถวทยอยเลื่อนเข้า (in)
  const [swap, setSwap] = useState<"idle" | "out" | "in">("idle");
  const swapT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const k = useDebounced(key, 500);
  // search-box suggestions (NUMBER COIL / MASTER COIL / product), debounced, max 10 from the server
  const kSug = useDebounced(key.trim(), 250);
  const [sugg, setSugg] = useState<{ q: string; list: Suggestion[] }>({ q: "", list: [] });
  useEffect(() => {
    if (kSug.length < 2) return;
    let live = true;
    api<Suggestion[]>(`/store/${stkId}/search-suggest`, { query: { q: kSug } })
      .then((list) => live && setSugg({ q: kSug, list }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [stkId, kSug]);
  const tokenRef = useRef<string | null>(null);
  const liveRef = useRef<Live | null>(null);
  const editingRef = useRef(false);
  const pauseUntil = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement & HTMLTableSectionElement>(null);
  const verRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // 📥 IMPORT PENTA STOCK (stock setting InSupplierImport): supplier file -> review only (no write yet)
  const pentaRef = useRef<HTMLInputElement>(null);
  const [penta, setPenta] = useState<ImportPreview | null>(null);
  const [pentaBusy, setPentaBusy] = useState(false);
  // 🏷 QR PICK LIST of ticked / listed review rows: cards come ready from the server (no re-fetch in PickingExport)
  const [pentaPick, setPentaPick] = useState<{ req: PickingReq; data: PickData } | null>(null);
  const pentaSource = useMemo(() => (pentaPick ? () => Promise.resolve(pentaPick.data) : undefined), [pentaPick]);
  const rowsRef = useRef<Product[] | null>(null);
  const coilsRef = useRef(coils);
  const showCoilsRef = useRef(showCoils);
  const metaRef = useRef<Meta | null>(null);
  useEffect(() => {
    rowsRef.current = rows;
    coilsRef.current = coils;
    showCoilsRef.current = showCoils;
    metaRef.current = meta;
  }, [rows, coils, showCoils, meta]);

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

  // ข้อมูลทั้งคลังตามตัวกรองโหลดครั้งเดียว -> ตารางแสดงทีละหน้า (PAGE รายการ) · SHOW CARD / SHOW PRODUCTION วนครบทุกรายการ
  const query = useCallback(
    () => api<{ token: string | null; rows: Product[] }>(`/store/${stkId}/products`, { query: { key: k, cat, filter, skip: 0, take: 100000, } }),
    [stkId, k, cat, filter],
  );

  // โหลดใหม่ทั้งชุด (keep > 0 = เรียลไทม์โหลดโครงตารางใหม่: อยู่หน้าเดิม ไม่เล่นอนิเมชันเปลี่ยนตัวกรอง)
  const reload = useCallback(
    async (keep = 0) => {
      const v = ++verRef.current;
      if (!keep && rowsRef.current) {
        clearTimeout(swapT.current);
        setSwap("out");
      }
      try {
        const r = await query();
        if (v !== verRef.current) return;
        setRows(r.rows);
        if (!keep) {
          setPage(0);
          setSwap("in");
          clearTimeout(swapT.current);
          swapT.current = setTimeout(() => setSwap("idle"), 900);
        }
        tokenRef.current = r.token;
      } catch (e) {
        if (v === verRef.current) toast.show("ERROR", "โหลดข้อมูลคลังไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [query, toast],
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
        const n: Record<number, CoilState> = {};
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

  // ⚡ ตัวเลขล่าสุด (ยอด / MAX / MIN / REMARK / สถานะ) - ไม่ทับช่องที่กำลังแก้
  const pullNumbers = useCallback(async () => {
    const r = await api<{ token: string; changed: boolean; counts: Counts; coilSum: CoilSum; rows?: Partial<Product>[] }>(`/store/${stkId}/numbers`, {
      query: { token: tokenRef.current },
    });
    tokenRef.current = r.token;
    if (!r.changed || !r.rows) return;
    const map = new Map(r.rows.map((x) => [x.partId, x]));
    const cur = rowsRef.current;
    if (!cur) return;
    // แทนเฉพาะแถวที่ค่าเปลี่ยนจริง (แถวอื่นคงอ็อบเจกต์เดิม = ไม่วาดใหม่) + แถวที่เปลี่ยนกระพริบให้เห็น
    const hit: number[] = [];
    const next = cur.map((p) => {
      const u = map.get(p.partId);
      if (!u) return p;
      for (const f of Object.keys(u) as (keyof Product)[])
        if (p[f] !== u[f]) {
          hit.push(p.partId);
          return { ...p, ...u };
        }
      return p;
    });
    if (hit.length === 0) return;
    setRows(next);
    // แถวที่เพิ่งแก้เองไม่ต้องกระพริบ (กระพริบเฉพาะที่เปลี่ยนจากเครื่องอื่น / การสแกน)
    const others = hit.filter((id) => !selfRef.current.has(id));
    if (others.length > 0 && others.length <= 50) flashRows(others);
    setMeta((m) => (m && (JSON.stringify(m.counts) !== JSON.stringify(r.counts) || JSON.stringify(m.coilSum) !== JSON.stringify(r.coilSum)) ? { ...m, counts: r.counts, coilSum: r.coilSum } : m));
  }, [stkId]);

  // ⚡ เรียลไทม์ทันที: เซิร์ฟเวอร์แจ้ง "store:{คลัง}" เมื่อตัวเลข / ตั้งค่าคลัง / โครงตาราง / ทะเบียน Coil เปลี่ยน (สแกน / แก้ / ตัด Coil / STORE-PC)
  //    -> ดึงเฉพาะที่เปลี่ยน (StoreMaxMinView.AttachLiveStructure) · กำลังแก้ช่องอยู่ = รอแก้เสร็จแล้วค่อยดึง (ไม่ทับค่าที่พิมพ์)
  const liveTick = useCallback(async () => {
    if (!rowsRef.current) return;
    // กำลังแก้ช่องอยู่ = รอให้แก้เสร็จก่อน (สูงสุด 60 วินาที) แล้วค่อยดึง -> ไม่พลาดการเปลี่ยนที่เข้ามาระหว่างพิมพ์
    for (let i = 0; editingRef.current && i < 120; i++) await new Promise((ok) => setTimeout(ok, 500));
    await pullNumbers();
    const now = await api<Live>(`/store/${stkId}/live`);
    const was = liveRef.current;
    liveRef.current = now;
    if (!now.stock) return onBack(); // คลังถูกลบ -> กลับหน้าการ์ดคลัง
    if (!was) return;
    if (now.settings !== was.settings) {
      await loadMeta(); // ตั้งค่าคลังเปลี่ยน -> ใช้ค่าล่าสุด (คอลัมน์ / หน่วย / ชื่อ ...)
      await reload(1);
    } else if (now.structure !== was.structure && !editingRef.current) await reload(1);
    if (now.coils !== was.coils) await refreshCoils();
  }, [stkId, pullNumbers, loadMeta, reload, refreshCoils, onBack]);
  useLive([`store:${stkId}`], liveTick, 10000);

  // 🔁 SHOW PRODUCTION: เลื่อนตารางขึ้นวนไปเรื่อย ๆ แบบป้ายโฆษณา - เลื่อนด้วย transform ทีละเศษพิกเซลบนการ์ดจอ (ลื่นแบบการ์ด SHOW CARD ไม่ขยับเป็นขั้น)
  //    หน้าเดียว = วนต่อเนื่อง (แถวที่พ้นด้านบนต่อท้ายใหม่) · หลายหน้า = เลื่อนจนสุดหน้า -> ไปหน้าถัดไป -> หน้าสุดท้ายแล้วกลับหน้าแรก (ครบทุกรายการ)
  //    หมุนล้อเมาส์ = เลื่อนเองได้ + หยุดอัตโนมัติ 5 วินาที · คลิกตาราง / แก้ไขช่อง = หยุดชั่วคราว
  const pagesRef = useRef(1);
  // 📐 กว้างพื้นที่ตาราง (ไว้ตัดสินว่าตารางแสดงครบทุกคอลัมน์ได้ไหม)
  const wrapRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [meta]);
  const mobile = useMobile();
  // ตารางล้นพื้นที่จริง (วัดจากตารางที่วาดอยู่) -> ขั้นแรกตารางแบบกระชับ (tight) · ยังล้นอีก = จำความกว้างที่ต้องใช้ แล้วสลับเป็นการ์ดจนกว่าพื้นที่จะกว้างพอ
  const [tight, setTight] = useState<string | null>(null);
  const [tableMin, setTableMin] = useState<{ code: string; w: number } | null>(null);
  useEffect(() => {
    if (mobile) return;
    const id = requestAnimationFrame(() => {
      const sc = scrollRef.current;
      const code = metaRef.current?.stock.code;
      if (!sc || !code || !sc.querySelector("table.store-table")) return;
      if (sc.scrollWidth <= sc.clientWidth + 2) return;
      if (tight !== code) setTight(code);
      else setTableMin({ code, w: sc.scrollWidth + (sc.offsetWidth - sc.clientWidth) + 4 }); // + ขอบ / แถบเลื่อน = เทียบกับความกว้างกล่องนอก (boxW) ได้ตรง
    });
    return () => cancelAnimationFrame(id);
  }, [boxW, rows, meta, mobile, tight]);
  const pageRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!production || !el) return;
    el.scrollTop = 0;
    let raf = 0;
    let last = performance.now();
    let pos = 0;
    let endAt = 0;
    let seenPage = pageRef.current;
    const bodies = () => el.querySelectorAll<HTMLElement>("[data-slide]");
    const apply = () => {
      const y = `translate3d(0,${-pos}px,0)`;
      bodies().forEach((b) => (b.style.transform = y));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      pauseUntil.current = performance.now() + 5000;
      pos = Math.max(0, pos + e.deltaY);
    };
    const onDown = () => (pauseUntil.current = performance.now() + 5000);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const body = bodyRef.current;
      if (seenPage !== pageRef.current) {
        seenPage = pageRef.current; // เปลี่ยนหน้า (เอง / อัตโนมัติ) -> เริ่มจากบนสุด
        pos = 0;
        endAt = 0;
      }
      if (body) {
        const head = (body.previousElementSibling as HTMLElement | null)?.offsetHeight ?? 0;
        const h = body.offsetHeight;
        const view = el.clientHeight - head;
        const run = !editingRef.current && now > pauseUntil.current;
        if (pagesRef.current > 1) {
          setLoop((cur) => (cur ? false : cur));
          const max = Math.max(0, h - view);
          if (pos > max) pos = max;
          if (run) {
            if (pos >= max - 0.5) {
              endAt ||= now;
              if (now - endAt > (max <= 1 ? 6000 : 1500)) {
                endAt = 0;
                pos = 0;
                setPage((cur) => (cur + 1) % pagesRef.current);
              }
            } else pos = Math.min(max, pos + speed * dt);
          }
        } else {
          const loopOn = h > view;
          setLoop((cur) => (cur === loopOn ? cur : loopOn));
          if (!loopOn) pos = 0;
          else {
            if (run) pos += speed * dt;
            if (pos >= h) pos -= h;
          }
        }
        apply();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      bodies().forEach((b) => (b.style.transform = ""));
    };
  }, [production, speed]);

  const pages = Math.max(1, Math.ceil((rows?.length ?? 0) / PAGE));
  const curPage = Math.min(page, pages - 1);
  useEffect(() => {
    pagesRef.current = pages;
    pageRef.current = curPage;
  }, [pages, curPage]);
  const pageRows = useMemo(() => rows?.slice(curPage * PAGE, (curPage + 1) * PAGE) ?? null, [rows, curPage]);
  // เปลี่ยนหน้า: ขึ้นบนสุดของตาราง + แถวทยอยเลื่อนเข้า
  const goPage = useCallback((n: number) => {
    setPage(n);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    clearTimeout(swapT.current);
    setSwap("in");
    swapT.current = setTimeout(() => setSwap("idle"), 900);
  }, []);
  // จำนวนสินค้าทั้งหมวด (ทุกหน้า) - ป้าย ITEMS ของหัวหมวดไม่ลดตามหน้า
  const groupTotal = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of rows ?? []) m.set(p.groupKey || "-", (m.get(p.groupKey || "-") ?? 0) + 1);
    return m;
  }, [rows]);
  const groups = useMemo(() => {
    const g: { key: string; items: Product[] }[] = [];
    for (const p of pageRows ?? []) {
      const gk = p.groupKey || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(p);
      else g.push({ key: gk, items: [p] });
    }
    return g;
  }, [pageRows]);

  // ⚡ ค่าคงที่ของแถว: เปลี่ยนเฉพาะตอนตั้งค่าคลังเปลี่ยน (ตัวเลขเรียลไทม์ทุก 3 วินาทีไม่ทำให้ทุกแถววาดใหม่)
  const mStock = meta?.stock;
  const mCols = meta?.columns;
  const mCoilOrder = meta?.coilRowOrder;
  const mCoilRemark = meta?.coilRemark;
  const mCanEdit = meta?.canEdit;
  const mCanQty = meta?.canEditQty;
  const mCoilReg = meta?.hasCoilRegister;
  const cfg = useMemo<RowCfg | null>(() => {
    if (!mStock || !mCols || !mCoilOrder) return null;
    const keys = ["NO", ...mCoilOrder];
    const iCoil = keys.indexOf("COILNO");
    const iMother = keys.indexOf("MOTHER");
    if (iCoil >= 0 && iMother > iCoil) [keys[iCoil], keys[iMother]] = ["MOTHER", "COILNO"]; // MASTER COIL มาก่อน NUMBER COIL
    if (mCoilRemark) keys.push("REMARK");
    const coilsOn = mStock.showCoilRows && !!mCoilReg;
    // คลังประเภท Material: กดทั้งแถวเพื่อเปิด / ปิด Coil
    const mat = mStock.stockType === "MATERIAL" || (!mStock.stockType && mStock.countCoil);
    return {
      cols: mCols,
      width: mCols.reduce((a, c) => a + (c === "MAXMIN" ? 2 : 1), 0) + (manage === "HIDE" ? 1 : 0),
      coilKeys: keys,
      coilsOn,
      rowToggle: mat && coilsOn,
      unit: mStock.unitDisplay,
      canEdit: !!mCanEdit,
      canEditQty: !!mCanQty,
      isLiveView: mStock.isLiveView,
      manage,
      coilOpen: mCoil ? { coilId: mCoil.row.coilId, kind: mCoil.kind } : null,
      hideBusy,
      picked,
    };
  }, [mStock, mCols, mCoilOrder, mCoilRemark, mCanEdit, mCanQty, mCoilReg, manage, mCoil, hideBusy, picked]);

  // หลังจัดการ Coil: ยอดล่าสุด + Coil ของสินค้านั้นเปิดให้เห็นผลทันที
  const afterManage = useCallback(
    async (partId: number | null) => {
      tokenRef.current = null;
      await pullNumbers().catch(() => undefined);
      if (partId !== null) {
        try {
          const r = await api<CoilRow[]>(`/store/${stkId}/coils/${partId}`);
          setCoils((c) => ({ ...c, [partId]: r }));
        } catch {
          /* รอบเรียลไทม์โหลดให้เอง */
        }
      }
      await refreshCoils();
      loadMeta();
    },
    [stkId, pullNumbers, refreshCoils, loadMeta],
  );

  // คำสั่งจากแถว (อ็อบเจกต์คงที่ - อ่านค่าล่าสุดจาก ref) -> แถวที่ memo ไว้ไม่ต้องวาดใหม่
  const act = useMemo<RowActions>(() => {
    const dropCoil = (partId: number) =>
      setCoils((c) => {
        const n = { ...c };
        delete n[partId];
        return n;
      });
    const dropFrom = (set: typeof setClosing, partId: number) =>
      set((cur) => {
        const n = new Set(cur);
        n.delete(partId);
        return n;
      });
    return {
      // คลังที่นับ Coil: กด PD CODE / แถว -> เปิด / ปิด Master Coil / Coil ลูก ใต้แถวสินค้านั้น · กดซ้ำระหว่างกำลังพับ = กางกลับ
      toggle: async (p) => {
        const m = metaRef.current;
        if (!m || !(m.stock.showCoilRows && m.hasCoilRegister)) return;
        if (coilsRef.current[p.partId]) {
          setClosing((cur) => {
            const n = new Set(cur);
            if (n.has(p.partId)) n.delete(p.partId);
            else n.add(p.partId);
            return n;
          });
          return;
        }
        setAnimOpen((cur) => new Set(cur).add(p.partId));
        setCoils((c) => ({ ...c, [p.partId]: "loading" }));
        try {
          const r = await api<CoilRow[]>(`/store/${stkId}/coils/${p.partId}`);
          setCoils((c) => ({ ...c, [p.partId]: r }));
        } catch (e) {
          dropCoil(p.partId);
          toast.show("COIL", "โหลดรายการ Coil ไม่สำเร็จ\n" + (e as Error).message, "error");
        }
      },
      save: async (p, field, value) => {
        const original = { partCode: p.partCode, remark: p.remark, max: p.max, min: p.min, qty: p.qty, stockBox: p.stockBox, stockPcs: p.stockPcs };
        if ((original[field] ?? "") === value) return;
        const next = { ...original, [field]: value };
        setRows((cur) => cur?.map((x) => (x.partId === p.partId ? { ...x, [field]: value } : x)) ?? cur);
        editingRef.current = true; // ระหว่างบันทึก รอบเรียลไทม์ไม่ดึงค่ามาทับ
        selfRef.current.add(p.partId);
        setTimeout(() => selfRef.current.delete(p.partId), 5000);
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
      },
      // ดูสดจาก StorePC = ดูอย่างเดียว (รวม REMARK) · ไม่มีสิทธิ์ EDIT = แก้ได้เฉพาะ REMARK
      denied: (f) => {
        if (metaRef.current?.stock.isLiveView) toast.show("READ ONLY", "คลังนี้แสดงข้อมูลสดจากโปรแกรมเดิม ดูได้อย่างเดียว", "warn");
        else if (f !== "remark") toast.show("ACCESS DENIED", "คุณไม่มีสิทธิ์แก้ไขข้อมูลในคลังนี้ (แก้ไขได้เฉพาะ REMARK)", "warn");
      },
      editing: (v) => {
        editingRef.current = v;
      },
      // พับเสร็จ (จบอนิเมชัน) -> เอาแถว Coil ออก
      closed: (partId) => {
        dropCoil(partId);
        dropFrom(setClosing, partId);
      },
      opened: (partId) => dropFrom(setAnimOpen, partId),
      // 💬 REMARK ของ Coil ลูก: แสดงทันที แล้วบันทึก (ไม่สำเร็จ = โหลด Coil ใหม่)
      saveCoilRemark: async (r, v) => {
        if ((r.remark ?? "") === v) return;
        setCoils((c) => {
          const list = c[r.partId];
          return Array.isArray(list) ? { ...c, [r.partId]: list.map((x) => (x.coilId === r.coilId ? { ...x, remark: v } : x)) } : c;
        });
        try {
          await api(`/store/${stkId}/coils/${r.coilId}/remark`, { method: "PUT", body: { remark: v } });
        } catch (e) {
          toast.show("ERROR", "ไม่สามารถบันทึก REMARK ได้\n" + (e as Error).message, "error");
          refreshCoils();
        }
      },
      addCoil: (p) => setMAdd(p),
      pick: (p) =>
        setPicked((cur) => {
          const n = new Set(cur);
          if (!n.delete(p.partId)) n.add(p.partId);
          return n;
        }),
      // HIDE mode: hide this product in this stock (it leaves the list; show it again in Master Data), then reload
      hide: async (p) => {
        setHideBusy(p.partId);
        try {
          const res = await api<{ message: string }>(`/store/${stkId}/products/${p.partId}/show`, { method: "PUT", body: { show: false, partCode: p.partCode } });
          toast.show("SUCCESS", `${p.partCode}\n${res.message}`, "ok");
          await reload(rowsRef.current?.length ?? 0);
        } catch (e) {
          toast.show("ERROR", "ไม่สามารถซ่อน / แสดงสินค้าได้\n" + (e as Error).message, "error");
        } finally {
          setHideBusy(null);
        }
      },
      // 🚚 TRANSFER: ยืนยัน -> สแกนออกจากคลังนี้ (บันทึกที่ Multi-Scanner) · EDIT / ADJUST = เปิดหน้าต่าง
      coilAct: async (a, r) => {
        if (a !== "transfer") return setMCoil((c) => (c?.row.coilId === r.coilId && c.kind === a ? null : { kind: a, row: r })); // 2nd click (red X) cancels
        const code = metaRef.current?.stock.code ?? "";
        const pc = rowsRef.current?.find((x) => x.partId === r.partId)?.partCode ?? "";
        const ok = await dlg.confirm({
          title: "TRANSFER (SCAN OUT)",
          ok: "🚚 TRANSFER",
          message: `ต้องการโอนย้าย Coil นี้ออกจาก ${code} หรือไม่?\n\n${pc}\nCoil ${r.coilNo}  •  Master ${r.motherCoil}  •  ${r.weight} KG\n\nระบบจะสแกนออกให้ และบันทึกที่ Multi-Scanner ทันที`,
        });
        if (!ok) return;
        try {
          const res = await api<{ message: string }>(`/store/${stkId}/manage/coils/${r.coilId}/transfer`, { method: "POST" });
          toast.show("TRANSFER", res.message, "ok");
          await afterManage(r.partId);
        } catch (e) {
          toast.show("ERROR", (e as Error).message, "error");
        }
      },
    };
  }, [stkId, toast, dlg, pullNumbers, reload, refreshCoils, afterManage]);

  if (!meta || !cfg) return <Loading />;
  const s = meta.stock;
  const cols = meta.columns;
  const header = (c: string) =>
    ({ NO: "NO.", IMAGE: "IMAGE", CUSTOMER: "CUSTOMER", CODE: "PD CODE", PARTA: "PART A", PARTB: "PART B", PARTNO: "PART NO", MODEL: "MODEL", NAME: "PRODUCT NAME", QTY: s.qtyHeader, BOX: s.boxHeader, PCS: "STOCK (PCS)", REMARK: "REMARK", STATUS: "STATUS", SUPPLIER: "SUPPLIER", CATEGORY: "CATEGORY", PACKSIZE: "PACK SIZE", BIN: "BIN" })[c] ??
    meta.customFields?.find((f) => f.key === c)?.label ??
    c;
  const width = cfg.width;
  const coilsOn = cfg.coilsOn;

  function toggleShowCoils(on: boolean) {
    setShowCoils(on);
    pref.set("ShowCoils." + s.code, on ? "1" : "0");
    if (!on) {
      setCoils({});
      setClosing(new Set());
      setAnimOpen(new Set());
    }
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

  // 📄 TEMPLATE MAX-MIN = Export ข้อมูลปัจจุบันของคลัง (คอลัมน์ตามรูปแบบของคลัง) · TEMPLATE COIL = ไฟล์เปล่าสำหรับเพิ่ม / อัพเดท Coil
  async function template(coil: boolean) {
    const ok = await dlg.confirm({
      title: coil ? "TEMPLATE COIL" : "TEMPLATE MAX-MIN",
      ok: "EXPORT",
      message: coil
        ? `สร้างไฟล์ TEMPLATE COIL ของคลัง ${s.code} ใช่หรือไม่?\n\n• กรอก PRODUCT CODE / MASTER COIL / NUMBER COIL / WEIGHT (KG.) / LABEL DATE ของ Coil แต่ละม้วน\n• ชีท HOW TO = วิธีกรอก · ชีท PRODUCT CODE = รหัสสินค้าของ ${s.code}\n• กรอกแล้วนำเข้ากลับด้วยปุ่ม IMPORT (MAX-MIN / COIL)`
        : `Export TEMPLATE MAX-MIN ของคลัง ${s.code} ใช่หรือไม่?\n\n• ข้อมูลปัจจุบันของ ${s.code} ใส่ไว้ให้แล้ว (คอลัมน์ตามรูปแบบของคลังนี้)\n${s.countCoil ? "• 1 แถว = 1 Coil (MASTER COIL / NUMBER COIL / น้ำหนัก)\n" : ""}• แก้ MAX / MIN / ยอด / SHOW-HIDE (1 = แสดง · 0 = ไม่แสดง) แล้วนำเข้ากลับด้วยปุ่ม IMPORT (MAX-MIN / COIL)\n• ชีท HOW TO = วิธีกรอก · ชีท PRODUCT CODE = รหัสสินค้าของ ${s.code}`,
    });
    if (!ok) return;
    try {
      await download(`/store/${stkId}/template`, { coil });
    } catch (e) {
      toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  const c = meta.counts;
  // 📱 การ์ดแทนตาราง: จอมือถือ หรือพื้นที่แคบกว่าที่ตารางต้องใช้ (แสดงไม่ครบทุกคอลัมน์ เช่น iPad แนวตั้ง / iPad mini) · ตารางพอดีจอ (iPad แนวนอน / Mac / PC) = ตารางแบบ Desktop
  const need = tableMin?.code === s.code ? tableMin.w : 0;
  const asCards = mobile || (need > 0 && boxW > 0 && boxW < need);
  // แถบระดับสต็อกบนการ์ด: ยอดคงเหลือช่องเดียวกับหน่วย MAX-MIN ของคลัง (BOX / PCS / QTY)
  const basis: CardLabels["basis"] = !s.useMaxMin ? null : ["COIL", "BOX"].includes(s.maxMinBasis) && (s.colStockBox || s.countCoil) ? "stockBox" : s.maxMinBasis === "PCS" && s.colStockPcs ? "stockPcs" : "qty";
  const labels: CardLabels = { max: s.maxHeader, min: s.minHeader, qty: s.qtyHeader, box: s.boxHeader, basis, basisLabel: basis === "stockBox" ? s.boxHeader : basis === "stockPcs" ? "STOCK (PCS)" : s.qtyHeader };
  const toggleGroup = (k: string) =>
    setCollapsed((cur) => {
      const n = new Set(cur);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // การ์ดทั้งชุด (SHOW PRODUCTION วาดซ้ำต่อท้ายอีกชุดเพื่อวนต่อเนื่อง)
  const cardsBody = (copy: boolean) =>
    groups.map((g) => (
      <Fragment key={(copy ? "c-" : "") + g.key}>
        <button type="button" className="mc-group" onClick={() => toggleGroup(g.key)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/store/warehouse.webp" alt="" className="size-6" draggable={false} />
          <span className="min-w-0 truncate text-[13px] font-bold">
            {meta.groupLabel} : <b className="text-[15px] font-extrabold">{g.key}</b>
          </span>
          <span className="ml-auto shrink-0 rounded-full bg-[#4f46e5] px-2.5 py-0.5 text-[10px] font-bold text-white">{(groupTotal.get(g.key) ?? g.items.length).toLocaleString()} ITEMS</span>
          <span className={`group-chev shrink-0 ${collapsed.has(g.key) ? "" : "is-open"}`} aria-hidden>
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3.5L10.5 8 6 12.5" />
            </svg>
          </span>
        </button>
        {!collapsed.has(g.key) &&
          g.items.map((p, i) => (
            <ProductCard key={p.partId} p={p} no={i + 1} cfg={cfg} labels={labels} coil={coils[p.partId]} closing={closing.has(p.partId)} anim={animOpen.has(p.partId)} act={act} />
          ))}
      </Fragment>
    ));
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
          <td colSpan={width} className="!p-0">
            <div className="flex h-[44px] items-center gap-2 border-y border-[#dfe3fb] bg-[linear-gradient(90deg,#eef1ff,#f7f8ff_55%,#ffffff)] pl-4 text-[#3730a3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/store/warehouse.webp" alt="" className="size-7" draggable={false} />
              <span className="text-sm font-bold">{meta.groupLabel} :</span>
              <span className="text-[15px] font-extrabold">{g.key}</span>
              <span className="ml-3 rounded-full bg-[#4f46e5] px-3 py-1 text-[10px] font-bold text-white shadow-[0_4px_10px_-6px_#4f46e5]">{(groupTotal.get(g.key) ?? g.items.length).toLocaleString()} ITEMS</span>
              <span className={`group-chev ml-auto mr-4 ${collapsed.has(g.key) ? "" : "is-open"}`} aria-hidden>
                <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3.5L10.5 8 6 12.5" />
                </svg>
              </span>
            </div>
          </td>
        </tr>
        {!collapsed.has(g.key) &&
          g.items.map((p, i) => (
            <ProductRow key={p.partId} p={p} no={i + 1} cfg={cfg} coil={coils[p.partId]} closing={closing.has(p.partId)} anim={animOpen.has(p.partId)} act={act} />
          ))}
      </Fragment>
    ));

  const menu: MenuAction[] = [
    {
      key: "export",
      title: "EXPORT EXCEL",
      detail: `ส่งออกรายการสินค้าของคลัง ${s.code} เป็นไฟล์ Excel ตามที่กรองอยู่ตอนนี้ (สถานะ / ${meta.groupLabel} / คำค้นหา)`,
      color: "#16a34a",
      icon: "export",
      onClick: () => download(`/store/${stkId}/export`, { key: k, cat, filter }).catch((e) => toast.show("ERROR", e.message, "error")),
    },
    ...(meta.canImport
      ? ([
          {
            key: "import",
            title: busy ? "IMPORTING..." : s.countCoil && meta.hasCoilRegister ? "IMPORT (MAX-MIN / COIL)" : "IMPORT MAX-MIN",
            detail: `นำเข้าไฟล์ TEMPLATE MAX-MIN (อัพเดท MAX / MIN / ยอด / SHOW-HIDE / เพิ่มสินค้า)${s.countCoil && meta.hasCoilRegister ? " หรือ TEMPLATE COIL (เพิ่ม / อัพเดท Coil)" : ""} ของคลัง ${s.code} · ระบบดูชนิดไฟล์เอง และแสดงสรุปให้ยืนยันก่อนบันทึกทุกครั้ง`,
            color: "#2563eb",
            icon: "import",
            busy,
            onClick: () => fileRef.current?.click(),
          },
          {
            key: "template",
            title: "TEMPLATE MAX-MIN",
            detail: `EXPORT TEMPLATE ข้อมูลปัจจุบันของ ${s.code} (คอลัมน์ตามรูปแบบของคลังนี้ + ชีท HOW TO / PRODUCT CODE) · แก้ MAX / MIN / ยอด / SHOW-HIDE แล้ว IMPORT กลับเข้าระบบ`,
            color: "#7c3aed",
            icon: "template",
            onClick: () => template(false),
          },
          ...(s.inSupplierImport
            ? [
                {
                  key: "penta",
                  title: pentaBusy ? "กำลังตรวจไฟล์…" : "IMPORT PENTA STOCK",
                  detail: `ตรวจไฟล์ PentaOnlineStock (.xlsx) เทียบกับ Coil ของ CHR-Nexus · กรอง ใหม่ / น้ำหนักเปลี่ยน / เหมือนเดิม / ผิด · IMPORT = อัพเดทน้ำหนัก / เพิ่ม Coil (ใส่ PD CODE) ที่เลือก`,
                  color: "#ea580c",
                  icon: "import",
                  busy: pentaBusy,
                  onClick: () => setPenta({ id: "", file: "", title: `PENTA STOCK · ${s.code}`, rows: [], errors: [] }),
                },
              ]
            : s.countCoil && meta.hasCoilRegister
            ? [
                {
                  key: "coil",
                  title: "TEMPLATE COIL",
                  detail: `EXPORT TEMPLATE สำหรับเพิ่ม / อัพเดท Coil ของ ${s.code} · PRODUCT CODE / MASTER COIL / NUMBER COIL / WEIGHT (KG.) / LABEL DATE + ชีท HOW TO / PRODUCT CODE · กรอกแล้ว IMPORT กลับ`,
                  color: "#ea580c",
                  icon: "coil",
                  onClick: () => template(true),
                },
              ]
            : []),
        ] as MenuAction[])
      : []),
  ];

  const filterBtn = (f: string) => () => setFilter((cur) => (cur === f ? "" : f));

  const partOf = (id: number) => rows?.find((x) => x.partId === id);
  // 🧲 MANAGE STOCK สำเร็จ = Toast (ไม่ต้องกด OK / X) ทำงานต่อได้ทันที · ผิดพลาด / ยืนยัน ยังเป็นหน้าต่างเหมือนเดิม
  const done = async (title: string, msg: string, partId: number | null) => {
    toast.show(title, msg, "ok");
    await afterManage(partId);
  };
  // HIDE (n): hide every ticked product in one call
  const hideSelected = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    setHideBusy(-1);
    try {
      const res = await api<{ message: string }>(`/store/${stkId}/products/show-batch`, { method: "PUT", body: { partIds: ids, show: false } });
      toast.show("SUCCESS", res.message, "ok");
      setPicked(new Set());
      await reload(rows?.length ?? 0);
    } catch (e) {
      toast.show("ERROR", "ไม่สามารถซ่อนสินค้าได้\n" + (e as Error).message, "error");
    } finally {
      setHideBusy(null);
    }
  };
  // เลือกโหมด: กดซ้ำ = ออก · ADJUST = เปิด SHOW COILS ให้เห็นแถว Coil ลูกทันที
  const pickMode = (m: ManageMode) => {
    const next = manage === m ? "" : m;
    setManage(next);
    setPicked(new Set());
    if (next === "ADJUST" && coilsOn && !showCoils) toggleShowCoils(true);
  };

  return (
    <PageBody>
      <StockHeader
        stock={s}
        onBack={onBack}
        readOnlyNote={meta.canEdit || s.isLiveView ? undefined : "ดู / แก้ REMARK เท่านั้น"}
        actions={
          <>
            <MinReportMenu stock={s} autoOpen={openMinReport} />
            {s.isMain && /* main material stock (by flag, not name - rename-safe) */ <Layout3DButton stockCode={s.code} />}
            <ActionMenu actions={menu} />
            {meta.canImport && (
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
            )}
            {meta.canImport && s.inSupplierImport && (
              <input
                ref={pentaRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f || pentaBusy) return;
                  setPentaBusy(true);
                  try {
                    setPenta(await upload<ImportPreview>(`/store/${stkId}/penta`, f));
                  } catch (err) {
                    toast.show("ERROR", (err as Error).message, "error");
                  } finally {
                    setPentaBusy(false);
                  }
                }}
              />
            )}
            {penta && (
              <ImportReview
                key={penta.file}
                preview={penta}
                applyUrl={`/store/${stkId}/penta/apply`}
                picking={pentaBusy}
                onPick={() => pentaRef.current?.click()}
                onClose={() => setPenta(null)}
                onDone={() => setPenta(null)}
                extra={!s.pentaPicking ? undefined : {
                  label: "🏷 QR PICK LIST",
                  onRun: async (keys, edits) => {
                    if (!keys.length) return toast.show("QR PICK LIST", "ไม่มีรายการให้พิมพ์", "warn");
                    try {
                      const d = await api<PickData & { skipped: string[] }>(`/store/${stkId}/penta/picking`, { method: "POST", body: { id: penta.id, keys, edits } });
                      if (d.skipped.length) toast.show("QR PICK LIST", `ข้าม ${d.skipped.length} รายการ\n${d.skipped.slice(0, 8).join("\n")}${d.skipped.length > 8 ? "\n…" : ""}`, "warn");
                      if (d.items.length) setPentaPick({ req: { mode: "SELECTED", ids: [], stkId: Number(stkId), stockName: penta.title }, data: d });
                    } catch (e) {
                      toast.show("ERROR", (e as Error).message, "error");
                    }
                  },
                }}
              />
            )}
            <PickingExport req={pentaPick?.req ?? null} source={pentaSource} onClose={() => setPentaPick(null)} />
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
        <SearchField value={key} onChange={setKey} placeholder="Search Part Code, Part Name, Part No, Customer, Master Coil or Number Coil..." suggestions={sugg.q === key.trim() ? sugg.list : []} />
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

      {cards && rows && rows.length > 0 && (
        <div className={`swap-${swap}`}>
          <ShowCards rows={rows} stock={s} speed={speed} />
        </div>
      )}

      <ManageBar mode={manage} onExit={() => (setManage(""), setPicked(new Set()))} picked={picked.size} busy={hideBusy !== null} onHide={hideSelected} />
      {/* 🧲 MANAGE STOCK ลอยติดวงกลมโปรไฟล์ (เฉพาะคลังนี้ + ผู้มีสิทธิ์) */}
      {manageAllowed && <ManageDock stockCode={s.code} mode={manage} onPick={pickMode} onHistory={() => setMHistory(true)} />}

      <div ref={wrapRef}>
      <div
        ref={scrollRef}
        className={`swap-${swap} ${asCards ? "mc-wrap" : "rounded-2xl border border-line/60 bg-surface shadow-sm"} ${production ? "prod-scroll max-h-[75dvh] overflow-hidden" : asCards ? "" : "max-h-[calc(100dvh-330px)] min-h-[320px] overflow-auto"}`}
      >
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty />
        ) : asCards ? (
          <>
            <div ref={bodyRef} data-slide className="mc-list">
              {cardsBody(false)}
            </div>
            {production && loop && (
              <div aria-hidden data-slide className="mc-list pt-3">
                {cardsBody(true)}
              </div>
            )}
          </>
        ) : (
          <table className={`data-table store-table t-center w-full ${tight === s.code ? "is-tight" : ""}`}>
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
                {manage === "HIDE" && <th className="text-center">HIDE</th>}
              </tr>
            </thead>
            <tbody ref={bodyRef} data-slide>{body(false)}</tbody>
            {production && loop && <tbody aria-hidden data-slide>{body(true)}</tbody>}
          </table>
        )}
      </div>
      </div>

      {rows && rows.length > PAGE && <Pager page={curPage} pages={pages} total={rows.length} size={PAGE} onPage={goPage} />}

      {mAdd && (
        <AddCoilModal
          stkId={stkId}
          stockCode={s.code}
          product={mAdd}
          onClose={() => setMAdd(null)}
          onDone={(msg) => {
            const id = mAdd.partId;
            setMAdd(null);
            done("ADD MASTER COIL", msg, id);
          }}
        />
      )}
      {mCoil?.kind === "edit" && (
        <EditCoilModal
          stkId={stkId}
          stockCode={s.code}
          partCode={partOf(mCoil.row.partId)?.partCode ?? ""}
          row={mCoil.row}
          onClose={() => setMCoil(null)}
          onDone={(msg) => {
            const id = mCoil.row.partId;
            setMCoil(null);
            done("EDIT COIL", msg, id);
          }}
        />
      )}
      {mCoil?.kind === "adjust" && (
        <AdjustCoilModal
          stkId={stkId}
          stockCode={s.code}
          partCode={partOf(mCoil.row.partId)?.partCode ?? ""}
          row={mCoil.row}
          onClose={() => setMCoil(null)}
          onDone={(msg) => {
            const id = mCoil.row.partId;
            setMCoil(null);
            done("ADJUST STOCK", msg, id);
          }}
        />
      )}
      {mHistory && <ManageHistoryModal stkId={stkId} stockCode={s.code} onClose={() => setMHistory(false)} />}
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
