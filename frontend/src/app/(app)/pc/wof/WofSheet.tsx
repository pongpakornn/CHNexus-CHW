"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { api, deviceName } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import { DOW, dowOf, f0, thisMonth } from "@/lib/pp";
import { ROLES, ROWS, daysIn, isLocked, parseQty, rowTotal, signChip, signOf, stOf, type PcDetail, type PcItem, type PcMeta, type PcPart, type PcUser } from "@/lib/pcwof";
import "./wof.css";

// 🗂 PC › WORK ORDER FOLLOW › ชีท : ตารางเมทริกซ์ (ชิ้นงาน x แถว x วัน) · กรอกได้เฉพาะ OWNER / EDITOR · บันทึกอัตโนมัติ (รวมส่งทุกช่องที่แก้ในครั้งเดียว)
//   ↑ ↓ Enter = ช่องล่าง / บน · ← → ที่ขอบข้อความ = ช่องซ้าย / ขวา · ชีทที่ APPROVE แล้ว = ล็อก (ดูอย่างเดียว)
type Save = "idle" | "saving" | "saved" | "error";
type Pend = { itemId: number; rowKey: string; day: number; qty: number | null };

export default function WofSheet({ id }: { id: number }) {
  const router = useRouter();
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<PcMeta | null>(null);
  const [d, setD] = useState<PcDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [save, setSave] = useState<Save>("idle");
  const [part, setPart] = useState(false);
  const [mgr, setMgr] = useState(false);
  const [vw, setVw] = useState(1280); // viewport width: < 1024 shows the DAY RANGE chips, < 768 defaults to one week
  const [pick, setPick] = useState<number | "all" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null); // part popover (phone)
  const pend = useRef(new Map<string, Pend>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushing = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const last = useRef("");
  const grid = useRef<HTMLTableElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<PcDetail>(`/pcwof/sheets/${id}`);
        if (quiet && (pend.current.size > 0 || flushing.current || sameData(last, r))) return; // never overwrite what is being typed
        last.current = JSON.stringify(r);
        setD(r);
      } catch (e) {
        if (!quiet) {
          toast.show("ERROR", (e as Error).message, "error");
          setGone(true);
        }
      }
    },
    [id, toast],
  );
  useEffect(() => {
    api<PcMeta>("/pcwof/meta").then(setMeta).catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  useEffect(() => {
    if (!meta?.ready) return;
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [meta?.ready, load]);
  useLive(["pcwof"], () => (meta?.ready ? load(true) : undefined));

  const flush = useCallback(async () => {
    if (flushing.current || pend.current.size === 0) return;
    flushing.current = true;
    const batch = [...pend.current.entries()].slice(0, 2000); // backend max 2000 cells per request
    batch.forEach(([k]) => pend.current.delete(k));
    setSave("saving");
    try {
      await api(`/pcwof/sheets/${id}/cells`, { method: "PUT", body: batch.map(([, p]) => p) });
      setSave(pend.current.size ? "saving" : "saved");
    } catch (e) {
      batch.forEach(([k, p]) => !pend.current.has(k) && pend.current.set(k, p)); // keep for retry
      setSave("error");
      toast.show("ERROR", "บันทึกไม่สำเร็จ: " + (e as Error).message, "error");
    } finally {
      flushing.current = false;
      if (pend.current.size && !timer.current) timer.current = setTimeout(() => ((timer.current = undefined), void flushRef.current()), 3000);
    }
  }, [id, toast]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  // leaving the page with unsaved edits: warn + flush
  useEffect(() => {
    const q = pend.current; // stable Map for the whole component life
    const h = (e: BeforeUnloadEvent) => q.size > 0 && e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => {
      window.removeEventListener("beforeunload", h);
      clearTimeout(timer.current);
      // unmount: an in-flight save keeps running; anything still queued (or failed) goes out with keepalive so it survives navigation
      const left = [...q.values()].slice(0, 2000);
      if (left.length) {
        q.clear();
        void fetch(`/api/pcwof/sheets/${id}/cells`, { method: "PUT", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Client-Device": deviceName() }, body: JSON.stringify(left) }).catch(() => {});
      }
    };
  }, [id]);

  const sheet = d?.sheet;
  const locked = sheet ? isLocked(sheet.signs) : false;
  const canEdit = !!d?.canEdit && !locked;
  const isOwner = !!sheet && !!meta && sheet.owner.userId.toLowerCase() === meta.me.userId.toLowerCase();
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const total = sheet ? daysIn(sheet.month) : 0;
  const weeks = Math.ceil(total / 7);
  const today = new Date().getDate();
  const auto: number | "all" = vw >= 768 || !sheet ? "all" : sheet.month === thisMonth() ? Math.min(Math.floor((today - 1) / 7), weeks - 1) : 0;
  const range = vw >= 1024 ? "all" : (pick !== null && (pick === "all" || pick < weeks) ? pick : auto);
  // TOTAL / ST. always use every day (rowTotal reads the cells), only the rendered columns are limited
  const days = useMemo(() => Array.from({ length: total }, (_, i) => i + 1).filter((n) => range === "all" || Math.floor((n - 1) / 7) === range), [total, range]);

  function setCell(item: PcItem, rowKey: string, day: number, raw: string) {
    const qty = parseQty(raw);
    if (qty === undefined) return toast.show("WARNING", "กรอกเป็นตัวเลข 0 ขึ้นไปเท่านั้น", "warn");
    const cur = item.cells[rowKey]?.[day] ?? null;
    if (cur === qty) return;
    setD((p) =>
      p && {
        ...p,
        items: p.items.map((x) => {
          if (x.itemId !== item.itemId) return x;
          const row = { ...(x.cells[rowKey] ?? {}) };
          if (qty === null) delete row[day];
          else row[day] = qty;
          return { ...x, cells: { ...x.cells, [rowKey]: row } };
        }),
      },
    );
    pend.current.set(`${item.itemId}|${rowKey}|${day}`, { itemId: item.itemId, rowKey, day, qty });
    setSave("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ((timer.current = undefined), void flushRef.current()), 800);
  }

  function nav(e: React.KeyboardEvent<HTMLTableElement>) {
    const el = e.target as HTMLInputElement;
    if (el.tagName !== "INPUT" || el.dataset.r === undefined) return;
    const r = Number(el.dataset.r),
      c = Number(el.dataset.c);
    let to: [number, number] | null = null;
    if (e.key === "Enter" || e.key === "ArrowDown") to = [r + 1, c];
    else if (e.key === "ArrowUp") to = [r - 1, c];
    else if (e.key === "ArrowLeft" && el.selectionStart === 0 && el.selectionEnd === 0) to = [r, c - 1];
    else if (e.key === "ArrowRight" && el.selectionStart === el.value.length) to = [r, c + 1];
    if (!to) return;
    const n = grid.current?.querySelector<HTMLInputElement>(`input[data-r="${to[0]}"][data-c="${to[1]}"]`);
    if (!n) return;
    e.preventDefault();
    n.focus();
    n.select();
  }

  // wait until queued / in-flight cell saves are done so a reload never reverts typed values (false = save keeps failing: skip reload)
  async function settle() {
    for (let i = 0; i < 20 && (pend.current.size > 0 || flushing.current); i++) {
      if (flushing.current) await new Promise((r) => setTimeout(r, 150));
      else await flushRef.current();
    }
    return pend.current.size === 0 && !flushing.current;
  }
  async function mut(fn: () => Promise<unknown>) {
    try {
      await fn();
      if (await settle()) await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  const setLocal = (it: PcItem, p: Partial<PcItem>) => setD((s) => s && { ...s, items: s.items.map((x) => (x.itemId === it.itemId ? { ...x, ...p } : x)) });
  const patchItem = (it: PcItem, p: Partial<Pick<PcItem, "intCode" | "barColor" | "remark" | "pcsPerBox">>) => {
    const n = { ...it, ...p };
    setLocal(it, p);
    return mut(() => api(`/pcwof/items/${it.itemId}`, { method: "PUT", body: { intCode: n.intCode, barColor: n.barColor, remark: n.remark, pcsPerBox: n.pcsPerBox } }));
  };
  async function move(i: number, dir: -1 | 1) {
    if (!d) return;
    const ids = d.items.map((x) => x.itemId);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    await mut(() => api(`/pcwof/sheets/${id}/items/order`, { method: "POST", body: { ids } }));
  }
  async function delItem(it: PcItem) {
    if (await dlg.confirm({ title: "ลบชิ้นงาน", message: `ลบ ${it.intCode || it.partName} ออกจากชีท?`, ok: "DELETE", danger: true })) await mut(() => api(`/pcwof/items/${it.itemId}`, { method: "DELETE" }));
  }
  async function delSheet() {
    if (!(await dlg.confirm({ title: "ลบชีท", message: "ลบชีทนี้ทั้งชีท? ข้อมูลทุกชิ้นงานจะหายและกู้คืนไม่ได้", ok: "DELETE", danger: true }))) return;
    try {
      await api(`/pcwof/sheets/${id}`, { method: "DELETE" });
      router.replace(`/pc/wof?month=${sheet?.month ?? ""}`);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  if (meta && !meta.ready)
    return (
      <PageBody>
        <div className="mr-off">รอติดตั้งฐานข้อมูล</div>
      </PageBody>
    );
  if (gone)
    return (
      <PageBody>
        <Empty>ไม่พบชีท หรือไม่มีสิทธิ์เข้าถึง</Empty>
        <Link href="/pc/wof" className="cta-btn is-gray self-start">
          BACK
        </Link>
      </PageBody>
    );
  if (!d || !sheet || !meta)
    return (
      <PageBody>
        <Loading />
      </PageBody>
    );

  return (
    <PageBody className="wof-page">
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title={`${sheet.customerName || sheet.customerCode} · W/O ${sheet.workOrderNo || "-"}`}
        subtitle={`${sheet.month} · ${sheet.items} ITEMS`}
        actions={
          <>
            <span className={`wof-save is-${save}`} role="status">
              {save === "saving" ? "กำลังบันทึก…" : save === "saved" ? "บันทึกแล้ว" : save === "error" ? "บันทึกไม่สำเร็จ (ลองใหม่อัตโนมัติ)" : canEdit ? "แก้ไขได้" : "ดูอย่างเดียว"}
            </span>
            <Link href={`/pc/wof?month=${sheet.month}`} className="cta-btn is-gray wof-np">
              BACK
            </Link>
            <button type="button" className="cta-btn is-gray wof-np" onClick={() => window.print()}>
              PRINT
            </button>
            {canEdit && (
              <button type="button" className="cta-btn is-purple wof-np" onClick={() => setPart(true)}>
                + ADD PART
              </button>
            )}
          </>
        }
      />
      {locked && <div className="wof-lock">🔒 ชีทนี้ APPROVE แล้ว · ล็อกการแก้ไข</div>}

      <section className="wof-info">
        <div>
          <span>OWNER</span>
          <b>{sheet.owner.name}</b>
        </div>
        <div>
          <span>EDITORS</span>
          <b>{sheet.editors.length ? sheet.editors.map((e) => e.name).join(", ") : "-"}</b>
        </div>
        {isOwner && !locked && (
          <div className="wof-np wof-info-act">
            <button type="button" className="cta-btn is-sm is-purple" onClick={() => setMgr(true)}>
              EDITORS
            </button>
            <button type="button" className="cta-btn is-sm is-red" onClick={delSheet}>
              DELETE SHEET
            </button>
          </div>
        )}
      </section>

      {vw < 1024 && total > 0 && (
        <div className="wof-range wof-np" role="group" aria-label="DAY RANGE">
          {Array.from({ length: weeks }, (_, i) => (
            <button key={i} type="button" className={range === i ? "is-on" : ""} onClick={() => setPick(i)}>
              {i * 7 + 1}–{Math.min(i * 7 + 7, total)}
            </button>
          ))}
          <button type="button" className={range === "all" ? "is-on" : ""} onClick={() => setPick("all")}>
            ALL
          </button>
        </div>
      )}

      {d.items.length === 0 ? (
        <Empty>ยังไม่มีชิ้นงานในชีท{canEdit ? " · กด + ADD PART" : ""}</Empty>
      ) : (
        <div className="wof-wrap">
          <table className="wof-table" ref={grid} onKeyDown={nav}>
            <thead>
              <tr>
                <th className="wof-s1">PART</th>
                <th className="wof-s2" />
                {days.map((n) => {
                  const w = dowOf(sheet.month, n);
                  return (
                    <th key={n} className={w === 0 || w === 6 ? "is-we" : ""}>
                      {n}
                      <small>{DOW[w]}</small>
                    </th>
                  );
                })}
                <th className="wof-tot">TOTAL</th>
              </tr>
            </thead>
            {d.items.map((it, ii) => {
              const del = rowTotal(it.cells, "DEL");
              return (
                <tbody key={it.itemId} className="wof-item" style={{ "--i": Math.min(ii, 12) } as React.CSSProperties}>
                  {[...ROWS.map((r) => r.key), "ST"].map((rk, ri) => {
                    const calc = rk === "ST";
                    const info = ROWS.find((r) => r.key === rk);
                    return (
                      <tr key={rk} className={calc ? "is-calc" : ""}>
                        {ri === 0 && (
                          <td rowSpan={8} className={`wof-s1 wof-part ${openId === it.itemId ? "is-open" : ""}`} style={{ borderLeftColor: it.barColor || "transparent" }}>
                            <div className="wof-part-h">
                              {canEdit ? <input className="wof-in-code" value={it.intCode} aria-label="INT CODE" onChange={(e) => setLocal(it, { intCode: e.target.value })} onBlur={(e) => patchItem(it, { intCode: e.target.value })} /> : <b>{it.intCode}</b>}
                              {canEdit && <input type="color" className="wof-color" value={it.barColor || "#6750a4"} aria-label="BAR COLOR" onChange={(e) => setLocal(it, { barColor: e.target.value })} onBlur={(e) => patchItem(it, { barColor: e.target.value })} />}
                            </div>
                            <div className="wof-part-n" title={it.partName} onClick={() => setOpenId((o) => (o === it.itemId ? null : it.itemId))}>
                              {it.partName}
                            </div>
                            <div className="wof-part-more">
                            <div className="wof-part-m">
                              {it.partNo}
                              {it.material ? ` · ${it.material}` : ""}
                            </div>
                            <label className="wof-part-f">
                              PCS/BOX
                              {canEdit ? (
                                <input
                                  inputMode="numeric"
                                  defaultValue={it.pcsPerBox ?? ""}
                                  onBlur={(e) => {
                                    const v = parseQty(e.target.value);
                                    if (v === undefined || (v !== null && (!Number.isInteger(v) || v < 1))) return toast.show("WARNING", "PCS/BOX ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป", "warn");
                                    if (v !== it.pcsPerBox) void patchItem(it, { pcsPerBox: v });
                                  }}
                                />
                              ) : (
                                <b>{it.pcsPerBox ?? "-"}</b>
                              )}
                            </label>
                            <label className="wof-part-f">
                              REMARK
                              {canEdit ? <input defaultValue={it.remark ?? ""} onBlur={(e) => e.target.value !== (it.remark ?? "") && void patchItem(it, { remark: e.target.value })} /> : <b>{it.remark || "-"}</b>}
                            </label>
                            {canEdit && (
                              <div className="wof-part-act wof-np">
                                <button type="button" disabled={ii === 0} onClick={() => move(ii, -1)} aria-label="ย้ายขึ้น">
                                  ▲
                                </button>
                                <button type="button" disabled={ii === d.items.length - 1} onClick={() => move(ii, 1)} aria-label="ย้ายลง">
                                  ▼
                                </button>
                                <button type="button" onClick={() => delItem(it)} aria-label="ลบชิ้นงาน">
                                  ✕
                                </button>
                              </div>
                            )}
                            </div>
                          </td>
                        )}
                        <td className="wof-s2 wof-rl" title={info?.th ?? "ST. = DEL ÷ PCS/BOX (ปัดขึ้น)"}>
                          {info?.label ?? "ST."}
                        </td>
                        {days.map((n) => {
                          const w = dowOf(sheet.month, n);
                          const cls = w === 0 || w === 6 ? "is-we" : "";
                          if (calc)
                            return (
                              <td key={n} className={cls}>
                                {stOf(it.cells.DEL?.[n] ?? 0, it.pcsPerBox) ?? "-"}
                              </td>
                            );
                          const v = it.cells[rk]?.[n];
                          return (
                            <td key={n} className={cls}>
                              {canEdit ? (
                                <input
                                  key={v ?? ""}
                                  className="wof-cell"
                                  inputMode="decimal"
                                  data-r={ii * 7 + ri}
                                  data-c={n}
                                  defaultValue={v ?? ""}
                                  aria-label={`${it.intCode} ${rk} วันที่ ${n}`}
                                  onFocus={(e) => e.target.select()}
                                  onBlur={(e) => setCell(it, rk, n, e.target.value)}
                                />
                              ) : (
                                (v ?? "")
                              )}
                            </td>
                          );
                        })}
                        <td className="wof-tot">{calc ? (stOf(del, it.pcsPerBox) ?? "-") : f0(rowTotal(it.cells, rk))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      <SignPanel sheetId={id} d={d} meta={meta} canRequest={d.canEdit} onDone={load} />
      {part && <PartPicker sheetId={id} onClose={() => setPart(false)} onAdded={load} />}
      {mgr && <EditorsModal sheetId={id} d={d} onClose={() => setMgr(false)} onSaved={() => (setMgr(false), load())} />}
    </PageBody>
  );
}

// ✍ PREPARE · CHECK · APPROVE : ขอให้ผู้ใช้คนหนึ่งเซ็น -> คนนั้นกด SIGN (APPROVE แล้ว = ชีทล็อก) · ต้องมีลายเซ็นในระบบ (backend แจ้งเอง)
function SignPanel({ sheetId, d, meta, canRequest, onDone }: { sheetId: number; d: PcDetail; meta: PcMeta; canRequest: boolean; onDone: () => Promise<void> }) {
  const toast = useToast();
  const users = useUsers();
  const [pick, setPick] = useState<Record<string, string>>({});
  const me = meta.me.userId.toLowerCase();
  async function act(path: string, body: object, ok: string) {
    try {
      await api(`/pcwof/sheets/${sheetId}/${path}`, { method: "POST", body });
      toast.show("OK", ok, "ok");
      await onDone();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  return (
    <section className="wof-sign" aria-label="SIGN">
      {ROLES.map((r) => {
        const s = signOf(d.sheet.signs, r);
        const c = signChip(s);
        const mine = !!s?.requestedTo && !s.signedBy && s.requestedTo.toLowerCase() === me;
        return (
          <div key={r} className="wof-sign-box">
            <b>{r}</b>
            <i className={`wof-chip is-${c.tone}`}>{c.text}</i>
            {/* signature image like the MIN REPORT document (stored user signature) */}
            {s?.signedBy && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="h-12 w-auto max-w-[160px] object-contain" src={`/api/signature/${encodeURIComponent(s.signedBy)}/image`} alt={`ลายเซ็น ${s.signedBy}`} draggable={false} />
            )}
            {s?.signedAt && <small>{new Date(s.signedAt).toLocaleString("th-TH")}</small>}
            {mine && (
              <button type="button" className="cta-btn is-sm is-green wof-np" onClick={() => act("sign", { role: r }, `ลงลายเซ็น ${r} แล้ว`)}>
                ✍ SIGN
              </button>
            )}
            {canRequest && !s?.signedBy && !isLocked(d.sheet.signs) && (
              <div className="wof-sign-req wof-np">
                <input list={`wof-u-${r}`} placeholder="USER ID" value={pick[r] ?? ""} onChange={(e) => setPick({ ...pick, [r]: e.target.value })} />
                <datalist id={`wof-u-${r}`}>
                  {users.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.name}
                    </option>
                  ))}
                </datalist>
                <button type="button" className="cta-btn is-sm is-purple" disabled={!(pick[r] ?? "").trim()} onClick={() => act("sign/request", { role: r, userId: pick[r].trim() }, `ส่งคำขอเซ็น ${r} แล้ว`)}>
                  REQUEST
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// user list for pickers (GET /users); if the caller may not read it the list stays empty and a typed USER ID still works
function useUsers() {
  const [u, setU] = useState<PcUser[]>([]);
  useEffect(() => {
    api<{ users: PcUser[] }>("/users")
      .then((r) => setU(r.users))
      .catch(() => {});
  }, []);
  return u;
}

function PartPicker({ sheetId, onClose, onAdded }: { sheetId: number; onClose: () => void; onAdded: () => Promise<void> }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const [rows, setRows] = useState<PcPart[] | null>(null);
  useEffect(() => {
    if (dq.length < 2) return;
    let on = true;
    api<PcPart[]>("/pcwof/parts", { query: { q: dq } })
      .then((r) => on && setRows(r))
      .catch((e) => on && (toast.show("ERROR", (e as Error).message, "error"), setRows([])));
    return () => void (on = false);
  }, [dq, toast]);
  const shown = dq.length < 2 ? null : rows;
  async function add(p: PcPart) {
    try {
      await api(`/pcwof/sheets/${sheetId}/items`, { method: "POST", body: { partId: p.partId, intCode: p.partCode, barColor: null, remark: null } });
      toast.show("Saved", `เพิ่ม ${p.partCode} แล้ว`, "ok");
      await onAdded();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  return (
    <Modal
      open
      title="+ ADD PART"
      onClose={onClose}
      footer={
        <button type="button" className="cta-btn is-gray" onClick={onClose}>
          CLOSE
        </button>
      }
    >
      <input className="wof-search" autoFocus value={q} placeholder="ค้นหา รหัส / ชื่อ / Part No (อย่างน้อย 2 ตัวอักษร)" onChange={(e) => setQ(e.target.value)} />
      <div className="wof-pick">
        {shown === null ? (
          <small>พิมพ์เพื่อค้นหาชิ้นงาน</small>
        ) : shown.length === 0 ? (
          <small>ไม่พบชิ้นงาน</small>
        ) : (
          shown.map((p) => (
            <button key={p.partId} type="button" className="wof-pick-row" onClick={() => add(p)}>
              <b>{p.partCode}</b>
              <span>{p.name}</span>
              <small>
                {p.partNo} · {p.customer}
                {p.packSize ? ` · ${p.packSize}/BOX` : ""}
              </small>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

function EditorsModal({ sheetId, d, onClose, onSaved }: { sheetId: number; d: PcDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const users = useUsers();
  const [sel, setSel] = useState(() => new Set(d.sheet.editors.map((e) => e.userId)));
  const [f, setF] = useState({ customerCode: d.sheet.customerCode, customerName: d.sheet.customerName, workOrderNo: d.sheet.workOrderNo });
  const [q, setQ] = useState("");
  const list = users.filter((u) => u.userId !== d.sheet.owner.userId && `${u.userId} ${u.name}`.toLowerCase().includes(q.toLowerCase()));
  async function save() {
    try {
      await api(`/pcwof/sheets/${sheetId}`, { method: "PUT", body: { ...f, editors: [...sel] } });
      toast.show("Saved", "บันทึกแล้ว", "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  const field = (k: keyof typeof f, label: string) => (
    <label className="wof-fld">
      <span>{label}</span>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <Modal
      open
      title="EDITORS"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cta-btn is-gray" onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className="cta-btn is-purple" onClick={save}>
            SAVE
          </button>
        </>
      }
    >
      <div className="wof-form">
        {field("customerCode", "CUSTOMER CODE")}
        {field("customerName", "CUSTOMER NAME")}
        {field("workOrderNo", "WORK ORDER NO.")}
      </div>
      <input className="wof-search" value={q} placeholder="ค้นหาผู้แก้ไข" onChange={(e) => setQ(e.target.value)} />
      <div className="wof-pick">
        {users.length === 0 && <small>ไม่สามารถโหลดรายชื่อผู้ใช้ได้</small>}
        {list.map((u) => (
          <label key={u.userId} className="wof-pick-row is-check">
            <input
              type="checkbox"
              checked={sel.has(u.userId)}
              onChange={() =>
                setSel((s) => {
                  const n = new Set(s);
                  if (!n.delete(u.userId)) n.add(u.userId);
                  return n;
                })
              }
            />
            <b>{u.userId}</b>
            <span>{u.name}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
