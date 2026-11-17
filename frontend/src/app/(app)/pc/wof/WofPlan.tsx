"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, PageBody, PageHeader } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { MonthField } from "@/components/forms/MonthField";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { api, deviceName } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import { DOW, dowOf, f0, thisMonth } from "@/lib/pp";
import { PAGE_SIZE, PLAN_ROWS, ROWS, currentStep, daysIn, editableStatus, initials, parseQty, rowTotal, statusTone, stOf, type PcDetail, type PcItem, type PcMeta, type PcPart, type PcUser } from "@/lib/pcwof";
import "./wof.css";

// 🗂 PC › WORK ORDER FOLLOW › แผน : ตารางแบบ WORKLOAD (ชิ้นงาน x แถว Excel x วัน) · 6 ชิ้นงาน / หน้า · เปลี่ยนเดือน = ชิ้นงานเดิม ตัวเลขของเดือนนั้น
//   กรอกได้เมื่อเป็น OWNER / EDITOR และสถานะ DRAFT / REJECTED · บันทึกอัตโนมัติ · ↑ ↓ Enter = ช่องล่าง / บน · ← → ที่ขอบข้อความ = ช่องซ้าย / ขวา
type Save = "idle" | "saving" | "saved" | "error";
type Pend = { itemId: number; rowKey: string; day: number; qty: number | null };

export default function WofPlan({ id }: { id: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const dlg = useDialogs();
  const [month, setMonthState] = useState(() => params.get("month") || thisMonth());
  const [meta, setMeta] = useState<PcMeta | null>(null);
  const [d, setD] = useState<PcDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [busyMonth, setBusyMonth] = useState(false);
  const [save, setSave] = useState<Save>("idle");
  const [partModal, setPartModal] = useState(false);
  const [mgr, setMgr] = useState(false);
  const [page, setPage] = useState(0);
  const [wo, setWo] = useState<string | null>(null); // typed W/O no (null = show saved)
  const [vw, setVw] = useState(1280); // viewport width: < 1024 shows the DAY RANGE chips, < 768 defaults to one week
  const [pick, setPick] = useState<number | "all" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null); // part popover (phone)
  const pend = useRef(new Map<string, Pend>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushing = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const monthRef = useRef(month);
  const last = useRef("");
  const grid = useRef<HTMLTableElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<PcDetail>(`/pcwof/plans/${id}`, { query: { month: monthRef.current } });
        if (quiet && (pend.current.size > 0 || flushing.current || sameData(last, r))) return; // never overwrite what is being typed
        last.current = JSON.stringify(r);
        setD(r);
      } catch (e) {
        if (!quiet) {
          toast.show("ERROR", (e as Error).message, "error");
          setGone(true);
        }
      } finally {
        setBusyMonth(false);
      }
    },
    [id, toast],
  );
  useEffect(() => {
    api<PcMeta>("/pcwof/meta")
      .then(setMeta)
      .catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  useEffect(() => {
    if (!meta?.ready) return;
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [meta?.ready, load, month]);
  useLive(["pcwof"], () => (meta?.ready ? load(true) : undefined));

  const flush = useCallback(async () => {
    if (flushing.current || pend.current.size === 0) return;
    flushing.current = true;
    const batch = [...pend.current.entries()].slice(0, 2000); // backend max 2000 cells per request
    batch.forEach(([k]) => pend.current.delete(k));
    setSave("saving");
    try {
      await api(`/pcwof/plans/${id}/cells`, { method: "PUT", body: { month: monthRef.current, cells: batch.map(([, p]) => p) } });
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
  // leaving the page with unsaved edits: warn; unmount sends what is still queued with keepalive
  useEffect(() => {
    const q = pend.current; // stable Map for the whole component life
    const h = (e: BeforeUnloadEvent) => q.size > 0 && e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => {
      window.removeEventListener("beforeunload", h);
      clearTimeout(timer.current);
      const left = [...q.values()].slice(0, 2000);
      if (left.length) {
        q.clear();
        void fetch(`/api/pcwof/plans/${id}/cells`, { method: "PUT", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Client-Device": deviceName() }, body: JSON.stringify({ month: monthRef.current, cells: left }) }).catch(() => {});
      }
    };
  }, [id]);

  // wait until queued / in-flight cell saves are done so a reload / month switch never loses or reverts typed values
  async function settle() {
    for (let i = 0; i < 20 && (pend.current.size > 0 || flushing.current); i++) {
      if (flushing.current) await new Promise((r) => setTimeout(r, 150));
      else await flushRef.current();
    }
    return pend.current.size === 0 && !flushing.current;
  }
  async function changeMonth(m: string) {
    if (m === month) return;
    if (!(await settle())) return toast.show("WARNING", "ยังบันทึกข้อมูลเดือนนี้ไม่สำเร็จ · ลองใหม่อีกครั้งก่อนเปลี่ยนเดือน", "warn");
    monthRef.current = m;
    setBusyMonth(true);
    setWo(null);
    setMonthState(m);
    router.replace(`?month=${m}`, { scroll: false });
  }

  const plan = d?.plan;
  const status = d?.month.status ?? "DRAFT";
  const editable = !!d?.canEdit && editableStatus(status);
  const isOwner = !!plan && !!meta && plan.owner.userId.toLowerCase() === meta.me.userId.toLowerCase();
  const items = useMemo(() => d?.items ?? [], [d]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const shown = items.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const total = daysIn(month);
  const weeks = Math.ceil(total / 7);
  const today = new Date().getDate();
  const auto: number | "all" = vw >= 768 ? "all" : month === thisMonth() ? Math.min(Math.floor((today - 1) / 7), weeks - 1) : 0;
  const range = vw >= 1024 ? "all" : pick !== null && (pick === "all" || pick < weeks) ? pick : auto;
  // TOTAL / ST. always use every day (rowTotal reads the cells), only the rendered columns are limited
  const days = useMemo(() => Array.from({ length: total }, (_, i) => i + 1).filter((n) => range === "all" || Math.floor((n - 1) / 7) === range), [total, range]);
  const sums = useMemo(() => {
    const at = (n: number, keys: string[]) => items.reduce((a, it) => a + keys.reduce((b, k) => b + (Number(it.cells[k]?.[n]) || 0), 0), 0);
    return [
      { k: "ORDER", label: "สั่งผลิต", keys: ["ORDER"] },
      { k: "PROD", label: "ผลิตได้ D+N", keys: ["PROD_D", "PROD_N"] },
      { k: "DEL", label: "DEL.", keys: ["DEL"] },
    ].map((r) => ({ ...r, by: Object.fromEntries(Array.from({ length: total }, (_, i) => [i + 1, at(i + 1, r.keys)])) as Record<number, number> }));
  }, [items, total]);

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

  async function mut(fn: () => Promise<unknown>) {
    try {
      await fn();
      if (await settle()) await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  const setLocal = (it: PcItem, p: Partial<PcItem>) => setD((s) => s && { ...s, items: s.items.map((x) => (x.itemId === it.itemId ? { ...x, ...p } : x)) });
  const patchItem = (it: PcItem, p: Partial<Pick<PcItem, "remark" | "packSize">>) => {
    const n = { ...it, ...p };
    setLocal(it, p);
    return mut(() => api(`/pcwof/items/${it.itemId}`, { method: "PUT", body: { remark: n.remark, packSize: n.packSize, month } }));
  };
  async function move(i: number, dir: -1 | 1) {
    const ids = items.map((x) => x.itemId);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    await mut(() => api(`/pcwof/plans/${id}/items/order`, { method: "POST", body: { ids, month } }));
  }
  async function delItem(it: PcItem) {
    if (await dlg.confirm({ title: "ลบชิ้นงาน", message: `ลบ ${it.partNo || it.partName} ออกจากแผน? (ลบตั้งแต่เดือนนี้เป็นต้นไป · เดือนก่อนหน้ายังเก็บเป็นประวัติ · ชิ้นงานอื่นเลื่อนขึ้น)`, ok: "DELETE", danger: true })) await mut(() => api(`/pcwof/items/${it.itemId}`, { method: "DELETE", query: { month } }));
  }
  async function delPlan() {
    if (!(await dlg.confirm({ title: "ลบแผน", message: "ลบแผนนี้ทั้งแผน? ข้อมูลทุกชิ้นงานทุกเดือนจะหายและกู้คืนไม่ได้", ok: "DELETE", danger: true }))) return;
    try {
      await api(`/pcwof/plans/${id}`, { method: "DELETE" });
      router.replace(`/pc/wof?month=${month}`);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  async function saveWo() {
    if (wo === null || wo === (d?.month.workOrderNo ?? "")) return setWo(null);
    await mut(() => api(`/pcwof/plans/${id}/month`, { method: "PUT", body: { month, workOrderNo: wo.trim() } }));
    setWo(null);
  }
  async function flow(path: "send" | "approve" | "reject") {
    if (!(await settle())) return toast.show("WARNING", "ยังบันทึกข้อมูลไม่สำเร็จ · ลองใหม่อีกครั้ง", "warn");
    let remark = "";
    if (path === "send" && !(await dlg.confirm({ title: "SEND FOR SIGN", message: "ส่งแผนเดือนนี้เพื่อลงลายเซ็น? หลังส่งจะแก้ไขตัวเลขไม่ได้จนกว่าจะถูกส่งกลับ", ok: "SEND" }))) return;
    if (path !== "send") {
      const r = await dlg.prompt({ title: path === "approve" ? "APPROVE" : "REJECT", message: path === "approve" ? "หมายเหตุ (ไม่บังคับ)" : "ระบุเหตุผลที่ส่งกลับ", multiline: true, ...(path === "reject" ? { required: "กรุณาระบุเหตุผล" } : {}) });
      if (r === null) return;
      remark = r;
    }
    try {
      await api(`/pcwof/plans/${id}/${path}`, { method: "POST", body: { month, remark } });
      toast.show("OK", path === "send" ? "ส่งลายเซ็นแล้ว" : path === "approve" ? "อนุมัติแล้ว" : "ส่งกลับแล้ว", "ok");
      await load();
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
        <Empty>ไม่พบแผน หรือไม่มีสิทธิ์เข้าถึง</Empty>
        <Link href="/pc/wof" className="cta-btn is-gray self-start">
          BACK
        </Link>
      </PageBody>
    );
  if (!d || !plan || !meta)
    return (
      <PageBody>
        <div className="grid gap-3" aria-busy>
          <div className="nx-skel h-16 rounded-2xl" />
          <div className="nx-skel h-28 rounded-2xl" />
          <div className="nx-skel h-72 rounded-2xl" />
        </div>
      </PageBody>
    );

  const tone = statusTone(status);
  const cur = currentStep(d.month.approvals);
  const me = meta.me.userId.toLowerCase();
  const canSign = status === "SENT" && !!cur && cur.users.some((u) => u.userId.toLowerCase() === me);

  return (
    <PageBody className="wof-page">
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title={`${plan.customerName || plan.customerCode} · ${plan.customerCode}`}
        subtitle={`${month} · ${plan.items} PARTS`}
        actions={
          <>
            <span className={`wof-save is-${save}`} role="status">
              {save === "saving" ? "กำลังบันทึก…" : save === "saved" ? "บันทึกแล้ว" : save === "error" ? "บันทึกไม่สำเร็จ (ลองใหม่อัตโนมัติ)" : editable ? "แก้ไขได้" : "ดูอย่างเดียว"}
            </span>
            <Link href={`/pc/wof?month=${month}`} className="cta-btn is-gray wof-np">
              BACK
            </Link>
            <button type="button" className="cta-btn is-gray wof-np" onClick={() => window.print()}>
              PRINT
            </button>
            {editable && (
              <button type="button" className="cta-btn is-purple wof-np" onClick={() => setPartModal(true)}>
                + ADD PART
              </button>
            )}
          </>
        }
      />
      {status === "SENT" && <div className="wof-lock">⏳ ส่งลายเซ็นแล้ว · รออนุมัติ · ล็อกการแก้ไขตัวเลข</div>}
      {status === "APPROVED" && <div className="wof-lock is-ok">🔒 เดือนนี้ APPROVE แล้ว · ล็อกการแก้ไข</div>}
      {status === "REJECTED" && <div className="wof-lock is-bad">↩ ถูกส่งกลับ · แก้ไขแล้วกด SEND FOR SIGN อีกครั้ง</div>}

      <section className="wof-info">
        <div className="wof-owner">
          <span className="wof-av" aria-hidden>
            {initials(plan.owner.name, plan.owner.userId)}
          </span>
          <span className="wof-owner-tx">
            <b>{plan.owner.name}</b>
            <small>OWNER · {plan.owner.userId}</small>
          </span>
        </div>
        <div>
          <span>EDITORS</span>
          <b>{plan.editors.length ? plan.editors.map((e) => e.name).join(", ") : "-"}</b>
        </div>
        <MonthField value={month} onChange={changeMonth} className="wof-np" />
        <label className="wof-wo">
          <span>W/O NO.</span>
          <input
            value={wo ?? d.month.workOrderNo ?? ""}
            disabled={!editable}
            placeholder="เลขที่ Work Order"
            onChange={(e) => setWo(e.target.value)}
            onBlur={saveWo}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        <i className={`wof-chip is-${tone}`}>{status}</i>
        <div className="wof-np wof-info-act">
          {editable && (
            <button type="button" className="cta-btn is-sm is-green" onClick={() => flow("send")}>
              SEND FOR SIGN
            </button>
          )}
          {isOwner && (
            <>
              <button type="button" className="cta-btn is-sm is-purple" onClick={() => setMgr(true)}>
                EDITORS
              </button>
              <button type="button" className="cta-btn is-sm is-red" onClick={delPlan}>
                DELETE PLAN
              </button>
            </>
          )}
        </div>
      </section>

      {d.month.approvals.length > 0 && (
        <section className="wof-flow" aria-label="APPROVALS">
          {[...d.month.approvals]
            .sort((a, b) => a.stepNo - b.stepNo)
            .map((s) => (
              <div key={s.stepNo} className={`wof-step ${s.signedBy ? "is-done" : cur?.stepNo === s.stepNo && status === "SENT" ? "is-cur" : ""}`}>
                <small>STEP {s.stepNo}</small>
                <b>{s.title}</b>
                <span>{s.users.map((u) => u.name).join(" / ") || "-"}</span>
                {s.signedBy && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="wof-sig" src={`/api/signature/${encodeURIComponent(s.signedBy)}/image`} alt={`ลายเซ็น ${s.signedBy}`} draggable={false} />
                )}
                <i className={`wof-chip is-${s.signedBy ? "ok" : s.status === "REJECTED" ? "bad" : "none"}`}>{s.signedBy ? `SIGNED · ${s.signedBy}` : s.status || "รอ"}</i>
                {s.signedAt && <small>{new Date(s.signedAt).toLocaleString("th-TH")}</small>}
              </div>
            ))}
          {canSign && (
            <div className="wof-flow-act wof-np">
              <button type="button" className="cta-btn is-sm is-green" onClick={() => flow("approve")}>
                ✍ APPROVE
              </button>
              <button type="button" className="cta-btn is-sm is-red" onClick={() => flow("reject")}>
                REJECT
              </button>
            </div>
          )}
        </section>
      )}

      {vw < 1024 && (
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

      {items.length === 0 ? (
        <Empty>ยังไม่มีชิ้นงานในแผน{editable ? " · กด + ADD PART" : ""}</Empty>
      ) : (
        <>
          <div className={`wof-wrap ${busyMonth ? "is-busy" : ""}`}>
            <table className="wof-table" ref={grid} onKeyDown={nav}>
              <thead>
                <tr>
                  <th className="wof-s1" rowSpan={2}>
                    PART
                  </th>
                  <th className="wof-sg" rowSpan={2} />
                  <th className="wof-s2" rowSpan={2} />
                  <th className="wof-band" colSpan={days.length}>
                    {month} · W/O {d.month.workOrderNo || "-"}
                  </th>
                  <th className="wof-tot" rowSpan={2}>
                    TOTAL
                  </th>
                </tr>
                <tr className="wof-h2">
                  {days.map((n) => {
                    const w = dowOf(month, n);
                    return (
                      <th key={n} className={w === 0 || w === 6 ? "is-we" : ""}>
                        {n}
                        <small>{DOW[w]}</small>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {shown.map((it, si) => {
                const ii = pg * PAGE_SIZE + si; // index in the whole plan (order buttons)
                const del = rowTotal(it.cells, "DEL");
                return (
                  <tbody key={it.itemId} className="wof-item" style={{ "--i": si } as React.CSSProperties}>
                    {[...ROWS.map((r) => r.key), "ST"].map((rk, ri) => {
                      const calc = rk === "ST";
                      const info = ROWS.find((r) => r.key === rk);
                      return (
                        <tr key={rk} className={calc ? "is-calc" : ""}>
                          {ri === 0 && (
                            <td rowSpan={7} className={`wof-s1 wof-part ${openId === it.itemId ? "is-open" : ""}`}>
                              <div className="wof-part-h">
                                {it.imageUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img className="wof-part-img" src={it.imageUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
                                )}
                                <b>{it.partNo}</b>
                              </div>
                              <div className="wof-part-n" title={it.partName} onClick={() => setOpenId((o) => (o === it.itemId ? null : it.itemId))}>
                                {it.partName}
                              </div>
                              <div className="wof-part-more">
                                <div className="wof-part-m">
                                  A: {it.partA || "-"} · B: {it.partB || "-"}
                                </div>
                                <label className="wof-part-f">
                                  PACK SIZE
                                  {editable ? (
                                    <input
                                      inputMode="numeric"
                                      defaultValue={it.packSize ?? ""}
                                      onBlur={(e) => {
                                        const v = parseQty(e.target.value);
                                        if (v === undefined || (v !== null && (!Number.isInteger(v) || v < 1))) return toast.show("WARNING", "PACK SIZE ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป", "warn");
                                        if (v !== it.packSize) void patchItem(it, { packSize: v });
                                      }}
                                    />
                                  ) : (
                                    <b>{it.packSize ?? "-"}</b>
                                  )}
                                </label>
                                <label className="wof-part-f">
                                  REMARK
                                  {editable ? <input defaultValue={it.remark ?? ""} onBlur={(e) => e.target.value !== (it.remark ?? "") && void patchItem(it, { remark: e.target.value })} /> : <b>{it.remark || "-"}</b>}
                                </label>
                                {editable && (
                                    <div className="wof-part-act wof-np">
                                      <button type="button" disabled={ii === 0} onClick={() => move(ii, -1)} aria-label="ย้ายขึ้น">
                                        ▲
                                      </button>
                                      <button type="button" disabled={ii === items.length - 1} onClick={() => move(ii, 1)} aria-label="ย้ายลง">
                                        ▼
                                      </button>
                                      <button type="button" onClick={() => delItem(it)} aria-label="ลบชิ้นงาน">
                                        ✕
                                      </button>
                                    </div>
)}                              </div>
                            </td>
                          )}
                          {ri === 0 && (
                            <td rowSpan={PLAN_ROWS} className="wof-sg wof-pl">
                              <span>PL</span>
                            </td>
                          )}
                          {ri === PLAN_ROWS && <td rowSpan={7 - PLAN_ROWS} className="wof-sg" />}
                          <td className="wof-s2 wof-rl" title={info?.th ?? "ST. = DEL ÷ PACK SIZE (ปัดขึ้น)"}>
                            {info?.label ?? "ST."}
                          </td>
                          {days.map((n) => {
                            const w = dowOf(month, n);
                            const cls = w === 0 || w === 6 ? "is-we" : "";
                            if (calc)
                              return (
                                <td key={n} className={cls}>
                                  {stOf(it.cells.DEL?.[n] ?? 0, it.packSize) ?? "-"}
                                </td>
                              );
                            const v = it.cells[rk]?.[n];
                            return (
                              <td key={n} className={cls}>
                                {editable ? (
                                  <input
                                    key={v ?? ""}
                                    className="wof-cell"
                                    inputMode="decimal"
                                    data-r={si * 6 + ri}
                                    data-c={n}
                                    defaultValue={v ?? ""}
                                    aria-label={`${it.partNo} ${rk} วันที่ ${n}`}
                                    onFocus={(e) => e.target.select()}
                                    onBlur={(e) => setCell(it, rk, n, e.target.value)}
                                  />
                                ) : (
                                  (v ?? "")
                                )}
                              </td>
                            );
                          })}
                          <td className="wof-tot">{calc ? (stOf(del, it.packSize) ?? "-") : f0(rowTotal(it.cells, rk))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
              <tfoot>
                {sums.map((r, i) => (
                  <tr key={r.k} className="wof-sum">
                    {i === 0 && (
                      <td className="wof-s1 wof-sumlab" rowSpan={3}>
                        TOTAL · ทุกชิ้นงาน
                      </td>
                    )}
                    {i === 0 && <td className="wof-sg" rowSpan={3} />}
                    <td className="wof-s2 wof-rl">{r.label}</td>
                    {days.map((n) => {
                      const w = dowOf(month, n);
                      return (
                        <td key={n} className={w === 0 || w === 6 ? "is-we" : ""}>
                          {r.by[n] ? f0(r.by[n]) : ""}
                        </td>
                      );
                    })}
                    <td className="wof-tot">{f0(Object.values(r.by).reduce((a, b) => a + b, 0))}</td>
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
          {pages > 1 && (
            <nav className="wof-pager wof-np" aria-label="PAGE">
              <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)}>
                ‹
              </button>
              {Array.from({ length: pages }, (_, i) => (
                <button key={i} type="button" className={i === pg ? "is-on" : ""} onClick={() => setPage(i)}>
                  {i + 1}
                </button>
              ))}
              <button type="button" disabled={pg === pages - 1} onClick={() => setPage(pg + 1)}>
                ›
              </button>
              <small>
                PARTS {pg * PAGE_SIZE + 1}–{Math.min(items.length, pg * PAGE_SIZE + PAGE_SIZE)} / {items.length}
              </small>
            </nav>
          )}
        </>
      )}

      {partModal && <PartPicker planId={id} month={month} customer={plan.customerCode} have={new Set(items.map((x) => x.partId))} onClose={() => setPartModal(false)} onAdded={load} />}
      {mgr && <EditorsModal planId={id} d={d} onClose={() => setMgr(false)} onSaved={() => (setMgr(false), load())} />}
    </PageBody>
  );
}

// user list for pickers (GET /users); if the caller may not read it the list stays empty
function useUsers() {
  const [u, setU] = useState<PcUser[]>([]);
  useEffect(() => {
    api<{ users: PcUser[] }>("/users")
      .then((r) => setU(r.users))
      .catch(() => {});
  }, []);
  return u;
}

// + ADD PART: the customer's parts (image / Part No / name / A / B / pack size) · tick several · ADD
function PartPicker({ planId, month, customer, have, onClose, onAdded }: { planId: number; month: string; customer: string; have: Set<number>; onClose: () => void; onAdded: () => Promise<void> }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const [rows, setRows] = useState<PcPart[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let on = true;
    api<PcPart[]>("/pcwof/parts", { query: { customer, q: dq } })
      .then((r) => on && setRows(r))
      .catch((e) => on && (toast.show("ERROR", (e as Error).message, "error"), setRows([])));
    return () => void (on = false);
  }, [dq, customer, toast]);
  async function add() {
    setBusy(true);
    let n = 0;
    try {
      for (const partId of sel) {
        await api(`/pcwof/plans/${planId}/items`, { method: "POST", body: { partId, month } });
        n++;
      }
      toast.show("Saved", `เพิ่ม ${n} ชิ้นงานแล้ว`, "ok");
      await onAdded();
      onClose();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      await onAdded();
      setBusy(false);
    }
  }
  const tick = (p: PcPart) => setSel((s) => (have.has(p.partId) ? s : (() => { const n = new Set(s); if (!n.delete(p.partId)) n.add(p.partId); return n; })()));
  return (
    <Modal
      open
      title={`+ ADD PART · ${customer}`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button type="button" className="cta-btn is-gray" onClick={onClose}>
            CLOSE
          </button>
          <button type="button" className="cta-btn is-purple" disabled={sel.size === 0 || busy} onClick={add}>
            ADD {sel.size || ""}
          </button>
        </>
      }
    >
      <input className="wof-search" autoFocus value={q} placeholder="ค้นหา Part No / ชื่อ / Part A / Part B" onChange={(e) => setQ(e.target.value)} />
      <div className="wof-pick">
        {rows === null ? (
          <div className="nx-skel h-16 rounded-xl" />
        ) : rows.length === 0 ? (
          <small>ไม่พบชิ้นงานของลูกค้านี้</small>
        ) : (
          rows.map((p) => {
            const added = have.has(p.partId);
            return (
              <button key={p.partId} type="button" className={`wof-pick-row is-part ${sel.has(p.partId) ? "is-sel" : ""}`} disabled={added} onClick={() => tick(p)}>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                ) : (
                  <span className="wof-noimg" />
                )}
                <span className="wof-pick-tx">
                  <b>{p.partNo}</b>
                  <span>{p.partName}</span>
                  <small>
                    A: {p.partA || "-"} · B: {p.partB || "-"} · PACK {p.packSize ?? "-"}
                  </small>
                </span>
                <i className={`wof-chip is-${added ? "ok" : sel.has(p.partId) ? "wait" : "none"}`}>{added ? "ADDED" : sel.has(p.partId) ? "✓" : "+"}</i>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function EditorsModal({ planId, d, onClose, onSaved }: { planId: number; d: PcDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const users = useUsers();
  const [sel, setSel] = useState(() => new Set(d.plan.editors.map((e) => e.userId)));
  const [q, setQ] = useState("");
  const list = users.filter((u) => u.userId !== d.plan.owner.userId && `${u.userId} ${u.name}`.toLowerCase().includes(q.toLowerCase()));
  async function save() {
    try {
      await api(`/pcwof/plans/${planId}`, { method: "PUT", body: { editors: [...sel] } });
      toast.show("Saved", "บันทึกแล้ว", "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
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
