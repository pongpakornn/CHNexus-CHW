"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { Loading } from "@/components/layout/Page";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

type Fmt = {
  fmtId: number;
  name: string;
  delimiter: string;
  delimMode: string;
  trimChars: string | null;
  codePrefix: string;
  codeCut: number | null;
  matchStart: string | null;
  matchEnd: string | null;
  matchBy: string;
  nameFields: string | null;
  codePos: number;
  altCodePos: number | null;
  qtyPos: number | null;
  minFields: number;
  coilNoPos: number | null;
  motherCoilPos: number | null;
  sourceStkId: number | null;
  sampleText: string;
  isActive: boolean;
};
type Data = { canAdd: boolean; canEdit: boolean; canDelete: boolean; formats: Fmt[]; stocks: { stkId: number; display: string }[]; matchFields?: { key: string; label: string }[] };
type Test = { ok: boolean; fields: string[]; codes: string[]; qty: number | null; coilNo: string | null; mother: string | null; lookup: string | null; minFields: number; namePositions: number[] };

const BLANK: Fmt = {
  fmtId: 0,
  name: "",
  delimiter: ";",
  delimMode: "CHAR",
  trimChars: null,
  codePrefix: "NONE",
  codeCut: null,
  matchStart: null,
  matchEnd: null,
  matchBy: "CODE",
  nameFields: null,
  codePos: 1,
  altCodePos: null,
  qtyPos: null,
  minFields: 1,
  coilNoPos: null,
  motherCoilPos: null,
  sourceStkId: null,
  sampleText: "",
  isActive: true,
};

const pos = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 🏷️ BARCODE FORMATS (BarcodeFormatWindow): รูปแบบป้าย Supplier + ทดสอบกับป้ายตัวอย่าง (แยกช่อง / หาสินค้าในระบบ)
export function FormatsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState<Fmt | null>(null);
  const [minTyped, setMinTyped] = useState("");
  const [test, setTest] = useState<Test | null>(null);
  const dF = useDebounced(f, 300);

  const load = useCallback(
    async (selectId?: number | null) => {
      try {
        const d = await api<Data>("/store/formats");
        setData(d);
        const pick = d.formats.find((x) => x.fmtId === selectId) ?? (selectId === undefined ? d.formats[0] : null);
        if (pick) {
          setF(pick);
          setMinTyped(String(pick.minFields));
        }
      } catch (e) {
        toast.show("ERROR", "ไม่สามารถโหลดรูปแบบบาร์โค้ดได้\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!dF) return;
    let alive = true;
    api<Test>("/store/formats/test", { method: "POST", body: { ...dF, minFields: pos(minTyped) ?? 1 } })
      .then((r) => alive && setTest(r))
      .catch(() => alive && setTest(null));
    return () => {
      alive = false;
    };
  }, [dF, minTyped]);

  const [saving, setSaving] = useState(false);
  async function save() {
    if (!f || saving) return;
    setSaving(true); // busy-lock: a double click must not create the format twice
    try {
      if (f.sampleText && test && !test.ok && !(await dlg.confirm({ title: "CONFIRM SAVE", message: "ตัวอย่างบาร์โค้ดที่ทดสอบไว้ ไม่ตรงกับรูปแบบนี้\nต้องการบันทึกต่อหรือไม่?" }))) return;
      const r = await api<{ id: number; message: string }>("/store/formats", { method: "POST", body: { format: f, typedMinFields: pos(minTyped) } });
      toast.show("Barcode Format", r.message, "ok");
      load(r.id);
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!f || !f.fmtId) return;
    if (!(await dlg.confirm({ title: "CONFIRM DELETE", danger: true, message: `ต้องการลบรูปแบบ "${f.name}" ใช่หรือไม่?\nคลังที่ใช้รูปแบบนี้จะไม่รับป้ายรูปแบบนี้อีก` }))) return;
    try {
      await api(`/store/formats/${f.fmtId}`, { method: "DELETE" });
      setF(null);
      load(null);
    } catch (e) {
      toast.show("ERROR", "ลบรูปแบบบาร์โค้ดไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  const canSave = f && (f.fmtId === 0 ? data?.canAdd : data?.canEdit);
  // MATCH BY: CODE = รหัสใดก็ได้ (เดิม) / NAME = ชื่อสินค้า / หรือเลือกช่องเดียวเอง เช่น PART NO / ช่องเพิ่มเองของคลัง
  const matchOpts = [
    { value: "CODE", label: "PRODUCT CODE (ค่าเดิม)" },
    { value: "NAME", label: "PRODUCT NAME" },
    ...(data?.matchFields ?? []).map((x) => ({ value: x.key, label: x.label })),
  ];
  const set = <K extends keyof Fmt>(k: K, v: Fmt[K]) => f && setF({ ...f, [k]: v });
  const txt = (label: string, k: keyof Fmt, opt: { num?: boolean; disabled?: boolean; ph?: string; mono?: boolean } = {}) => (
    <label className={`fx ${opt.disabled ? "is-off" : ""}`}>
      <span className="fx-cap">{label}</span>
      <input
        className={`field fx-in ${opt.mono ? "font-mono" : ""}`}
        disabled={opt.disabled}
        placeholder={opt.ph}
        inputMode={opt.num ? "numeric" : undefined}
        value={(f?.[k] as string | number | null) ?? ""}
        onChange={(e) => set(k, (opt.num ? pos(e.target.value.replace(/\D/g, "")) : e.target.value || null) as never)}
      />
    </label>
  );
  const pick = (label: string, k: keyof Fmt, options: { value: string; label: string }[]) => (
    <div className="fx">
      <span className="fx-cap">{label}</span>
      <MenuSelect compact className="w-full" value={String(f?.[k] ?? "")} options={options} onChange={(v) => set(k, (k === "sourceStkId" ? (v ? Number(v) : null) : v) as never)} />
    </div>
  );
  const group = (n: number, title: string, hint: string, children: React.ReactNode) => (
    <section className="fm-group" style={{ "--d": `${n * 70}ms` } as React.CSSProperties}>
      <div className="fm-group-head">
        <span className="fm-no">{n}</span>
        <b>{title}</b>
        <span className="truncate text-[11px] font-semibold text-ink-soft">{hint}</span>
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">{children}</div>
    </section>
  );

  const color = (n: number) => {
    if (!f) return "#e3e1e8";
    if (f.matchBy === "NAME" ? test?.namePositions.includes(n) : n === f.codePos) return "var(--accent)";
    if (n === f.altCodePos) return "var(--info)";
    if (n === f.qtyPos) return "var(--success)";
    if (n === f.coilNoPos || n === f.motherCoilPos) return "var(--warning)";
    return "#b9b5c4";
  };

  return (
    <Modal
      open
      wide
      title="🏷️ BARCODE FORMATS"
      onClose={onClose}
      footer={
        <>
          {data?.canAdd && (
            <button className="fill-btn mr-auto" onClick={() => (setF({ ...BLANK }), setMinTyped(""))}>
              ＋ NEW FORMAT
            </button>
          )}
          {data?.canDelete && f && f.fmtId > 0 && (
            <button className="cta-btn is-red" onClick={remove}>
              🗑 DELETE
            </button>
          )}
          {canSave && (
            <button className="cta-btn is-purple" onClick={save} disabled={saving}>
              💾 SAVE
            </button>
          )}
        </>
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
          {/* รายการรูปแบบ */}
          <div className="fm-list">
            <div className="fm-list-head">
              FORMATS <span>{data.formats.length}</span>
            </div>
            <div className="flex max-h-[30dvh] flex-col gap-1 overflow-auto p-1.5 lg:max-h-[62dvh]">
              {data.formats.map((x, i) => (
                <button
                  key={x.fmtId}
                  onClick={() => (setF(x), setMinTyped(String(x.minFields)))}
                  className={`fm-item ${f?.fmtId === x.fmtId ? "is-on" : ""} ${x.isActive ? "" : "is-inactive"}`}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <span className="fm-dot" />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  {!x.isActive && <span className="fm-tag">INACTIVE</span>}
                </button>
              ))}
              {f && f.fmtId === 0 && (
                <div className="fm-item is-on">
                  <span className="fm-dot" />
                  <span className="min-w-0 flex-1 truncate">{f.name || "NEW FORMAT"}</span>
                  <span className="fm-tag">NEW</span>
                </div>
              )}
              {data.formats.length === 0 && !f && <div className="p-3 text-sm text-ink-soft">ยังไม่มีรูปแบบ</div>}
            </div>
          </div>
          {f && (
            <div key={f.fmtId} className="grid min-w-0 content-start gap-3">
              <section className="fm-group" style={{ "--d": "0ms" } as React.CSSProperties}>
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                  {txt("FORMAT NAME", "name")}
                  <label className={`sw ${f.isActive ? "is-on" : ""} mb-0.5 justify-self-start`}>
                    <input type="checkbox" className="sr-only" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                    <span className="sw-track" />
                    {f.isActive ? "ACTIVE" : "INACTIVE"}
                  </label>
                </div>
              </section>
              {group(
                1,
                "SPLIT & CLEAN",
                "แยกช่องของป้าย / ตัดตัวอักษร",
                <>
                  {pick("SPLIT FIELDS BY", "delimMode", [
                    { value: "CHAR", label: "DELIMITER" },
                    { value: "SPACES", label: "ANY SPACES" },
                  ])}
                  {txt("DELIMITER", "delimiter", { disabled: f.delimMode === "SPACES", mono: true })}
                  {txt("TRIM CHARS", "trimChars", { ph: "เช่น |", mono: true })}
                  <label className="fx">
                    <span className="fx-cap">MIN FIELDS</span>
                    <input className="field fx-in" inputMode="numeric" placeholder={test ? `auto ${test.minFields}` : ""} value={minTyped} onChange={(e) => setMinTyped(e.target.value.replace(/\D/g, ""))} />
                  </label>
                </>,
              )}
              {group(
                2,
                "MATCH PRODUCT",
                "หาสินค้าจากรหัส / ชื่อ",
                <>
                  {pick("MATCH BY", "matchBy", matchOpts)}
                  {pick("CODE PREFIX", "codePrefix", [
                    { value: "NONE", label: "NONE" },
                    { value: "DIGIT", label: "CUT 1st DIGIT (2A250 → A250)" },
                    { value: "CUT", label: "CUT N CHARS" },
                  ])}
                  {txt("CUT N", "codeCut", { num: true, disabled: f.codePrefix !== "CUT" })}
                  {txt("NAME FIELDS #", "nameFields", { disabled: f.matchBy !== "NAME", ph: "เช่น 6,7" })}
                  {txt("STARTS WITH", "matchStart", { mono: true })}
                  {txt("ENDS WITH", "matchEnd", { mono: true })}
                </>,
              )}
              {group(
                3,
                "FIELD POSITIONS",
                "ลำดับช่องของข้อมูลในป้าย (#)",
                <>
                  {txt("CODE FIELD #", "codePos", { num: true })}
                  {txt("ALT CODE FIELD #", "altCodePos", { num: true })}
                  {txt("QTY FIELD #", "qtyPos", { num: true })}
                  {txt("NUMBER COIL FIELD #", "coilNoPos", { num: true })}
                  {txt("MASTER COIL FIELD #", "motherCoilPos", { num: true })}
                  <div className="col-span-2 min-w-0 md:col-span-3">
                    {pick("DEDUCT FROM STOCK (ตัดยอดจากคลัง)", "sourceStkId", [{ value: "", label: "— NONE —" }, ...data.stocks.map((s) => ({ value: String(s.stkId), label: s.display }))])}
                  </div>
                </>,
              )}
              <section className={`fm-group fm-test ${test && f.sampleText ? (test.ok ? "is-ok" : "is-bad") : ""}`} style={{ "--d": "280ms" } as React.CSSProperties}>
                <div className="fm-group-head">
                  <span className="fm-no">🧪</span>
                  <b>TEST LABEL (SAMPLE)</b>
                  <span className="truncate text-[11px] font-semibold text-ink-soft">ยิง / วางป้ายตัวอย่าง - ระบบแยกช่องให้ดูทันที</span>
                </div>
                <input className="field fx-in font-mono" value={f.sampleText ?? ""} onChange={(e) => set("sampleText", e.target.value)} placeholder="ยิง / วางป้ายตัวอย่างที่นี่" />
                {test && test.fields.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {test.fields.map((v, i) => (
                      <span key={`${i}-${v}`} className="fm-chip" style={{ background: color(i + 1), "--i": i } as React.CSSProperties}>
                        <i>#{i + 1}</i> {v || "∅"}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-ink-soft">
                  <span className="fm-key" style={{ "--c": "var(--accent)" } as React.CSSProperties}>CODE / NAME</span>
                  <span className="fm-key" style={{ "--c": "var(--info)" } as React.CSSProperties}>ALT CODE</span>
                  <span className="fm-key" style={{ "--c": "var(--success)" } as React.CSSProperties}>QTY</span>
                  <span className="fm-key" style={{ "--c": "var(--warning)" } as React.CSSProperties}>COIL</span>
                </div>
                {test && f.sampleText && (
                  <div className="mt-3 grid gap-1 text-sm font-bold">
                    <div className={test.ok ? "text-success" : "text-danger"}>
                      {test.ok ? `✔ MATCH • ${matchOpts.find((o) => o.value === f.matchBy)?.label ?? "CODE"}:${test.codes.join(" / ")}${test.qty !== null ? ` • QTY ${test.qty}` : ""}` : "✖ ป้ายนี้ไม่ตรงกับรูปแบบ"}
                    </div>
                    {(test.coilNo || test.mother) && (
                      <div className="text-warning">
                        🧲 NUMBER COIL: {test.coilNo ?? "-"} • MASTER COIL: {test.mother ?? "-"}
                      </div>
                    )}
                    {test.lookup && <div className={test.lookup.startsWith("FOUND") ? "text-success" : "text-ink-soft"}>{test.lookup}</div>}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
