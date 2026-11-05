"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { QrImage } from "@/components/print/QrImage";
import { type CardOpts, type Layout, LAYOUTS, LayoutOption, SheetPreview, Sheets, fitTexts, makePdf } from "@/components/print/PickSheets";
import { api } from "@/lib/api";
import type { Loc } from "./types";

// ▣ EXPORT QR ตำแหน่งจัดเก็บ: โลโก้ CHR + QR (ข้อมูลตามรูปแบบที่ตั้ง) + ป้าย "RACK1 : 3A" ใต้ QR
//   A4 หลายดวงต่อแผ่น (ตัดตามเส้นประ) หรือฉลาก 62 × 40 mm · PDF / PRINT · ลง Activity Log
const LAYOUT_KEY = "layout-qr-layout";
// ขนาด QR ต่อรูปแบบแผ่น (mm) - ช่องใหญ่ = QR ใหญ่ สแกนจากไกลได้
const QR_MM: Record<Layout, number> = { "A4-10": 38, "A4-12": 32, "A4-14": 27, "A4-21": 24, LABEL: 31 };
const keyOf = (c: Loc) => String(c.locId);
function card(lay: Layout) {
  return function layoutCard(c: Loc, o: CardOpts) {
    return <LayoutQrCard c={c} qrMm={QR_MM[lay]} label={!!o.label} />;
  };
}

function read(): Layout | null {
  try {
    const v = localStorage.getItem(LAYOUT_KEY) as Layout | null;
    return v && LAYOUTS.some((l) => l.key === v) ? v : null;
  } catch {
    return null;
  }
}

export function LayoutExport({ items, onClose }: { items: Loc[] | null; onClose: () => void }) {
  const toast = useToast();
  const [layout, setLayout] = useState<Layout>("A4-12");
  const [printing, setPrinting] = useState<{ items: Loc[]; layout: Layout; mode: "print" | "pdf" } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!items) return;
    const l = read();
    if (l) queueMicrotask(() => setLayout(l));
  }, [items]);

  const pick = (v: Layout) => {
    setLayout(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      /* ไม่จำก็ได้ */
    }
  };

  useLayoutEffect(() => {
    if (!printing) return;
    let done = false;
    const finish = () => api("/layout/qr-log", { method: "POST", body: { ids: printing.items.map((c) => c.locId), mode: `${printing.mode} ${printing.layout}` } }).catch(() => {});
    const run = async () => {
      if (done) return;
      done = true;
      fitTexts(printRef.current);
      if (printing.mode === "pdf") {
        try {
          const n = await makePdf(printRef.current!, printing.layout === "LABEL", "LAYOUT_QR");
          toast.show("EXPORT PDF", `บันทึกไฟล์ ${n} แล้ว (${printing.items.length} QR)`, "ok");
          finish();
          onClose();
        } catch (e) {
          toast.show("ERROR", "สร้าง PDF ไม่สำเร็จ\n" + (e as Error).message, "error");
        } finally {
          setPrinting(null);
        }
        return;
      }
      window.print();
      setPrinting(null);
      finish();
      onClose();
      toast.show("PRINT", `ส่งพิมพ์ ${printing.items.length} QR แล้ว`, "ok");
    };
    // รอ QR (สร้างแบบ async) ครบทุกดวง + โลโก้ หรือไม่เกิน 3 วินาที
    const started = Date.now();
    const tick = setInterval(() => {
      const box = printRef.current;
      const ready = box && box.querySelectorAll("img.lo-qr-img").length >= printing.items.length;
      const logos = box ? [...box.querySelectorAll<HTMLImageElement>("img.lo-logo")].every((i) => i.complete) : false;
      if ((ready && logos) || Date.now() - started > 3000) {
        clearInterval(tick);
        run();
      }
    }, 80);
    return () => clearInterval(tick);
  }, [printing, toast, onClose]);

  const n = items?.length ?? 0;
  const L = LAYOUTS.find((l) => l.key === (printing?.layout ?? layout))!;

  return (
    <>
      <Modal
        open={!!items}
        size="xl"
        title={`▣ EXPORT QR • LAYOUT • ${n.toLocaleString()} QR`}
        onClose={onClose}
        footer={
          <>
            <button className="fill-btn mr-auto" onClick={onClose}>
              CANCEL
            </button>
            <button className="cta-btn is-red" onClick={() => items && setPrinting({ items, layout, mode: "pdf" })} disabled={!!printing || n === 0}>
              ⬇ EXPORT PDF
            </button>
            <button className="cta-btn is-purple" onClick={() => items && setPrinting({ items, layout, mode: "print" })} disabled={!!printing || n === 0}>
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
                <LayoutOption key={l.key} l={l} on={layout === l.key} count={n} onPick={() => pick(l.key)} />
              ))}
            </div>
            <div className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">LABEL • เครื่องพิมพ์ฉลาก 62 mm</div>
            <LayoutOption l={LAYOUTS[4]} on={layout === "LABEL"} count={n} onPick={() => pick("LABEL")} />
            <p className="mt-1 text-xs font-semibold text-ink-soft">PRINT: ตั้ง Margins = None / Scale = 100% และปิด Headers and footers · PDF: บันทึกไฟล์ลงเครื่องได้เลย</p>
          </div>
          {items && <SheetPreview items={items} layout={layout} keyOf={keyOf} card={card(layout)} foot="LAYOUT QR" />}
        </div>
      </Modal>

      {printing &&
        createPortal(
          <div id="print-area" ref={printRef} className={L.key === "LABEL" ? "pk-print-label" : "pk-print-a4"}>
            <Sheets items={printing.items} layout={L.key} keyOf={keyOf} card={card(L.key)} foot="LAYOUT QR" />
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
    </>
  );
}

// ดวง QR ตำแหน่ง: โลโก้ CHR + LAYOUT · QR กลาง · "RACK1 : 3A" ตัวใหญ่ใต้ QR (ฉลาก = QR ซ้าย ข้อความขวา)
function LayoutQrCard({ c, qrMm, label }: { c: Loc; qrMm: number; label: boolean }) {
  const [type, name] = c.label.split(" : ");
  return (
    <div className={`lo-card ${label ? "is-label" : ""}`} style={{ "--qr": `${qrMm}mm` } as React.CSSProperties}>
      <div className="lo-card-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/picklist/ch-logo.png" alt="CH. RADIATORS CO.,LTD." className="lo-logo" draggable={false} />
        <span>LAYOUT</span>
      </div>
      <div className="lo-card-qr">
        <QrImage text={c.qr} size={label ? 96 : 140} className="lo-qr-img" />
      </div>
      <div className="lo-card-text">
        <span className="pk-v lo-card-label" data-lines="1">
          {type} : {name}
        </span>
      </div>
    </div>
  );
}
