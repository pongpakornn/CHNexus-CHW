"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { RowAction } from "@/components/button-action/RowAction";
import { api } from "@/lib/api";

// 📝 SETUP › MIN REASONS : groups of reasons for the REPORT box (CIMS = the original list)
//   each group: name · stocks that see it (none ticked = every stock) · reasons (add / edit / reorder / delete) · one SAVE for everything
//   stocks that get MIN alerts and the sign FLOW are set as before (MIN REPORT / SIGN FLOW)
type Reason = { id: number; text: string; key: string };
type Group = { id: number; name: string; stocks: number[]; reasons: Reason[]; key: string; add: string };
type Data = { ready: boolean; groupsReady: boolean; stocks: { stkId: number; code: string }[]; groups: { id: number; name: string; stocks: number[] | null; reasons: { id: number; text: string }[] }[] };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
let seq = 0;
const keyOf = () => `n${++seq}`;
const clean = (t: string) => t.trim().replace(/\s+/g, " ");
const snap = (g: Group[]) => JSON.stringify(g.map((x) => [x.id, clean(x.name), [...x.stocks].sort(), x.reasons.map((r) => [r.id, clean(r.text)])]));

export function MinReasonPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<{ ready: boolean; groupsReady: boolean; stocks: Data["stocks"] }>({ ready: true, groupsReady: true, stocks: [] });
  const [orig, setOrig] = useState<Group[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/minreport/settings/reason-groups");
      const g = d.groups.map((x) => ({ id: x.id, name: x.name, stocks: x.stocks ?? [], add: "", key: `g${x.id || keyOf()}`, reasons: x.reasons.map((r) => ({ id: r.id, text: r.text, key: `r${r.id || keyOf()}` })) }));
      setMeta({ ready: d.ready, groupsReady: d.groupsReady, stocks: d.stocks });
      setOrig(g);
      setGroups(g);
    } catch (e) {
      toast.show("ERROR", "โหลดกลุ่มหมายเหตุไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => !!groups && !!orig && snap(groups) !== snap(orig), [groups, orig]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!groups) return <Loading />;
  const can = meta.ready && meta.groupsReady;
  const setG = (gi: number, fn: (g: Group) => Group) => setGroups((all) => (all ? all.map((g, k) => (k === gi ? fn(g) : g)) : all));
  const swap = <T,>(arr: T[], i: number, j: number) => {
    if (j < 0 || j >= arr.length) return arr;
    const n = [...arr];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  };

  function addReason(gi: number) {
    const g = groups![gi];
    const t = clean(g.add);
    if (!t) return;
    if (t.length > 60) return toast.show("WARNING", "หมายเหตุยาวได้ไม่เกิน 60 ตัวอักษร", "warn");
    if (g.reasons.some((r) => clean(r.text).toLowerCase() === t.toLowerCase())) return toast.show("WARNING", `กลุ่ม ${g.name} มีหมายเหตุ "${t}" อยู่แล้ว`, "warn");
    setG(gi, (x) => ({ ...x, add: "", reasons: [...x.reasons, { id: 0, text: t, key: keyOf() }] }));
  }
  function addGroup() {
    setGroups((all) => [...(all ?? []), { id: 0, name: `กลุ่มใหม่ ${(all?.length ?? 0) + 1}`, stocks: [], reasons: [], add: "", key: keyOf() }]);
  }
  async function removeGroup(gi: number) {
    const g = groups![gi];
    if (!(await dlg.confirm({ title: "ลบกลุ่มหมายเหตุ", message: `ลบกลุ่ม "${g.name}" และหมายเหตุ ${g.reasons.length} รายการในกลุ่ม?\n(รายงานเดิมยังแสดงข้อความเดิม) · มีผลเมื่อกด SAVE`, ok: "ลบ" }))) return;
    setGroups((all) => (all ? all.filter((_, k) => k !== gi) : all));
  }

  async function save() {
    setBusy(true);
    try {
      const body = { groups: groups!.map((g) => ({ id: g.id, name: clean(g.name), stocks: g.stocks, reasons: g.reasons.map((r) => ({ id: r.id, text: clean(r.text) })) })) };
      const r = await api<{ message: string }>("/minreport/settings/reason-groups", { method: "POST", body });
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
        กลุ่มหมายเหตุที่กดได้ตอน REPORT สินค้าค้างที่ค่า MIN · ตอน REPORT ผู้ใช้เลือกกลุ่มก่อน แล้วเลือกหมายเหตุของกลุ่มนั้น · ติ๊กคลังเพื่อให้กลุ่มแสดงเฉพาะคลังนั้น (ไม่ติ๊ก = ทุกคลัง) · คลังที่แจ้งเตือนและ SIGN FLOW ตั้งที่เมนูเดิม · กด SAVE เพื่อบันทึก
      </p>
      {!meta.groupsReady && <div className="mr-off">ฐานข้อมูลยังไม่มีกลุ่มหมายเหตุ (database/nexus/68_Min_Reason_Groups.sql) · แสดงรายการเดิมเป็นกลุ่ม CIMS แก้ไขไม่ได้</div>}

      {groups.map((g, gi) => (
        <section key={g.key} className={`rg-card ${g.id ? "" : "is-new"}`}>
          <div className="rg-head">
            <span className="rg-no">{gi + 1}</span>
            <label className="min-w-0 flex-1">
              <span className={L}>ชื่อกลุ่ม</span>
              <input className="field" value={g.name} maxLength={60} disabled={!can} onChange={(e) => setG(gi, (x) => ({ ...x, name: e.target.value }))} />
            </label>
            <div className="rg-move">
              <button type="button" className="rg-mv" title="เลื่อนกลุ่มขึ้น" aria-label="เลื่อนกลุ่มขึ้น" disabled={!can || gi === 0} onClick={() => setGroups((a) => (a ? swap(a, gi, gi - 1) : a))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </button>
              <button type="button" className="rg-mv" title="เลื่อนกลุ่มลง" aria-label="เลื่อนกลุ่มลง" disabled={!can || gi === groups.length - 1} onClick={() => setGroups((a) => (a ? swap(a, gi, gi + 1) : a))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <RowAction kind="delete" title="ลบกลุ่ม" disabled={!can || groups.length <= 1} onClick={() => removeGroup(gi)} />
            </div>
          </div>

          <div>
            <span className={L}>แสดงที่คลัง {g.stocks.length === 0 ? "(ทุกคลัง)" : `(${g.stocks.length})`}</span>
            <div className="rg-stocks">
              {meta.stocks.map((s) => {
                const on = g.stocks.includes(s.stkId);
                return (
                  <button
                    key={s.stkId}
                    type="button"
                    aria-pressed={on}
                    disabled={!can}
                    className={on ? "is-on" : ""}
                    onClick={() => setG(gi, (x) => ({ ...x, stocks: on ? x.stocks.filter((v) => v !== s.stkId) : [...x.stocks, s.stkId] }))}
                  >
                    {on ? "✓ " : ""}
                    {s.code}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className={L}>หมายเหตุในกลุ่ม ({g.reasons.length})</span>
            <div className="rs-list">
              {g.reasons.map((r, i) => (
                <div key={r.key} className={`rs-row ${r.id ? "" : "is-new"}`}>
                  <span>{i + 1}</span>
                  <input
                    value={r.text}
                    maxLength={60}
                    disabled={!can}
                    aria-label={`หมายเหตุลำดับ ${i + 1} กลุ่ม ${g.name}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setG(gi, (x) => ({ ...x, reasons: x.reasons.map((y, k) => (k === i ? { ...y, text: v } : y)) }));
                    }}
                  />
                  <div className="rs-btns">
                    <button type="button" title="เลื่อนขึ้น" onClick={() => setG(gi, (x) => ({ ...x, reasons: swap(x.reasons, i, i - 1) }))} disabled={!can || i === 0}>
                      ⬆
                    </button>
                    <button type="button" title="เลื่อนลง" onClick={() => setG(gi, (x) => ({ ...x, reasons: swap(x.reasons, i, i + 1) }))} disabled={!can || i === g.reasons.length - 1}>
                      ⬇
                    </button>
                    <button type="button" title="ลบ" className="is-del" onClick={() => setG(gi, (x) => ({ ...x, reasons: x.reasons.filter((_, k) => k !== i) }))} disabled={!can}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="rs-add mt-2">
              <input value={g.add} maxLength={60} onChange={(e) => setG(gi, (x) => ({ ...x, add: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addReason(gi)} placeholder="เพิ่มหมายเหตุในกลุ่มนี้ เช่น รอ Packing" disabled={!can} />
              <button type="button" className="cta-btn is-green" onClick={() => addReason(gi)} disabled={!can || !g.add.trim()}>
                ＋ ADD
              </button>
            </div>
          </div>
        </section>
      ))}

      <button type="button" className="cta-btn is-purple justify-self-start" onClick={addGroup} disabled={!can}>
        ＋ เพิ่มกลุ่มหมายเหตุ
      </button>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs font-bold text-warning">ยังไม่ได้ SAVE</span>}
        <button type="button" className="cta-btn is-gray" onClick={() => setGroups(orig)} disabled={!dirty || busy}>
          RESET
        </button>
        <button type="button" className="cta-btn is-green" onClick={save} disabled={!can || !dirty || busy}>
          {busy ? "…" : "💾 SAVE"}
        </button>
      </div>
    </div>
  );
}
