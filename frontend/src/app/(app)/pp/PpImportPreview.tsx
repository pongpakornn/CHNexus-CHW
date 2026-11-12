"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { Empty, Loading, SearchBox } from "@/components/layout/Page";
import { Pager } from "@/components/tables/Pager";
import { api, upload } from "@/lib/api";
import { EASE } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";

// 📥 เตรียม IMPORT (Template ของ Production Plan) แบบเดียวกับ FORECAST FILE: การ์ดสรุป -> กดดูรายการ -> IMPORT
//   ✏️ ยอดเปลี่ยน (เดิม → ใหม่) · 🆕 ใหม่ · 0️⃣ ว่าง + ยังไม่มียอด = ใส่ 0 · ✔ เท่าเดิม (ไม่แตะ) · ⚠ ข้อผิดพลาด (สูตร Error / ไม่ใช่ตัวเลข) = ข้าม
type Status = "NEW" | "CHANGED" | "SAME" | "ZERO";
type PvCell = { group: string; label: string; status: Status; old: number | null; new: number };
type Pv = { id: string; file: string; title: string; items: PvCell[]; errors: { cell: string; text: string }[]; unknown: string[]; rounded: number; count: number };
type View = "home" | "ready" | "CHANGED" | "NEW" | "ZERO" | "SAME" | "errors";
const PAGE = 100;
const n2 = (v: number | null) => (v == null ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const ST: Record<Status, string> = { NEW: "ใหม่", CHANGED: "ยอดเปลี่ยน", ZERO: "ใส่ 0", SAME: "เท่าเดิม" };

export function PpImportPreview({ file, endpoint, title, onClose, onDone }: { file: File | null; endpoint: string; title: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [pv, setPv] = useState<Pv | null>(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState<View>("home");
  const [busy, setBusy] = useState(false);

  // เลือกไฟล์ใหม่ = เริ่มหน้าเตรียม IMPORT ใหม่ (รีเซ็ตระหว่าง render ไม่ใช่ใน effect)
  const [forFile, setForFile] = useState<File | null>(file);
  if (file !== forFile) {
    setForFile(file);
    setPv(null);
    setErr("");
    setView("home");
  }

  useEffect(() => {
    if (!file) return;
    let alive = true;
    upload<Pv>(endpoint, file)
      .then((r) => alive && setPv(r))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [file, endpoint]);

  const items = useMemo(() => pv?.items ?? [], [pv]);
  const cnt = useMemo(() => {
    const c = { NEW: 0, CHANGED: 0, ZERO: 0, SAME: 0 };
    for (const x of items) c[x.status]++;
    return c;
  }, [items]);
  const ready = cnt.NEW + cnt.CHANGED + cnt.ZERO;
  const bad = (pv?.errors.length ?? 0) + (pv?.unknown.length ?? 0);

  async function doImport() {
    if (!pv || !ready) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(endpoint + "/apply", { method: "POST", body: pv.id });
      toast.show("IMPORTED", r.message, "ok");
      onDone();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const list = view === "ready" ? items.filter((x) => x.status !== "SAME") : view === "home" || view === "errors" ? [] : items.filter((x) => x.status === view);

  if (typeof document === "undefined") return null;
  return createPortal(
    <Modal
      open={!!file}
      size="xl"
      title={`📥 เตรียม IMPORT • ${title}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span className="mr-auto truncate text-xs font-bold text-ink-soft">{pv ? `${pv.file} · ${pv.title}` : file?.name}</span>
          {view !== "home" && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setView("home")}>
              ← กลับหน้าเตรียม IMPORT
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className="btn bg-accent" disabled={!pv || busy || ready === 0} onClick={doImport}>
            {busy ? <span className="ff-spin is-sm" aria-label="กำลังทำงาน" /> : `📥 IMPORT (${ready.toLocaleString()})`}
          </button>
        </>
      }
    >
      {err ? (
        <p className="ff-ref is-bad">{err}</p>
      ) : !pv ? (
        <div className="grid place-items-center gap-2 py-10">
          <Loading />
          <small className="text-xs font-bold text-ink-soft">กำลังอ่านไฟล์และเทียบกับยอดในระบบ…</small>
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} initial={reduce ? { opacity: 0 } : { opacity: 0, x: view === "home" ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: view === "home" ? -24 : 24 }} transition={{ duration: 0.3, ease: EASE }}>
            {view === "home" ? (
              <div className="grid gap-4">
                <div className="ff-cards">
                  <PvCard tone="ok" icon="✅" title="พร้อมดำเนินการ" n={ready} sub={`ยอดเปลี่ยน ${cnt.CHANGED.toLocaleString()} • ใหม่ ${cnt.NEW.toLocaleString()} • ใส่ 0 ${cnt.ZERO.toLocaleString()}`} onClick={() => setView("ready")} i={0} />
                  <PvCard tone="warn" icon="✏️" title="ยอดเปลี่ยน" n={cnt.CHANGED} sub="อัพเดทเป็นยอดใหม่ (ดูยอดเดิม → ยอดใหม่)" onClick={() => setView("CHANGED")} i={1} />
                  <PvCard tone="blue" icon="🆕" title="ยอดใหม่" n={cnt.NEW} sub="ยังไม่มียอดในระบบ = เพิ่ม" onClick={() => setView("NEW")} i={2} />
                  <PvCard tone="purple" icon="0️⃣" title="ว่าง • ใส่ 0" n={cnt.ZERO} sub="ช่องว่างที่ยังไม่มียอด = ใส่ 0" onClick={() => setView("ZERO")} i={3} />
                  <PvCard tone="mute" icon="✔" title="ยอดเดิมตรงกัน" n={cnt.SAME} sub="ไม่แตะ" onClick={() => setView("SAME")} i={4} />
                  {bad > 0 && <PvCard tone="bad" icon="⚠" title="ข้อผิดพลาด • ข้าม" n={bad} sub="สูตร Error / ไม่ใช่ตัวเลข / ไม่พบในระบบ" onClick={() => setView("errors")} i={5} />}
                </div>
                <p className="ff-ref">
                  ช่องว่างที่มียอดอยู่แล้ว = คงยอดเดิม · พิมพ์ 0 = เปลี่ยนเป็น 0 · ช่องสูตร / Link อ่านค่าที่ Excel คำนวณไว้ตอน Save
                  {pv.rounded > 0 ? ` · ทศนิยมเกิน 2 ตำแหน่ง ${pv.rounded.toLocaleString()} ช่อง ปัดเป็น 2 ตำแหน่ง` : ""}
                </p>
                {ready === 0 && bad === 0 && <p className="ff-ref is-ok">ยอดในไฟล์ตรงกับในระบบทั้งหมด ไม่มีอะไรต้องอัพเดท</p>}
              </div>
            ) : view === "errors" ? (
              <ErrorList pv={pv} />
            ) : (
              <CellList title={view === "ready" ? "✅ พร้อมดำเนินการ" : view === "CHANGED" ? "✏️ ยอดเปลี่ยน (ยอดเดิม → ยอดใหม่)" : view === "NEW" ? "🆕 ยอดใหม่" : view === "ZERO" ? "0️⃣ ว่าง • ใส่ 0" : "✔ ยอดเดิมตรงกัน (ไม่แตะ)"} list={list} showSt={view === "ready"} />
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Modal>,
    document.body,
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

function CellList({ title, list, showSt }: { title: string; list: PvCell[]; showSt: boolean }) {
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200).trim().toLowerCase();
  const [page, setPage] = useState(0);
  const rows = useMemo(() => (q ? list.filter((x) => `${x.group} ${x.label}`.toLowerCase().includes(q)) : list), [list, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm font-black text-[#1f2350]">
          {title} • {rows.length.toLocaleString()}
        </b>
        <SearchBox value={key} onChange={(s) => (setKey(s), setPage(0))} placeholder="ค้นหา เครื่อง / หน่วยงาน / วันที่" className="ml-auto min-w-[220px]" />
      </div>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ff-table-wrap is-modal">
          <table className="ff-table">
            <thead>
              <tr>
                {showSt && <th>สถานะ</th>}
                <th>รายการ</th>
                <th>ช่อง / วันที่</th>
                <th className="is-num">ยอดเดิม</th>
                <th className="is-num">ยอดใหม่</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(cur * PAGE, cur * PAGE + PAGE).map((x, i) => (
                <tr key={`${x.group}|${x.label}`} style={{ "--i": Math.min(i, 20) } as React.CSSProperties}>
                  {showSt && (
                    <td data-label="สถานะ">
                      <span className={`ff-st ${x.status === "CHANGED" ? "is-changed" : x.status === "NEW" ? "is-new" : "is-ok"}`}>{ST[x.status]}</span>
                    </td>
                  )}
                  <td data-label="รายการ" className="is-pa">
                    {x.group}
                  </td>
                  <td data-label="ช่อง / วันที่">{x.label}</td>
                  <td data-label="ยอดเดิม" className="is-num">
                    {x.status === "CHANGED" ? <s>{n2(x.old)}</s> : n2(x.old)}
                  </td>
                  <td data-label="ยอดใหม่" className="is-num">
                    {x.status === "SAME" ? n2(x.new) : <b>{n2(x.new)}</b>}
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

function ErrorList({ pv }: { pv: Pv }) {
  return (
    <div className="grid gap-3">
      <b className="text-sm font-black text-[#1f2350]">⚠ ข้อผิดพลาด • ไม่นำเข้า (ช่องอื่น IMPORT ได้ตามปกติ)</b>
      {pv.unknown.length > 0 && <p className="ff-ref is-bad">ไม่พบในระบบ ({pv.unknown.length}): {pv.unknown.join(", ")}</p>}
      {pv.errors.length > 0 && (
        <div className="ff-table-wrap is-modal">
          <table className="ff-table">
            <thead>
              <tr>
                <th>ช่อง</th>
                <th>ปัญหา</th>
              </tr>
            </thead>
            <tbody>
              {pv.errors.slice(0, 500).map((e, i) => (
                <tr key={i}>
                  <td data-label="ช่อง" className="is-pa">
                    {e.cell}
                  </td>
                  <td data-label="ปัญหา">{e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pv.errors.length > 500 && <small className="text-xs font-bold text-ink-soft">… และอีก {(pv.errors.length - 500).toLocaleString()} ช่อง</small>}
      <p className="ff-ref">แก้ในไฟล์ (เช่น Link ที่ #REF! ให้ชี้ใหม่) แล้ว Save และ IMPORT อีกครั้ง</p>
    </div>
  );
}
