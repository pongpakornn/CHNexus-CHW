"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api } from "@/lib/api";

// 📝 SETUP › MIN REASONS : ตัวเลือกหมายเหตุของปุ่ม REPORT (ทั้งระบบ) - เพิ่ม / แก้ไขข้อความ / ลบ / เลื่อนลำดับ แล้วกด SAVE ครั้งเดียว
//   รายงานเก่าเก็บข้อความหมายเหตุไว้ในตัวเองแล้ว (แก้ / ลบตัวเลือกไม่กระทบเอกสารเดิม)
type Row = { id: number; text: string; key: string };
type Data = { ready: boolean; items: { id: number; text: string }[] };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
let seq = 0;
const keyOf = () => `n${++seq}`;

export function MinReasonPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [ready, setReady] = useState(true);
  const [orig, setOrig] = useState<Row[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/minreport/settings/reasons");
      const r = d.items.map((x) => ({ id: x.id, text: x.text, key: `r${x.id || keyOf()}` }));
      setReady(d.ready);
      setOrig(r);
      setRows(r);
    } catch (e) {
      toast.show("ERROR", "โหลดตัวเลือกหมายเหตุไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => !!rows && !!orig && JSON.stringify(rows.map((r) => [r.id, r.text.trim()])) !== JSON.stringify(orig.map((r) => [r.id, r.text])), [rows, orig]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!rows) return <Loading />;
  const set = (fn: (r: Row[]) => Row[]) => setRows((r) => (r ? fn(r) : r));
  const move = (i: number, d: number) =>
    set((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  function addOne() {
    const t = add.trim().replace(/\s+/g, " ");
    if (!t) return;
    if (t.length > 60) return toast.show("WARNING", "หมายเหตุยาวได้ไม่เกิน 60 ตัวอักษร", "warn");
    if (rows!.some((r) => r.text.trim().toLowerCase() === t.toLowerCase())) return toast.show("WARNING", `มีหมายเหตุ "${t}" อยู่แล้ว`, "warn");
    set((r) => [...r, { id: 0, text: t, key: keyOf() }]);
    setAdd("");
  }

  async function remove(i: number) {
    const r = rows![i];
    if (r.id && !(await dlg.confirm({ title: "ลบหมายเหตุ", message: `ลบตัวเลือก "${r.text}" ?\n(รายงานเดิมที่ใช้หมายเหตุนี้ยังแสดงข้อความเดิม) · มีผลเมื่อกด SAVE`, ok: "ลบ" }))) return;
    set((x) => x.filter((_, k) => k !== i));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/minreport/settings/reasons", { method: "POST", body: { items: rows!.map((x) => ({ id: x.id, text: x.text.trim() })) } });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-xs font-bold text-ink-soft">
        ตัวเลือกหมายเหตุที่กดได้ตอน REPORT สินค้าค้างที่ค่า MIN (ทุกคลัง) · กดตัวเลือก = ข้อความลงช่องรายละเอียด แล้วพิมพ์เพิ่มต่อได้ · แก้ข้อความได้ในช่องเลย · ⬆⬇ เลื่อนลำดับ · กด SAVE เพื่อบันทึก
      </p>
      {!ready && <div className="mr-off">ฐานข้อมูลยังไม่มีตารางหมายเหตุ (database/nexus/23_Min_Report_Reasons.sql) · แสดงค่าเริ่มต้น แก้ไขไม่ได้</div>}

      <div>
        <span className={L}>เพิ่มหมายเหตุ</span>
        <div className="rs-add">
          <input value={add} maxLength={60} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} placeholder="เช่น รอ Packing / รอ QA Release" disabled={!ready} />
          <button type="button" className="cta-btn is-green" onClick={addOne} disabled={!ready || !add.trim()}>
            ＋ ADD
          </button>
        </div>
      </div>

      <div>
        <span className={L}>ตัวเลือกหมายเหตุ ({rows.length})</span>
        <div className="rs-list">
          {rows.map((r, i) => (
            <div key={r.key} className={`rs-row ${r.id ? "" : "is-new"}`}>
              <span>{i + 1}</span>
              <input
                value={r.text}
                maxLength={60}
                disabled={!ready}
                aria-label={`หมายเหตุลำดับ ${i + 1}`}
                onChange={(e) => {
                  const v = e.target.value;
                  set((x) => x.map((y, k) => (k === i ? { ...y, text: v } : y)));
                }}
              />
              <div className="rs-btns">
                <button type="button" title="เลื่อนขึ้น" onClick={() => move(i, -1)} disabled={!ready || i === 0}>
                  ⬆
                </button>
                <button type="button" title="เลื่อนลง" onClick={() => move(i, 1)} disabled={!ready || i === rows.length - 1}>
                  ⬇
                </button>
                <button type="button" title="ลบ" className="is-del" onClick={() => remove(i)} disabled={!ready || rows.length <= 1}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs font-bold text-warning">ยังไม่ได้ SAVE</span>}
        <button type="button" className="cta-btn is-gray" onClick={() => setRows(orig)} disabled={!dirty || busy}>
          RESET
        </button>
        <button type="button" className="cta-btn is-green" onClick={save} disabled={!ready || !dirty || busy}>
          {busy ? "…" : "💾 SAVE"}
        </button>
      </div>
    </div>
  );
}
