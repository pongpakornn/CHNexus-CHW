"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Loading } from "@/components/ui/Page";
import { QrImage } from "@/components/ui/QrImage";
import { api } from "@/lib/api";
import { stockIcon, tileStyle } from "@/lib/stockIcons";
import type { Layout } from "./types";

type Opt = { key: string; label: string };
type Data = {
  stocks: { stkId: number; code: string; name: string; count: number; stockType: string | null; isMain: boolean }[];
  layouts: { stkId: number; code: string; layout: Layout }[];
  columns: Opt[];
  qrFields: Opt[];
  groups: string[];
  defaultOrder: string[];
  formFields: Opt[];
  hasFormFields: boolean;
  hasQrFields: boolean;
};
type Tab = "DELETE" | "FORM" | "COLUMNS" | "QR";
const SIDE_KEY = "inv-admin-side";

// 🛠 ADMIN ของ Inventory Registration (ProductControlAdminWindow - Level 1): STOCK DELETE / TABLE COLUMNS / QR CODE
export function AdminModal({ ticked, onClose }: { ticked: number[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("DELETE");
  const [changed, setChanged] = useState(false);
  const [layouts, setLayouts] = useState<Record<number, Layout>>({});
  const [dirty, setDirty] = useState<number[]>([]);
  const [cur, setCur] = useState(0);
  const [chosen, setChosen] = useState<number[]>([]);
  const [all, setAll] = useState(ticked.length === 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [mini, setMini] = useState(false); // Sidebar พับ = ไอคอนอย่างเดียว
  const [drawer, setDrawer] = useState(false); // มือถือ: เมนูเลื่อนออกจากซ้าย
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDE_KEY) === "1") queueMicrotask(() => setMini(true));
    } catch {
      /* ไม่มี storage */
    }
  }, []);
  const toggleMini = () =>
    setMini((m) => {
      try {
        localStorage.setItem(SIDE_KEY, m ? "0" : "1");
      } catch {
        /* ไม่จำก็ได้ */
      }
      return !m;
    });

  const load = () =>
    api<Data>("/products/admin")
      .then((d) => {
        setData(d);
        setLayouts(Object.fromEntries(d.layouts.map((l) => [l.stkId, { ...l.layout, qrFields: l.layout.qrFields.includes("CODE") ? l.layout.qrFields : ["CODE", ...l.layout.qrFields] }])));
        setDirty([]);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = async () => {
    if (dirty.length > 0 && !(await dlg.confirm({ title: "UNSAVED CHANGES", message: "มีการตั้งค่าที่ยังไม่ได้กด SAVE\nต้องการปิดหน้าต่างโดยไม่บันทึกหรือไม่?" }))) return;
    onClose(changed);
  };

  const edit = (fn: (l: Layout) => Layout) => {
    setLayouts((m) => ({ ...m, [cur]: fn(m[cur]) }));
    setDirty((d) => (d.includes(cur) ? d : [...d, cur]));
  };

  async function saveLayouts(kind: "COLUMNS" | "QR" | "FORM") {
    const list = dirty.map((id) => {
      const l = layouts[id];
      return kind === "COLUMNS" ? { stkId: id, columns: l.columns, groupBy: l.groupBy } : kind === "FORM" ? { stkId: id, formFields: l.formFields } : { stkId: id, qrFields: l.qrFields, qrLabel: l.qrLabel };
    });
    if (kind === "COLUMNS") {
      const empty = dirty.find((id) => layouts[id].columns.length === 0);
      if (empty !== undefined) return toast.show("WARNING", `${data?.layouts.find((x) => x.stkId === empty)?.code}: กรุณาเลือกคอลัมน์อย่างน้อย 1 คอลัมน์`, "warn");
    }
    try {
      await api("/products/admin/layouts", { method: "POST", body: list });
      toast.show("SAVED", "บันทึกการตั้งค่าแล้ว", "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doDelete() {
    if (!data) return;
    const stocks = data.stocks.filter((s) => chosen.includes(s.stkId));
    const what = all ? `สินค้าทั้งหมดในคลัง ${stocks.map((s) => s.code).join(", ")}` : `สินค้าที่ติ๊กไว้ ${ticked.length} รายการ (เฉพาะที่อยู่ในคลัง ${stocks.map((s) => s.code).join(", ")})`;
    const ok = await dlg.confirm({
      title: "CONFIRM DELETE",
      danger: true,
      ok: "DELETE",
      message: `ยืนยันการลบ${what}\n\nสินค้าจะถูกลบออกจากระบบทั้งหมด (ทุกคลัง ประวัติสแกน ค่า Max-Min และ Coil) แม้ยังมียอดคงเหลือ\nลบแล้วกู้คืนไม่ได้\n\nเหตุผล: ${reason.trim()}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ level: "ok" | "warn"; message: string }>("/products/admin/delete", { method: "POST", body: { stockIds: chosen, all, partIds: ticked, reason } });
      await dlg.alert({ title: "STOCK DELETE", message: r.message, tone: r.level });
      setChanged(true);
      setReason("");
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const l = layouts[cur];
  const labelOf = (opts: Opt[], k: string) => opts.find((o) => o.key === k)?.label ?? k;
  const stockOf = (id: number) => data?.stocks.find((s) => s.stkId === id);
  const picked = data ? data.stocks.filter((s) => chosen.includes(s.stkId)) : [];

  // ปุ่มเลือก (GROUP BY / คอลัมน์): ขอบสี ชี้แล้วสีเต็มขยายจากกลางปุ่ม · on = เลือกอยู่
  const fill = (on: boolean, text: React.ReactNode, onClick: () => void, key: string, extra = "") => (
    <button key={key} type="button" onClick={onClick} className={`fill-btn ${on ? "is-on" : ""} ${extra}`}>
      {text}
    </button>
  );

  // ลำดับที่เลือก (ตัวเลข + ◀ เลื่อนขึ้นก่อน + × เอาออก) · ที่ยังไม่เลือก = ＋ เพิ่มต่อท้าย
  const orderList = (list: string[], opts: Opt[], onChange: (v: string[]) => void, locked?: string | string[]) => (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {list.length === 0 && <span className="text-xs font-bold text-ink-soft">ยังไม่ได้เลือก</span>}
        {list.map((k, i) => (
          <span key={k} className="ord-chip">
            <b className="ord-no">{i + 1}</b>
            <button type="button" disabled={i === 0} title="เลื่อนขึ้นก่อน" onClick={() => onChange(list.map((x, j) => (j === i - 1 ? k : j === i ? list[i - 1] : x)))} className="ord-mv">
              ◀
            </button>
            <span className="px-0.5">{labelOf(opts, k)}</span>
            {(Array.isArray(locked) ? locked.includes(k) : k === locked) ? (
              <span className="ord-lock" title="จำเป็นต้องมี">
                🔒
              </span>
            ) : (
              <button type="button" title="เอาออก" onClick={() => onChange(list.filter((x) => x !== k))} className="ord-x">
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {opts.some((o) => !list.includes(o.key)) && (
        <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-3">
          {opts.filter((o) => !list.includes(o.key)).map((o) => fill(false, `＋ ${o.label}`, () => onChange([...list, o.key]), o.key, "is-add"))}
        </div>
      )}
    </div>
  );

  // การ์ดคลังแบบหน้า Store (Max-Min): แถบสี · ไอคอนประจำคลัง · รหัส / ชื่อ · จำนวน · ติ๊กถูกเมื่อเลือก
  const stockCard = (o: { id: number; code: string; name?: string; count?: number; type?: string | null; i: number }, on: boolean, onClick: () => void, tone: "danger" | "accent", mark?: boolean) => {
    const [ic, c0] = o.id === 0 ? ["", "#6750a4"] : stockIcon(o.code, o.i, o.type);
    const col = tone === "danger" && on ? "#ef4444" : c0;
    return (
      <button key={o.id} type="button" onClick={onClick} className={`adm-card ${on ? "is-on" : ""}`} style={{ "--c": col } as React.CSSProperties}>
        <span className="adm-bar" />
        <span className="adm-ic" style={tileStyle(c0)}>
          {o.id === 0 ? (
            <svg viewBox="0 0 24 24" className="size-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
            </svg>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ic} alt="" className="size-6 object-contain" draggable={false} />
          )}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5 truncate text-[15px] font-extrabold text-[#1f2350]">
            {o.code} {mark && <span className="adm-dirty" title="ยังไม่ได้ SAVE" />}
          </span>
          {o.name && <span className="block truncate text-[11px] font-semibold text-ink-soft">{o.name}</span>}
          {o.count !== undefined && (
            <span className="mt-1 block text-[11px] font-extrabold" style={{ color: c0 }}>
              <span className="text-lg tabular-nums">{o.count.toLocaleString()}</span> ITEMS
            </span>
          )}
        </span>
        <span className="adm-check" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 12.5 4 4 8-9" />
          </svg>
        </span>
      </button>
    );
  };

  const TABS: [Tab, string, string, React.ReactNode][] = [
    ["DELETE", "STOCK DELETE", "ลบสินค้าตามคลัง", <path key="d" d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />],
    ["FORM", "FORM FIELDS", "ช่องกรอกลงทะเบียน / Template", <path key="f" d="M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4" />],
    ["COLUMNS", "TABLE COLUMNS", "คอลัมน์ / จัดกลุ่ม", <path key="c" d="M4 5h16v14H4zM4 10h16M10 10v9M15 10v9" />],
    ["QR", "QR CODE", "ข้อมูลใน QR / ข้อความใต้ QR", <path key="q" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5" />],
  ];

  const tabName = TABS.find((x) => x[0] === tab)?.[1] ?? "";
  const pick = (t: Tab) => {
    setTab(t);
    setDrawer(false);
    if (t === "FORM" && cur === 0 && data) setCur(data.stocks[0]?.stkId ?? 0);
  };
  const burger = (onClick: () => void, label: string) => (
    <button type="button" className="adm-burger" onClick={onClick} aria-label={label} title={label}>
      <span />
      <span />
      <span />
    </button>
  );
  const foot =
    tab === "DELETE" ? (
      <button className="cta-btn is-red ml-auto" disabled={busy || chosen.length === 0 || !reason.trim() || (!all && ticked.length === 0)} onClick={doDelete}>
        🗑 DELETE
      </button>
    ) : (
      <>
        {tab === "FORM" && l && (
          <button className="fill-btn is-sm" onClick={() => data && edit((x) => ({ ...x, formFields: data.formFields.map((o) => o.key) }))}>
            ALL FIELDS
          </button>
        )}
        {tab === "COLUMNS" && l && (
          <button className="fill-btn is-sm" onClick={() => data && edit((x) => ({ ...x, columns: [...data.defaultOrder], groupBy: "CATEGORY" }))}>
            RESET
          </button>
        )}
        <button className="cta-btn is-purple ml-auto" disabled={dirty.length === 0} onClick={() => saveLayouts(tab as "COLUMNS" | "QR" | "FORM")}>
          💾 SAVE {dirty.length > 0 ? `(${dirty.length})` : ""}
        </button>
      </>
    );

  return (
    <Modal open size="xl" flush title={`🛠 ADMIN • ${tabName}`} onClose={close}>
      {/* Sidebar ติดขอบซ้ายสูงเต็มหน้าต่าง (แบบเมนูหลัก) · พับเหลือไอคอนได้ · มือถือ = เมนูเลื่อนออกจากซ้าย */}
      <div className={`adm-shell ${mini ? "is-mini" : ""} ${drawer ? "is-drawer" : ""}`}>
        <nav className="adm-nav">
          <div className="adm-nav-head">
            {burger(() => (window.matchMedia("(max-width: 767px)").matches ? setDrawer(false) : toggleMini()), mini ? "กางเมนู" : "พับเมนู")}
            <span className="adm-nav-title">
              ADMIN
              <small>INVENTORY REGISTRATION</small>
            </span>
          </div>
          {TABS.map(([t, txt, hint, path]) => (
            <button key={t} type="button" onClick={() => pick(t)} title={mini ? txt : undefined} className={`adm-item ${tab === t ? "is-on" : ""}`}>
              <svg viewBox="0 0 24 24" className="adm-item-ic" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {path}
              </svg>
              <span className="adm-item-txt">
                <span className="block truncate text-[13.5px] font-extrabold">{txt}</span>
                <span className="adm-item-hint">{hint}</span>
              </span>
            </button>
          ))}
        </nav>
        {drawer && <div className="adm-scrim" onClick={() => setDrawer(false)} />}

        <section className="adm-main">
          <div className="adm-main-head">
            {burger(() => setDrawer(true), "เมนู")}
            <b>{tabName}</b>
          </div>
          <div className="adm-scroll">
            {!data ? (
              <Loading />
            ) : (
              <>
          {tab === "DELETE" && (
            <div key="del" className="adm-pane grid content-start gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="adm-title">SELECT STOCK</div>
                <span className="ml-auto" />
                {fill(
                  chosen.length === data.stocks.length && data.stocks.length > 0,
                  chosen.length === data.stocks.length && data.stocks.length > 0 ? "✓ ALL STOCKS" : "SELECT ALL STOCKS",
                  () => setChosen(chosen.length === data.stocks.length ? [] : data.stocks.map((s) => s.stkId)),
                  "all",
                  "is-sm is-danger",
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
                {data.stocks.map((s, i) =>
                  stockCard(
                    { id: s.stkId, code: s.code, name: s.name, count: s.count, type: s.stockType, i },
                    chosen.includes(s.stkId),
                    () => setChosen((c) => (c.includes(s.stkId) ? c.filter((x) => x !== s.stkId) : [...c, s.stkId])),
                    "danger",
                  ),
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    [false, "DELETE THE TICKED PRODUCTS", `สินค้าที่ติ๊กไว้ในตาราง (${ticked.length} ticked)`, ticked.length === 0],
                    [true, "DELETE ALL PRODUCTS", "สินค้าทั้งหมดในคลังที่เลือก", false],
                  ] as [boolean, string, string, boolean][]
                ).map(([v, t, h, off]) => (
                  <button key={t} type="button" disabled={off} onClick={() => setAll(v)} className={`adm-opt ${all === v ? "is-on" : ""}`}>
                    <span className="adm-radio" />
                    <span className="min-w-0 text-left">
                      <b className="block text-[13px] font-extrabold">{t}</b>
                      <span className="block text-[11px] font-semibold text-ink-soft">{h}</span>
                    </span>
                  </button>
                ))}
              </div>
              <textarea className="field" rows={2} placeholder="เหตุผล (REASON)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className={`adm-sum ${chosen.length > 0 ? "is-warn" : ""}`}>
                {chosen.length === 0
                  ? "Select at least 1 stock."
                  : all
                    ? `All products in ${picked.map((s) => s.code).join(", ")} will be deleted from the system (up to ${picked.reduce((a, s) => a + s.count, 0).toLocaleString()} product(s)).`
                    : `${ticked.length} ticked product(s) will be deleted if they are in ${picked.map((s) => s.code).join(", ")}.`}
              </div>
            </div>
          )}

          {tab === "FORM" && (
            <div key="form" className="adm-pane grid content-start gap-4">
              <div className="adm-title">SELECT STOCK</div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {data.layouts
                  .filter((x) => x.stkId !== 0)
                  .map((x, i) => {
                    const st = stockOf(x.stkId);
                    return stockCard({ id: x.stkId, code: x.code, name: st?.name, type: st?.stockType, i }, cur === x.stkId, () => setCur(x.stkId), "accent", dirty.includes(x.stkId));
                  })}
              </div>
              {l && cur !== 0 ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="adm-box grid content-start gap-3">
                    <div className="adm-title">ช่องกรอกลงทะเบียนสินค้า (ลำดับตามที่เลือก) • TEMPLATE EXCEL ของคลังนี้ใช้ช่องชุดเดียวกัน</div>
                    {orderList(l.formFields ?? [], data.formFields, (v) => edit((x) => ({ ...x, formFields: v })), ["CODE", "NAME"])}
                    <p className="text-[11px] font-semibold text-ink-soft">
                      MASTER COIL / COIL NO / WEIGHT ของคลังที่นับ Coil = ของแต่ละ Coil (MASTER COIL อย่างเดียว = Master ทั้งม้วน) · คลังอื่น WEIGHT = น้ำหนักสินค้า · ช่องที่ไม่ได้เลือก ค่าเดิมของสินค้าไม่ถูกลบ
                    </p>
                    {!data.hasFormFields && <div className="text-xs font-bold text-warning">ฐานข้อมูลยังไม่รองรับ (database/nexus/09_ProductControl_FormFields.sql)</div>}
                  </div>
                  {/* ตัวอย่างฟอร์ม */}
                  <div className="adm-box">
                    <div className="adm-title mb-3">PREVIEW • {data.layouts.find((x) => x.stkId === cur)?.code}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(l.formFields ?? []).map((k, i) => (
                        <div key={k} className={`fm-prev ${k === "IMAGE" ? "col-span-2" : ""}`} style={{ animationDelay: `${i * 25}ms` }}>
                          <span>{labelOf(data.formFields, k)}</span>
                          <i />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="adm-sum">เลือกคลังเพื่อตั้งช่องกรอก</div>
              )}
            </div>
          )}

          {(tab === "COLUMNS" || tab === "QR") && (
            <div key={tab} className="adm-pane grid content-start gap-4">
              <div className="adm-title">SELECT STOCK</div>
              <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {data.layouts.map((x, i) => {
                  const st = stockOf(x.stkId);
                  return stockCard({ id: x.stkId, code: x.code, name: x.stkId === 0 ? "ค่าเริ่มต้นของทุกคลัง" : st?.name, type: st?.stockType, i }, cur === x.stkId, () => setCur(x.stkId), "accent", dirty.includes(x.stkId));
                })}
              </div>
              {l && tab === "COLUMNS" && (
                <div className="adm-box grid gap-5">
                  <div>
                    <div className="adm-title mb-2">GROUP BY</div>
                    <div className="flex flex-wrap gap-2">{data.groups.map((g) => fill(l.groupBy === g, g, () => edit((x) => ({ ...x, groupBy: g })), g))}</div>
                  </div>
                  <div>
                    <div className="adm-title mb-2">COLUMNS (ลำดับตามที่เลือก)</div>
                    {orderList(l.columns, data.columns, (v) => edit((x) => ({ ...x, columns: v })))}
                  </div>
                </div>
              )}
              {l && tab === "QR" && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="adm-box grid content-start gap-5">
                    <div>
                      <div className="adm-title mb-2">รูปแบบที่ 2 • ข้อมูลใน QR (หน้าสแกนอ่าน คั่นด้วย |)</div>
                      {orderList(l.qrFields, data.qrFields, (v) => edit((x) => ({ ...x, qrFields: v.includes("CODE") ? v : ["CODE", ...v] })), "CODE")}
                    </div>
                    <div>
                      <div className="adm-title mb-2">รูปแบบที่ 1 • ข้อความใต้ QR (บรรทัดแรกตัวหนา)</div>
                      {orderList(l.qrLabel, data.qrFields, (v) => edit((x) => ({ ...x, qrLabel: v })))}
                    </div>
                    {!data.hasQrFields && <div className="text-xs font-bold text-warning">ฐานข้อมูลยังไม่รองรับรูปแบบ QR แบบกำหนดเอง (Update_20261017b.sql)</div>}
                  </div>
                  {/* ตัวอย่างป้าย QR */}
                  <div className="adm-box">
                    <div className="adm-title mb-3">PREVIEW</div>
                    <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-[0_10px_24px_-14px_rgb(55_48_107/0.45)]">
                      <QrImage text={l.qrFields.map((k) => (k === "CODE" ? "A250-00017" : k === "NAME" ? "SAMPLE NAME" : k)).join("|")} size={140} />
                    </div>
                    <div className="mt-3 text-center text-sm">
                      {l.qrLabel.map((k, i) => (
                        <div key={k} className={i === 0 ? "font-extrabold text-[#1f2350]" : "font-semibold text-ink-soft"}>
                          {labelOf(data.qrFields, k)}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 break-all rounded-lg bg-surface-2 px-2 py-1.5 text-center font-mono text-[10px] text-ink-soft">{l.qrFields.map((k) => labelOf(data.qrFields, k)).join(" | ")}</div>
                  </div>
                </div>
              )}
            </div>
          )}
              </>
            )}
          </div>
          <div className="adm-foot">{foot}</div>
        </section>
      </div>
    </Modal>
  );
}
