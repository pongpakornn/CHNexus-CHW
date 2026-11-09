"use client";

import { GroupRow, useCollapsed } from "@/components/tables/GroupRow";
import { ActionMenu } from "@/components/menus/ActionMenu";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { Pager } from "@/components/tables/Pager";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { QrImage } from "@/components/print/QrImage";
import { RowAction, RowActions } from "@/components/button-action/RowAction";
import { ChoiceCard, Glyph, GLYPH } from "@/components/buttons/ChoiceCard";
import { PickingExport, type PickingReq } from "./PickingExport";
import { stockIcon } from "@/lib/stockIcons";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { AdminModal } from "./AdminModal";
import { LayoutQrPicker } from "./LayoutQrPicker";
import { createPortal } from "react-dom";
import { CoilPanel, type CoilRow } from "./CoilPanel";
import { EMPTY_FORM, formOf, type Form, type Layout, type Meta, type Part } from "./types";

const PAGE = 100;

// ช่องกรอกของคลัง (ADMIN > FORM FIELDS) -> ช่องในฟอร์ม · ALL FIELDS = ทุกช่อง
const FIELDS: Record<string, [string, keyof Form, { list?: string; numeric?: boolean; placeholder?: string }?]> = {
  SUPPLIER: ["SUPPLIER", "supplier", { list: "dl-sup" }],
  CUSTOMER: ["CUSTOMER", "customer", { list: "dl-cus" }],
  CATEGORY: ["CATEGORY", "category", { list: "dl-cat" }],
  PARTA: ["PART A", "partA"],
  PARTB: ["PART B", "partB"],
  MODEL: ["MODEL", "model"],
  PARTNO: ["PART NO", "partNo"],
  PACKSIZE: ["PACKSIZE", "packSize", { numeric: true }],
  BIN: ["BIN", "bin"],
  QRCODE: ["QR CODE (SUPPLIER)", "qrCode"],
};
const ALL_FIELDS = ["IMAGE", "SUPPLIER", "CUSTOMER", "CATEGORY", "MODEL", "CODE", "PARTA", "PARTB", "PARTNO", "NAME", "PACKSIZE", "BIN", "MOTHER", "COILNO", "WEIGHT", "QRCODE"];

// 🏷️ MASTER DATA › PRODUCT CONTROL (เดิม INVENTORY REGISTRATION) - ฟอร์มลงทะเบียน / แก้ไข + ตารางสินค้าตามคลัง
//   type = ประเภทคลังจากเมนู (PRODUCT = Part Information / MATERIAL / COMPONENT …) -> เห็น / ลงทะเบียนเฉพาะคลังประเภทนั้น
//   stk  = คลังที่เลือกจากเมนูย่อย (เช่น STORE-PC) · ไม่ส่งทั้งคู่ = ทุกคลังแบบเดิม
export default function InventoryPage({ type, stk, title }: { type?: string; stk?: number; title?: string }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const [edpOnly, setEdpOnly] = useState(false); // 🏭 FILTER EDP: เฉพาะชิ้นงานที่ระบบ EDP ใช้ (STORE-PC)
  const [formStk, setFormStk] = useState<number | null>(null); // คลังที่ลงทะเบียน -> ช่องกรอกตามคอลัมน์ของคลังนั้น (null = ทุกช่อง)
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
  const [layoutQr, setLayoutQr] = useState(false); // ▣ EXPORT QR CODE LAYOUT
  const [tplOpen, setTplOpen] = useState(false);
  const [tplOptions, setTplOptions] = useState<{ stkId: number; code: string; name: string; heads: string; countCoil: boolean }[]>([]);
  const [exportOpen, setExportOpen] = useState<{ all: number } | null>(null);
  const [picking, setPicking] = useState<PickingReq | null>(null);
  const closePicking = useCallback(() => setPicking(null), []);
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
        if (id && m.stocks.some((s) => s.stkId === id && !s.isMain && s.canAdd)) ids.push(id);
      }
      if (!main && ids.length === 0) main = true;
    }
    // ติ๊กได้เฉพาะคลังที่มีสิทธิ์เพิ่ม - คลังหลักไม่มีสิทธิ์ = ใช้คลังแรกที่มีสิทธิ์แทน
    const mainOk = m.stocks.some((s) => s.isMain && s.canAdd);
    if (main && !mainOk) {
      main = false;
      const first = m.stocks.find((s) => !s.isMain && s.canAdd);
      if (ids.length === 0 && first) ids.push(first.stkId);
    }
    setInMain(main);
    setOthers(ids);
  }, []);

  useEffect(() => {
    api<Meta>("/products/meta")
      .then((raw) => {
        const m: Meta = type ? { ...raw, canAll: false, stocks: raw.stocks.filter((s) => (s.stockType ?? "OTHER").toUpperCase() === type) } : raw;
        const pick = (id: number | null | undefined) => (id != null && m.stocks.some((s) => s.stkId === id) ? id : null);
        const first = type ? (pick(stk) ?? pick(m.savedFilter) ?? m.stocks[0]?.stkId ?? null) : m.savedFilter;
        setMeta(m);
        setFilter(first);
        const fs = m.stocks.find((s) => s.stkId === first) ?? m.stocks.find((s) => s.isMain) ?? m.stocks[0];
        setFormStk(fs?.stkId ?? null);
        applyDefaultStocks(m);
        if (fs?.canAdd) {
          setInMain(fs.isMain);
          setOthers(fs.isMain ? [] : [fs.stkId]);
        }
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast, applyDefaultStocks, type, stk]);

  const query = useCallback(
    (skip: number) => api<{ total: number; layout: Layout; coilStkId: number | null; groups?: Record<string, number>; rows: Part[] }>("/products", { query: { key: k, stkId: filter ?? undefined, skip, take: PAGE, edp: edpOnly || undefined } }),
    [k, filter, edpOnly],
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

  // PRODUCT CODE: แนะนำสินค้าที่มีแล้ว (เลือก = ดึงข้อมูลมาใส่ช่องเพื่อลงทะเบียนใหม่ - แก้สินค้าเดิมกด EDIT ในตาราง)
  const pickedCode = useRef<string | null>(null);
  useEffect(() => {
    if (editId || viewId || codeKey.trim().length < 2 || codeKey === pickedCode.current) {
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
  }, [codeKey, editId, viewId]);

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

  // ☰ ช่วยกรอก: ค่าที่เคยกรอก (โหลดครั้งแรกที่คลิกช่อง)
  const [cfSug, setCfSug] = useState<Record<number, string[]>>({});
  const loadSug = (id: number) => {
    if (cfSug[id]) return;
    setCfSug((m) => ({ ...m, [id]: [] }));
    api<string[]>(`/products/fields/${id}/suggest`)
      .then((list) => setCfSug((m) => ({ ...m, [id]: list })))
      .catch(() => {});
  };
  // ⚡ เติมอัตโนมัติ: ช่องต้นทางเปลี่ยน -> หาค่าจากสินค้าที่เคยกรอกค่าต้นทางเดียวกัน (เติมเฉพาะช่องว่าง / ช่องที่ระบบเติมไว้เอง)
  const autoSet = useRef<Record<string, string>>({});
  const SRC_FORM: Record<string, keyof Form> = { SUPPLIER: "supplier", CUSTOMER: "customer", CATEGORY: "category", MODEL: "model", CODE: "partCode", NAME: "partName", PARTA: "partA", PARTB: "partB", PARTNO: "partNo", BIN: "bin", PACKSIZE: "packSize" };
  const srcOf = (from: string) => (SRC_FORM[from] ? String(form[SRC_FORM[from]] ?? "") : (form.cf[from] ?? "")).trim();
  const autoDeps = (meta?.customFields ?? []).filter((d) => d.autoFrom).map((d) => `${d.key}=${srcOf(d.autoFrom!)}`).join("|");
  useEffect(() => {
    if (!autoDeps || (viewId && !editId)) return;
    const t = setTimeout(() => {
      for (const d of (meta?.customFields ?? []).filter((x) => x.autoFrom && (formStk == null || x.stockId === formStk))) {
        const v = srcOf(d.autoFrom!);
        if (!v) continue;
        api<{ value: string | null }>(`/products/fields/${d.fieldId}/auto`, { query: { value: v } })
          .then((r) => {
            if (!r.value) return;
            setForm((f) => {
              const cur = f.cf[d.key] ?? "";
              if (cur && cur !== autoSet.current[d.key]) return f; // ผู้ใช้กรอกเองแล้ว = ไม่ทับ
              autoSet.current[d.key] = r.value!;
              return { ...f, cf: { ...f.cf, [d.key]: r.value! } };
            });
          })
          .catch(() => {});
      }
    }, 450);
    return () => clearTimeout(t);
  }, [autoDeps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta) return <Loading />;
  if (meta.stocks.length === 0)
    return (
      <PageBody className="md-gray">
        <Empty>ไม่มีคลังประเภทนี้ที่คุณมีสิทธิ์ดู (ติดต่อ Admin เพื่อขอสิทธิ์คลัง)</Empty>
      </PageBody>
    );
  const filterStock = meta.stocks.find((s) => s.stkId === filter) ?? null;
  // 🔒 สิทธิ์ของหน้า (ProductControl) + สิทธิ์ของคลังที่ดูอยู่ (ALL STOCKS = มีสิทธิ์อย่างน้อย 1 คลัง)
  //    VIEW = ดูอย่างเดียว · EDIT = แก้ไข / ซ่อน · DEL = ลบ · ADMIN = เฉพาะ Admin Level 1
  const inScope = (k: "canAdd" | "canEdit" | "canDelete") => (filterStock ? filterStock[k] : meta.stocks.some((s) => s[k]));
  const can = {
    add: meta.can.add && meta.stocks.some((s) => s.canAdd),
    edit: meta.can.edit && inScope("canEdit"),
    delete: meta.can.delete && inScope("canDelete"),
    admin: meta.can.admin,
  };
  const cols = layout?.columns ?? [];
  // ช่องกรอกของคลังที่เลือกในหัว REGISTER PRODUCT
  const formStock = meta.stocks.find((s) => s.stkId === formStk) ?? null;
  const formCols = formStk == null ? null : (meta.layouts.find((l) => l.stkId === formStk)?.layout.formFields ?? null);
  const fieldKeys = formCols && formCols.length > 0 ? formCols : ALL_FIELDS;
  const showImage = fieldKeys.includes("IMAGE");
  // คลังที่นับ Coil: MASTER / COIL NO / WEIGHT = ของ Coil · คลังอื่น: WEIGHT = น้ำหนักสินค้า
  const coilForm = meta.hasCoilRegister && (formStock ? formStock.countCoil : true);
  const showPartWeight = !!formStock && !formStock.countCoil && fieldKeys.includes("WEIGHT");
  const cfDefs = meta.customFields ?? [];
  const label = (k: string) => meta.columns.find((c) => c.key === k)?.label ?? cfDefs.find((f) => f.key === k)?.label ?? k;
  // ➕ ช่องกรอกเพิ่มเอง: TEXT / NUMBER / DATE
  const cfInput = (k: string) => {
    const d = cfDefs.find((f) => f.key === k);
    if (!d) return null;
    return (
      <label className="block">
        <span className="mb-1 block truncate text-[11px] font-extrabold uppercase text-ink-soft" title={d.label}>
          {d.label}
          {d.unit ? ` (${d.unit})` : ""}
          {d.isNew && <span className="cf-new">NEW</span>}
          {d.autoFrom && <span className="ml-1 text-accent" title="เติมอัตโนมัติ">⚡</span>}
        </span>
        {d.type === "SELECT" ? (
          <MenuSelect
            compact
            className="w-full"
            value={form.cf[k] ?? ""}
            options={[{ value: "", label: "— เลือก —" }, ...(form.cf[k] && !(d.options ?? []).includes(form.cf[k]) ? [form.cf[k]] : []), ...(d.options ?? [])].map((o) => (typeof o === "string" ? { value: o, label: o } : o))}
            onChange={(v) => setForm({ ...form, cf: { ...form.cf, [k]: v } })}
          />
        ) : (
        <>
        <input
          className="field"
          type={d.type === "DATE" ? "date" : "text"}
          inputMode={d.type === "NUMBER" ? "decimal" : undefined}
          list={d.suggest && d.type !== "DATE" ? `dl-cf-${d.fieldId}` : undefined}
          onFocus={d.suggest ? () => loadSug(d.fieldId) : undefined}
          value={form.cf[k] ?? ""}
          onChange={(e) => setForm({ ...form, cf: { ...form.cf, [k]: d.type === "NUMBER" ? e.target.value.replace(/[^\d.,-]/g, "") : e.target.value } })}
        />
        {d.suggest && (
          <datalist id={`dl-cf-${d.fieldId}`}>
            {(cfSug[d.fieldId] ?? []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        )}
        </>
        )}
      </label>
    );
  };

  function clear() {
    pickedCode.current = null;
    setForm(EMPTY_FORM);
    setEditId(null);
    setViewId(null);
    setOldCode(null);
    setCoilText(null);
    if (meta) applyDefaultStocks(meta);
    // มีคลังที่เลือกไว้ในหัวฟอร์ม = ลงทะเบียนเข้าคลังนั้น
    const fs = meta?.stocks.find((x) => x.stkId === formStk);
    if (fs?.canAdd) {
      setInMain(fs.isMain);
      setOthers(fs.isMain ? [] : [fs.stkId]);
    }
  }

  // 📋 เลือกจากรายการแนะนำ: คัดลอกข้อมูลมาใส่ช่องอย่างเดียว (ยังเป็นการลงทะเบียนใหม่ - ไม่แตะสินค้าเดิม · คลังที่เลือกไว้คงเดิม)
  async function copyFrom(p: Part) {
    pickedCode.current = p.partCode;
    setForm({ ...formOf(p) });
    setCoilText(null);
    try {
      const d = await api<{ partWeight: number | null; cf?: Record<string, string> }>(`/products/${p.ptId}/detail`, { query: { code: p.partCode, stkId: filter ?? undefined } });
      setForm((f) => (f.partCode === p.partCode ? { ...f, partWeight: d.partWeight == null ? "" : String(d.partWeight), cf: { ...(d.cf ?? {}) } } : f));
    } catch {
      /* ใช้ข้อมูลจากรายการแนะนำ */
    }
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
      const d = await api<{ stockIds: number[]; coilText: string | null; partWeight: number | null; cf?: Record<string, string> }>(`/products/${p.ptId}/detail`, { query: { code: p.partCode, stkId: filter ?? undefined } });
      setInMain(p.isShowMain);
      setOthers(d.stockIds);
      setCoilText(d.coilText);
      setForm((f) => ({ ...f, partWeight: d.partWeight == null ? "" : String(d.partWeight), cf: { ...(d.cf ?? {}) } }));
    } catch {
      /* แสดงข้อมูลได้แม้โหลดคลังไม่สำเร็จ */
    }
  }

  async function changeFilter(v: number | null) {
    if (!editId && !viewId && v != null) {
      setFormStk(v);
      const s = meta?.stocks.find((x) => x.stkId === v);
      if (s?.canAdd) {
        setInMain(s.isMain);
        setOthers(s.isMain ? [] : [s.stkId]);
      }
    }
    setEdpOnly(false);
    setFilter(v);
    setPage(0);
    setCoils({});
    api("/products/filter", { method: "POST", body: v }).catch(() => {});
  }



  async function save(isEdit: boolean) {
    if (!form.partCode.trim()) return toast.show("WARNING", "กรุณากรอกรหัสสินค้าก่อนทำการลงทะเบียนครับ", "warn");
    if (form.packSize.trim() && !/^\d+$/.test(form.packSize.trim())) return toast.show("WARNING", "PACKSIZE ต้องเป็นตัวเลขเท่านั้นครับ", "warn");
    if (!inMain && others.length === 0) return toast.show("WARNING", "กรุณาเลือกคลัง (STOCK) อย่างน้อย 1 คลังครับ", "warn");
    setBusy(true);
    try {
      // ➕ ส่งเฉพาะช่องเพิ่มเองที่อยู่ในฟอร์มของคลังนี้ (ช่องอื่นของสินค้าไม่แตะ) · ว่าง = ล้างค่า
      const cf = Object.fromEntries(fieldKeys.filter((k) => k.startsWith("CF") && cfDefs.some((d) => d.key === k)).map((k) => [k, form.cf[k] ?? ""]));
      const body = { ...form, cf, partWeight: showPartWeight ? form.partWeight : undefined, inMain, otherStockIds: others, filterStkId: filter, oldCode };
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
    await loadCoils(p.ptId);
  }

  async function loadCoils(ptId: number) {
    try {
      const r = await api<CoilRow[]>(`/products/${ptId}/coils`, { query: { stkId: coilStk } });
      setCoils((c) => ({ ...c, [ptId]: r }));
    } catch {
      setCoils((c) => ({ ...c, [ptId]: [] }));
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
      // คลังที่นับ Coil: ป้ายสรุป (กด = กางรายการ Coil จัดกลุ่มตาม Master แก้ / ลบได้) · คลังอื่นแสดงข้อความเดิม
      case "MOTHER":
        return (
          <td key={c} className="whitespace-pre-line text-xs">
            {coilStk && p.coilCount > 0 ? (
              <button type="button" className={`coil-chip ${coils[p.ptId] ? "is-open" : ""}`} onClick={() => toggleCoils(p)} title={p.motherCoil ?? ""}>
                {p.masterCount.toLocaleString()} MASTER
              </button>
            ) : (
              p.motherCoil
            )}
          </td>
        );
      case "COILNO":
        return (
          <td key={c} className="whitespace-pre-line text-xs">
            {coilStk && p.coilCount > 0 ? (
              <button type="button" className={`coil-chip is-coil ${coils[p.ptId] ? "is-open" : ""}`} onClick={() => toggleCoils(p)}>
                {p.coilCount.toLocaleString()} COIL
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            ) : (
              p.coilNo
            )}
          </td>
        );
      case "QRCODE":
        return <td key={c} className="max-w-[160px] truncate font-mono text-xs" title={p.qrCodeData}>{p.qrCodeData}</td>;
      default:
        return c.startsWith("CF") ? (
          <td key={c} className="max-w-[200px] break-words text-sm font-semibold">
            {p.cf?.[c] || "-"}
          </td>
        ) : (
          <td key={c} />
        );
    }
  };


  const allTicked = (rows ?? []).length > 0 && (rows ?? []).every((r) => ticked.includes(r.ptId));
  const ncols = cols.length + 2;

  return (
    <PageBody className="md-gray">
      <PageHeader
        icon="/icons/InventoryRegistration.png"
        title={title ?? "PRODUCT CONTROL"}
        subtitle={`MASTER DATA · ลงทะเบียนสินค้า / แก้ไข / QR CODE${type ? ` · ${meta.stocks.map((s) => s.code).join(" · ")}` : ""}`}
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
                {
                  key: "qr-layout",
                  title: "EXPORT QR CODE LAYOUT",
                  detail: "ส่งออก QR ตำแหน่งจัดเก็บ (Locations จาก LAYOUT SETUP) เลือกจากตาราง แล้ว Export PDF แบบเดียวกับ QR สินค้า",
                  color: "#6750a4",
                  icon: "qr" as const,
                  onClick: () => setLayoutQr(true),
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
        <div id="reg-form" className="relative z-30 scroll-mt-4">
          <Card
            title={editId ? "✏️ EDIT PRODUCT" : viewId ? "👁 VIEW PRODUCT" : "＋ REGISTER PRODUCT"}
            actions={
              <>
                {(editId || viewId || form.partCode) && (
                  <button className="fill-btn is-sm" onClick={clear}>
                    CLEAR
                  </button>
                )}
                {formStock && <span className="md-status is-on">STOCK · {formStock.code}</span>}
              </>
            }
            bodyClass="p-4 md:p-5"
            clip={false}
          >
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className={`flex shrink-0 flex-row items-start gap-3 sm:flex-col sm:items-center ${showImage ? "" : "hidden"}`}>
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
                {/* ช่องกรอกตามคลังที่เลือก (ADMIN > FORM FIELDS ของคลังนั้น) เรียงตามที่ตั้ง: PRODUCT CODE / NAME ทุกคลัง · COIL เฉพาะคลังที่นับ Coil
                    ALL FIELDS = ทุกช่อง · ช่องที่ซ่อนไม่ถูกล้างค่า (แก้สินค้าแล้วค่าเดิมยังอยู่) */}
                <div key={formStk ?? "all"} className="reg-fields grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                  {fieldKeys.map((k) => {
                    switch (k) {
                      case "IMAGE":
                        return null;
                      case "CODE":
                        return (
                          <Fragment key={k}>
                        <div className="relative">
                          {input("PRODUCT CODE", "partCode")}
                          {codeSuggest.length > 0 && !editId && !viewId && (
                            <div className="absolute z-30 mt-1 max-h-60 w-[min(360px,80vw)] overflow-auto rounded-xl border border-line bg-surface shadow-xl">
                              {codeSuggest.map((p) => (
                                <button
                                  key={p.ptId}
                                  type="button"
                                  className="block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-surface-2"
                                  onClick={() => {
                                    setCodeSuggest([]);
                                    copyFrom(p);
                                    toast.show("PRODUCT CODE", `ดึงข้อมูล ${p.partCode} มาใส่ช่องแล้ว - แก้ค่าที่ต้องการแล้วกด ＋ PART REGISTRATION เพื่อเพิ่มใหม่ (แก้สินค้าเดิมกด EDIT ในตาราง)`, "info");
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
                          </Fragment>
                        );
                      case "NAME":
                        return <Fragment key={k}>{input("PRODUCT NAME", "partName")}</Fragment>;
                      case "MOTHER":
                        return coilForm ? <Fragment key={k}>{input("MASTER COIL", "masterCoil", { placeholder: "กรอกอย่างเดียว = Master ทั้งม้วน" })}</Fragment> : null;
                      case "COILNO":
                        return coilForm ? <Fragment key={k}>{input("COIL NO", "coilNo")}</Fragment> : null;
                      case "WEIGHT":
                        return coilForm ? (
                          <Fragment key={k}>{input("COIL WEIGHT (KG)", "coilKg", { placeholder: "0.000" })}</Fragment>
                        ) : showPartWeight ? (
                          <Fragment key={k}>{input("WEIGHT (KG)", "partWeight", { placeholder: "0.000" })}</Fragment>
                        ) : null;
                      default:
                        return FIELDS[k] ? <Fragment key={k}>{input(FIELDS[k][0], FIELDS[k][1], FIELDS[k][2])}</Fragment> : k.startsWith("CF") ? <Fragment key={k}>{cfInput(k)}</Fragment> : null;
                    }
                  })}
                </div>
                {meta.hasCoilRegister && coilText && <div className="mt-2 text-xs font-bold text-accent">{coilText}</div>}
                {/* แก้ไขสินค้า: ช่อง Coil ในฟอร์ม = เพิ่ม Coil ใหม่ · Coil เดิมแก้ / ลบ / เปลี่ยนชื่อ Master ที่แถว Coil ใต้สินค้าในตาราง */}
                {editId && coilForm && (
                  <div className="mt-1.5 text-xs font-semibold text-ink-soft">
                    ✏️ MASTER COIL / COIL NO / WEIGHT ในฟอร์มนี้ = <b>เพิ่ม Coil ใหม่</b> (กรอก MASTER อย่างเดียว + WEIGHT = Master ทั้งม้วน) · แก้ / ลบ Coil เดิม หรือเปลี่ยนชื่อ MASTER กดปุ่ม ✏ / 🗑 ที่แถว Coil ใต้สินค้าในตาราง
                  </div>
                )}
                <datalist id="dl-sup">{meta.suggestions.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
                <datalist id="dl-cat">{meta.suggestions.categories.map((s) => <option key={s} value={s} />)}</datalist>
                <datalist id="dl-cus">{meta.suggestions.customers.map((s) => <option key={s} value={s} />)}</datalist>

                <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 lg:flex-row lg:items-end">
                  <div className="min-w-0 flex-1">
                    {/* คลังที่บันทึก = คลังของหน้านี้ (แต่ละคลังมีหน้าของตัวเองที่ Sidebar) · แก้ไข = คงคลังเดิมของสินค้า */}
                    <span className="mb-2 block text-[11px] font-extrabold uppercase text-ink-soft">STOCK</span>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.stocks
                        .filter((s) => (s.isMain ? inMain : others.includes(s.stkId)))
                        .map((s) => (
                          <span key={s.stkId} className="md-status is-on" title={s.name}>
                            {s.code}
                          </span>
                        ))}
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
                        <>
                        {/* ↺ RESET: ล้างข้อมูลในช่องทั้งหมดเพื่อกรอกใหม่ (คลังที่เลือกไว้คงเดิม) */}
                        <button
                          type="button"
                          className="btn-ghost min-w-[120px]"
                          disabled={busy}
                          onClick={() => {
                            pickedCode.current = null;
                            setForm(EMPTY_FORM);
                            setCoilText(null);
                            setViewId(null);
                          }}
                        >
                          ↺ RESET
                        </button>
                        <button className="btn bg-accent min-w-[180px]" disabled={busy} onClick={() => save(false)}>
                          ＋ PART REGISTRATION
                        </button>
                        </>
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
                options={[...(meta.canAll ? [{ value: "", label: "ALL STOCKS" }] : []), ...meta.stocks.map((s) => ({ value: String(s.stkId), label: s.code }))]}
                onChange={(v) => changeFilter(v ? Number(v) : null)}
              />
              {filterStock?.code === "STORE-PC" && (
                <button
                  type="button"
                  className={`fill-btn ${edpOnly ? "is-on" : ""}`}
                  title="แสดงเฉพาะชิ้นงานที่ระบบ EDP PLANNING ใช้ (มีค่า PCS/HG · HG QTY)"
                  onClick={() => (setEdpOnly((v) => !v), setPage(0))}
                >
                  🏭 EDP {edpOnly ? "✓" : ""}
                </button>
              )}
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
                          {/* สินค้าที่มี Coil: กดที่ไหนก็ได้ในแถว = กาง / พับรายการ Master Coil / Coil (ยกเว้นปุ่ม / ช่องติ๊ก) */}
                          <tr
                            className={`${viewId === p.ptId ? "bg-accent-soft/40" : ""} ${p.isShow ? "" : "[&>td:not(:last-child)]:opacity-50"} ${coilStk && p.coilCount > 0 ? "cursor-pointer" : ""}`}
                            onClick={(e) => {
                              if (!coilStk || p.coilCount <= 0 || (e.target as HTMLElement).closest("button, input, a, label, select")) return;
                              void toggleCoils(p);
                            }}
                          >
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
                              <td colSpan={ncols} className="!p-0 text-left text-xs">
                                {coils[p.ptId] === "loading" ? (
                                  <div className="bg-[#f8f6fd] p-3">⏳ LOADING COILS...</div>
                                ) : (
                                  <CoilPanel
                                    rows={coils[p.ptId] as CoilRow[]}
                                    stkId={coilStk ?? 0}
                                    ptId={p.ptId}
                                    partCode={p.partCode}
                                    canEdit={can.edit}
                                    canDelete={can.delete}
                                    onChanged={() => {
                                      loadCoils(p.ptId);
                                      reload();
                                    }}
                                  />
                                )}
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

      {/* 📄 TEMPLATE: เลือกคลัง -> คอลัมน์ตาม Store (Max-Min) ของคลังนั้น (การ์ดแบบหน้า Store) */}
      <Modal open={tplOpen} size="xl" title="📄 TEMPLATE EXCEL" onClose={() => setTplOpen(false)}>
        <p className="mb-4 text-sm font-semibold text-ink-soft">เลือกคลัง: ระบบสร้าง Template ตามคอลัมน์ที่คลังนั้นแสดงใน Store (Max-Min)</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[{ stkId: 0, code: "ALL COLUMNS", name: "ทุกคลัง", heads: "ทุกคอลัมน์ที่ระบบอ่านได้ ใส่รหัสคลังเองที่ STOCK1 - STOCK3", countCoil: false }, ...tplOptions].map((o, i) => {
            const [ic, col] = o.stkId === 0 ? ["", "#6750a4"] : stockIcon(o.code, i);
            return (
              <ChoiceCard
                key={o.stkId}
                delay={i}
                color={col}
                // eslint-disable-next-line @next/next/no-img-element
                icon={o.stkId === 0 ? <Glyph d={GLYPH.grid} /> : <img src={ic} alt="" className="size-6 object-contain" draggable={false} />}
                title={o.code}
                detail={o.name}
                meta={o.heads}
                onClick={async () => {
                  setTplOpen(false);
                  try {
                    await download("/products/template", { stkId: o.stkId || undefined });
                  } catch (e) {
                    toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + (e as Error).message, "error");
                  }
                }}
              />
            );
          })}
        </div>
      </Modal>

      {layoutQr && createPortal(<LayoutQrPicker onClose={() => setLayoutQr(false)} />, document.body)}
      {/* ▣ EXPORT QR: ที่ติ๊กไว้ / ทั้งหมดในคลัง */}
      <Modal open={!!exportOpen} wide title="▣ EXPORT QR" onClose={() => setExportOpen(null)}>
        <p className="mb-4 text-sm font-semibold text-ink-soft">QR CODE ตามรูปแบบที่ตั้งไว้ของ {filterStock?.code ?? "ALL STOCKS"} (ปุ่ม ADMIN &gt; QR CODE)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <ChoiceCard
            color="#6750a4"
            icon={<Glyph d={GLYPH.check} />}
            title={`EXPORT SELECTED (${ticked.length.toLocaleString()})`}
            detail={ticked.length === 0 ? "ยังไม่ได้ติ๊กรายการในตาราง" : `เฉพาะ ${ticked.length} รายการที่ติ๊กไว้ในตาราง`}
            meta="PDF • QR CODE"
            disabled={ticked.length === 0}
            onClick={() => exportQr("SELECTED")}
          />
          <ChoiceCard
            delay={1}
            color="#16a34a"
            icon={<Glyph d={GLYPH.qr} />}
            title={`EXPORT ALL IN ${filterStock?.code ?? "ALL STOCKS"} (${exportOpen?.all.toLocaleString()})`}
            detail="สินค้าทั้งหมดในคลัง (ไม่ต้องติ๊ก / ไม่ขึ้นกับคำค้นหา)"
            meta="PDF • QR CODE"
            onClick={() => exportQr("ALL")}
          />
          <ChoiceCard
            delay={2}
            color="#e11d48"
            icon={<Glyph d={GLYPH.sheet} />}
            title={`PICKING (${(ticked.length || exportOpen?.all || 0).toLocaleString()})`}
            detail={`การ์ดแบบ Pick List: RUNNING A0001 · PART A / CUSTOMER · PART NO · PACKSIZE + หน่วย — ${ticked.length ? `เฉพาะ ${ticked.length} รายการที่ติ๊กไว้` : `ทั้งหมดใน ${filterStock?.code ?? "ALL STOCKS"} (ไม่ได้ติ๊ก)`}`}
            meta="PREVIEW • PRINT / PDF"
            onClick={() => {
              setExportOpen(null);
              setPicking({ mode: ticked.length ? "SELECTED" : "ALL", ids: ticked, stkId: filter, stockName: filterStock?.code ?? "ALL STOCKS" });
            }}
          />
        </div>
      </Modal>
      <PickingExport req={picking} onClose={closePicking} />

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
