"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { ActionMenu } from "@/components/menus/ActionMenu";
import { DateField } from "@/components/forms/DateField";
import { DateRange } from "@/components/forms/DateRange";
import { GroupRow, useCollapsed } from "@/components/tables/GroupRow";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { QrImage } from "@/components/print/QrImage";
import { type CardOpts, type Layout, LAYOUTS, LayoutOption, SheetPreview, Sheets, fitTexts, makePdf } from "@/components/print/PickSheets";
import { api, download } from "@/lib/api";
import { isoDate, today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { useLive } from "@/lib/live";

type PickCard = {
  ticketNo: string;
  itemNo: string;
  groupCode: string;
  materialCode: string;
  workOrder: string;
  lotNo: string;
  jobName: string;
  qty: number;
  ticketDate: string | null;
  productName: string;
  unit: string;
  fgName: string;
  printedBy: string | null;
  printedDate: string | null;
  printCount: number;
  lastPrintedBy: string | null;
  lastPrintedDate: string | null;
};

const LAYOUT_KEY = "picklist-layout";
const HISTORY_MONTHS = 2;

const qtyNum = (q: number) => Number(q.toFixed(2)).toString();
const qtyText = (c: PickCard) => `${qtyNum(c.qty)} ${c.unit ?? ""}`.trim();
const keyOf = (c: PickCard) => `${c.ticketNo}|${c.itemNo}`;
const pickCard = (c: PickCard, o: CardOpts) => <PickCardView c={c} {...o} />;
// QR เดียวกับ PackingCardModel.QrText: TicketNo | MaterialCode | WorkOrder | LotNo | JobName | Qty (หน้าสแกนอ่านได้)
const qrText = (c: PickCard) => `${c.ticketNo} | ${c.materialCode} | ${c.workOrder ?? ""} | ${c.lotNo ?? ""} | ${c.jobName ?? ""} | ${qtyNum(c.qty)}`;
// ปี ค.ศ. เสมอ (dd-MM-yyyy) ตรงกับการ์ด WPF
const d = (s: string | null) => {
  if (!s) return "";
  const x = new Date(s);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
};
const stamp = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shift = (iso: string, n: number) => {
  const [y, m, dd] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, dd + n));
};
const minDate = () => {
  const x = new Date();
  x.setMonth(x.getMonth() - HISTORY_MONTHS);
  return isoDate(x);
};

// 📦 PICK LIST (PackingCardView): ERP 192.168.10.10 อ่านอย่างเดียว -> การ์ดเบิก + QR / พิมพ์ A4 · ฉลาก / Export Excel
//   บันทึกเฉพาะประวัติการพิมพ์ใน CHR-Nexus (Nexus.PickListPrintLogs) - ไม่เขียนอะไรกลับ ERP
export default function PickListPage() {
  const toast = useToast();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<PickCard[] | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [preview, setPreview] = useState<PickCard | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [printOpen, setPrintOpen] = useState(false); // หน้าต่าง PREVIEW (เลือกรูปแบบ + ดูแผ่นจริง) ก่อน PRINT / EXPORT PDF
  const [layout, setLayout] = useState<Layout>("A4-10");
  const [printing, setPrinting] = useState<{ items: PickCard[]; layout: Layout; mode: "print" | "pdf" } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [collapsed, toggleGroup] = useCollapsed();
  const printRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"DAY" | "RANGE">("DAY");
  const k = useDebounced(key, 250);

  // เลือกวันเดียว = FROM / TO เป็นวันนั้น (ไม่เกินย้อนหลัง 2 เดือน / ไม่เกินวันนี้)
  function setDay(v: string) {
    const m = minDate();
    const x = v < m ? m : v > today() ? today() : v;
    setFrom(x);
    setTo(x);
    setSel([]);
  }

  useEffect(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY) as Layout | null;
      if (v && LAYOUTS.some((l) => l.key === v)) queueMicrotask(() => setLayout(v));
    } catch {
      /* ไม่มี storage = ใช้ค่าเริ่มต้น */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api<{ source: string; rows: PickCard[] }>("/picklist", { query: { from, to } });
      setRows(r.rows);
      setSource(r.source);
      setError(null);
    } catch (e) {
      setRows((x) => x ?? []);
      setError((e as Error).message);
    }
  }, [from, to]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  // ⚡ อัพเดททันทีเมื่อมีการพิมพ์ / บันทึก + เช็คเองทุก 15 วินาที (รายการใหม่จาก ERP)
  useLive(["data"], load, 15000);

  const shown = useMemo(() => {
    const q = k.trim().toLowerCase();
    const list = rows ?? [];
    return q ? list.filter((c) => [c.ticketNo, c.materialCode, c.productName, c.workOrder, c.lotNo, c.jobName, c.groupCode, c.fgName].some((v) => (v ?? "").toLowerCase().includes(q))) : list;
  }, [rows, k]);
  const groups = useMemo(() => {
    const m = new Map<string, PickCard[]>();
    for (const c of shown) {
      const g = c.groupCode || "-";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()].map(([key, items]) => ({ key, items }));
  }, [shown]);
  const picked = shown.filter((c) => sel.includes(keyOf(c)));
  const printedN = shown.filter((c) => c.printedDate).length;
  const allSel = shown.length > 0 && shown.every((c) => sel.includes(keyOf(c)));
  const cur = preview ?? picked[0] ?? null;

  function choose(c: PickCard) {
    setPreview(c);
    if (window.innerWidth < 1024) setMobilePreview(true);
  }

  function pickLayout(v: Layout) {
    setLayout(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      /* ไม่จำก็พิมพ์ได้ */
    }
  }

  async function exportExcel() {
    if (picked.length === 0) return toast.show("WARNING", "กรุณาติ๊กเลือกรายการที่ต้องการ Export อย่างน้อย 1 รายการครับ", "warn");
    setExporting(true);
    try {
      await download("/picklist/export", undefined, picked);
      toast.show("EXPORT", `ส่งออก ${picked.length} รายการแล้ว`, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setExporting(false);
    }
  }

  function print() {
    setPrintOpen(false);
    setPrinting({ items: picked, layout, mode: "print" });
  }

  // ⬇ EXPORT PDF: วาดแผ่นเดียวกับที่พิมพ์ (A4 / ฉลาก 62 × 40) แล้วแปลงเป็น PDF ในเครื่อง - ไม่บันทึกว่าพิมพ์แล้ว
  function exportPdf() {
    setPrintOpen(false);
    setPrinting({ items: picked, layout, mode: "pdf" });
  }

  function openPreview() {
    if (picked.length === 0) return toast.show("WARNING", "กรุณาติ๊กเลือกรายการที่ต้องการพิมพ์ / Export PDF ก่อนครับ", "warn");
    setPrintOpen(true);
  }

  // วาดการ์ด + QR ครบแล้วค่อยสั่งพิมพ์ -> บันทึกประวัติการพิมพ์ (CHR-Nexus) หลังปิดหน้าต่างพิมพ์
  useLayoutEffect(() => {
    if (!printing) return;
    let done = false;
    const go = async () => {
      if (done) return;
      done = true;
      fitTexts(printRef.current);
      if (printing.mode === "pdf") {
        try {
          const n = await makePdf(printRef.current!, printing.layout === "LABEL", "PICKLIST");
          toast.show("EXPORT PDF", `บันทึกไฟล์ ${n} แล้ว (${printing.items.length} การ์ด)`, "ok");
        } catch (e) {
          toast.show("ERROR", "สร้าง PDF ไม่สำเร็จ\n" + (e as Error).message, "error");
        } finally {
          setPrinting(null);
        }
        return;
      }
      window.print();
      const items = printing.items;
      setPrinting(null);
      try {
        const r = await api<{ saved: number; fails: string[] }>("/picklist/printed", { method: "POST", body: items });
        if (r.fails.length) toast.show("WARNING", `พิมพ์แล้ว แต่บันทึกประวัติไม่สำเร็จ ${r.fails.length} รายการ\n${r.fails.slice(0, 3).join("\n")}`, "warn");
        else toast.show("PRINT", `บันทึกการพิมพ์ ${r.saved} ใบแล้ว`, "ok");
        setSel([]);
        load();
      } catch (e) {
        toast.show("ERROR", (e as Error).message, "error");
      }
    };
    // รอ QR (สร้างแบบ async) ทุกใบ หรือไม่เกิน 3 วินาที
    const started = Date.now();
    const tick = setInterval(() => {
      const box = printRef.current;
      const ready = box && box.querySelectorAll("img.pk-qr-img").length >= printing.items.length;
      const logos = box ? [...box.querySelectorAll<HTMLImageElement>("img.pk-logo")].every((i) => i.complete) : false;
      if ((ready && logos) || Date.now() - started > 3000) {
        clearInterval(tick);
        go();
      }
    }, 80);
    return () => clearInterval(tick);
  }, [printing, load, toast]);

  const L = LAYOUTS.find((l) => l.key === (printing?.layout ?? layout))!;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/PickList.png"
        title="PICK LIST"
        subtitle={`${shown.length.toLocaleString()} ITEM(S) • SOURCE: ${source || "-"}`}
        actions={
          <ActionMenu
            caption={["PICK LIST", "EXPORT · PRINT"]}
            label="เมนู Pick List"
            actions={[
              {
                key: "select",
                title: "SELECT NOT PRINTED",
                detail: "ติ๊กเลือกทุกรายการที่ยังไม่เคยพิมพ์ (ตามคำค้นหา / ช่วงวันที่ที่แสดงอยู่)",
                color: "#f59e0b",
                icon: "check" as const,
                disabled: shown.length === printedN,
                onClick: () => setSel(shown.filter((c) => !c.printedDate).map(keyOf)),
              },
              {
                key: "export",
                title: `EXPORT EXCEL${picked.length ? ` (${picked.length})` : ""}`,
                detail: "ส่งออกรายการที่ติ๊กไว้เป็นไฟล์ Excel (BILL / PD CODE / QTY / WORK ORDER / LOT / ประวัติการพิมพ์)",
                color: "#16a34a",
                icon: "export" as const,
                busy: exporting,
                onClick: exportExcel,
              },
              {
                key: "pdf",
                title: `EXPORT PDF${picked.length ? ` (${picked.length})` : ""}`,
                detail: "ดูตัวอย่างแผ่นจริงก่อน แล้วบันทึกเป็นไฟล์ PDF (A4 10 / 12 / 14 / 21 ใบต่อแผ่น หรือฉลาก 62 × 40 mm) - ไม่นับเป็นการพิมพ์",
                color: "#e11d48",
                icon: "export" as const,
                busy: printing?.mode === "pdf",
                onClick: openPreview,
              },
              {
                key: "print",
                title: `PRINT${picked.length ? ` (${picked.length})` : ""}`,
                detail: "ดูตัวอย่างแผ่นจริงก่อนพิมพ์: A4 10 / 12 / 14 / 21 ใบต่อแผ่น หรือฉลาก 62 × 40 mm - บันทึกว่าใครพิมพ์ เมื่อไหร่",
                color: "#6750a4",
                icon: "print" as const,
                onClick: openPreview,
              },
            ]}
          />
        }
      />

      {error ? (
        <div className="pk-note is-error">
          <span className="pk-dot" />
          <span>{error}</span>
        </div>
      ) : source === "CHR-Nexus" ? (
        <div className="pk-note">
          <span className="pk-dot" />
          <span>
            🔒 ยังไม่ได้ตั้งค่าการอ่านข้อมูลจาก ERP (192.168.10.10 อ่านอย่างเดียว) — รายการด้านล่างมาจากประวัติการพิมพ์ใน CHR-Nexus (ดู / พิมพ์ซ้ำ / Export ได้)
          </span>
        </div>
      ) : null}

      {/* ด้านบนแบบ WPF: ค้นหา + ประวัติย้อนหลัง (ซ้าย) · พรีวิวการ์ด (ขวา) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="SEARCH" bodyClass="grid content-start gap-4 p-4 md:p-5" clip={false}>
          <SearchBox fancy value={key} onChange={setKey} placeholder="ค้นหา BILL / PD CODE / PRODUCT / WORK ORDER / LOT / PART NAME" />
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-accent">
              🕘 HISTORY <span className="font-bold text-ink-soft">(BACK {HISTORY_MONTHS} MONTHS)</span>
            </div>
            {/* 📅 DAY = เลือกวันไหน แสดงเฉพาะวันนั้น (‹ › เลื่อนทีละวัน) · RANGE = ช่วงวันที่ */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="pk-seg" role="tablist">
                {(["DAY", "RANGE"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : ""} onClick={() => (setMode(m), m === "DAY" && from !== to && setDay(from))}>
                    {m}
                  </button>
                ))}
              </div>
              {mode === "DAY" ? (
                <>
                  <button type="button" className="pk-step" disabled={from <= minDate()} onClick={() => setDay(shift(from, -1))} aria-label="วันก่อนหน้า">
                    ‹
                  </button>
                  <DateField label="DATE" value={from} onChange={setDay} className="w-[190px]" />
                  <button type="button" className="pk-step" disabled={from >= today()} onClick={() => setDay(shift(from, 1))} aria-label="วันถัดไป">
                    ›
                  </button>
                </>
              ) : (
                <DateRange
                  from={from}
                  to={to}
                  quick={false}
                  onChange={(f, t) => {
                    const m = minDate();
                    setFrom(f < m ? m : f);
                    setTo(t < m ? m : t);
                    setSel([]);
                  }}
                />
              )}
              <button className="btn-ghost" disabled={from === today() && to === today()} onClick={() => setDay(today())}>
                TODAY
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PkStat label="ITEMS" value={shown.length} tone="var(--primary)" />
            <PkStat label="PRINTED" value={printedN} tone="var(--success)" />
            <PkStat label="NOT YET" value={shown.length - printedN} tone="var(--warning)" />
            <PkStat label="SELECTED" value={picked.length} tone="var(--accent)" />
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-ink-soft">
            <span className={`pk-src ${source === "ERP" ? "is-live" : ""}`} />
            {source === "ERP" ? "ERP 192.168.10.10 • READ ONLY • อัพเดททุก 15 วินาที" : source ? "CHR-Nexus • PRINT HISTORY" : "LOADING..."}
          </div>
        </Card>

        <Card title="LABEL PREVIEW" bodyClass="grid place-items-center p-4 md:p-5">
          {cur ? (
            <div className="pk-preview">
              <PickCardView c={cur} />
            </div>
          ) : (
            <div className="pk-preview is-empty">
              <PickCardView c={null} />
              <div className="pk-empty-tip">คลิกแถวในตารางเพื่อดูการ์ด</div>
            </div>
          )}
        </Card>
      </div>

      <Card title={`PICK LIST • ${shown.length.toLocaleString()}`} actions={sel.length > 0 && <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setSel([])}>CLEAR SELECTION ({picked.length})</button>}>
        <div className="max-h-[calc(100dvh-240px)] min-h-[360px] overflow-auto">
          {!rows ? (
            <Loading />
          ) : shown.length === 0 ? (
            <Empty>{error ? "อ่านข้อมูลไม่สำเร็จ" : "ไม่มีรายการในช่วงวันที่นี้"}</Empty>
          ) : (
            <table className="data-table t-center w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>
                    <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? shown.map(keyOf) : [])} />
                  </th>
                  <th>BILL NO.</th>
                  <th>GROUP</th>
                  <th>PD CODE</th>
                  <th>PRODUCT NAME</th>
                  <th>QTY</th>
                  <th>WORKORDER</th>
                  <th>LOT</th>
                  <th>PART NAME</th>
                  <th>PRINTED</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <GroupRow colSpan={10} label="GROUP" value={g.key} count={g.items.length} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)} />
                    {!collapsed.has(g.key) &&
                      g.items.map((c) => {
                        const on = sel.includes(keyOf(c));
                        return (
                          <tr key={keyOf(c)} onClick={() => choose(c)} className={`cursor-pointer ${cur && keyOf(cur) === keyOf(c) ? "bg-accent-soft/40" : on ? "bg-accent-soft/20" : ""}`}>
                            <td onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={on} onChange={(e) => (setSel((s) => (e.target.checked ? [...s, keyOf(c)] : s.filter((x) => x !== keyOf(c)))), setPreview(c))} />
                            </td>
                            <td className="whitespace-nowrap font-extrabold text-primary">{c.ticketNo}</td>
                            <td>{c.groupCode}</td>
                            <td className="whitespace-nowrap">{c.materialCode}</td>
                            <td className="min-w-[170px]">{c.productName}</td>
                            <td className="whitespace-nowrap">
                              {qtyNum(c.qty)} <span className="text-[11px] text-ink-soft">{c.unit}</span>
                            </td>
                            <td className="whitespace-nowrap">{c.workOrder}</td>
                            <td>{c.lotNo}</td>
                            <td className="min-w-[170px]">{c.fgName}</td>
                            <td className="min-w-[150px] text-xs">
                              {c.printedDate ? (
                                <>
                                  <div className="font-bold text-success">
                                    {stamp(c.printedDate)} {c.printedBy}
                                  </div>
                                  {c.printCount > 1 && c.lastPrintedDate && (
                                    <div className="font-semibold text-[#e65100]">
                                      ×{c.printCount} • {stamp(c.lastPrintedDate)} {c.lastPrintedBy}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <Badge color="var(--warning)">NOT YET</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* 📱 จอเล็ก: กดแถว = ดูการ์ดในหน้าต่าง */}
      <Modal open={mobilePreview && !!preview} title="LABEL PREVIEW" onClose={() => setMobilePreview(false)}>
        {preview && (
          <div className="pk-preview mx-auto">
            <PickCardView c={preview} />
          </div>
        )}
      </Modal>

      {/* 🖨 PREVIEW: เลือกรูปแบบ + ดูแผ่นจริง (ย่อพอดีจอทุกขนาด) แล้ว PRINT / EXPORT PDF */}
      <Modal
        open={printOpen}
        size="xl"
        title={`🖨 PRINT / PDF PREVIEW • ${picked.length} CARD(S)`}
        onClose={() => setPrintOpen(false)}
        footer={
          <>
            <button className="fill-btn mr-auto" onClick={() => setPrintOpen(false)}>
              CANCEL
            </button>
            <button className="cta-btn is-red" onClick={exportPdf} disabled={!!printing}>
              ⬇ EXPORT PDF
            </button>
            <button className="cta-btn is-purple" onClick={print} disabled={!!printing}>
              🖨 PRINT
            </button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">A4 LAYOUT • เครื่องพิมพ์ทั่วไป</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {LAYOUTS.filter((l) => l.key !== "LABEL").map((l) => (
                <LayoutOption key={l.key} l={l} on={layout === l.key} count={picked.length} onPick={() => pickLayout(l.key)} />
              ))}
            </div>
            <div className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">LABEL • เครื่องพิมพ์ฉลาก 62 mm</div>
            <LayoutOption l={LAYOUTS[4]} on={layout === "LABEL"} count={picked.length} onPick={() => pickLayout("LABEL")} />
            <p className="mt-1 text-xs font-semibold text-ink-soft">PRINT: ตั้ง Margins = None / Scale = 100% และปิด Headers and footers · PDF: บันทึกไฟล์ลงเครื่องได้เลย</p>
          </div>
          {printOpen && <SheetPreview items={picked} layout={layout} keyOf={keyOf} card={pickCard} foot="PICK LIST" />}
        </div>
      </Modal>

      {printing &&
        createPortal(
          <div id="print-area" ref={printRef} className={L.key === "LABEL" ? "pk-print-label" : "pk-print-a4"}>
            <Sheets items={printing.items} layout={L.key} keyOf={keyOf} card={pickCard} foot="PICK LIST" />
            <style>{`
              #print-area { position: fixed; left: -10000px; top: 0; }
              @media print {
                body > *:not(#print-area) { display: none !important; }
                #print-area { position: static; left: auto; }
                @page { size: ${L.key === "LABEL" ? "62mm 40mm" : "A4 portrait"}; margin: 0; }
              }
            `}</style>
          </div>,
          document.body,
        )}
    </PageBody>
  );
}

function PkStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="pk-stat" style={{ "--c": tone } as React.CSSProperties}>
      <span>{label}</span>
      <b>{value.toLocaleString()}</b>
    </div>
  );
}

// การ์ดเบิกแบบ WPF (BuildA4Card / พรีวิว): โลโก้บริษัท + QR มุมขวาบน / Bill-Group · Product Code · Product Name · Work Order-LOT · Part Name · Quantity-TicketDate
//   ป้ายตัวหนา + ค่าบนเส้นใต้ · a4 = เต็มช่องของแผ่น A4 (ความสูงแถวตามสัดส่วน) · label = ฉลาก 62 × 40 mm (ไม่มี Product Code / Name แบบฉลากเดิม)
function PickCardView({ c, s, qrMm, logoMm, a4, label }: { c: PickCard | null; s?: number; qrMm?: number; logoMm?: number; a4?: boolean; label?: boolean }) {
  const v = (x: string | undefined | null) => (c ? x ?? "" : "");
  const row = (fields: [string, string][], opt: { stars?: number[]; two?: boolean; full?: boolean } = {}) => (
    <div className={`pk-row ${opt.full === false ? "" : "is-full"}`}>
      {fields.map(([l, val], i) => (
        <div key={l} className="pk-f" style={{ flex: opt.stars?.[i] ?? 1 }}>
          <span className="pk-l">{l}</span>
          <span className="pk-u">
            <span className="pk-v" data-lines={opt.two && i === fields.length - 1 ? 2 : 1}>
              {val}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
  const style = { ...(s ? { "--s": s } : {}), ...(qrMm ? { "--qr": `${qrMm}mm` } : {}), ...(logoMm ? { "--logo": `${logoMm}mm` } : {}) } as React.CSSProperties;
  return (
    <div className={`pk-card ${a4 ? "is-a4" : ""} ${label ? "is-label" : ""}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/picklist/ch-logo.png" alt="CH. RADIATORS CO.,LTD." className="pk-logo" draggable={false} />
      <div className="pk-qr">{c ? <QrImage text={qrText(c)} size={label ? 64 : 96} className="pk-qr-img" /> : <span className="pk-qr-empty" />}</div>
      <div className="pk-div" />
      {row([["Bill", v(c?.ticketNo)], ["Group", v(c?.groupCode)]], { stars: [1.8, 1], full: !!label })}
      {!label && row([["Product Code", v(c?.materialCode)]])}
      {!label && row([["Product Name", v(c?.productName)]], { two: true })}
      {row([["Work Order", v(c?.workOrder)], ["LOT NO.", v(c?.lotNo)]], { stars: [1.8, 1] })}
      {row([["Part Name", v(c?.fgName)]], { two: true })}
      {row([["Quantity", c ? qtyText(c) : ""], ["TicketDate", c ? d(c.ticketDate) : ""]])}
    </div>
  );
}
