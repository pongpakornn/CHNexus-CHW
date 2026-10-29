"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { Checkbox } from "@/components/ui/Checkbox";
import { useDialogs } from "@/components/ui/Dialogs";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { Loading } from "@/components/ui/Page";
import { QrImage } from "@/components/ui/QrImage";
import { api } from "@/lib/api";
import { stockIcon, tileStyle } from "@/lib/stockIcons";
import type { Layout } from "./types";

type Opt = { key: string; label: string };
type COpt = { id: number; value: string; uses: number };
type CField = { fieldId: number; stockId: number; key: string; label: string; type: string; values: number; unit: string | null; options: COpt[]; suggest?: boolean; autoFrom?: string | null; isNew?: boolean };
// หน่วยที่ใช้บ่อยของช่อง NUMBER (กดเลือก หรือพิมพ์เอง)
const UNITS = ["KG", "TON", "G", "PCS", "BOX", "SET", "M", "CM", "MM", "L"];
// ช่องของระบบที่ใช้เป็นต้นทางของการเติมอัตโนมัติ
const AUTO_SRC: Opt[] = [
  { key: "SUPPLIER", label: "SUPPLIER" },
  { key: "CUSTOMER", label: "CUSTOMER" },
  { key: "CATEGORY", label: "CATEGORY" },
  { key: "MODEL", label: "MODEL" },
  { key: "CODE", label: "PRODUCT CODE" },
  { key: "NAME", label: "PRODUCT NAME" },
  { key: "PARTA", label: "PART A" },
  { key: "PARTB", label: "PART B" },
  { key: "PARTNO", label: "PART NO" },
  { key: "BIN", label: "BIN" },
  { key: "PACKSIZE", label: "PACKSIZE" },
];
// ป้าย NEW (ช่องที่สร้างไม่เกิน 4 สัปดาห์ - Server ตัดสิน)
const NewDot = () => <span className="cf-new" title="ช่องใหม่ (แสดง 4 สัปดาห์)">NEW</span>;
const CF_TYPES = [
  { value: "TEXT", label: "TEXT (ข้อความ)" },
  { value: "NUMBER", label: "NUMBER (ตัวเลข + หน่วย)" },
  { value: "DATE", label: "DATE (วันที่)" },
  { value: "SELECT", label: "DROPDOWN (เลือกจากรายการ)" },
];
const typeName = (t: string) => (t === "SELECT" ? "DROPDOWN" : t);
type Data = {
  stocks: { stkId: number; code: string; name: string; count: number; stockType: string | null; isMain: boolean }[];
  layouts: { stkId: number; code: string; layout: Layout }[];
  columns: Opt[];
  qrFields: Opt[];
  groups: string[];
  defaultOrder: string[];
  formFields: Opt[];
  hasFormFields: boolean;
  hasCustomFields: boolean;
  hasDropdown: boolean;
  hasHelpers?: boolean;
  customFields: CField[];
  hasQrFields: boolean;
};
type Tab = "DELETE" | "FIELDS" | "LISTS" | "FORM" | "COLUMNS" | "QR";
const SIDE_KEY = "inv-admin-side";

// 🛠 ADMIN ของ Inventory Registration (ProductControlAdminWindow - Level 1): STOCK DELETE / TABLE COLUMNS / QR CODE
export function AdminModal({ ticked, onClose }: { ticked: number[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("DELETE");
  const [changed, setChanged] = useState(false);
  const [layouts, setLayouts] = useState<Record<number, Layout>>({});
  const [dirty, setDirty] = useState<number[]>([]);
  const [cur, setCur] = useState(0);
  const [chosen, setChosen] = useState<number[]>([]);
  const [all, setAll] = useState(ticked.length === 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // ➕ CUSTOM FIELDS: ช่องใหม่ / ช่องที่กำลังแก้
  const [nf, setNf] = useState({ label: "", type: "TEXT", unit: "", suggest: false, auto: false, autoFrom: "" });
  const [ef, setEf] = useState<{ id: number; label: string; type: string; unit: string; suggest: boolean; auto: boolean; autoFrom: string } | null>(null);
  // ▾ DROPDOWN LISTS: ช่องที่เลือก / รายการใหม่ / รายการที่กำลังแก้
  const [lf, setLf] = useState(0);
  const [nopt, setNopt] = useState("");
  const [eo, setEo] = useState<{ id: number; value: string } | null>(null);
  const [mini, setMini] = useState(false); // Sidebar พับ = ไอคอนอย่างเดียว
  const [drawer, setDrawer] = useState(false); // มือถือ: เมนูเลื่อนออกจากซ้าย
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDE_KEY) === "1") queueMicrotask(() => setMini(true));
    } catch {
      /* ไม่มี storage */
    }
  }, []);
  const toggleMini = () =>
    setMini((m) => {
      try {
        localStorage.setItem(SIDE_KEY, m ? "0" : "1");
      } catch {
        /* ไม่จำก็ได้ */
      }
      return !m;
    });

  const load = () =>
    api<Data>("/products/admin")
      .then((d) => {
        setData(d);
        setLayouts(Object.fromEntries(d.layouts.map((l) => [l.stkId, { ...l.layout, qrFields: l.layout.qrFields.includes("CODE") ? l.layout.qrFields : ["CODE", ...l.layout.qrFields] }])));
        setDirty([]);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = async () => {
    if (dirty.length > 0 && !(await dlg.confirm({ title: "UNSAVED CHANGES", message: "มีการตั้งค่าที่ยังไม่ได้กด SAVE\nต้องการปิดหน้าต่างโดยไม่บันทึกหรือไม่?" }))) return;
    onClose(changed);
  };

  const edit = (fn: (l: Layout) => Layout) => {
    setLayouts((m) => ({ ...m, [cur]: fn(m[cur]) }));
    setDirty((d) => (d.includes(cur) ? d : [...d, cur]));
  };

  async function saveLayouts(kind: "COLUMNS" | "QR" | "FORM") {
    const list = dirty.map((id) => {
      const l = layouts[id];
      return kind === "COLUMNS" ? { stkId: id, columns: l.columns, groupBy: l.groupBy } : kind === "FORM" ? { stkId: id, formFields: l.formFields } : { stkId: id, qrFields: l.qrFields, qrLabel: l.qrLabel };
    });
    if (kind === "COLUMNS") {
      const empty = dirty.find((id) => layouts[id].columns.length === 0);
      if (empty !== undefined) return toast.show("WARNING", `${data?.layouts.find((x) => x.stkId === empty)?.code}: กรุณาเลือกคอลัมน์อย่างน้อย 1 คอลัมน์`, "warn");
    }
    try {
      await api("/products/admin/layouts", { method: "POST", body: list });
      toast.show("SAVED", "บันทึกการตั้งค่าแล้ว", "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doDelete() {
    if (!data) return;
    const stocks = data.stocks.filter((s) => chosen.includes(s.stkId));
    const what = all ? `สินค้าทั้งหมดในคลัง ${stocks.map((s) => s.code).join(", ")}` : `สินค้าที่ติ๊กไว้ ${ticked.length} รายการ (เฉพาะที่อยู่ในคลัง ${stocks.map((s) => s.code).join(", ")})`;
    const ok = await dlg.confirm({
      title: "CONFIRM DELETE",
      danger: true,
      ok: "DELETE",
      message: `ยืนยันการลบ${what}\n\nสินค้าจะถูกลบออกจากระบบทั้งหมด (ทุกคลัง ประวัติสแกน ค่า Max-Min และ Coil) แม้ยังมียอดคงเหลือ\nลบแล้วกู้คืนไม่ได้\n\nเหตุผล: ${reason.trim()}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ level: "ok" | "warn"; message: string }>("/products/admin/delete", { method: "POST", body: { stockIds: chosen, all, partIds: ticked, reason } });
      await dlg.alert({ title: "STOCK DELETE", message: r.message, tone: r.level });
      setChanged(true);
      setReason("");
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ช่วยกรอก: แสดงค่าที่เคยกรอก + เติมอัตโนมัติจากช่องต้นทาง (ส่งเฉพาะเมื่อฐานรองรับ)
  const helperBody = (h: { suggest: boolean; auto: boolean; autoFrom: string }) =>
    data?.hasHelpers ? { suggest: h.suggest, autoFrom: h.auto && h.autoFrom ? h.autoFrom : null } : {};
  // ใช้ช่องที่มีอยู่แล้วของคลังอื่น
  async function copyField(f: CField) {
    const code = stockOf(cur)?.code ?? "";
    if (!(await dlg.confirm({ title: "USE FIELD", ok: "＋ ADD", message: `เพิ่มช่อง "${f.label}" (${typeName(f.type)}${f.unit ? ` • ${f.unit}` : ""}) จากคลัง ${stockOf(f.stockId)?.code ?? ""} ให้คลัง ${code}?\n\nชนิด / หน่วย / รายการ DROPDOWN / การช่วยกรอก เหมือนเดิม · ค่าของสินค้าแยกตามคลัง` }))) return;
    try {
      const r = await api<{ message: string }>(`/products/admin/fields/${f.fieldId}/copy`, { method: "POST", body: { stkId: cur } });
      toast.show("CUSTOM FIELD", r.message, "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  // ➕ เพิ่ม / แก้ / ลบ ช่องกรอกของคลัง (ยืนยันก่อนทุกครั้ง)
  async function addField() {
    if (!data || !cur) return;
    const label = nf.label.trim();
    if (!label) return toast.show("WARNING", "กรุณากรอกชื่อช่อง", "warn");
    const code = stockOf(cur)?.code ?? "";
    if (!(await dlg.confirm({ title: "ADD FIELD", ok: "＋ ADD", message: `เพิ่มช่อง "${label.toUpperCase()}" (${typeName(nf.type)}${nf.type === "NUMBER" && nf.unit.trim() ? ` • หน่วย ${nf.unit.trim().toUpperCase()}` : ""}) ให้คลัง ${code}?

แล้วเลือกให้แสดงได้ที่ FORM FIELDS / TABLE COLUMNS และหน้า Store (EDIT STOCK) · Template Excel ใช้ตาม FORM FIELDS` }))) return;
    try {
      const r = await api<{ message: string }>("/products/admin/fields", { method: "POST", body: { stkId: cur, label, type: nf.type, unit: nf.type === "NUMBER" ? nf.unit : null, ...helperBody(nf) } });
      toast.show("CUSTOM FIELD", r.message + (nf.type === "SELECT" ? "\nเพิ่มรายการให้เลือกได้ที่เมนู DROPDOWN LISTS" : ""), "ok");
      setNf({ label: "", type: nf.type, unit: "", suggest: false, auto: false, autoFrom: "" });
      setChanged(true);
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }
  async function saveField() {
    if (!ef) return;
    try {
      if (ef.type === "SELECT" && data?.customFields.find((f) => f.fieldId === ef.id)?.type !== "SELECT"
        && !(await dlg.confirm({ title: "CHANGE TO DROPDOWN", ok: "CHANGE", message: "เปลี่ยนเป็น DROPDOWN?\nค่าที่สินค้ากรอกไว้แล้วจะกลายเป็นรายการให้เลือกให้อัตโนมัติ" }))) return;
      const r = await api<{ message: string }>(`/products/admin/fields/${ef.id}`, { method: "PUT", body: { stkId: cur, label: ef.label, type: ef.type, unit: ef.type === "NUMBER" ? ef.unit : null, ...helperBody(ef) } });
      toast.show("CUSTOM FIELD", r.message, "ok");
      setEf(null);
      setChanged(true);
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }
  async function deleteField(f: CField) {
    if (
      !(await dlg.confirm({
        title: "DELETE FIELD",
        danger: true,
        ok: "🗑 DELETE",
        message: `ลบช่อง "${f.label}" ของคลัง ${stockOf(f.stockId)?.code ?? ""}?

ค่าที่เคยกรอกไว้ ${f.values.toLocaleString()} รายการจะถูกลบด้วย และเอาออกจาก FORM FIELDS / TABLE COLUMNS / หน้า Store ให้อัตโนมัติ
ลบแล้วกู้คืนไม่ได้`,
      }))
    )
      return;
    try {
      const r = await api<{ message: string }>(`/products/admin/fields/${f.fieldId}/delete`, { method: "POST" });
      toast.show("CUSTOM FIELD", r.message, "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  // ▾ รายการของ DROPDOWN
  const listField = data?.customFields.find((f) => f.fieldId === lf && f.stockId === cur && f.type === "SELECT") ?? data?.customFields.find((f) => f.stockId === cur && f.type === "SELECT");
  async function optRun(fn: () => Promise<{ message: string }>) {
    try {
      const r = await fn();
      toast.show("DROPDOWN", r.message, "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }
  const addOpt = () => {
    if (!listField || !nopt.trim()) return;
    const v = nopt.trim();
    setNopt("");
    optRun(() => api(`/products/admin/fields/${listField.fieldId}/options`, { method: "POST", body: { value: v } }));
  };
  const saveOpt = () => {
    if (!eo || !eo.value.trim()) return;
    const o = eo;
    setEo(null);
    optRun(() => api(`/products/admin/options/${o.id}`, { method: "PUT", body: { value: o.value } }));
  };
  async function delOpt(o: COpt) {
    if (!listField) return;
    if (
      !(await dlg.confirm({
        title: "DELETE ITEM",
        danger: true,
        ok: "🗑 DELETE",
        message: `ลบรายการ "${o.value}" ออกจาก ${listField.label}?` + (o.uses > 0 ? `\n\nสินค้าที่เลือกค่านี้อยู่ ${o.uses.toLocaleString()} รายการจะกลายเป็นค่าว่าง` : ""),
      }))
    )
      return;
    optRun(() => api(`/products/admin/options/${o.id}/delete`, { method: "POST" }));
  }
  const moveOpt = (i: number, d: number) => {
    if (!listField) return;
    const ids = listField.options.map((o) => o.id);
    if (i + d < 0 || i + d >= ids.length) return;
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    optRun(() => api(`/products/admin/fields/${listField.fieldId}/options/order`, { method: "POST", body: ids }));
  };

  // ชื่อช่องต้นทางของการเติมอัตโนมัติ
  const autoName = (k: string) => AUTO_SRC.find((o) => o.key === k)?.label ?? data?.customFields.find((f) => f.key === k)?.label ?? k;
  // ☑ ช่วยกรอก: แสดงค่าที่เคยกรอก / เติมอัตโนมัติจากช่องอื่น (เลือกต้นทางได้ 1 ช่อง)
  const helperUi = (h: { suggest: boolean; auto: boolean; autoFrom: string }, set: (p: Partial<{ suggest: boolean; auto: boolean; autoFrom: string }>) => void, self?: string) => (
    <div className="cf-help">
      <Checkbox checked={h.suggest} onChange={(v) => set({ suggest: v })} label="แสดงค่าที่เคยกรอกไว้ให้เลือก" />
      <Checkbox checked={h.auto} onChange={(v) => set({ auto: v, autoFrom: v ? h.autoFrom || "SUPPLIER" : h.autoFrom })} label="เติมอัตโนมัติจากช่อง" />
      {h.auto && (
        <MenuSelect
          compact
          className="w-full"
          value={h.autoFrom || "SUPPLIER"}
          options={[...AUTO_SRC, ...(data?.customFields ?? []).filter((f) => f.stockId === cur && f.key !== self).map((f) => ({ key: f.key, label: `${f.label} (ช่องเพิ่มเอง)` }))].map((o) => ({ value: o.key, label: o.label }))}
          onChange={(v) => set({ autoFrom: v })}
        />
      )}
      {h.auto && <p className="text-[11px] font-semibold text-ink-soft">กรอก {autoName(h.autoFrom || "SUPPLIER")} แล้วช่องนี้เติมค่าจากสินค้าที่เคยกรอก {autoName(h.autoFrom || "SUPPLIER")} เดียวกันให้เอง</p>}
    </div>
  );

  const l = layouts[cur];
  // ช่องกรอกเพิ่มเองของคลังที่เลือก -> ตัวเลือกใน FORM FIELDS / TABLE COLUMNS
  const cfOpts = (stk: number): Opt[] => (data?.customFields ?? []).filter((f) => f.stockId === stk).map((f) => ({ key: f.key, label: f.label }));
  const newKeys = new Set((data?.customFields ?? []).filter((f) => f.isNew).map((f) => f.key));
  const labelOf = (opts: Opt[], k: string) => opts.find((o) => o.key === k)?.label ?? data?.customFields.find((f) => f.key === k)?.label ?? k;
  const stockOf = (id: number) => data?.stocks.find((s) => s.stkId === id);
  const picked = data ? data.stocks.filter((s) => chosen.includes(s.stkId)) : [];

  // ปุ่มเลือก (GROUP BY / คอลัมน์): ขอบสี ชี้แล้วสีเต็มขยายจากกลางปุ่ม · on = เลือกอยู่
  const fill = (on: boolean, text: React.ReactNode, onClick: () => void, key: string, extra = "") => (
    <button key={key} type="button" onClick={onClick} className={`fill-btn ${on ? "is-on" : ""} ${extra}`}>
      {text}
    </button>
  );

  // ลำดับที่เลือก (ตัวเลข + ◀ เลื่อนขึ้นก่อน + × เอาออก) · ที่ยังไม่เลือก = ＋ เพิ่มต่อท้าย
  const orderList = (list: string[], opts: Opt[], onChange: (v: string[]) => void, locked?: string | string[]) => (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {list.length === 0 && <span className="text-xs font-bold text-ink-soft">ยังไม่ได้เลือก</span>}
        {list.map((k, i) => (
          <span key={k} className="ord-chip">
            <b className="ord-no">{i + 1}</b>
            <button type="button" disabled={i === 0} title="เลื่อนขึ้นก่อน" onClick={() => onChange(list.map((x, j) => (j === i - 1 ? k : j === i ? list[i - 1] : x)))} className="ord-mv">
              ◀
            </button>
            <span className="px-0.5">{labelOf(opts, k)}</span>
            {newKeys.has(k) && <NewDot />}
            {(Array.isArray(locked) ? locked.includes(k) : k === locked) ? (
              <span className="ord-lock" title="จำเป็นต้องมี">
                🔒
              </span>
            ) : (
              <button type="button" title="เอาออก" onClick={() => onChange(list.filter((x) => x !== k))} className="ord-x">
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {opts.some((o) => !list.includes(o.key)) && (
        <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-3">
          {opts.filter((o) => !list.includes(o.key)).map((o) => fill(false, <>＋ {o.label}{newKeys.has(o.key) && <NewDot />}</>, () => onChange([...list, o.key]), o.key, "is-add"))}
        </div>
      )}
    </div>
  );

  // การ์ดคลังแบบหน้า Store (Max-Min): แถบสี · ไอคอนประจำคลัง · รหัส / ชื่อ · จำนวน · ติ๊กถูกเมื่อเลือก
  const stockCard = (o: { id: number; code: string; name?: string; count?: number; type?: string | null; i: number }, on: boolean, onClick: () => void, tone: "danger" | "accent", mark?: boolean) => {
    const [ic, c0] = o.id === 0 ? ["", "#6750a4"] : stockIcon(o.code, o.i, o.type);
    const col = tone === "danger" && on ? "#ef4444" : c0;
    return (
      <button key={o.id} type="button" onClick={onClick} className={`adm-card ${on ? "is-on" : ""}`} style={{ "--c": col } as React.CSSProperties}>
        <span className="adm-bar" />
        <span className="adm-ic" style={tileStyle(c0)}>
          {o.id === 0 ? (
            <svg viewBox="0 0 24 24" className="size-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
            </svg>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ic} alt="" className="size-6 object-contain" draggable={false} />
          )}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5 truncate text-[15px] font-extrabold text-[#1f2350]">
            {o.code} {mark && <span className="adm-dirty" title="ยังไม่ได้ SAVE" />}
          </span>
          {o.name && <span className="block truncate text-[11px] font-semibold text-ink-soft">{o.name}</span>}
          {o.count !== undefined && (
            <span className="mt-1 block text-[11px] font-extrabold" style={{ color: c0 }}>
              <span className="text-lg tabular-nums">{o.count.toLocaleString()}</span> ITEMS
            </span>
          )}
        </span>
        <span className="adm-check" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 12.5 4 4 8-9" />
          </svg>
        </span>
      </button>
    );
  };

  const TABS: [Tab, string, string, React.ReactNode][] = [
    ["DELETE", "STOCK DELETE", "ลบสินค้าตามคลัง", <path key="d" d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />],
    ["FIELDS", "CUSTOM FIELDS", "เพิ่ม / แก้ / ลบ ช่องกรอกของคลัง", <path key="cf" d="M12 5v14M5 12h14M4 4h4M16 4h4M4 20h4M16 20h4" />],
    ["LISTS", "DROPDOWN LISTS", "รายการให้เลือกของช่อง DROPDOWN", <path key="dl" d="M4 6h11M4 12h11M4 18h7M18 15l2.5 3 2.5-3" />],
    ["FORM", "FORM FIELDS", "ช่องกรอกลงทะเบียน / Template", <path key="f" d="M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4" />],
    ["COLUMNS", "TABLE COLUMNS", "คอลัมน์ / จัดกลุ่ม", <path key="c" d="M4 5h16v14H4zM4 10h16M10 10v9M15 10v9" />],
    ["QR", "QR CODE", "ข้อมูลใน QR / ข้อความใต้ QR", <path key="q" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5" />],
  ];

  const tabName = TABS.find((x) => x[0] === tab)?.[1] ?? "";
  const pick = (t: Tab) => {
    setTab(t);
    setDrawer(false);
    if ((t === "FORM" || t === "FIELDS" || t === "LISTS") && cur === 0 && data) setCur(data.stocks[0]?.stkId ?? 0);
    setEf(null);
    setEo(null);
  };
  const burger = (onClick: () => void, label: string) => (
    <button type="button" className="adm-burger" onClick={onClick} aria-label={label} title={label}>
      <span />
      <span />
      <span />
    </button>
  );
  const foot =
    tab === "FIELDS" || tab === "LISTS" ? (
      <span className="text-xs font-bold text-ink-soft">เพิ่ม / แก้ / ลบ มีผลทันที (ไม่ต้องกด SAVE) · ลง Activity Log ทุกครั้ง</span>
    ) : tab === "DELETE" ? (
      <button className="cta-btn is-red ml-auto" disabled={busy || chosen.length === 0 || !reason.trim() || (!all && ticked.length === 0)} onClick={doDelete}>
        🗑 DELETE
      </button>
    ) : (
      <>
        {tab === "FORM" && l && (
          <button className="fill-btn is-sm" onClick={() => data && edit((x) => ({ ...x, formFields: data.formFields.map((o) => o.key) }))}>
            ALL FIELDS
          </button>
        )}
        {tab === "COLUMNS" && l && (
          <button className="fill-btn is-sm" onClick={() => data && edit((x) => ({ ...x, columns: [...data.defaultOrder], groupBy: "CATEGORY" }))}>
            RESET
          </button>
        )}
        <button className="cta-btn is-purple ml-auto" disabled={dirty.length === 0} onClick={() => saveLayouts(tab as "COLUMNS" | "QR" | "FORM")}>
          💾 SAVE {dirty.length > 0 ? `(${dirty.length})` : ""}
        </button>
      </>
    );

  return (
    <Modal open size="xl" flush title={`🛠 ADMIN • ${tabName}`} onClose={close}>
      {/* Sidebar ติดขอบซ้ายสูงเต็มหน้าต่าง (แบบเมนูหลัก) · พับเหลือไอคอนได้ · มือถือ = เมนูเลื่อนออกจากซ้าย */}
      <div className={`adm-shell ${mini ? "is-mini" : ""} ${drawer ? "is-drawer" : ""}`}>
        <nav className="adm-nav">
          <div className="adm-nav-head">
            {burger(() => (window.matchMedia("(max-width: 767px)").matches ? setDrawer(false) : toggleMini()), mini ? "กางเมนู" : "พับเมนู")}
            <span className="adm-nav-title">
              ADMIN
              <small>INVENTORY REGISTRATION</small>
            </span>
          </div>
          {TABS.map(([t, txt, hint, path]) => (
            <button key={t} type="button" onClick={() => pick(t)} title={mini ? txt : undefined} className={`adm-item ${tab === t ? "is-on" : ""}`}>
              <svg viewBox="0 0 24 24" className="adm-item-ic" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {path}
              </svg>
              <span className="adm-item-txt">
                <span className="block truncate text-[13.5px] font-extrabold">{txt}</span>
                <span className="adm-item-hint">{hint}</span>
              </span>
            </button>
          ))}
        </nav>
        {drawer && <div className="adm-scrim" onClick={() => setDrawer(false)} />}

        <section className="adm-main">
          <div className="adm-main-head">
            {burger(() => setDrawer(true), "เมนู")}
            <b>{tabName}</b>
          </div>
          <div className="adm-scroll">
            {!data ? (
              <Loading />
            ) : (
              <>
          {tab === "DELETE" && (
            <div key="del" className="adm-pane grid content-start gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="adm-title">SELECT STOCK</div>
                <span className="ml-auto" />
                {fill(
                  chosen.length === data.stocks.length && data.stocks.length > 0,
                  chosen.length === data.stocks.length && data.stocks.length > 0 ? "✓ ALL STOCKS" : "SELECT ALL STOCKS",
                  () => setChosen(chosen.length === data.stocks.length ? [] : data.stocks.map((s) => s.stkId)),
                  "all",
                  "is-sm is-danger",
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
                {data.stocks.map((s, i) =>
                  stockCard(
                    { id: s.stkId, code: s.code, name: s.name, count: s.count, type: s.stockType, i },
                    chosen.includes(s.stkId),
                    () => setChosen((c) => (c.includes(s.stkId) ? c.filter((x) => x !== s.stkId) : [...c, s.stkId])),
                    "danger",
                  ),
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    [false, "DELETE THE TICKED PRODUCTS", `สินค้าที่ติ๊กไว้ในตาราง (${ticked.length} ticked)`, ticked.length === 0],
                    [true, "DELETE ALL PRODUCTS", "สินค้าทั้งหมดในคลังที่เลือก", false],
                  ] as [boolean, string, string, boolean][]
                ).map(([v, t, h, off]) => (
                  <button key={t} type="button" disabled={off} onClick={() => setAll(v)} className={`adm-opt ${all === v ? "is-on" : ""}`}>
                    <span className="adm-radio" />
                    <span className="min-w-0 text-left">
                      <b className="block text-[13px] font-extrabold">{t}</b>
                      <span className="block text-[11px] font-semibold text-ink-soft">{h}</span>
                    </span>
                  </button>
                ))}
              </div>
              <textarea className="field" rows={2} placeholder="เหตุผล (REASON)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className={`adm-sum ${chosen.length > 0 ? "is-warn" : ""}`}>
                {chosen.length === 0
                  ? "Select at least 1 stock."
                  : all
                    ? `All products in ${picked.map((s) => s.code).join(", ")} will be deleted from the system (up to ${picked.reduce((a, s) => a + s.count, 0).toLocaleString()} product(s)).`
                    : `${ticked.length} ticked product(s) will be deleted if they are in ${picked.map((s) => s.code).join(", ")}.`}
              </div>
            </div>
          )}

          {tab === "FIELDS" && (
            <div key="fields" className="adm-pane grid content-start gap-4">
              <div className="adm-title">SELECT STOCK</div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {data.stocks.map((st, i) =>
                  stockCard({ id: st.stkId, code: st.code, name: `${data.customFields.filter((f) => f.stockId === st.stkId).length} CUSTOM FIELD(S)`, type: st.stockType, i }, cur === st.stkId, () => (setCur(st.stkId), setEf(null)), "accent"),
                )}
              </div>
              {!data.hasCustomFields ? (
                <div className="adm-sum is-warn">ฐานข้อมูลยังไม่รองรับ - รัน database/nexus/12_Custom_Fields.sql บนฐาน CHR-Nexus</div>
              ) : cur ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="adm-box grid content-start gap-2">
                    <div className="adm-title mb-1">ช่องกรอกเพิ่มเองของ {stockOf(cur)?.code}</div>
                    {data.customFields.filter((f) => f.stockId === cur).length === 0 && <div className="py-3 text-sm font-bold text-ink-soft">ยังไม่มีช่องเพิ่มเอง - เพิ่มได้ที่กล่องด้านขวา</div>}
                    {data.customFields
                      .filter((f) => f.stockId === cur)
                      .map((f, i) =>
                        ef?.id === f.fieldId ? (
                          <div key={f.fieldId} className="cf-row is-edit">
                            <input className="field fx-in min-w-0 flex-1" autoFocus maxLength={60} value={ef.label} onChange={(e) => setEf({ ...ef, label: e.target.value })} onKeyDown={(e) => (e.key === "Enter" ? saveField() : e.key === "Escape" && setEf(null))} />
                            <MenuSelect compact className="w-[210px]" value={ef.type} options={CF_TYPES} onChange={(v) => setEf({ ...ef, type: v })} />
                            {ef.type === "NUMBER" && <input className="field fx-in w-[110px]" maxLength={20} list="cf-units" placeholder="หน่วย เช่น KG" value={ef.unit} onChange={(e) => setEf({ ...ef, unit: e.target.value })} />}
                            <button className="cta-btn is-purple is-sm" onClick={saveField}>
                              💾 SAVE
                            </button>
                            <button className="fill-btn is-xs" onClick={() => setEf(null)}>
                              CANCEL
                            </button>
                            {data.hasHelpers && <div className="basis-full">{helperUi(ef, (p) => setEf({ ...ef, ...p }), f.key)}</div>}
                          </div>
                        ) : (
                          <div key={f.fieldId} className="cf-row" style={{ "--i": i } as React.CSSProperties}>
                            <span className="cf-key">{f.key}</span>
                            <b className="min-w-0 flex-1 truncate text-[14px] text-[#1f2350]">
                              {f.label}
                              {f.isNew && <NewDot />}
                            </b>
                            {f.suggest && <span className="cf-type" title="ตอนกรอกแสดงค่าที่เคยกรอกให้เลือก">☰ SUGGEST</span>}
                            {f.autoFrom && <span className="cf-type" title="เติมค่าให้อัตโนมัติจากช่องนี้">⚡ AUTO ← {autoName(f.autoFrom)}</span>}
                            <span className="cf-type">
                              {typeName(f.type)}
                              {f.unit ? ` • ${f.unit}` : ""}
                            </span>
                            {f.type === "SELECT" && (
                              <button className="cf-type is-list" onClick={() => (setLf(f.fieldId), setTab("LISTS"))} title="จัดการรายการให้เลือก">
                                ▾ {f.options.length} รายการ
                              </button>
                            )}
                            <span className="text-[11px] font-bold text-ink-soft">{f.values.toLocaleString()} ค่า</span>
                            <button className="fill-btn is-xs" onClick={() => setEf({ id: f.fieldId, label: f.label, type: f.type, unit: f.unit ?? "", suggest: !!f.suggest, auto: !!f.autoFrom, autoFrom: f.autoFrom ?? "" })}>
                              ✏ EDIT
                            </button>
                            <button className="fill-btn is-xs text-danger" onClick={() => deleteField(f)}>
                              🗑 DELETE
                            </button>
                          </div>
                        ),
                      )}
                  </div>
                  <div className="adm-box grid content-start gap-3">
                    <div className="adm-title">＋ เพิ่มช่องใหม่ให้ {stockOf(cur)?.code}</div>
                    <label className="fx">
                      <span className="fx-cap">ชื่อช่อง (FIELD NAME)</span>
                      <input className="field fx-in" maxLength={60} placeholder="เช่น COLOR / LOT SIZE / EXPIRE DATE" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addField()} />
                    </label>
                    <div className="fx">
                      <span className="fx-cap">ชนิดข้อมูล (TYPE)</span>
                      <MenuSelect compact className="w-full" value={nf.type} options={data.hasDropdown ? CF_TYPES : CF_TYPES.filter((t) => t.value !== "SELECT")} onChange={(v) => setNf({ ...nf, type: v })} />
                    </div>
                    {nf.type === "NUMBER" && (
                      <label className="fx">
                        <span className="fx-cap">หน่วย (UNIT) - ไม่บังคับ</span>
                        <input className="field fx-in" maxLength={20} list="cf-units" placeholder="เลือกด้านล่าง หรือพิมพ์เอง" value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addField()} />
                        <span className="unit-chips">
                          {UNITS.map((u) => (
                            <button key={u} type="button" className={`unit-chip ${nf.unit.trim().toUpperCase() === u ? "is-on" : ""}`} onClick={() => setNf({ ...nf, unit: nf.unit.trim().toUpperCase() === u ? "" : u })}>
                              {u}
                            </button>
                          ))}
                        </span>
                      </label>
                    )}
                    {data.hasHelpers && helperUi(nf, (p) => setNf({ ...nf, ...p }))}
                    {nf.type === "SELECT" && <p className="text-[11px] font-bold text-accent">▾ เพิ่มแล้วไปเพิ่มรายการให้เลือกที่เมนู DROPDOWN LISTS</p>}
                    <button className="cta-btn is-purple" onClick={addField} disabled={!nf.label.trim()}>
                      ＋ ADD FIELD
                    </button>
                    {(() => {
                      // ช่องของคลังอื่นที่คลังนี้ยังไม่มี (ชื่อไม่ซ้ำ) -> กดเพื่อใช้กับคลังนี้
                      const mine = new Set(data.customFields.filter((f) => f.stockId === cur).map((f) => f.label));
                      const seen = new Set<string>();
                      const others = data.customFields.filter((f) => f.stockId !== cur && !mine.has(f.label) && !seen.has(f.label) && (seen.add(f.label), true));
                      return others.length > 0 ? (
                        <div className="grid gap-2 border-t border-dashed border-line pt-3">
                          <span className="fx-cap">ใช้ช่องที่มีอยู่แล้วของคลังอื่น</span>
                          <div className="flex flex-wrap gap-2">
                            {others.map((f) =>
                              fill(false, <>＋ {f.label}<small className="ml-1 opacity-60">{stockOf(f.stockId)?.code}</small>{f.isNew && <NewDot />}</>, () => copyField(f), `cp-${f.fieldId}`, "is-add"),
                            )}
                          </div>
                        </div>
                      ) : null;
                    })()}
                    <datalist id="cf-units">
                      {UNITS.map((u) => (
                        <option key={u} value={u} />
                      ))}
                    </datalist>
                    <p className="text-[11px] font-semibold leading-relaxed text-ink-soft">
                      เพิ่มแล้ว: เลือกให้แสดงที่ FORM FIELDS (ช่องกรอก + Template / Import Excel ใช้ชื่อช่องเป็นหัวคอลัมน์) · TABLE COLUMNS (ตารางหน้านี้) · หน้า Store &gt; EDIT STOCK &gt; TABLE COLUMNS (ตารางคลัง)
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {tab === "LISTS" && (
            <div key="lists" className="adm-pane grid content-start gap-4">
              <div className="adm-title">SELECT STOCK</div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {data.stocks.map((st, i) =>
                  stockCard({ id: st.stkId, code: st.code, name: `${data.customFields.filter((f) => f.stockId === st.stkId && f.type === "SELECT").length} DROPDOWN`, type: st.stockType, i }, cur === st.stkId, () => (setCur(st.stkId), setEo(null)), "accent"),
                )}
              </div>
              {!data.hasDropdown ? (
                <div className="adm-sum is-warn">ฐานข้อมูลยังไม่รองรับ - รัน database/nexus/13_Custom_Field_Unit_Dropdown.sql บนฐาน CHR-Nexus</div>
              ) : !listField ? (
                <div className="adm-sum">คลัง {stockOf(cur)?.code} ยังไม่มีช่อง DROPDOWN - เพิ่มที่เมนู CUSTOM FIELDS (เลือกชนิด DROPDOWN)</div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="adm-box grid content-start gap-2">
                    <div className="adm-title mb-1">ช่อง DROPDOWN ของ {stockOf(cur)?.code}</div>
                    {data.customFields
                      .filter((f) => f.stockId === cur && f.type === "SELECT")
                      .map((f, i) => (
                        <button key={f.fieldId} type="button" className={`fm-item ${listField.fieldId === f.fieldId ? "is-on" : ""}`} style={{ "--i": i } as React.CSSProperties} onClick={() => (setLf(f.fieldId), setEo(null))}>
                          <span className="fm-dot" />
                          <span className="min-w-0 flex-1 truncate">{f.label}</span>
                          <span className="fm-tag">{f.options.length}</span>
                        </button>
                      ))}
                  </div>
                  <div className="adm-box grid content-start gap-3">
                    <div className="adm-title">รายการให้เลือกของ {listField.label} (เรียงตามที่แสดงใน DROPDOWN)</div>
                    <div className="flex gap-2">
                      <input className="field fx-in min-w-0 flex-1" maxLength={200} placeholder="รายการใหม่ แล้วกด Enter / ＋ ADD" value={nopt} onChange={(e) => setNopt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOpt()} />
                      <button className="cta-btn is-purple" disabled={!nopt.trim()} onClick={addOpt}>
                        ＋ ADD
                      </button>
                    </div>
                    {listField.options.length === 0 && <div className="py-2 text-sm font-bold text-ink-soft">ยังไม่มีรายการ - พิมพ์ด้านบนแล้วกด ＋ ADD</div>}
                    <div className="grid gap-1.5">
                      {listField.options.map((o, i) => (
                        <div key={o.id} className="dept-row" style={{ "--i": i } as React.CSSProperties}>
                          <span className="dept-no">{i + 1}</span>
                          {eo?.id === o.id ? (
                            <input className="field fx-in !h-9 min-w-0 flex-1" autoFocus maxLength={200} value={eo.value} onChange={(e) => setEo({ ...eo, value: e.target.value })} onKeyDown={(e) => (e.key === "Enter" ? saveOpt() : e.key === "Escape" && setEo(null))} onBlur={saveOpt} />
                          ) : (
                            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-bold text-[#1f2350]" title="คลิกเพื่อแก้ไข" onClick={() => setEo({ id: o.id, value: o.value })}>
                              {o.value}
                            </button>
                          )}
                          {o.uses > 0 && <span className="cf-type">{o.uses.toLocaleString()} ใช้อยู่</span>}
                          <span className="dept-acts">
                            <button type="button" className="dept-btn" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => moveOpt(i, -1)}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="m6 15 6-6 6 6" />
                              </svg>
                            </button>
                            <button type="button" className="dept-btn" aria-label="Move down" title="Move down" disabled={i === listField.options.length - 1} onClick={() => moveOpt(i, 1)}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                            <button type="button" className="dept-btn" aria-label="Edit" title="แก้ไข" onClick={() => setEo({ id: o.id, value: o.value })}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
                              </svg>
                            </button>
                            <button type="button" className="dept-btn is-del" aria-label="Delete" title="ลบ" onClick={() => delOpt(o)}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                              </svg>
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] font-semibold text-ink-soft">แก้ชื่อรายการ = สินค้าที่เลือกค่าเดิมเปลี่ยนตามให้ · ลบรายการ = สินค้าที่เลือกค่านั้นเป็นค่าว่าง · Import Excel ต้องใส่ค่าที่ตรงกับรายการ</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "FORM" && (
            <div key="form" className="adm-pane grid content-start gap-4">
              <div className="adm-title">SELECT STOCK</div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {data.layouts
                  .filter((x) => x.stkId !== 0)
                  .map((x, i) => {
                    const st = stockOf(x.stkId);
                    return stockCard({ id: x.stkId, code: x.code, name: st?.name, type: st?.stockType, i }, cur === x.stkId, () => setCur(x.stkId), "accent", dirty.includes(x.stkId));
                  })}
              </div>
              {l && cur !== 0 ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="adm-box grid content-start gap-3">
                    <div className="adm-title">ช่องกรอกลงทะเบียนสินค้า (ลำดับตามที่เลือก) • TEMPLATE EXCEL ของคลังนี้ใช้ช่องชุดเดียวกัน</div>
                    {orderList(l.formFields ?? [], [...data.formFields, ...cfOpts(cur)], (v) => edit((x) => ({ ...x, formFields: v })), ["CODE", "NAME"])}
                    <p className="text-[11px] font-semibold text-ink-soft">
                      MASTER COIL / COIL NO / WEIGHT ของคลังที่นับ Coil = ของแต่ละ Coil (MASTER COIL อย่างเดียว = Master ทั้งม้วน) · คลังอื่น WEIGHT = น้ำหนักสินค้า · ช่องที่ไม่ได้เลือก ค่าเดิมของสินค้าไม่ถูกลบ
                    </p>
                    {!data.hasFormFields && <div className="text-xs font-bold text-warning">ฐานข้อมูลยังไม่รองรับ (database/nexus/09_ProductControl_FormFields.sql)</div>}
                  </div>
                  {/* ตัวอย่างฟอร์ม */}
                  <div className="adm-box">
                    <div className="adm-title mb-3">PREVIEW • {data.layouts.find((x) => x.stkId === cur)?.code}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(l.formFields ?? []).map((k, i) => (
                        <div key={k} className={`fm-prev ${k === "IMAGE" ? "col-span-2" : ""}`} style={{ animationDelay: `${i * 25}ms` }}>
                          <span>{labelOf([...data.formFields, ...cfOpts(cur)], k)}</span>
                          <i />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="adm-sum">เลือกคลังเพื่อตั้งช่องกรอก</div>
              )}
            </div>
          )}

          {(tab === "COLUMNS" || tab === "QR") && (
            <div key={tab} className="adm-pane grid content-start gap-4">
              <div className="adm-title">SELECT STOCK</div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {data.layouts.map((x, i) => {
                  const st = stockOf(x.stkId);
                  return stockCard({ id: x.stkId, code: x.code, name: x.stkId === 0 ? "ค่าเริ่มต้นของทุกคลัง" : st?.name, type: st?.stockType, i }, cur === x.stkId, () => setCur(x.stkId), "accent", dirty.includes(x.stkId));
                })}
              </div>
              {l && tab === "COLUMNS" && (
                <div className="adm-box grid gap-5">
                  <div>
                    <div className="adm-title mb-2">GROUP BY</div>
                    <div className="flex flex-wrap gap-2">{data.groups.map((g) => fill(l.groupBy === g, g, () => edit((x) => ({ ...x, groupBy: g })), g))}</div>
                  </div>
                  <div>
                    <div className="adm-title mb-2">COLUMNS (ลำดับตามที่เลือก)</div>
                    {orderList(l.columns, [...data.columns, ...cfOpts(cur)], (v) => edit((x) => ({ ...x, columns: v })))}
                  </div>
                </div>
              )}
              {l && tab === "QR" && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="adm-box grid content-start gap-5">
                    <div>
                      <div className="adm-title mb-2">รูปแบบที่ 2 • ข้อมูลใน QR (หน้าสแกนอ่าน คั่นด้วย |)</div>
                      {orderList(l.qrFields, data.qrFields, (v) => edit((x) => ({ ...x, qrFields: v.includes("CODE") ? v : ["CODE", ...v] })), "CODE")}
                    </div>
                    <div>
                      <div className="adm-title mb-2">รูปแบบที่ 1 • ข้อความใต้ QR (บรรทัดแรกตัวหนา)</div>
                      {orderList(l.qrLabel, data.qrFields, (v) => edit((x) => ({ ...x, qrLabel: v })))}
                    </div>
                    {!data.hasQrFields && <div className="text-xs font-bold text-warning">ฐานข้อมูลยังไม่รองรับรูปแบบ QR แบบกำหนดเอง (Update_20261017b.sql)</div>}
                  </div>
                  {/* ตัวอย่างป้าย QR */}
                  <div className="adm-box">
                    <div className="adm-title mb-3">PREVIEW</div>
                    <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-[0_10px_24px_-14px_rgb(55_48_107/0.45)]">
                      <QrImage text={l.qrFields.map((k) => (k === "CODE" ? "A250-00017" : k === "NAME" ? "SAMPLE NAME" : k)).join("|")} size={140} />
                    </div>
                    <div className="mt-3 text-center text-sm">
                      {l.qrLabel.map((k, i) => (
                        <div key={k} className={i === 0 ? "font-extrabold text-[#1f2350]" : "font-semibold text-ink-soft"}>
                          {labelOf(data.qrFields, k)}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 break-all rounded-lg bg-surface-2 px-2 py-1.5 text-center font-mono text-[10px] text-ink-soft">{l.qrFields.map((k) => labelOf(data.qrFields, k)).join(" | ")}</div>
                  </div>
                </div>
              )}
            </div>
          )}
              </>
            )}
          </div>
          <div className="adm-foot">{foot}</div>
        </section>
      </div>
    </Modal>
  );
}
