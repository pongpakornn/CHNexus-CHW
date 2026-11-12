"use client";

import { Fragment, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card } from "@/components/layout/Page";
import { PillSwitch } from "@/components/charts/ChartHeader";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { EASE } from "@/lib/motion";
import { f0 } from "@/lib/pp";
import { ENS, WL_ROWS, type WlMonth, type WlNote, type WlRef } from "./wl";

// 🔍 CASE 1 (ตาม EXCEL) vs CASE 2 (ตามระบบ): เทียบ PDT / Direct ทีละหน่วยงาน × เดือน
//   CASE 1 = ยอดจากไฟล์ Work load (ชีท 9. ManPower) · CASE 2 = ระบบคำนวณจาก Forecast / Order ที่มีในระบบจริง + STD ของ Capacity
//   กดแถว = เหตุผลที่ตรง / ไม่ตรง (หมายเหตุ แก้ได้) + ยอดของระบบมาจากไหน (PCS จาก ORDER / FORECAST / กำหนดเอง · วันทำงาน)
type Tot = { p1: number; p9: number; a1: number };
const f2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (v: number, f: (x: number) => string) => (Math.abs(v) < 0.005 ? "0" : (v > 0 ? "+" : "−") + f(Math.abs(v)));

export function WlCompare({ months, totals, refs, notes, canEdit, onSaved }: { months: WlMonth[]; totals: Record<string, Tot>[]; refs: Map<string, WlRef>; notes: WlNote[]; canEdit: boolean; onSaved: () => void }) {
  const reduce = useReducedMotion();
  const toast = useToast();
  const [mi, setMi] = useState(1); // เริ่มที่เดือน N
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const m = months[mi];
  const noteOf = useMemo(() => new Map(notes.map((n) => [`${n.month}|${n.row}`, n])), [notes]);

  const rows = useMemo(() => {
    if (!m) return [];
    return WL_ROWS.map((r) => {
      const x = refs.get(`${m.month}|${r.key}`);
      const t = r.dept ? totals[mi]?.[r.dept] : undefined;
      const sp = t?.p1 ?? 0,
        sd = r.direct === false ? 0 : (t?.p9 ?? 0);
      const xp = x?.pdt ?? null,
        xd = x ? (r.direct === false ? 0 : (x.direct ?? 0)) : null;
      // ยอดของระบบมาจากไหน: นับแถว Product ตามแหล่ง PCS
      const parts = r.dept ? (m.depts[r.dept] ?? []).flatMap((mc) => mc.parts) : [];
      const src = { ORDER: 0, FORECAST: 0, MANUAL: 0, NONE: 0 };
      for (const p of parts) src[(p.pcsFrom || "NONE") as keyof typeof src] = (src[(p.pcsFrom || "NONE") as keyof typeof src] ?? 0) + 1;
      const same = xp != null && Math.abs(sp - xp) < 0.5 && Math.abs(sd - (xd ?? 0)) < 0.01;
      return { r, x, sp, sd, xp, xd, src, parts: parts.length, machines: r.dept ? (m.depts[r.dept] ?? []).length : 0, same, note: noteOf.get(`${m.month}|${r.key}`) };
    }).filter((x) => x.r.dept || (x.xp ?? 0) !== 0 || (x.xd ?? 0) !== 0);
  }, [m, mi, refs, totals, noteOf]);

  if (!m) return null;
  const hasRef = rows.some((x) => x.x);
  const sum = rows.reduce((a, x) => ({ sp: a.sp + x.sp, sd: a.sd + x.sd, xp: a.xp + (x.xp ?? 0), xd: a.xd + (x.xd ?? 0) }), { sp: 0, sd: 0, xp: 0, xd: 0 });
  const file = rows.find((x) => x.x)?.x;
  const nSame = rows.filter((x) => x.same).length;

  async function saveNote(row: string) {
    const k = `${m.month}|${row}`;
    setBusy(k);
    try {
      const r = await api<{ message: string }>("/pp/workload/note", { method: "POST", body: { month: m.month, row, note: draft[k] ?? "" } });
      toast.show("SAVED", r.message, "ok");
      setDraft((d) => {
        const n = { ...d };
        delete n[k];
        return n;
      });
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="🔍 CASE 1 (ตาม EXCEL) vs CASE 2 (ตามระบบ)"
      actions={
        <PillSwitch
          label="เดือน"
          value={String(mi)}
          onChange={(v) => (setMi(Number(v)), setOpen(null))}
          options={months.map((x, i) => ({ v: String(i), l: `${ENS(x.month)} ${i === 0 ? "N-1" : i === 1 ? "N" : `N+${i - 1}`}` }))}
        />
      }
      bodyClass="p-4"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={m.month} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="grid gap-3">
          <div className="wlc-sum">
            <div className="is-xl">
              <small>CASE 1 • ตาม EXCEL</small>
              <b>{hasRef ? f0(sum.xp) : "–"}</b>
              <span>PDT · Direct {hasRef ? f2(sum.xd) : "–"}</span>
            </div>
            <div className="is-sys">
              <small>CASE 2 • ตามระบบ</small>
              <b>{f0(sum.sp)}</b>
              <span>PDT · Direct {f2(sum.sd)}</span>
            </div>
            <div className={hasRef && Math.abs(sum.sp - sum.xp) < 0.5 ? "is-ok" : "is-diff"}>
              <small>ระบบ − EXCEL</small>
              <b>{hasRef ? sg(sum.sp - sum.xp, f0) : "–"}</b>
              <span>Direct {hasRef ? sg(sum.sd - sum.xd, f2) : "–"} คน</span>
            </div>
            <div className="is-cnt">
              <small>หน่วยงานที่ตรง</small>
              <b>
                {nSame} / {rows.length}
              </b>
              <span>{m.workdays.length} วันทำงาน ({m.workdaySource === "COMPANY" ? "Company Workdays" : "ยังไม่ได้ตั้ง · จันทร์–เสาร์"})</span>
            </div>
          </div>
          <p className="wlc-file">
            {file ? (
              <>
                CASE 1 จากไฟล์ <b>{file.fileName}</b> · Import {new Date(file.updatedAt).toLocaleDateString("en-GB")} · CASE 2 = Forecast / Order ที่มีในระบบตอนนี้ + STD ของ Capacity · กดแถวเพื่อดูเหตุผล
              </>
            ) : (
              "ยังไม่มียอด EXCEL ของเดือนนี้ · กด IMPORT WORK LOAD EXCEL ด้านบน"
            )}
          </p>

          <div className="wlc-wrap">
            <table className="wlc-table">
              <thead>
                <tr>
                  <th rowSpan={2}>หน่วยงาน</th>
                  <th colSpan={3} className="is-grp">
                    PDT
                  </th>
                  <th colSpan={3} className="is-grp">
                    DIRECT (คน)
                  </th>
                  <th rowSpan={2}>สถานะ</th>
                </tr>
                <tr>
                  <th className="is-xl">EXCEL</th>
                  <th className="is-sys">ระบบ</th>
                  <th>ต่าง</th>
                  <th className="is-xl">EXCEL</th>
                  <th className="is-sys">ระบบ</th>
                  <th>ต่าง</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x, i) => {
                  const k = `${m.month}|${x.r.key}`;
                  const isOpen = open === x.r.key;
                  const dp = x.xp == null ? null : x.sp - x.xp,
                    dd = x.xd == null ? null : x.sd - x.xd;
                  return (
                    <Fragment key={x.r.key}>
                      <tr className={`wlc-row ${isOpen ? "is-open" : ""}`} style={{ "--i": i } as React.CSSProperties} onClick={() => setOpen(isOpen ? null : x.r.key)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(isOpen ? null : x.r.key))} aria-expanded={isOpen}>
                        <td data-label="หน่วยงาน" className="is-name">
                          <i aria-hidden>{isOpen ? "▾" : "▸"}</i>
                          {x.r.short}
                          {x.note && <em title="มีเหตุผล / หมายเหตุ">📝</em>}
                        </td>
                        <td data-label="PDT EXCEL" className="is-xl">
                          {x.xp == null ? "–" : f0(x.xp)}
                        </td>
                        <td data-label="PDT ระบบ" className="is-sys">
                          {f0(x.sp)}
                        </td>
                        <td data-label="PDT ต่าง" className={dp == null ? "" : Math.abs(dp) < 0.5 ? "is-zero" : dp > 0 ? "is-pos" : "is-neg"}>
                          {dp == null ? "–" : sg(dp, f0)}
                        </td>
                        <td data-label="DIRECT EXCEL" className="is-xl">
                          {x.xd == null ? "–" : f2(x.xd)}
                        </td>
                        <td data-label="DIRECT ระบบ" className="is-sys">
                          {f2(x.sd)}
                        </td>
                        <td data-label="DIRECT ต่าง" className={dd == null ? "" : Math.abs(dd) < 0.005 ? "is-zero" : dd > 0 ? "is-pos" : "is-neg"}>
                          {dd == null ? "–" : sg(dd, f2)}
                        </td>
                        <td data-label="สถานะ">{x.xp == null ? <span className="wlc-st is-none">ไม่มี EXCEL</span> : x.same ? <span className="wlc-st is-ok">✔ ตรง</span> : <span className="wlc-st is-bad">⚠ ไม่ตรง</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="wlc-detail">
                          <td colSpan={8}>
                            <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="wlc-panes">
                              <div className="wlc-pane is-xl">
                                <b>📊 CASE 1 • ทำไมตรง / ไม่ตรงกับ EXCEL</b>
                                {canEdit ? (
                                  <>
                                    <textarea
                                      className="field"
                                      rows={7}
                                      value={draft[k] ?? x.note?.note ?? ""}
                                      placeholder="ยังไม่มีเหตุผล · พิมพ์ผลการตรวจ / ข้อสรุปที่คุยกันได้ที่นี่"
                                      onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                      <small>{x.note ? `แก้ล่าสุด: ${x.note.updatedBy ?? "-"} · ${new Date(x.note.updatedAt).toLocaleDateString("en-GB")}` : ""}</small>
                                      <button type="button" className="cta-btn is-green is-sm ml-auto" disabled={!(k in draft) || busy === k} onClick={() => saveNote(x.r.key)}>
                                        {busy === k ? "…" : "💾 SAVE"}
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <p className="wlc-note">{x.note?.note ?? "ยังไม่มีเหตุผล"}</p>
                                )}
                              </div>
                              <div className="wlc-pane is-sys">
                                <b>⚙ CASE 2 • ยอดของระบบมาจาก</b>
                                {x.r.dept ? (
                                  <ul>
                                    <li>
                                      สูตร Capacity เดียวกับ Excel: PDT = รวม Stroke (PCS × Total Process ÷ Pcs./Stroke) · Direct = Req. Man power (P9) · {x.machines} เครื่อง / กลุ่ม · {x.parts} แถว Product
                                    </li>
                                    <li>
                                      PCS ของเดือน {ENS(m.month)}: ORDER <b>{x.src.ORDER}</b> แถว · FORECAST <b>{x.src.FORECAST}</b> แถว · กำหนดเอง (M) <b>{x.src.MANUAL}</b> แถว · ไม่มียอด <b>{x.src.NONE}</b> แถว
                                    </li>
                                    <li>PCS มาจาก MASTER DATA › Forecast / Order (มี Order = ใช้ Order · ไม่มี = Forecast รวมทุกลูกค้าตาม PART A)</li>
                                    <li>
                                      วันทำงาน {m.workdays.length} วัน ({m.workdaySource === "COMPANY" ? "Company Workdays" : "ยังไม่ได้ตั้ง Company Workdays · ใช้ จันทร์–เสาร์"})
                                    </li>
                                    {x.src.ORDER + x.src.FORECAST + x.src.MANUAL === 0 && <li className="is-warn">ไม่มียอด Forecast / Order ของเดือนนี้ในระบบเลย → ระบบ = 0</li>}
                                  </ul>
                                ) : (
                                  <p className="wlc-note">หน่วยงานนี้ไม่ได้ดึงยอดจาก Capacity (PDT / Direct = 0 ทั้ง Excel และระบบ)</p>
                                )}
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td className="is-xl">{hasRef ? f0(sum.xp) : "–"}</td>
                  <td className="is-sys">{f0(sum.sp)}</td>
                  <td>{hasRef ? sg(sum.sp - sum.xp, f0) : "–"}</td>
                  <td className="is-xl">{hasRef ? f2(sum.xd) : "–"}</td>
                  <td className="is-sys">{f2(sum.sd)}</td>
                  <td>{hasRef ? sg(sum.sd - sum.xd, f2) : "–"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </motion.div>
      </AnimatePresence>
    </Card>
  );
}
