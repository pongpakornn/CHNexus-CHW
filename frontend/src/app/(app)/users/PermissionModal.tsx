"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { Loading } from "@/components/ui/Page";
import { api } from "@/lib/api";
import type { PermData, PermRow, ScanStock } from "./types";

const FLAGS = ["view", "add", "edit", "delete", "approve"] as const;
const HEAD: Record<(typeof FLAGS)[number], string> = { view: "VIEW", add: "ADD", edit: "EDIT", delete: "DEL", approve: "APPROVE" };

// 🔑 PERMISSION / 👤 USER PROFILE (UserPermissionWindow) - สิทธิ์ทุกระบบ + ทุกคลัง
//   แถว Multi-Scanner กดขยาย = คลังที่สแกนได้ + ★ OUT FIRST + DEDUCTED + EMP ID / DEPT + DISPLAY
export function PermissionModal({
  userId,
  readOnly,
  canContact,
  onClose,
  onSaved,
  onEditContacts,
}: {
  userId: string;
  readOnly: boolean;
  canContact: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onEditContacts: () => Promise<boolean>;
}) {
  const toast = useToast();
  const [data, setData] = useState<PermData | null>(null);
  const [rows, setRows] = useState<PermRow[]>([]);
  const [stocks, setStocks] = useState<ScanStock[]>([]);
  const [open, setOpen] = useState(readOnly);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<PermData>(`/users/${encodeURIComponent(userId)}/permissions`);
      setData(d);
      setRows(d.rows);
      setStocks(d.scanner?.stocks ?? []);
    } catch (e) {
      toast.show("ERROR", "โหลดสิทธิ์ไม่สำเร็จ\n" + (e as Error).message, "error");
      onClose();
    }
  }, [userId, toast, onClose]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const setFlag = (sysId: string, k: (typeof FLAGS)[number], v: boolean) => setRows((rs) => rs.map((r) => (r.sysId === sysId ? { ...r, [k]: v } : r)));
  const setAll = (fn: (r: PermRow) => PermRow) => setRows((rs) => rs.map(fn));

  const setStock = (id: number, patch: Partial<ScanStock>) =>
    setStocks((ss) =>
      ss.map((s) => {
        if (s.stkId !== id) return s;
        const n = { ...s, ...patch };
        if (patch.on === false) Object.assign(n, { priority: false, deduct: false, askEmployee: false, askDepartment: false });
        // เลือกคลังกลุ่มตัดข้ามคลัง = เปิด DEDUCTED ให้ก่อน (ปิดเองได้)
        if (patch.on === true && s.deductEligible && !s.deduct) n.deduct = true;
        return n;
      }),
    );
  const togglePriority = (id: number) =>
    setStocks((ss) => {
      const cur = ss.find((s) => s.stkId === id);
      const on = !cur?.priority;
      return ss.map((s) => ({ ...s, priority: s.stkId === id ? on && s.on : false }));
    });

  const on = stocks.filter((s) => s.on);
  const summary =
    on.length === 0
      ? "⛔ NOT SET - this user cannot scan (the scan page asks them to contact the Admin)"
      : "STOCKS : " +
        on.map((i) => i.code + (i.priority ? " ★" : "") + (i.deduct ? " (DEDUCTED)" : "") + (i.askEmployee ? " (EMP ID)" : "") + (i.askDepartment ? " (DEPT)" : "")).join(",  ") +
        (on.length > 1 ? "   (scan together)" : "");

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/users/${encodeURIComponent(userId)}/permissions`, {
        method: "POST",
        body: { rows, scanner: data?.scanner ? stocks : null },
      });
      onSaved(r.message);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const u = data?.user;
  const colOn = (k: (typeof FLAGS)[number]) => rows.length > 0 && rows.every((r) => r[k]);
  const rowOn = (r: PermRow) => FLAGS.every((k) => r[k]);
  const setRow = (sysId: string, v: boolean) => setRows((rs) => rs.map((r) => (r.sysId === sysId ? { ...r, view: v, add: v, edit: v, delete: v, approve: v } : r)));
  const granted = rows.reduce((a, r) => a + FLAGS.filter((k) => r[k]).length, 0);

  // ปุ่มสิทธิ์ 1 ช่อง: ติ๊ก = สีของสิทธิ์นั้น + เครื่องหมายถูกวาดขึ้น (label = แบบการ์ดบนมือถือ)
  const flag = (r: PermRow, k: (typeof FLAGS)[number], label?: boolean) => (
    <button
      key={k}
      type="button"
      disabled={readOnly}
      aria-pressed={r[k]}
      aria-label={`${r.title} ${HEAD[k]}`}
      title={`${HEAD[k]}`}
      className={`pf pf-${k} ${r[k] ? "is-on" : ""} ${label ? "has-label" : ""}`}
      onClick={() => setFlag(r.sysId, k, !r[k])}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m6 12.5 4 4 8-9" />
      </svg>
      {label && <span>{HEAD[k]}</span>}
    </button>
  );

  // คลังที่สแกนได้ของ Multi-Scanner (แถวขยาย / การ์ดบนมือถือใช้ร่วมกัน)
  const scanBox = (
    <div className="grid gap-2">
      {stocks.length === 0 && <div className="text-xs font-bold text-ink-soft">ยังไม่มีคลังที่เปิดช่องทางสแกน</div>}
      {stocks.map((s) => (
        <div key={s.stkId} className={`pm-stock ${s.on ? "is-on" : ""}`}>
          <label className={`sw ${s.on ? "is-on" : ""} min-w-[190px] !border-0 !bg-transparent !p-0 !shadow-none`}>
            <input type="checkbox" className="sr-only" disabled={readOnly} checked={s.on} onChange={(e) => setStock(s.stkId, { on: e.target.checked })} />
            <span className="sw-track" />
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-[#1f2350]">{s.code}</span>
              <span className="block truncate text-[10.5px] font-semibold text-ink-soft">{s.name}</span>
            </span>
          </label>
          <button className={`fill-btn is-xs ${s.priority ? "is-on is-star" : ""}`} disabled={readOnly || !(s.on && s.canOut)} onClick={() => togglePriority(s.stkId)}>
            {s.priority ? "★ OUT FIRST" : "☆ OUT FIRST"}
          </button>
          {s.deductEligible && (
            <button className={`fill-btn is-xs ${s.deduct ? "is-on" : ""}`} disabled={readOnly || !s.on} onClick={() => setStock(s.stkId, { deduct: !s.deduct })}>
              DEDUCTED
            </button>
          )}
          {data?.scanner?.hasWho && (
            <>
              <button className={`fill-btn is-xs ${s.askEmployee ? "is-on" : ""}`} disabled={readOnly || !s.on} onClick={() => setStock(s.stkId, { askEmployee: !s.askEmployee })}>
                EMP ID
              </button>
              <button className={`fill-btn is-xs ${s.askDepartment ? "is-on" : ""}`} disabled={readOnly || !s.on} onClick={() => setStock(s.stkId, { askDepartment: !s.askDepartment })}>
                DEPT
              </button>
            </>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-[10px] font-extrabold text-ink-soft">
            DISPLAY
            <select className="field w-auto py-1 text-xs" disabled={readOnly || !s.on} value={s.display} onChange={(e) => setStock(s.stkId, { display: e.target.value })}>
              {s.options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
    </div>
  );

  const scanToggle = (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button className={`fill-btn is-xs ${open ? "is-on" : ""}`} onClick={() => setOpen((o) => !o)}>
        {(open ? "▾" : "▸") + " SCAN STOCKS + DISPLAY"}
      </button>
      <span className={`text-[11px] font-extrabold ${on.length ? "text-success" : "text-danger"}`}>{summary}</span>
    </div>
  );

  return (
    <Modal
      open
      size="xl"
      title={readOnly ? "👤 USER PROFILE" : "🔑 PERMISSION"}
      onClose={onClose}
      footer={
        <>
          {!readOnly && (
            <div className="mr-auto flex flex-wrap gap-2">
              <button className="fill-btn is-sm" onClick={() => setAll((r) => ({ ...r, view: true }))}>
                VIEW ALL
              </button>
              <button className="fill-btn is-sm" onClick={() => setAll((r) => ({ ...r, view: true, add: true, edit: true, delete: true, approve: true }))}>
                SELECT ALL
              </button>
              <button className="fill-btn is-sm is-danger" onClick={() => setAll((r) => ({ ...r, view: false, add: false, edit: false, delete: false, approve: false }))}>
                CLEAR
              </button>
            </div>
          )}
          <button className={readOnly ? "cta-btn is-gray" : "fill-btn"} onClick={onClose}>
            {readOnly ? "CLOSE" : "CANCEL"}
          </button>
          {!readOnly && (
            <button className="cta-btn is-green" disabled={busy || !data} onClick={save}>
              💾 SAVE PERMISSION
            </button>
          )}
        </>
      }
    >
      {!data || !u ? (
        <Loading />
      ) : (
        <div className="grid gap-4">
          {/* ผู้ใช้ */}
          <div className="pm-user">
            <span className="pm-avatar">{u.name.trim().slice(0, 2).toUpperCase() || "?"}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-extrabold text-[#1f2350]">{u.name}</div>
              <div className="text-xs font-bold text-ink-soft">
                ID : {u.userId} <span className="pm-level">{u.levelText}</span>
              </div>
            </div>
            {!readOnly && (
              <div className="pm-count" title="จำนวนสิทธิ์ที่เปิด">
                <b key={granted}>{granted}</b>
                <span>/ {rows.length * FLAGS.length} GRANTED</span>
              </div>
            )}
          </div>
          {u.level === 1 && <div className="rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">LEVEL 1 (ADMIN) can see and do everything without these settings.</div>}

          {readOnly && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ["USER ID", u.userId],
                  ["NAME", u.name],
                  ["POSITION", u.position],
                  ["UNIT", u.department],
                  ["SECTION", u.section],
                  ["DIVISION", u.division],
                  ["LEVEL", u.levelText],
                  ["STATUS", u.statusText],
                  ["LAST LOGIN", u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "-"],
                ] as const
              ).map(([l, v], i) => (
                <div key={l} className="pm-tile" style={{ animationDelay: `${i * 30}ms` }}>
                  <div className="text-[10px] font-bold text-ink-soft">{l}</div>
                  <div className="truncate text-sm font-extrabold">{v?.trim() ? v : "-"}</div>
                </div>
              ))}
            </div>
          )}

          {data.contacts !== null && !readOnly && (
            <div className="pm-contact">
              <span className="pm-bell" aria-hidden>
                🔔
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-line text-xs font-semibold text-ink-soft">
                <span className="font-extrabold text-primary">ALERT CONTACT : </span>
                {data.contacts}
              </div>
              {canContact && (
                <button
                  className="cta-btn is-red is-sm"
                  onClick={async () => {
                    if (await onEditContacts()) load();
                  }}
                >
                  🔔 SET ALERT CONTACT
                </button>
              )}
            </div>
          )}

          {/* 🖥 Desktop: ตารางสิทธิ์ (กดหัวคอลัมน์ = ทั้งคอลัมน์ / ALL = ทั้งแถว) */}
          <div className="hidden overflow-auto rounded-2xl border border-line/60 md:block">
            <table className="data-table pm-table w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left">SYSTEM</th>
                  {!readOnly && <th className="w-16 text-center">ALL</th>}
                  {FLAGS.map((k) => (
                    <th key={k} className="w-24 text-center">
                      {readOnly ? (
                        HEAD[k]
                      ) : (
                        <button type="button" className={`pm-col ${colOn(k) ? "is-on" : ""}`} title={`${HEAD[k]} ทุกระบบ`} onClick={() => setAll((r) => ({ ...r, [k]: !colOn(k) }))}>
                          {HEAD[k]}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const head = i === 0 || r.group !== rows[i - 1].group ? r.group : null;
                  const ms = r.sysId.toLowerCase() === "multiscanner" && data.scanner;
                  return (
                    <Fragment key={r.sysId}>
                      {head && (
                        <tr className="pm-group">
                          <td colSpan={readOnly ? 6 : 7}>{head}</td>
                        </tr>
                      )}
                      <tr className="pm-row">
                        <td className="text-left">
                          <div className="font-extrabold text-[#1f2350]">{r.title}</div>
                          {r.hint && <div className="text-[11px] font-semibold text-ink-soft">{r.hint}</div>}
                          {ms && scanToggle}
                        </td>
                        {!readOnly && (
                          <td className="text-center">
                            <label className={`sw sw-mini ${rowOn(r) ? "is-on" : ""}`} title="ทุกสิทธิ์ของระบบนี้">
                              <input type="checkbox" className="sr-only" checked={rowOn(r)} onChange={(e) => setRow(r.sysId, e.target.checked)} />
                              <span className="sw-track" />
                            </label>
                          </td>
                        )}
                        {FLAGS.map((k) => (
                          <td key={k} className="text-center">
                            {flag(r, k)}
                          </td>
                        ))}
                      </tr>
                      {ms && open && (
                        <tr>
                          <td colSpan={readOnly ? 6 : 7} className="bg-[#faf9fe]">
                            {scanBox}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 📱 Mobile: การ์ดต่อระบบ */}
          <div className="grid gap-3 md:hidden">
            {rows.map((r, i) => {
              const head = i === 0 || r.group !== rows[i - 1].group ? r.group : null;
              const ms = r.sysId.toLowerCase() === "multiscanner" && data.scanner;
              return (
                <Fragment key={r.sysId}>
                  {head && <div className="pm-mhead">{head}</div>}
                  <div className="pm-card" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-[#1f2350]">{r.title}</div>
                        {r.hint && <div className="text-[11px] font-semibold text-ink-soft">{r.hint}</div>}
                      </div>
                      {!readOnly && (
                        <label className={`sw sw-mini ${rowOn(r) ? "is-on" : ""}`} title="ทุกสิทธิ์">
                          <input type="checkbox" className="sr-only" checked={rowOn(r)} onChange={(e) => setRow(r.sysId, e.target.checked)} />
                          <span className="sw-track" />
                        </label>
                      )}
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">{FLAGS.map((k) => flag(r, k, true))}</div>
                    {ms && (
                      <>
                        {scanToggle}
                        {open && <div className="mt-2">{scanBox}</div>}
                      </>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
