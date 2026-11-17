"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { Checkbox } from "@/components/forms/Checkbox";
import { Loading } from "@/components/layout/Page";
import { Select } from "@/components/dropdowns/Select";
import { api } from "@/lib/api";
import { STOCK_TYPES, tileStyle } from "@/lib/stockIcons";
import { FormatsModal } from "./FormatsModal";
import type { Stock } from "./types";

type Fmt = { fmtId: number; name: string; isActive: boolean };

const COLUMNS: [string, string][] = [
  ["NO", "No."],
  ["IMAGE", "IMAGE"],
  ["CUSTOMER", "CUSTOMER"],
  ["CODE", "PD CODE"],
  ["PARTA", "PART A"],
  ["PARTB", "PART B"],
  ["PARTNO", "PART NO"],
  ["MODEL", "MODEL"],
  ["NAME", "PRODUCT NAME"],
  ["MAXMIN", "MAX / MIN"],
  ["QTY", "QTY"],
  ["BOX", "STOCK (BOX)"],
  ["COIL", "STOCK (COIL)"],
  ["PCS", "STOCK (PCS)"],
  ["REMARK", "REMARK"],
  // ช่องข้อมูลสินค้าจาก Product Control
  ["SUPPLIER", "SUPPLIER"],
  ["CATEGORY", "CATEGORY"],
  ["PACKSIZE", "PACK SIZE"],
  ["BIN", "BIN"],
];
const SUB_ROWS: [string, string][] = [
  ["COILNO", "NUMBER COIL"],
  ["MOTHER", "MASTER COIL"],
  ["WEIGHT", "WEIGHT (KG)"],
  ["COIL", "COIL"],
  ["TON", "TON"],
  ["RECEIVED", "RECEIVED"],
];
const SUB_DEFAULT = SUB_ROWS.map(([k]) => k);

const NEW_STOCK: Partial<Stock> = {
  stkId: 0,
  code: "",
  name: "",
  unit: "KG",
  groupBy: "CATEGORY",
  maxMinBasis: "KG",
  allowDecimal: false,
  maxMinDecimalSetting: false,
  notSetButton: false,
  showCoilRowsSetting: true,
  cardStyleSetting: "IMAGE",
  inExcel: true,
  inSupplierImport: false,
  inSysQr: true,
  outSysQr: true,
  inPickList: false,
  inSupplier: false,
  outPickList: false,
  outSupplier: false,
  formatIds: [],
  stockType: null,
};

// ⚙ ตั้งค่าคลัง (StockEditorWindow): ข้อมูลคลัง / คอลัมน์ตาราง (ลำดับตามที่ติ๊ก) / แถว Coil ย่อย / การ์ด / ช่องทางสแกน / รูปแบบป้าย
export function StockEditor({ stkId, canFormats, onClose, onSaved }: { stkId: number | null; canFormats: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<Partial<Stock> | null>(stkId ? null : NEW_STOCK);
  const [cols, setCols] = useState<string[]>(stkId ? [] : ["IMAGE", "CODE", "NAME", "MAXMIN", "QTY", "REMARK"]);
  const [subs, setSubs] = useState<string[]>(SUB_DEFAULT);
  const [formats, setFormats] = useState<Fmt[]>([]);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  // ➕ ช่องกรอกเพิ่มเองของคลังนี้ (Inventory Registration > ADMIN > CUSTOM FIELDS) - เลือกแสดงเป็นคอลัมน์ได้
  const [cfCols, setCfCols] = useState<[string, string][]>([]);

  const loadFormats = () => api<Fmt[]>("/store/formats/brief").then(setFormats).catch(() => {});

  useEffect(() => {
    if (!stkId) {
      api<Fmt[]>("/store/formats/brief").then(setFormats).catch(() => {});
      return;
    }
    api<{ stock: Stock; columns: string[]; coilRowOrder: string[]; formats: Fmt[]; customFields?: { key: string; label: string }[] }>(`/store/stocks/${stkId}/settings`)
      .then((r) => {
        setS({ ...r.stock, maxMinBasis: ["KG", "PCS", "SHEET", "BOX", "COIL"].includes(r.stock.maxMinUnit) ? r.stock.maxMinUnit : "KG", maxMinDecimalSetting: r.stock.maxMinDecimal, showCoilRowsSetting: r.stock.showCoilRowsSetting ?? true, cardStyleSetting: r.stock.cardStyle });
        setCols(r.columns);
        setCfCols((r.customFields ?? []).map((f) => [f.key, `➕ ${f.label}`]));
        setSubs(r.stock.coilRowColumns === "-" ? [] : r.coilRowOrder);
        setFormats(r.formats);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [stkId, toast]);

  if (!s)
    return (
      <Modal open wide title="EDIT STOCK" onClose={onClose}>
        <Loading />
      </Modal>
    );

  const set = <K extends keyof Stock>(k: K, v: Stock[K]) => setS({ ...s, [k]: v });
  const toggleCol = (k: string) => setCols((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const toggleSub = (k: string) => setSubs((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const supplier = !!(s.inSupplier || s.outSupplier);

  async function save() {
    if (!s) return;
    if (!s.code?.trim()) return toast.show("WARNING", "กรุณากรอกรหัสคลัง (STOCK CODE)", "warn");
    if (!s.name?.trim()) return toast.show("WARNING", "กรุณากรอกชื่อคลัง (STOCK NAME)", "warn");
    if (!stkId && !s.stockType) return toast.show("WARNING", "กรุณาเลือกประเภทคลัง (STOCK TYPE)", "warn");
    if (cols.length === 0) return toast.show("WARNING", "กรุณาเลือกคอลัมน์ที่ต้องการแสดงอย่างน้อย 1 คอลัมน์", "warn");
    if (supplier && (s.formatIds ?? []).length === 0) return toast.show("WARNING", "เปิดช่องทาง SUPPLIER LABEL แล้ว กรุณาเลือกรูปแบบบาร์โค้ด Supplier อย่างน้อย 1 รูปแบบ", "warn");
    const body = {
      ...s,
      columnOrder: cols.join(","),
      coilRowColumns: subs.join(",") === SUB_DEFAULT.join(",") ? null : subs.length === 0 ? "-" : subs.join(","),
    };
    setBusy(true);
    try {
      const r = await api<{ message: string }>(stkId ? `/store/stocks/${stkId}` : "/store/stocks", { method: stkId ? "PUT" : "POST", body });
      toast.show("Stock", r.message, "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ชิปเลือก: วงเลขลำดับ (no) / เครื่องหมายถูก · เลือก = ไล่สีเต็มชิป
  const chip = (key: string | number, on: boolean, label: React.ReactNode, onClick: () => void, disabled = false, no?: number) => (
    <button key={key} type="button" disabled={disabled} onClick={onClick} aria-pressed={on} className={`col-chip ${on ? "is-on" : ""}`}>
      <span className="col-no" key={on ? `on-${no ?? ""}` : "off"}>
        {on ? (no ?? "✓") : ""}
      </span>
      {label}
    </button>
  );
  const order = (keys: string[], all: [string, string][]) => (
    <div className="col-order">
      ORDER:
      {keys.length === 0
        ? " -"
        : keys.map((k, i) => (
            <span key={k} style={{ animationDelay: `${i * 25}ms` }}>
              {i > 0 && <em>→ </em>}
              {all.find((c) => c[0] === k)?.[1]}
            </span>
          ))}
    </div>
  );
  const check = (k: keyof Stock, label: string) => <Checkbox checked={!!s[k]} onChange={(v) => set(k, v as never)} label={label} />;
  const section = (title: string, children: React.ReactNode, hint?: string) => (
    <div className="se-sec">
      <div className="se-sec-head">{title}</div>
      {children}
      {hint && <div className="mt-2 text-xs font-semibold text-ink-soft">{hint}</div>}
    </div>
  );

  return (
    <Modal
      open
      wide
      title={stkId ? "EDIT STOCK" : "ADD STOCK"}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-purple" onClick={save} disabled={busy}>
            {busy ? "⏳ SAVING..." : stkId ? "💾 SAVE" : "＋ CREATE STOCK"}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm font-semibold text-ink-soft">
        {stkId ? `${s.code} • ${s.name}${s.isMain ? " • MAIN STOCK" : ""}` : "Create a new stock - every user gets VIEW permission automatically"}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {section(
          "STOCK",
          <div className="grid grid-cols-2 gap-3">
            <label className="fx col-span-2 sm:col-span-1">
              <span className="fx-cap">STOCK CODE</span>
              <input className="field fx-in" maxLength={30} value={s.code ?? ""} onChange={(e) => set("code", e.target.value)} />
            </label>
            <label className="fx col-span-2 sm:col-span-1">
              <span className="fx-cap">STOCK NAME</span>
              <input className="field fx-in" value={s.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </label>
            <div className="col-span-2">
              <span className="mb-1.5 block text-xs font-bold text-ink-soft">STOCK TYPE {stkId ? "" : "*"} (ไอคอนของคลัง)</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Stock type">
                {STOCK_TYPES.map((t) => {
                  const on = s.stockType === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={t.hint}
                      onClick={() => set("stockType", t.value)}
                      className={`group flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11px] font-extrabold uppercase transition duration-200 hover:-translate-y-0.5 ${
                        on ? "border-transparent text-white shadow-[0_8px_18px_-8px_rgba(37,99,235,.8)]" : "border-line bg-surface text-ink hover:border-[#2563eb]"
                      }`}
                      style={on ? { background: `linear-gradient(145deg, color-mix(in srgb, ${t.color} 62%, white), ${t.color})` } : undefined}
                    >
                      <span className="grid size-9 place-items-center rounded-[11px] transition-transform duration-300 group-hover:scale-110" style={on ? { background: "rgb(255 255 255 / .22)" } : tileStyle(t.color)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.icon} alt="" className="size-6 object-contain" />
                      </span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs font-bold text-ink-soft">UNIT</span>
              <Select ariaLabel="Unit" value={s.unit ?? "KG"} onChange={(v) => set("unit", v)} options={["KG", "PCS", "SHEET"].map((u) => ({ value: u, label: u }))} />
            </div>
            <div>
              <span className="mb-1 block text-xs font-bold text-ink-soft">GROUP BY</span>
              <Select ariaLabel="Group by" value={s.groupBy ?? "CATEGORY"} onChange={(v) => set("groupBy", v)} options={["CATEGORY", "CUSTOMER", "SUPPLIER"].map((u) => ({ value: u, label: u }))} />
            </div>
            <div>
              <span className="mb-1 block text-xs font-bold text-ink-soft">MAX / MIN UNIT</span>
              <Select ariaLabel="Max / min unit" value={s.maxMinBasis ?? "KG"} onChange={(v) => set("maxMinBasis", v)} options={["KG", "PCS", "SHEET", "BOX", "COIL"].map((u) => ({ value: u, label: u }))} />
            </div>
            <div className="col-span-2 mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {check("allowDecimal", "DECIMAL QTY")}
              {check("maxMinDecimalSetting", "MAX / MIN DECIMAL")}
              {check("notSetButton", "3rd button = MAX-MIN NOT SET")}
            </div>
          </div>,
        )}
        {section(
          "TABLE COLUMNS (order = order ticked)",
          <>
            <div className="flex flex-wrap gap-2">{[...COLUMNS, ...cfCols].map(([k, l]) => chip(k, cols.includes(k), l, () => toggleCol(k), false, cols.indexOf(k) + 1))}</div>
            {order(cols, [...COLUMNS, ...cfCols])}
            <div className="mt-2 text-[11px] font-semibold text-ink-soft">
              ➕ = ช่องกรอกเพิ่มเองของคลัง · เพิ่ม / แก้ / ลบ ช่องได้ที่ MASTER DATA &gt; Product Control &gt; ADMIN &gt; CUSTOM FIELDS{stkId ? "" : " (สร้างคลังก่อนแล้วค่อยเพิ่มช่อง)"}
            </div>
          </>,
          "STOCK (COIL) = นับ Coil (คลัง KG) • ติ๊กก่อน = แสดงก่อน",
        )}
        {section(
          "COIL SUB ROWS",
          <>
            <div className="mb-3">
              <Checkbox checked={s.showCoilRowsSetting ?? true} onChange={(v) => set("showCoilRowsSetting", v)} disabled={!cols.includes("COIL")} label="Click PD CODE shows the coils" />
            </div>
            <div className="flex flex-wrap gap-2">
              {SUB_ROWS.map(([k, l]) => chip(k, subs.includes(k), l, () => toggleSub(k), !cols.includes("COIL"), subs.indexOf(k) + 1))}
            </div>
          </>,
          "ใช้กับคลังที่เปิด STOCK (COIL)",
        )}
        {section(
          "PRODUCT CARDS",
          <Select
            ariaLabel="Product cards"
            value={s.cardStyleSetting ?? "OFF"}
            onChange={(v) => set("cardStyleSetting", v)}
            options={[
              { value: "IMAGE", label: "WITH IMAGE" },
              { value: "TEXT", label: "NO IMAGE" },
              { value: "OFF", label: "OFF" },
            ]}
          />,
          s.cardStyleSetting === "IMAGE" && !cols.includes("IMAGE")
            ? "IMAGE column is off - cards will show as NO IMAGE. Tick IMAGE in TABLE COLUMNS to show pictures on the cards."
            : "Cards that scroll above the table (SHOW CARDS on the Store page).",
        )}
        {section(
          "SCAN CHANNELS",
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <div className="text-xs font-extrabold text-success">IN (รับเข้า)</div>
              {check("inPickList", "PICK LIST QR")}
              {check("inSupplier", "SUPPLIER LABEL")}
              {check("inSysQr", "SYSTEM QR")}
              {check("inExcel", "IMPORT EXCEL (TEMPLATE MAX-MIN / COIL)")}
              {check("inSupplierImport", "IMPORT PENTA STOCK (แทน TEMPLATE COIL)")}
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-extrabold text-danger">OUT (จ่ายออก)</div>
              {check("outPickList", "PICK LIST QR")}
              {check("outSupplier", "SUPPLIER LABEL")}
              {check("outSysQr", "SYSTEM QR")}
            </div>
          </div>,
        )}
        {section(
          "SUPPLIER LABEL FORMATS",
          <>
            <div className={`flex flex-wrap gap-2 ${supplier ? "" : "opacity-50"}`}>
              {formats.length === 0 && <span className="text-sm text-ink-soft">ยังไม่มีรูปแบบบาร์โค้ด</span>}
              {formats.map((f) =>
                chip(
                  f.fmtId,
                  (s.formatIds ?? []).includes(f.fmtId),
                  f.isActive ? f.name : `${f.name} (INACTIVE)`,
                  () => set("formatIds", (s.formatIds ?? []).includes(f.fmtId) ? (s.formatIds ?? []).filter((x) => x !== f.fmtId) : [...(s.formatIds ?? []), f.fmtId]),
                  !supplier,
                ),
              )}
            </div>
            {canFormats && (
              <button type="button" className="fill-btn is-xs mt-3" onClick={() => setManage(true)}>
                🏷️ MANAGE FORMATS
              </button>
            )}
          </>,
          "เลือกได้เมื่อเปิดช่องทาง SUPPLIER LABEL",
        )}
      </div>
      {manage && (
        <FormatsModal
          onClose={() => {
            setManage(false);
            loadFormats();
          }}
        />
      )}
    </Modal>
  );
}
