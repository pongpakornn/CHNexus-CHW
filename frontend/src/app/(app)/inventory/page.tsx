"use client";

import { GroupRow, useCollapsed } from "@/components/ui/GroupRow";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { Pager } from "@/components/ui/Pager";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { QrImage } from "@/components/ui/QrImage";
import { RowAction, RowActions } from "@/components/ui/RowAction";
import { api, download, upload } from "@/lib/api";
import { qty } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { AdminModal } from "./AdminModal";
import { EMPTY_FORM, formOf, type Form, type Layout, type Meta, type Part } from "./types";

const PAGE = 100;
type CoilRow = { coilId: number; isMother: boolean; no: number; coilNo: string; motherCoil: string; weightKG: number; ton: number; received: string };

// 🏷️ INVENTORY REGISTRATION (ProductControlView) - ฟอร์มลงทะเบียน / แก้ไข + ตารางสินค้าตามคลัง
export default function InventoryPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const [key, setKey] = useState("");
  const [page, setPage] = useState(0);
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({}); // จำนวนรายการทั้งหมดของแต่ละกลุ่ม (ทุกหน้า) // หน้าที่แสดง (ละ PAGE รายการ) · ค้นหา / เปลี่ยนคลัง = กลับหน้าแรก
  const search = (v: string) => (setKey(v), setPage(0));
  const [rows, setRows] = useState<Part[] | null>(null);
  const [total, setTotal] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [coilStk, setCoilStk] = useState<number | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editId, setEditId] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [oldCode, setOldCode] = useState<string | null>(null);
  const [inMain, setInMain] = useState(true);
  const [others, setOthers] = useState<number[]>([]);
  const [coilText, setCoilText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coils, setCoils] = useState<Record<number, CoilRow[] | "loading">>({});
  const [admin, setAdmin] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplOptions, setTplOptions] = useState<{ stkId: number; code: string; name: string; heads: string; countCoil: boolean }[]>([]);
  const [exportOpen, setExportOpen] = useState<{ all: number } | null>(null);
  const [codeSuggest, setCodeSuggest] = useState<Part[]>([]);
  const k = useDebounced(key, 300);
  const codeKey = useDebounced(form.partCode, 300);
  const verRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  // คลังที่ติ๊กไว้ตอนลงทะเบียนใหม่ = ค่าที่ผู้ใช้เลือกค้างไว้ ("main|id,id" / ยังไม่เคยเลือก = คลังหลัก)
  const applyDefaultStocks = useCallback((m: Meta) => {
    let main = true;
    const ids: number[] = [];
    if (m.savedStocks) {
      const [a, b] = m.savedStocks.split("|");
      main = a === "1";
      for (const t of (b ?? "").split(",")) {
        const id = Number(t);
        if (id && m.stocks.some((s) => s.stkId === id && !s.isMain)) ids.push(id);
      }
      if (!main && ids.length === 0) main = true;
    }
    setInMain(main);
    setOthers(ids);
  }, []);

  useEffect(() => {
    api<Meta>("/products/meta")
      .then((m) => {
        setMeta(m);
        setFilter(m.savedFilter);
        applyDefaultStocks(m);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast, applyDefaultStocks]);

  const query = useCallback(
    (skip: number) => api<{ total: number; layout: Layout; coilStkId: number | null; groups?: Record<string, number>; rows: Part[] }>("/products", { query: { key: k, stkId: filter ?? undefined, skip, take: PAGE } }),
    [k, filter],
  );

  const reload = useCallback(async () => {
    if (!meta) return;
    const v = ++verRef.current;
    try {
      const r = await query(page * PAGE);
      if (v !== verRef.current) return;
      // ลบ / ซ่อนจนหน้านี้ว่าง -> ไปหน้าสุดท้ายที่ยังมีรายการ
      if (r.rows.length === 0 && page > 0 && r.total > 0) return setPage(Math.ceil(r.total / PAGE) - 1);
      setRows(r.rows);
      setTotal(r.total);
      setGroupCounts(r.groups ?? {});
      setLayout(r.layout);
      setCoilStk(r.coilStkId);
    } catch (e) {
      toast.show("ERROR", "โหลดข้อมูลไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }, [meta, query, page, toast]);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const goPage = (p: number) => {
    setPage(p);
    listRef.current?.scrollTo({ top: 0 });
  };

  // PRODUCT CODE: แนะนำสินค้าที่มีแล้ว (เลือก = ดึงข้อมูลทั้งหมดมาแก้)
  useEffect(() => {
    if (editId || codeKey.trim().length < 2) {
      queueMicrotask(() => setCodeSuggest([]));
      return;
    }
    let alive = true;
    api<{ rows: Part[] }>("/products", { query: { key: codeKey, take: 12 } })
      .then((r) => alive && setCodeSuggest(r.rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [codeKey, editId]);

  const [collapsed, toggleGroup] = useCollapsed();
  const groups = useMemo(() => {
    const g: { key: string; items: Part[] }[] = [];
    const none = layout?.groupBy === "NONE";
    const list = [...(rows ?? [])];
    if (!none) list.sort((a, b) => (a.groupKey ?? "").localeCompare(b.groupKey ?? ""));
    for (const p of list) {
      const gk = none ? "" : p.groupKey || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(p);
      else g.push({ key: gk, items: [p] });
    }
    return g;
  }, [rows, layout]);

  if (!meta) return <Loading />;
  const can = meta.can;
  const filterStock = meta.stocks.find((s) => s.stkId === filter) ?? null;
  const cols = layout?.columns ?? [];
  const label = (k: string) => meta.columns.find((c) => c.key === k)?.label ?? k;

  function clear() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setViewId(null);
    setOldCode(null);
    setCoilText(null);
    if (meta) applyDefaultStocks(meta);
  }

  async function fill(p: Part, edit: boolean) {
    setForm(formOf(p));
    setViewId(p.ptId);
    setEditId(edit ? p.ptId : null);
    setOldCode(edit ? p.partCode : null);
    setCoilText(null);
    // ฟอร์มอยู่ด้านบน: กด VIEW / EDIT จากแถวที่เลื่อนลงไปแล้ว = เลื่อนขึ้นไปที่ฟอร์ม
    const f = document.getElementById("reg-form");
    if (f && f.getBoundingClientRect().top < 0) f.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const d = await api<{ stockIds: number[]; coilText: string | null }>(`/products/${p.ptId}/detail`, { query: { code: p.partCode, stkId: filter ?? undefined } });
      setInMain(p.isShowMain);
      setOthers(d.stockIds);
      setCoilText(d.coilText);
    } catch {
      /* แสดงข้อมูลได้แม้โหลดคลังไม่สำเร็จ */
    }
  }

  async function changeFilter(v: number | null) {
    setFilter(v);
    setPage(0);
    setCoils({});
    api("/products/filter", { method: "POST", body: v }).catch(() => {});
  }

  function toggleStock(id: number | "main") {
    const nextMain = id === "main" ? !inMain : inMain;
    const nextOthers = id === "main" ? others : others.includes(id) ? others.filter((x) => x !== id) : [...others, id];
    setInMain(nextMain);
    setOthers(nextOthers);
    if (!editId && !viewId) api("/products/default-stocks", { method: "POST", body: `${nextMain ? "1" : "0"}|${nextOthers.join(",")}` }).catch(() => {});
  }

  async function save(isEdit: boolean) {
    if (!form.partCode.trim()) return toast.show("WARNING", "กรุณากรอกรหัสสินค้าก่อนทำการลงทะเบียนครับ", "warn");
    if (form.packSize.trim() && !/^\d+$/.test(form.packSize.trim())) return toast.show("WARNING", "PACKSIZE ต้องเป็นตัวเลขเท่านั้นครับ", "warn");
    if (!inMain && others.length === 0) return toast.show("WARNING", "กรุณาเลือกคลัง (STOCK) อย่างน้อย 1 คลังครับ", "warn");
    setBusy(true);
    try {
      const body = { ...form, inMain, otherStockIds: others, filterStkId: filter, oldCode };
      const r = await api<{ message: string }>(isEdit ? `/products/${editId}` : "/products", { method: isEdit ? "PUT" : "POST", body });
      await dlg.alert({ title: isEdit ? "SAVE CHANGES" : "REGISTER", message: r.message, tone: r.message.includes("⚠") ? "warn" : "ok" });
      clear();
      reload();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Part) {
    if (!(await dlg.confirm({ title: "CONFIRM", danger: true, ok: "DELETE", message: `ลบสินค้า: ${p.partName}?` }))) return;
    try {
      const r = await api<{ message: string }>(`/products/${p.ptId}/delete`, { method: "POST", body: { partCode: p.partCode, partName: p.partName } });
      toast.show("DELETE", r.message, "ok");
      if (viewId === p.ptId) clear();
      reload();
    } catch (e) {
      dlg.alert({ title: "DELETE", tone: "error", message: (e as Error).message });
    }
  }

  async function toggleShow(p: Part) {
    try {
      const r = await api<{ message: string }>(`/products/${p.ptId}/toggle`, { method: "POST", body: { partCode: p.partCode, partName: p.partName, show: !p.isShow, stkId: filter } });
      setRows((cur) => cur?.map((x) => (x.ptId === p.ptId ? { ...x, isShow: !p.isShow } : x)) ?? cur);
      toast.show("SHOW / HIDE", r.message, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function uploadImage(file: File) {
    // คลังของรูป: คลังในช่องกรอง (ถ้าติ๊กไว้) > คลังแรกที่ติ๊ก > คลังในช่องกรอง > คลังหลัก
    const tickedStocks = meta!.stocks.filter((s) => (s.isMain ? inMain : others.includes(s.stkId)));
    const code =
      (filterStock && tickedStocks.some((s) => s.stkId === filterStock.stkId) ? filterStock.code : null) ??
      tickedStocks[0]?.code ??
      filterStock?.code ??
      meta!.stocks.find((s) => s.isMain)?.code ??
      "STOCK";
    try {
      const r = await upload<{ imageFileName: string; imageUrl: string }>("/products/image", file, { stockCode: code, current: form.imageFileName ?? "" });
      setForm((f) => ({ ...f, imageFileName: r.imageFileName, imageUrl: r.imageUrl }));
      toast.show("IMAGE", "อัปโหลดรูปภาพสำเร็จ (กด REGISTER / SAVE CHANGES เพื่อบันทึก)", "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/products/import", file);
      if (!(await dlg.confirm({ title: "CONFIRM IMPORT", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/products/import/apply", { method: "POST", body: pv.id });
      await dlg.alert({ title: "IMPORT", message: r.message });
      reload();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function openExport() {
    try {
      const r = await api<{ count: number }>("/products/count", { query: { stkId: filter ?? undefined } });
      setExportOpen({ all: r.count });
    } catch (e) {
      toast.show("ERROR", "โหลดรายการสินค้าไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  async function exportQr(mode: "SELECTED" | "ALL") {
    setExportOpen(null);
    if (mode === "SELECTED" && ticked.length === 0) return toast.show("WARNING", "กรุณาเลือกรายการที่ต้องการ Export อย่างน้อย 1 รายการครับ", "warn");
    try {
      await download("/products/export-qr", undefined, { mode, ids: ticked, stkId: filter, stockName: filterStock?.code ?? "ALL STOCKS" });
      toast.show("EXPORT QR", "ส่งออกไฟล์ QR เรียบร้อยแล้ว!", "ok");
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  async function toggleCoils(p: Part) {
    if (!coilStk || p.coilCount <= 0) return;
    if (coils[p.ptId]) {
      setCoils((c) => {
        const n = { ...c };
        delete n[p.ptId];
        return n;
      });
      return;
    }
    setCoils((c) => ({ ...c, [p.ptId]: "loading" }));
    try {
      const r = await api<CoilRow[]>(`/products/${p.ptId}/coils`, { query: { stkId: coilStk } });
      setCoils((c) => ({ ...c, [p.ptId]: r }));
    } catch {
      setCoils((c) => ({ ...c, [p.ptId]: [] }));
    }
  }

  const input = (label: string, k: keyof Form, opt: { list?: string; numeric?: boolean; placeholder?: string } = {}) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      <input
        className="field"
        list={opt.list}
        inputMode={opt.numeric ? "numeric" : undefined}
        placeholder={opt.placeholder}
        value={(form[k] as string) ?? ""}
        onChange={(e) => setForm({ ...form, [k]: opt.numeric ? e.target.value.replace(/\D/g, "") : e.target.value })}
      />
    </label>
  );

  const cell = (p: Part, c: string) => {
    switch (c) {
      case "IMAGE":
        return (
          <td key={c}>
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" className="h-12 w-12 rounded-lg bg-surface-2 object-contain" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-surface-2 text-line">▣</div>
            )}
          </td>
        );
      case "SUPPLIER":
        return <td key={c}>{p.supplier}</td>;
      case "CUSTOMER":
        return <td key={c}>{p.customer}</td>;
      case "CATEGORY":
        return <td key={c}>{p.category}</td>;
      case "PARTA":
        return <td key={c}>{p.partA}</td>;
      case "PARTB":
        return <td key={c}>{p.partB}</td>;
      case "MODEL":
        return <td key={c}>{p.model}</td>;
      case "CODE":
        return (
          <td key={c} className="whitespace-nowrap">
            <button className={`font-extrabold ${coilStk && p.coilCount > 0 ? "text-accent hover:underline" : "cursor-default text-primary"}`} onClick={() => toggleCoils(p)}>
              {p.partCode} {coilStk && p.coilCount > 0 && <Badge color="var(--accent)">🧲 {p.coilCount}</Badge>}
            </button>
          </td>
        );
      case "PARTNO":
        return <td key={c}>{p.partNo}</td>;
      case "NAME":
        return <td key={c} className="min-w-[220px]">{p.partName}</td>;
      case "PACKSIZE":
        return <td key={c} className="text-right">{p.packSize}</td>;
      case "BIN":
        return <td key={c}>{p.location}</td>;
      case "MOTHER":
        return <td key={c} className="whitespace-pre-line text-xs">{p.motherCoil}</td>;
      case "COILNO":
        return <td key={c} className="whitespace-pre-line text-xs">{p.coilNo}</td>;
      case "QRCODE":
        return <td key={c} className="max-w-[160px] truncate font-mono text-xs" title={p.qrCodeData}>{p.qrCodeData}</td>;
      default:
        return <td key={c} />;
    }
  };

  const stockChip = (id: number | "main", text: string, on: boolean, title?: string) => (
    <button
      key={String(id)}
      type="button"
      title={title}
      onClick={() => toggleStock(id)}
      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${on ? "border-accent bg-accent text-white" : "border-line bg-surface hover:border-accent"}`}
    >
      {text}
    </button>
  );

  const allTicked = (rows ?? []).length > 0 && (rows ?? []).every((r) => ticked.includes(r.ptId));
  const ncols = cols.length + 2;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/InventoryRegistration.png"
        title="INVENTORY REGISTRATION"
        subtitle="ลงทะเบียนสินค้า / แก้ไข / QR CODE"
        actions={
          <>
            <ActionMenu
              caption={["EXCEL · QR", can.admin ? "TEMPLATE · IMPORT · QR · ADMIN" : "TEMPLATE · IMPORT · QR"]}
              actions={[
                ...(can.add
                  ? [
                      {
                        key: "template",
                        title: "TEMPLATE EXCEL",
                        detail: "ดาวน์โหลดไฟล์ต้นแบบสำหรับลงทะเบียนสินค้า เลือกคลังได้ คอลัมน์ตาม Store (Max-Min) ของคลังนั้น",
                        color: "#7c3aed",
                        icon: "template" as const,
                        onClick: async () => {
                          setTplOptions(await api("/products/template/options"));
                          setTplOpen(true);
                        },
                      },
                      {
                        key: "import",
                        title: busy ? "IMPORTING..." : "IMPORT EXCEL",
                        detail: "นำเข้าไฟล์ Excel (.xlsx) ตามรูปแบบ Template ตรวจสรุปก่อนยืนยันลงทะเบียน",
                        color: "#0284c7",
                        icon: "import" as const,
                        busy,
                        onClick: () => fileRef.current?.click(),
                      },
                    ]
                  : []),
                {
                  key: "qr",
                  title: `EXPORT QR CODE${ticked.length > 0 ? ` (${ticked.length})` : ""}`,
                  detail: "ส่งออกป้าย QR Code ของสินค้าที่ติ๊กไว้ หรือทั้งหมดในคลังที่เลือกอยู่",
                  color: "#16a34a",
                  icon: "qr" as const,
                  onClick: openExport,
                },
                ...(can.admin
                  ? [{ key: "admin", title: "ADMIN", detail: "จัดการขั้นสูง (Admin Level 1): ลบสินค้าตามคลัง / ตั้งคอลัมน์ตาราง / รูปแบบ QR CODE", color: "#334155", icon: "admin" as const, onClick: () => setAdmin(true) }]
                  : []),
              ]}
            />
            {can.add && (
              <>
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
              </>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {/* ฟอร์มลงทะเบียน / แก้ไข: อยู่ด้านบนแบบ WPF (รูป + QR ซ้าย · ช่องกรอก 5 คอลัมน์ · STOCK · ปุ่ม) ตารางอยู่ด้านล่าง */}
        <div id="reg-form" className="scroll-mt-4">
          <Card
            title={editId ? "✏️ EDIT PRODUCT" : viewId ? "👁 VIEW PRODUCT" : "＋ REGISTER PRODUCT"}
            actions={
              (editId || viewId || form.partCode) && (
                <button className="btn-ghost px-3 py-1 text-xs" onClick={clear}>
                  CLEAR
                </button>
              )
            }
            bodyClass="p-4 md:p-5"
            clip={false}
          >
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="flex shrink-0 flex-row items-start gap-3 sm:flex-col sm:items-center">
                <button
                  type="button"
                  disabled={!(can.add || can.edit)}
                  onClick={() => imgRef.current?.click()}
                  className="reg-img group grid size-[132px] place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-surface-2 text-xs font-bold text-ink-soft transition hover:border-accent sm:size-[150px]"
                  title="เลือกรูปสินค้า"
                >
                  {form.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.imageUrl} alt="" className="h-full w-full object-contain p-1.5 transition group-hover:scale-105" />
                  ) : (
                    <span className="grid place-items-center gap-1">
                      <svg viewBox="0 0 24 24" className="size-8 text-line transition group-hover:text-accent" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                        <circle cx="9" cy="10" r="1.8" />
                        <path d="m4.5 17.5 5-5 3.5 3.5 2.5-2.5 4 4" />
                      </svg>
                      SELECT IMAGE
                    </span>
                  )}
                </button>
                <input
                  ref={imgRef}
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) uploadImage(f);
                  }}
                />
                <div className="rounded-xl border border-line/70 bg-white p-1.5" title="QR CODE = PRODUCT CODE">
                  <QrImage text={form.partCode.trim()} size={96} />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                {/* ลำดับช่องตาม WPF: SUPPLIER, CUSTOMER, CATEGORY, PART A, PART B / MODEL, PRODUCT CODE, PART NO, PRODUCT NAME, PACKSIZE / BIN, MASTER COIL, COIL NO, COIL WEIGHT, QR CODE */}
                <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                  {input("SUPPLIER", "supplier", { list: "dl-sup" })}
                  {input("CUSTOMER", "customer", { list: "dl-cus" })}
                  {input("CATEGORY", "category", { list: "dl-cat" })}
                  {input("PART A", "partA")}
                  {input("PART B", "partB")}
                  {input("MODEL", "model")}
                  <div className="relative">
                    {input("PRODUCT CODE", "partCode")}
                    {codeSuggest.length > 0 && !editId && (
                      <div className="absolute z-30 mt-1 max-h-60 w-[min(360px,80vw)] overflow-auto rounded-xl border border-line bg-surface shadow-xl">
                        {codeSuggest.map((p) => (
                          <button
                            key={p.ptId}
                            type="button"
                            className="block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-surface-2"
                            onClick={() => {
                              setCodeSuggest([]);
                              fill(p, can.edit);
                              search(p.partCode);
                              toast.show("PRODUCT CODE", `ดึงข้อมูล ${p.partCode} มาแล้ว - แก้ / เพิ่ม Coil แล้วกด SAVE CHANGES`, "info");
                            }}
                          >
                            <div className="text-sm font-extrabold text-primary">
                              {p.partCode} {p.partA && <span className="text-ink-soft">• PART A {p.partA}</span>}
                            </div>
                            <div className="truncate text-xs">{p.partName}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {input("PART NO", "partNo")}
                  {input("PRODUCT NAME", "partName")}
                  {input("PACKSIZE", "packSize", { numeric: true })}
                  {input("BIN", "bin")}
                  {meta.hasCoilRegister && (
                    <>
                      {input("MASTER COIL", "masterCoil")}
                      {input("COIL NO", "coilNo")}
                      {input("COIL WEIGHT (KG)", "coilKg", { placeholder: "0.000" })}
                    </>
                  )}
                  {input("QR CODE (SUPPLIER)", "qrCode")}
                </div>
                {meta.hasCoilRegister && coilText && <div className="mt-2 text-xs font-bold text-accent">🧲 {coilText}</div>}
                <datalist id="dl-sup">{meta.suggestions.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
                <datalist id="dl-cat">{meta.suggestions.categories.map((s) => <option key={s} value={s} />)}</datalist>
                <datalist id="dl-cus">{meta.suggestions.customers.map((s) => <option key={s} value={s} />)}</datalist>

                <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-end">
                  <div className="min-w-0 flex-1">
                    <span className="mb-2 block text-[11px] font-extrabold uppercase text-ink-soft">STOCK</span>
                    <div className="flex flex-wrap gap-2">
                      {meta.stocks.map((s) => (s.isMain ? stockChip("main", s.code, inMain, s.name) : stockChip(s.stkId, s.code, others.includes(s.stkId), s.name)))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {editId ? (
                      can.edit && (
                        <button className="btn bg-success min-w-[180px]" disabled={busy} onClick={() => save(true)}>
                          💾 SAVE CHANGES
                        </button>
                      )
                    ) : (
                      can.add && (
                        <button className="btn bg-accent min-w-[180px]" disabled={busy} onClick={() => save(false)}>
                          ＋ PART REGISTRATION
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ตารางสินค้า */}
        <Card
          title={`PRODUCTS • ${total.toLocaleString()}`}
          actions={
            <>
              <MenuSelect
                className="w-[200px]"
                value={filter == null ? "" : String(filter)}
                options={[{ value: "", label: "ALL STOCKS" }, ...meta.stocks.map((s) => ({ value: String(s.stkId), label: s.code }))]}
                onChange={(v) => changeFilter(v ? Number(v) : null)}
              />
            </>
          }
        >
          <div className="border-b border-line/60 p-3">
            <SearchBox value={key} onChange={search} placeholder="ค้นหา PRODUCT CODE / ชื่อ / PART A / BIN / COIL" />
          </div>
          <div ref={listRef} className="max-h-[calc(100dvh-280px)] min-h-[360px] overflow-auto">
            {!rows ? (
              <Loading />
            ) : rows.length === 0 ? (
              <Empty />
            ) : (
              <table className="data-table t-center w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>
                      <input type="checkbox" checked={allTicked} onChange={(e) => setTicked(e.target.checked ? rows.map((r) => r.ptId) : [])} />
                    </th>
                    {cols.map((c) => (
                      <th key={c}>{label(c)}</th>
                    ))}
                    <th className="text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.key || "_"}>
                      {g.key && <GroupRow colSpan={ncols} label={layout?.groupBy ?? ""} value={g.key} count={groupCounts[g.key] ?? g.items.length} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)} />}
                      {!collapsed.has(g.key) && g.items.map((p) => (
                        <Fragment key={p.ptId}>
                          <tr className={`${viewId === p.ptId ? "bg-accent-soft/40" : ""} ${p.isShow ? "" : "[&>td:not(:last-child)]:opacity-50"}`}>
                            <td>
                              <input type="checkbox" checked={ticked.includes(p.ptId)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, p.ptId] : t.filter((x) => x !== p.ptId)))} />
                            </td>
                            {cols.map((c) => cell(p, c))}
                            <td className="whitespace-nowrap text-right">
                              <RowActions>
                                <RowAction kind="view" active={viewId === p.ptId && !editId} onClick={() => (viewId === p.ptId && !editId ? clear() : fill(p, false))} />
                                {can.edit && <RowAction kind="edit" active={editId === p.ptId} title={editId === p.ptId ? "CANCEL EDIT" : "EDIT"} onClick={() => (editId === p.ptId ? clear() : fill(p, true))} />}
                                {can.edit && <RowAction kind="hide" shown={p.isShow} onClick={() => toggleShow(p)} />}
                                {can.delete && <RowAction kind="delete" onClick={() => remove(p)} />}
                              </RowActions>
                            </td>
                          </tr>
                          {coils[p.ptId] && (
                            <tr>
                              <td colSpan={ncols} className="bg-[#f8f6fd] p-2 text-xs">
                                {coils[p.ptId] === "loading"
                                  ? "⏳ LOADING COILS..."
                                  : (coils[p.ptId] as CoilRow[]).map((r) => (
                                      <div key={r.coilId + (r.isMother ? "m" : "c")} className={`flex gap-4 px-2 py-1 ${r.isMother ? "font-extrabold text-accent" : "text-ink-soft"}`}>
                                        <span className="w-8 text-right">{r.isMother ? "" : r.no}</span>
                                        <span className="w-44">{r.isMother ? `MASTER ${r.coilNo}` : `↳ ${r.coilNo}`}</span>
                                        <span className="w-28">{r.motherCoil || "-"}</span>
                                        <span className="w-28 text-right">{qty(r.weightKG)} KG</span>
                                        <span>{r.received}</span>
                                      </div>
                                    ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {total > PAGE && (
            <div className="border-t border-line/60 pt-4">
              <Pager page={Math.min(page, pages - 1)} pages={pages} total={total} size={PAGE} onPage={goPage} />
            </div>
          )}
        </Card>
      </div>

      {/* 📄 TEMPLATE: เลือกคลัง -> คอลัมน์ตาม Store (Max-Min) ของคลังนั้น */}
      <Modal open={tplOpen} wide title="📄 TEMPLATE EXCEL" onClose={() => setTplOpen(false)}>
        <p className="mb-3 text-sm font-semibold text-ink-soft">เลือกคลัง: ระบบสร้าง Template ตามคอลัมน์ที่คลังนั้นแสดงใน Store (Max-Min)</p>
        <div className="grid gap-2">
          {[{ stkId: 0, code: "ALL COLUMNS (ทุกคลัง)", name: "", heads: "ทุกคอลัมน์ที่ระบบอ่านได้ ใส่รหัสคลังเองที่ STOCK1 - STOCK3", countCoil: false }, ...tplOptions].map((o) => (
            <button
              key={o.stkId}
              className="rounded-xl border-2 border-line p-3 text-left hover:border-accent"
              onClick={async () => {
                setTplOpen(false);
                try {
                  await download("/products/template", { stkId: o.stkId || undefined });
                } catch (e) {
                  toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + (e as Error).message, "error");
                }
              }}
            >
              <div className="font-extrabold text-primary">
                {o.code} {o.name && <span className="text-ink-soft">• {o.name}</span>}
              </div>
              <div className="text-xs">{o.heads}</div>
            </button>
          ))}
        </div>
      </Modal>

      {/* ▣ EXPORT QR: ที่ติ๊กไว้ / ทั้งหมดในคลัง */}
      <Modal open={!!exportOpen} title="▣ EXPORT QR" onClose={() => setExportOpen(null)}>
        <p className="mb-3 text-sm font-semibold text-ink-soft">QR CODE ตามรูปแบบที่ตั้งไว้ของ {filterStock?.code ?? "ALL STOCKS"} (ปุ่ม ADMIN &gt; QR CODE)</p>
        <div className="grid gap-2">
          <button className="rounded-xl border-2 border-line p-4 text-left hover:border-accent disabled:opacity-50" disabled={ticked.length === 0} onClick={() => exportQr("SELECTED")}>
            <div className="font-extrabold text-primary">☑ EXPORT SELECTED ({ticked.length.toLocaleString()})</div>
            <div className="text-xs">{ticked.length === 0 ? "ยังไม่ได้ติ๊กรายการในตาราง" : `เฉพาะ ${ticked.length} รายการที่ติ๊กไว้ในตาราง`}</div>
          </button>
          <button className="rounded-xl border-2 border-line p-4 text-left hover:border-accent" onClick={() => exportQr("ALL")}>
            <div className="font-extrabold text-primary">
              ▦ EXPORT ALL IN {filterStock?.code ?? "ALL STOCKS"} ({exportOpen?.all.toLocaleString()})
            </div>
            <div className="text-xs">สินค้าทั้งหมดในคลัง (ไม่ต้องติ๊ก / ไม่ขึ้นกับคำค้นหา)</div>
          </button>
        </div>
      </Modal>

      {admin && (
        <AdminModal
          ticked={ticked}
          onClose={(changed) => {
            setAdmin(false);
            if (changed) {
              setTicked([]);
              reload();
            }
          }}
        />
      )}
    </PageBody>
  );
}
