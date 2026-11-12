"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { Empty, Loading, SearchBox } from "@/components/layout/Page";
import { Pager } from "@/components/tables/Pager";
import { api } from "@/lib/api";
import { EASE } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { MON, keyOf, n0, type FFile, type Fix, type NewProd, type Preview, type Prod, type PvItem, type PvMissing, type SendRow } from "./ff";

// 📥 หน้าเตรียม IMPORT (FORECAST FILE): การ์ดสรุป -> กดดูรายการ -> ย้อนกลับมาหน้าเตรียม IMPORT
//   ✅ พร้อมดำเนินการ = ใหม่ + ยอดเปลี่ยน (+ รายการที่แก้แล้ว) · ✏️ ยอดเปลี่ยน (เดิม -> ใหม่) · 🆕 ใหม่ · ✔ ยอดเดิมตรงกัน (ใช้ตัวเดิม ไม่แตะ)
//   ⚠ ไม่มีในระบบ: ใช้ PART A ที่มีอยู่ (ระบบหาตัวใกล้เคียงให้ เช่น เว้นวรรคเกิน) หรือ ➕ เพิ่ม Product ใหม่ (ช่องเดียวกับ Product Control)
//   🆕 แก้แล้ว: แสดงสถานะ พร้อมดำเนินการ · แก้ / ยกเลิกได้ · ไม่มีรายการค้าง = การ์ด "ไม่มีในระบบ" หายไป
//   IMPORT: ตรวจ Product ใหม่อีกครั้ง (มีคนเพิ่มไปแล้ว = ใช้ตัวนั้น ไม่สร้างซ้ำ) -> เพิ่ม Product -> อัพเดทยอด (Server ตรวจทุกแถวอีกรอบ)
type View = "home" | "ready" | "changed" | "new" | "same" | "missing" | "fixed";
type Stock = { stkId: number; code: string; name: string; isMain: boolean; canAdd: boolean };
type PMeta = { canAdd: boolean; stocks: Stock[] };
const PAGE = 100;
const KIND: Record<PvMissing["kind"], string> = {
  NOT_FOUND: "ไม่พบ PART A ในระบบ",
  NO_PART_A: "ไม่มี PART A ในไฟล์",
  NO_CUSTOMER: "สินค้าในระบบไม่มี CUSTOMER",
  MULTI: "PART A ซ้ำหลายสินค้า",
  INVALID: "ข้อมูลไม่ถูกต้อง",
};
const fixable = (m: PvMissing) => m.kind === "NOT_FOUND" || m.kind === "NO_PART_A";
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const ym = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${MON[mo - 1]} ${y}`;
};

export function ImportPreview({ file, year, withCalc, rows, onClose }: { file: FFile; year: number; withCalc: boolean; rows: SendRow[]; onClose: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState<View>("home");
  const [fixes, setFixes] = useState<Record<string, Fix>>({});
  const [editing, setEditing] = useState<PvMissing | null>(null);
  const [meta, setMeta] = useState<PMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Preview>("/forecast/file/preview", { method: "POST", body: { year, rows } })
      .then((r) => alive && setPv(r))
      .catch((e) => alive && setErr((e as Error).message));
    api<{ can: { add: boolean }; stocks: Stock[] }>("/products/meta")
      .then((r) => alive && setMeta({ canAdd: r.can.add, stocks: r.stocks.filter((s) => s.canAdd) }))
      .catch(() => alive && setMeta({ canAdd: false, stocks: [] }));
    return () => {
      alive = false;
    };
  }, [year, rows]);

  const items = useMemo(() => pv?.items ?? [], [pv]);
  const missing = useMemo(() => pv?.missing ?? [], [pv]);
  const open = missing.filter((m) => !fixes[m.key]);
  const fixed = missing.filter((m) => fixes[m.key]);
  const fixedRows = fixed.reduce((a, m) => a + m.rows, 0);
  const cnt = { new: items.filter((x) => x.status === "NEW").length, changed: items.filter((x) => x.status === "CHANGED").length, same: items.filter((x) => x.status === "SAME").length };
  const ready = cnt.new + cnt.changed + fixedRows;

  // แถวที่ส่ง IMPORT: แทน PART A ของกลุ่มที่แก้แล้ว (ใช้ตัวที่มีอยู่ / Product ใหม่)
  const effective = useCallback(
    (fx: Record<string, Fix>) =>
      rows.map((r) => {
        const f = fx[keyOf(r)];
        if (!f) return r;
        return { ...r, partA: f.mode === "map" ? f.prod.partA : f.form.partA };
      }),
    [rows],
  );

  async function doImport() {
    if (!pv) return;
    let fx = { ...fixes };
    const pend = Object.entries(fx).filter(([, f]) => f.mode === "new" && !f.done) as [string, Extract<Fix, { mode: "new" }>][];
    const lines = [
      `ไฟล์: ${file.fileName} • ปี ${year}`,
      `พร้อมดำเนินการ ${ready.toLocaleString()} รายการ (ใหม่ ${cnt.new.toLocaleString()} • ยอดเปลี่ยน ${cnt.changed.toLocaleString()}${fixedRows ? ` • แก้แล้ว ${fixedRows.toLocaleString()} แถว` : ""})`,
      `ยอดเดิมตรงกัน ${cnt.same.toLocaleString()} รายการ (ใช้ตัวเดิม ไม่แตะ)`,
      open.length ? `⚠ ไม่มีในระบบ ${open.length.toLocaleString()} รายการ (ข้าม ไม่นำเข้า)` : "",
      pend.length ? `\n➕ เพิ่ม Product ใหม่ ${pend.length} รายการก่อน แล้วจึงอัพเดทยอด` : "",
      withCalc ? "แล้วคำนวณ MAX / MIN ของคลังที่เปิด AUTO CALC" : "นำเข้าอย่างเดียว ไม่คำนวณ MAX / MIN",
    ].filter(Boolean);
    if (!(await dlg.confirm({ title: "IMPORT FORECAST FILE", message: lines.join("\n") + "\n\nยืนยันการนำเข้าหรือไม่?", ok: "IMPORT" }))) return;
    try {
      // 1) ตรวจ Product ใหม่อีกครั้ง: มีคนเพิ่ม PART A นี้ไปแล้ว = ใช้ตัวที่มีอยู่ ไม่สร้างซ้ำ
      if (pend.length) {
        setBusy("กำลังตรวจสอบ Product อีกครั้ง…");
        const chk = await api<{ exists: Prod[] }>("/forecast/file/check", { method: "POST", body: pend.map(([, f]) => f.form.partA) });
        const ex = new Map(chk.exists.map((p) => [p.partA.toUpperCase(), p]));
        const moved: string[] = [];
        for (const [k, f] of pend) {
          const hit = ex.get(f.form.partA.trim().toUpperCase());
          if (hit) {
            fx = { ...fx, [k]: { mode: "map", prod: hit } };
            moved.push(hit.partA);
          }
        }
        if (moved.length) toast.show("ใช้ Product ที่มีอยู่แล้ว", `PART A ${moved.join(", ")} มีในระบบแล้ว (มีคนเพิ่มไประหว่างนี้) - ใช้ตัวที่มีอยู่ ไม่สร้างซ้ำ`, "warn");
        // 2) เพิ่ม Product ใหม่ทีละรายการ (สิทธิ์ / Log เดียวกับ Product Control) · พลาด = หยุด ยังไม่อัพเดทยอด
        for (const [k, f] of Object.entries(fx)) {
          if (f.mode !== "new" || f.done) continue;
          setBusy(`กำลังเพิ่ม Product ${f.form.partA} …`);
          const s = f.form;
          const main = s.stock === "MAIN";
          try {
            const r = await api<{ ptId: number }>("/products", {
              method: "POST",
              body: { supplier: s.supplier, category: s.category, partCode: s.partCode, partName: s.partName, packSize: s.packSize, bin: s.bin, qrCode: "", customer: s.customer, partA: s.partA, partB: s.partB, partNo: s.partNo, model: s.model, imageFileName: null, coilNo: "", masterCoil: "", coilKg: "", inMain: main, otherStockIds: main ? [] : [s.stock], filterStkId: null, oldCode: null },
            });
            fx = { ...fx, [k]: { ...f, done: { ptId: r.ptId, partCode: s.partCode, partA: s.partA, partB: s.partB, partNo: s.partNo, name: s.partName, customer: s.customer } } };
            setFixes(fx);
          } catch (e) {
            setFixes(fx);
            throw new Error(`เพิ่ม Product ${s.partA} ไม่สำเร็จ - ยังไม่ได้อัพเดทยอด\n\n${(e as Error).message}`);
          }
        }
        setFixes(fx);
      }
      // 3) อัพเดทยอด (Server จับคู่ PART A ใหม่ทุกแถว · เงื่อนไขเดิม)
      setBusy("กำลังอัพเดทยอด Forecast / Order / Delivery …");
      const r = await api<{ message: string; month: string | null }>("/forecast/file/apply", { method: "POST", body: { year, withCalc, rows: effective(fx), fileId: file.id, summary: false } });
      await dlg.alert({ title: "IMPORT FORECAST FILE", message: r.message, tone: r.message.includes("⚠") ? "warn" : "ok" });
      router.push("/master/forecast");
    } catch (e) {
      dlg.alert({ title: "IMPORT", tone: "error", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const go = (v: View) => setView(v);
  const listOf = (v: View): PvItem[] => (v === "ready" ? items.filter((x) => x.status !== "SAME") : v === "changed" ? items.filter((x) => x.status === "CHANGED") : v === "new" ? items.filter((x) => x.status === "NEW") : v === "same" ? items.filter((x) => x.status === "SAME") : []);

  return (
    <Modal
      open
      size="xl"
      title={editing ? "➕ เพิ่ม PRODUCT ใหม่" : "📥 เตรียม IMPORT • FORECAST FILE"}
      onClose={() => !busy && (editing ? setEditing(null) : onClose())}
      footer={
        editing ? null : (
          <>
            <span className="mr-auto text-xs font-bold text-ink-soft">{busy ?? (withCalc ? "IMPORT + คำนวณ MAX / MIN AUTO" : "IMPORT อย่างเดียว (ไม่คำนวณ)")}</span>
            {view !== "home" && (
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => go("home")}>
                ← กลับหน้าเตรียม IMPORT
              </button>
            )}
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={onClose}>
              CANCEL
            </button>
            <button type="button" className="btn bg-accent" disabled={!pv || !!busy || ready === 0} onClick={doImport}>
              {busy ? <span className="ff-spin is-sm" aria-label="กำลังทำงาน" /> : `📥 IMPORT (${ready.toLocaleString()})`}
            </button>
          </>
        )
      }
    >
      {err ? (
        <p className="ff-ref is-bad">{err}</p>
      ) : !pv ? (
        <div className="grid place-items-center gap-2 py-10">
          <Loading />
          <small className="text-xs font-bold text-ink-soft">กำลังตรวจ {rows.length.toLocaleString()} แถวกับข้อมูลในระบบ…</small>
        </div>
      ) : editing ? (
        <ProductForm
          m={editing}
          fix={fixes[editing.key]}
          meta={meta}
          category={pv.defaults.category}
          onCancel={() => setEditing(null)}
          onSave={(f) => {
            setFixes((x) => ({ ...x, [editing.key]: f }));
            setEditing(null);
            toast.show("พร้อมดำเนินการ", f.mode === "map" ? `ใช้ PART A ${f.prod.partA} ที่มีอยู่ในระบบ` : `จะเพิ่ม Product ${f.form.partA} ตอนกด IMPORT`, "ok");
          }}
        />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} initial={reduce ? { opacity: 0 } : { opacity: 0, x: view === "home" ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: view === "home" ? -24 : 24 }} transition={{ duration: 0.3, ease: EASE }}>
            {view === "home" ? (
              <div className="grid gap-4">
                <div className="ff-cards">
                  <PvCard tone="ok" icon="✅" title="พร้อมดำเนินการ" n={ready} sub={`ใหม่ ${cnt.new.toLocaleString()} • ยอดเปลี่ยน ${cnt.changed.toLocaleString()}${fixedRows ? ` • แก้แล้ว ${fixedRows.toLocaleString()}` : ""}`} onClick={() => go("ready")} i={0} />
                  <PvCard tone="warn" icon="✏️" title="ยอดเปลี่ยน" n={cnt.changed} sub="อัพเดทเป็นยอดใหม่ (ดูยอดเดิม → ยอดใหม่)" onClick={() => go("changed")} i={1} />
                  <PvCard tone="blue" icon="🆕" title="รายการใหม่" n={cnt.new} sub="ยังไม่มีในเดือนนั้น = เพิ่ม" onClick={() => go("new")} i={2} />
                  <PvCard tone="mute" icon="✔" title="ยอดเดิมตรงกัน" n={cnt.same} sub="ใช้ตัวเดิม ไม่แตะ" onClick={() => go("same")} i={3} />
                  {open.length > 0 && <PvCard tone="bad" icon="⚠" title="ไม่มีในระบบ" n={open.length} sub={`${open.reduce((a, m) => a + m.rows, 0).toLocaleString()} แถว • กดเพื่อเพิ่ม / เลือกตัวที่มีอยู่`} onClick={() => go("missing")} i={4} />}
                  {fixed.length > 0 && <PvCard tone="purple" icon="🛠" title="แก้แล้ว • พร้อมดำเนินการ" n={fixed.length} sub={`เพิ่ม Product ใหม่ ${fixed.filter((m) => fixes[m.key]?.mode === "new").length} • ใช้ตัวที่มีอยู่ ${fixed.filter((m) => fixes[m.key]?.mode === "map").length}`} onClick={() => go("fixed")} i={5} />}
                </div>
                {open.length > 0 && (
                  <div className="ff-alerts">
                    <b>⚠ รายการที่ไม่มีในระบบ ({open.length}) • จะไม่นำเข้าจนกว่าจะแก้</b>
                    {open.slice(0, 6).map((m) => (
                      <button key={m.key} type="button" onClick={() => go("missing")}>
                        <span className="is-pa">{m.partA || "ไม่มี PART A"}</span>
                        <span className="truncate">
                          {m.sheet} • {m.partNo} • {m.name}
                        </span>
                        <i>{KIND[m.kind]}</i>
                      </button>
                    ))}
                    {open.length > 6 && <small>… และอีก {open.length - 6} รายการ (กดการ์ด ไม่มีในระบบ)</small>}
                  </div>
                )}
              </div>
            ) : view === "missing" || view === "fixed" ? (
              <MissingList
                list={view === "missing" ? open : fixed}
                fixes={fixes}
                canAdd={!!meta?.canAdd}
                fixedView={view === "fixed"}
                onMap={(m, p) => setFixes((x) => ({ ...x, [m.key]: { mode: "map", prod: p } }))}
                onAdd={(m) => setEditing(m)}
                onUndo={(m) =>
                  setFixes((x) => {
                    const n = { ...x };
                    delete n[m.key];
                    return n;
                  })
                }
              />
            ) : (
              <ItemList v={view} list={listOf(view)} fixed={view === "ready" ? fixed : []} fixes={fixes} />
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Modal>
  );
}

function PvCard({ tone, icon, title, n, sub, onClick, i }: { tone: string; icon: string; title: string; n: number; sub: string; onClick: () => void; i: number }) {
  return (
    <button type="button" className={`ff-card is-${tone}`} onClick={onClick} style={{ "--d": `${i * 60}ms` } as React.CSSProperties}>
      <span className="ff-card-ic" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <small>{title}</small>
        <b>{n.toLocaleString()}</b>
        <em>{sub}</em>
      </span>
      <span className="ff-card-go" aria-hidden>
        ›
      </span>
    </button>
  );
}

// รายการ (ใหม่ / ยอดเปลี่ยน / ยอดเดิมตรงกัน) · ยอดเปลี่ยน = เดิม → ใหม่
function ItemList({ v, list, fixed, fixes }: { v: View; list: PvItem[]; fixed: PvMissing[]; fixes: Record<string, Fix> }) {
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200).trim().toLowerCase();
  const [page, setPage] = useState(0);
  const rows = useMemo(() => (q ? list.filter((x) => [x.customer, x.partA, x.partB, x.partNo, x.name].join(" ").toLowerCase().includes(q)) : list), [list, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const title = v === "ready" ? "✅ พร้อมดำเนินการ" : v === "changed" ? "✏️ ยอดเปลี่ยน (ยอดเดิม → ยอดใหม่)" : v === "new" ? "🆕 รายการใหม่" : "✔ ยอดเดิมตรงกัน (ใช้ตัวเดิม ไม่แตะ)";
  const cell = (x: PvItem, k: "f" | "o" | "d") => {
    const nv = x[k],
      ov = k === "f" ? x.oldF : k === "o" ? x.oldO : x.oldD;
    if (x.status !== "CHANGED" || ov === nv) return <span className={nv ? "" : "is-z"}>{n0(nv)}</span>;
    return (
      <span className="ff-chg">
        <s>{n0(ov)}</s>
        <b>{n0(nv)}</b>
      </span>
    );
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm font-black text-[#1f2350]">
          {title} • {rows.length.toLocaleString()}
        </b>
        <SearchBox value={key} onChange={(s) => (setKey(s), setPage(0))} placeholder="ค้นหา PART A / PART B / PART NO / ชื่อ / ลูกค้า" className="ml-auto min-w-[220px]" />
      </div>
      {fixed.length > 0 && (
        <p className="ff-ref">
          + แก้แล้ว {fixed.length} รายการ ({fixed.reduce((a, m) => a + m.rows, 0)} แถว): {fixed.map((m) => (fixes[m.key]?.mode === "map" ? (fixes[m.key] as { prod: Prod }).prod.partA : (fixes[m.key] as { form: NewProd }).form.partA)).join(", ")} (ตรวจยอดตอน IMPORT)
        </p>
      )}
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ff-table-wrap is-modal">
          <table className="ff-table">
            <thead>
              <tr>
                {v === "ready" && <th>สถานะ</th>}
                <th>CUSTOMER</th>
                <th>PART A</th>
                <th>PART B</th>
                <th>PART NO</th>
                <th>PRODUCT NAME</th>
                <th>MONTH</th>
                <th className="is-num">FORECAST</th>
                <th className="is-num">ORDER</th>
                <th className="is-num">DELIVERY</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(cur * PAGE, cur * PAGE + PAGE).map((x, i) => (
                <tr key={`${x.customer}|${x.partA}|${x.month}`} style={{ "--i": Math.min(i, 20) } as React.CSSProperties}>
                  {v === "ready" && (
                    <td data-label="สถานะ">
                      <span className={`ff-st is-${x.status.toLowerCase()}`}>{x.status === "NEW" ? "ใหม่" : "ยอดเปลี่ยน"}</span>
                    </td>
                  )}
                  <td data-label="CUSTOMER">{x.customer}</td>
                  <td data-label="PART A" className="is-pa">
                    {x.partA}
                  </td>
                  <td data-label="PART B">{x.partB || "-"}</td>
                  <td data-label="PART NO" className="is-pn">
                    {x.partNo || "-"}
                  </td>
                  <td data-label="PRODUCT NAME" className="is-name">
                    {x.name || "-"}
                  </td>
                  <td data-label="MONTH">{ym(x.month)}</td>
                  <td data-label="FORECAST" className="is-num">
                    {cell(x, "f")}
                  </td>
                  <td data-label="ORDER" className="is-num">
                    {cell(x, "o")}
                  </td>
                  <td data-label="DELIVERY" className="is-num">
                    {cell(x, "d")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <Pager page={cur} pages={pages} total={rows.length} size={PAGE} onPage={setPage} />}
    </div>
  );
}

// ⚠ ไม่มีในระบบ / 🛠 แก้แล้ว
function MissingList({ list, fixes, canAdd, fixedView, onMap, onAdd, onUndo }: { list: PvMissing[]; fixes: Record<string, Fix>; canAdd: boolean; fixedView: boolean; onMap: (m: PvMissing, p: Prod) => void; onAdd: (m: PvMissing) => void; onUndo: (m: PvMissing) => void }) {
  const [key, setKey] = useState("");
  const q = key.trim().toLowerCase();
  const rows = q ? list.filter((m) => [m.partA, m.sheet, m.partNo, m.name, m.reason].join(" ").toLowerCase().includes(q)) : list;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm font-black text-[#1f2350]">
          {fixedView ? "🛠 แก้แล้ว • พร้อมดำเนินการ" : "⚠ ไม่มีในระบบ"} • {rows.length}
        </b>
        <SearchBox value={key} onChange={setKey} placeholder="ค้นหา PART A / PART NO / ชื่อ / ลูกค้า" className="ml-auto min-w-[220px]" />
      </div>
      {!fixedView && <p className="ff-ref">เลือก &quot;ใช้ตัวนี้&quot; ถ้าเป็นสินค้าที่มีอยู่แล้ว (เช่น เว้นวรรค / ขีดไม่ตรง) หรือกด ➕ เพิ่ม Product ใหม่ · รายการที่ไม่แก้ = ข้าม ไม่นำเข้า</p>}
      {rows.length === 0 ? (
        <Empty>{fixedView ? "ยังไม่มีรายการที่แก้" : "ไม่มีรายการค้าง 🎉"}</Empty>
      ) : (
        <div className="grid gap-2">
          {rows.map((m, i) => {
            const f = fixes[m.key];
            return (
              <div key={m.key} className={`ff-miss ${f ? "is-fixed" : ""}`} style={{ "--d": `${Math.min(i, 12) * 40}ms` } as React.CSSProperties}>
                <div className="ff-miss-head">
                  <span className="is-pa">{m.partA || "ไม่มี PART A"}</span>
                  <span className={`ff-st ${f ? "is-ok" : "is-bad"}`}>{f ? (f.mode === "map" ? `พร้อมดำเนินการ • ใช้ ${f.prod.partA}` : f.done ? "เพิ่ม Product ใหม่สำเร็จแล้ว" : `พร้อมดำเนินการ • เพิ่ม Product ใหม่ ${f.form.partA}`) : KIND[m.kind]}</span>
                  <small className="ml-auto">
                    {m.sheet} • {m.months.map((x) => MON[x - 1]).join(", ")} • {m.rows} แถว
                  </small>
                </div>
                <div className="ff-miss-body">
                  <span>
                    <small>PART NO</small>
                    {m.partNo || "-"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <small>PRODUCT NAME</small>
                    <em className="block truncate">{m.name || "-"}</em>
                  </span>
                  <span>
                    <small>F / O / D</small>
                    {n0(m.f)} / {n0(m.o)} / {n0(m.d)}
                  </span>
                </div>
                {!f && m.suggest.length > 0 && fixable(m) && (
                  <div className="ff-sug">
                    <small>ใกล้เคียงในระบบ:</small>
                    {m.suggest.map((p) => (
                      <button key={p.ptId} type="button" onClick={() => onMap(m, p)} title={`${p.customer} • ${p.partNo} • ${p.name}`}>
                        ✔ ใช้ตัวนี้ <b>{p.partA}</b> <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!f && !fixable(m) && <p className="ff-note">{m.reason} · แก้ที่ MASTER DATA › Product Control แล้วเลือกไฟล์ใหม่ (รายการนี้จะข้ามไปก่อน)</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  {f ? (
                    <>
                      {f.mode === "new" && !f.done && (
                        <button type="button" className="fill-btn is-sm" onClick={() => onAdd(m)}>
                          ✏ แก้ไข
                        </button>
                      )}
                      {!(f.mode === "new" && f.done) && (
                        <button type="button" className="fill-btn is-sm is-danger" onClick={() => onUndo(m)}>
                          ↺ ยกเลิก
                        </button>
                      )}
                    </>
                  ) : (
                    fixable(m) &&
                    (canAdd ? (
                      <button type="button" className="fill-btn is-sm is-add" onClick={() => onAdd(m)}>
                        ➕ เพิ่ม Product ใหม่
                      </button>
                    ) : (
                      <small className="text-[11px] font-bold text-ink-soft">ไม่มีสิทธิ์เพิ่มสินค้า (Product Control)</small>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ➕ ฟอร์มเพิ่ม Product ใหม่ (ช่องหลักของ Product Control) · พิมพ์ PART A แล้วระบบตรวจทันทีว่ามีอยู่แล้วไหม (มี = ใช้ตัวที่มีอยู่)
function ProductForm({ m, fix, meta, category, onCancel, onSave }: { m: PvMissing; fix?: Fix; meta: PMeta | null; category: string; onCancel: () => void; onSave: (f: Fix) => void }) {
  const stocks = meta?.stocks ?? [];
  const defStock: NewProd["stock"] = stocks.some((s) => s.isMain) ? "MAIN" : (stocks[0]?.stkId ?? "MAIN");
  const [f, setF] = useState<NewProd>(() =>
    fix?.mode === "new"
      ? fix.form
      : { partCode: "-", partA: tidy(m.partA), partB: "", partNo: tidy(m.partNo), partName: tidy(m.name), customer: m.customer || m.sheet, model: "", category, packSize: "", supplier: "", bin: "", stock: defStock },
  );
  const [exists, setExists] = useState<Prod | null>(null);
  const [checking, setChecking] = useState(false);
  const pa = useDebounced(f.partA, 400);
  useEffect(() => {
    const a = pa.trim();
    if (!a) return;
    let alive = true;
    const t = setTimeout(() => setChecking(true), 0);
    api<{ exists: Prod[] }>("/forecast/file/check", { method: "POST", body: [a] })
      .then((r) => alive && setExists(r.exists[0] ?? null))
      .catch(() => alive && setExists(null))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pa]);
  const set = (p: Partial<NewProd>) => setF((x) => ({ ...x, ...p }));
  const changedA = m.partA && tidy(m.partA) !== m.partA;
  const ok = f.partCode.trim() && f.partA.trim() && f.customer.trim() && f.partName.trim() && (!f.packSize.trim() || /^\d+$/.test(f.packSize.trim())) && stocks.length > 0;
  const fld = (k: keyof NewProd, label: string, req = false, ph = "") => (
    <label className="ff-fld">
      <span>
        {label}
        {req && <i>*</i>}
      </span>
      <input className="field" value={String(f[k])} placeholder={ph} onChange={(e) => set({ [k]: e.target.value } as Partial<NewProd>)} onBlur={(e) => set({ [k]: tidy(e.target.value) } as Partial<NewProd>)} />
    </label>
  );
  return (
    <div className="grid gap-4">
      <div className="ff-ref">
        จากไฟล์: <b>{m.sheet}</b> • PART A <b>{m.partA || "(ไม่มี)"}</b> • PART NO <b>{m.partNo || "-"}</b> • {m.name || "-"} • {m.rows} แถว ({m.months.map((x) => MON[x - 1]).join(", ")})
        {changedA && <span className="ml-1 font-black text-[#b45309]">• ตัดช่องว่างที่เกินออกให้แล้ว</span>}
      </div>
      {exists && pa.trim() && (
        <div className="ff-exists">
          <span>
            ✔ มี PART A <b>{exists.partA}</b> อยู่ในระบบแล้ว ({exists.customer} • {exists.partNo || "-"} • {exists.name})
          </span>
          <button type="button" className="cta-btn is-green is-sm" onClick={() => onSave({ mode: "map", prod: exists })}>
            ใช้ตัวที่มีอยู่แล้ว
          </button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fld("partCode", "PRODUCT CODE", true, "ไม่มีรหัส = -")}
        <label className="ff-fld">
          <span>
            PART A<i>*</i>
            {checking && <em> กำลังตรวจ…</em>}
          </span>
          <input className="field" value={f.partA} onChange={(e) => set({ partA: e.target.value })} onBlur={(e) => set({ partA: tidy(e.target.value) })} />
        </label>
        {fld("partB", "PART B")}
        {fld("partNo", "PART NO")}
        {fld("partName", "PRODUCT NAME", true)}
        {fld("customer", "CUSTOMER", true)}
        {fld("model", "MODEL")}
        {fld("category", "CATEGORY")}
        {fld("packSize", "PACKSIZE", false, "ตัวเลข")}
        {fld("supplier", "SUPPLIER")}
        {fld("bin", "BIN")}
        <label className="ff-fld">
          <span>
            STOCK<i>*</i>
          </span>
          <select className="field" value={String(f.stock)} onChange={(e) => set({ stock: e.target.value === "MAIN" ? "MAIN" : Number(e.target.value) })}>
            {stocks.map((s) => (
              <option key={s.stkId} value={s.isMain ? "MAIN" : s.stkId}>
                {s.code} • {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!stocks.length && <p className="ff-ref is-bad">ไม่มีคลังที่คุณเพิ่มสินค้าได้</p>}
      <p className="text-[11px] font-semibold text-ink-soft">Product จะถูกเพิ่มตอนกด IMPORT (ตรวจซ้ำอีกครั้งก่อนเพิ่ม) · รูป / Coil / ช่องอื่น ๆ แก้ต่อได้ที่ MASTER DATA › Product Control</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          ← กลับ
        </button>
        <button type="button" className="btn bg-accent" disabled={!ok || checking || !!exists} onClick={() => onSave({ mode: "new", form: { ...f, partA: tidy(f.partA), partCode: f.partCode.trim() } })}>
          ✔ ยืนยัน (พร้อมดำเนินการ)
        </button>
      </div>
    </div>
  );
}
