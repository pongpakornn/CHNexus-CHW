"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { QrImage } from "@/components/ui/QrImage";
import { type CardOpts, type Layout, LAYOUTS, LayoutOption, SheetPreview, Sheets, fitTexts, makePdf } from "@/components/print/PickSheets";
import { api } from "@/lib/api";

// ▣ EXPORT QR › PICKING: การ์ดรูปแบบ Pick List ของสินค้า (Inventory Registration)
//   Bill -> RUNNING (ตัวอักษรนำหน้า 0-2 ตัว + เลขรัน เช่น A0001) · Group เหมือนเดิม (ตามการจัดกลุ่มของตาราง)
//   Work Order -> PART A (ขึ้นไปบรรทัดบน) + CUSTOMER บรรทัดเดียวกัน · Product Code -> PART NO. · Product Name เหมือนเดิม
//   ตัด LOT NO. / Part Name · Production date / Inspection date / Delivery date = เว้นว่างไว้เขียนมือ · Quantity / Packsize + หน่วย
//   QR = รูปแบบ QR ที่ตั้งไว้ของคลัง (ADMIN > QR CODE) · LOGO เลือก CHR / CHW
export type PickingReq = { mode: "SELECTED" | "ALL"; ids: number[]; stkId: number | null; stockName: string };

type Row = { ptId: number; code: string; partNo: string; name: string; partA: string; customer: string; packSize: string; group: string; qr: string };
type Card = Row & { run: string; qty: string; logo: Logo };

// โลโก้บนการ์ด: CHR = ซีเอช เรดิเอเตอร์ (ตัวเดิมของ Pick List) · CHW = ซีเอชวัฒนายนต์
type Logo = "CHR" | "CHW";
const LOGOS: { key: Logo; src: string; alt: string }[] = [
  { key: "CHR", src: "/images/picklist/ch-logo.png", alt: "CH. RADIATORS CO.,LTD." },
  { key: "CHW", src: "/images/picklist/chw-logo.png", alt: "CH WATANAYONT CO.,LTD." },
];
const logoKey = (stkId: number | null) => `picking-logo-${stkId ?? 0}`;

const LAYOUT_KEY = "picking-layout";
const runKey = (stkId: number | null) => `picking-run-${stkId ?? 0}`;
const keyOf = (c: Card) => `${c.ptId}|${c.run}`;
const pickingCard = (c: Card, o: CardOpts) => <PickingCardView c={c} {...o} />;

// ตัวอักษรนำหน้า 0-2 ตัว (A-Z) / เลขเริ่ม 1-8 หลัก
const cleanPrefix = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
const cleanStart = (v: string) => v.replace(/\D/g, "").slice(0, 8);
const runOf = (prefix: string, start: string, i: number) => {
  const digits = start || "0001";
  return prefix + String(Number(digits) + i).padStart(digits.length, "0");
};

function readJson<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ไม่มี storage = ไม่จำ */
  }
}

export function PickingExport({ req, onClose }: { req: PickingReq | null; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ unit: string; units: string[]; items: Row[] } | null>(null);
  const [layout, setLayout] = useState<Layout>("A4-10");
  const [prefix, setPrefix] = useState("A");
  const [start, setStart] = useState("0001");
  const [unit, setUnit] = useState("");
  const [logo, setLogo] = useState<Logo>("CHR");
  const [printing, setPrinting] = useState<{ items: Card[]; layout: Layout; mode: "print" | "pdf" } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // เปิดหน้าต่าง: โหลดข้อมูลการ์ด + รูปแบบ / RUNNING ล่าสุดของคลังนี้ (จำในเครื่อง)
  useEffect(() => {
    if (!req) return;
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setData(null);
      const l = readJson<Layout>(LAYOUT_KEY);
      if (l && LAYOUTS.some((x) => x.key === l)) setLayout(l);
      const r = readJson<{ prefix: string; next: string }>(runKey(req.stkId));
      setPrefix(r ? cleanPrefix(r.prefix ?? "") : "A");
      setStart(r?.next ? cleanStart(r.next) : "0001");
      // โลโก้ที่เลือกล่าสุดของคลังนี้ · ยังไม่เคยเลือก = คลังชื่อมี CHW ใช้ CHW นอกนั้น CHR
      const lg = readJson<Logo>(logoKey(req.stkId));
      setLogo(lg === "CHR" || lg === "CHW" ? lg : /CHW/i.test(req.stockName) ? "CHW" : "CHR");
    });
    api<{ unit: string; units: string[]; items: Row[] }>("/products/picking", { method: "POST", body: req })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setUnit(d.unit || "");
      })
      .catch((e) => {
        if (!alive) return;
        toast.show("ERROR", "โหลดข้อมูล PICKING ไม่สำเร็จ\n" + (e as Error).message, "error");
        onClose();
      });
    return () => {
      alive = false;
    };
  }, [req, toast, onClose]);

  const cards = useMemo<Card[]>(
    () =>
      (data?.items ?? []).map((r, i) => ({
        ...r,
        run: runOf(prefix, start, i),
        qty: r.packSize ? `${r.packSize} ${unit}`.trim() : "",
        logo,
      })),
    [data, prefix, start, unit, logo],
  );

  function pickLayout(v: Layout) {
    setLayout(v);
    writeJson(LAYOUT_KEY, v);
  }

  function go(mode: "print" | "pdf") {
    if (cards.length === 0) return;
    setPrinting({ items: cards, layout, mode });
  }

  // วาดการ์ด + QR ครบแล้วค่อยพิมพ์ / แปลง PDF -> จำเลขถัดไป + ลง Activity Log
  useLayoutEffect(() => {
    if (!printing || !req) return;
    let done = false;
    const finish = () => {
      const digits = start || "0001";
      writeJson(runKey(req.stkId), { prefix, next: String(Number(digits) + printing.items.length).padStart(digits.length, "0") });
      const first = printing.items[0]?.run ?? "";
      const last = printing.items[printing.items.length - 1]?.run ?? "";
      api("/products/picking/log", {
        method: "POST",
        body: { mode: req.mode, ids: printing.items.map((c) => c.ptId), stkId: req.stkId, stockName: req.stockName, layout: `${printing.mode.toUpperCase()} ${printing.layout}`, running: `${first} - ${last}` },
      }).catch(() => {});
    };
    const run = async () => {
      if (done) return;
      done = true;
      fitTexts(printRef.current);
      if (printing.mode === "pdf") {
        try {
          const n = await makePdf(printRef.current!, printing.layout === "LABEL", "PICKING");
          toast.show("EXPORT PDF", `บันทึกไฟล์ ${n} แล้ว (${printing.items.length} การ์ด)`, "ok");
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
      toast.show("PRINT", `ส่งพิมพ์ ${printing.items.length} การ์ดแล้ว`, "ok");
    };
    // รอ QR (สร้างแบบ async) ทุกใบ หรือไม่เกิน 3 วินาที
    const started = Date.now();
    const tick = setInterval(() => {
      const box = printRef.current;
      const ready = box && box.querySelectorAll("img.pk-qr-img").length >= printing.items.length;
      const logos = box ? [...box.querySelectorAll<HTMLImageElement>("img.pk-logo")].every((i) => i.complete) : false;
      if ((ready && logos) || Date.now() - started > 3000) {
        clearInterval(tick);
        run();
      }
    }, 80);
    return () => clearInterval(tick);
  }, [printing, req, prefix, start, toast, onClose]);

  const L = LAYOUTS.find((l) => l.key === (printing?.layout ?? layout))!;
  const n = cards.length;
  const firstRun = n ? cards[0].run : runOf(prefix, start, 0);
  const lastRun = n ? cards[n - 1].run : "";

  return (
    <>
      <Modal
        open={!!req}
        size="xl"
        title={`▣ PICKING • ${req?.stockName ?? ""} • ${n.toLocaleString()} CARD(S)`}
        onClose={onClose}
        footer={
          <>
            <button className="fill-btn mr-auto" onClick={onClose}>
              CANCEL
            </button>
            <button className="cta-btn is-red" onClick={() => go("pdf")} disabled={!!printing || n === 0}>
              ⬇ EXPORT PDF
            </button>
            <button className="cta-btn is-purple" onClick={() => go("print")} disabled={!!printing || n === 0}>
              🖨 PRINT
            </button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">LOGO</div>
            <div className="grid grid-cols-2 gap-2">
              {LOGOS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  title={l.alt}
                  className={`pk-opt !p-2 ${logo === l.key ? "is-on" : ""}`}
                  onClick={() => {
                    setLogo(l.key);
                    if (req) writeJson(logoKey(req.stkId), l.key);
                  }}
                >
                  <span className="grid w-full gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.src} alt={l.alt} className="h-7 w-full object-contain" draggable={false} />
                    <b className="text-center text-[12px] font-black text-primary">{l.key}</b>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">RUNNING (แทน BILL)</div>
            <div className="flex items-end gap-2">
              <label className="grid gap-1 text-[10px] font-extrabold text-ink-soft">
                PREFIX
                <input
                  className="field !h-9 !w-[72px] text-center font-mono text-sm"
                  placeholder="A"
                  maxLength={2}
                  value={prefix}
                  title="ตัวอักษรนำหน้า 0-2 ตัว เช่น A / AB (ว่าง = เลขอย่างเดียว)"
                  onChange={(e) => setPrefix(cleanPrefix(e.target.value))}
                />
              </label>
              <label className="grid gap-1 text-[10px] font-extrabold text-ink-soft">
                START
                <input
                  className="field !h-9 !w-[110px] text-center font-mono text-sm"
                  placeholder="0001"
                  inputMode="numeric"
                  maxLength={8}
                  value={start}
                  title="เลขเริ่ม (จำนวนหลักตามที่กรอก เช่น 0001 = 4 หลัก)"
                  onChange={(e) => setStart(cleanStart(e.target.value))}
                />
              </label>
              <label className="grid gap-1 text-[10px] font-extrabold text-ink-soft">
                UNIT
                <input
                  className="field !h-9 !w-[90px] text-center font-mono text-sm"
                  list="picking-units"
                  placeholder="PCS"
                  maxLength={20}
                  value={unit}
                  title="หน่วยของ PACKSIZE (ค่าเริ่ม = หน่วยของคลัง)"
                  onChange={(e) => setUnit(e.target.value.toUpperCase())}
                />
                <datalist id="picking-units">
                  {(data?.units ?? []).map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </label>
            </div>
            <div className="font-mono text-[12px] font-bold text-accent">
              {n ? `${firstRun} → ${lastRun}` : firstRun}
              <span className="ml-2 font-sans text-[10.5px] font-semibold text-ink-soft">(ครั้งถัดไปเริ่มต่อจากเลขสุดท้ายให้เอง)</span>
            </div>

            <div className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">A4 LAYOUT • เครื่องพิมพ์ทั่วไป</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {LAYOUTS.filter((l) => l.key !== "LABEL").map((l) => (
                <LayoutOption key={l.key} l={l} on={layout === l.key} count={n} onPick={() => pickLayout(l.key)} />
              ))}
            </div>
            <div className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">LABEL • เครื่องพิมพ์ฉลาก 62 mm</div>
            <LayoutOption l={LAYOUTS[4]} on={layout === "LABEL"} count={n} onPick={() => pickLayout("LABEL")} />
            <p className="mt-1 text-xs font-semibold text-ink-soft">PRINT: ตั้ง Margins = None / Scale = 100% และปิด Headers and footers · PDF: บันทึกไฟล์ลงเครื่องได้เลย</p>
          </div>
          {req && data ? (
            <SheetPreview items={cards} layout={layout} keyOf={keyOf} card={pickingCard} foot="PICKING" />
          ) : (
            <div className="grid min-h-[300px] place-items-center text-sm font-bold text-ink-soft">กำลังโหลด…</div>
          )}
        </div>
      </Modal>

      {printing &&
        createPortal(
          <div id="print-area" ref={printRef} className={L.key === "LABEL" ? "pk-print-label" : "pk-print-a4"}>
            <Sheets items={printing.items} layout={L.key} keyOf={keyOf} card={pickingCard} foot="PICKING" />
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

// การ์ด PICKING (โครงเดียวกับการ์ด Pick List): โลโก้ + QR มุมขวาบน
//   Running-Group · Part A-Customer · Part No. · Product Name · Production date-Inspection date · Delivery date-Quantity / Packsize
function PickingCardView({ c, s, qrMm, logoMm, a4, label }: { c: Card } & CardOpts) {
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
  const lg = LOGOS.find((x) => x.key === c.logo) ?? LOGOS[0];
  const style = { ...(s ? { "--s": s } : {}), ...(qrMm ? { "--qr": `${qrMm}mm` } : {}), ...(logoMm ? { "--logo": `${logoMm}mm` } : {}) } as React.CSSProperties;
  return (
    <div className={`pk-card is-picking ${a4 ? "is-a4" : ""} ${label ? "is-label" : ""}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={lg.src} alt={lg.alt} className="pk-logo" draggable={false} />
      <div className="pk-qr">{c.qr ? <QrImage text={c.qr} size={label ? 64 : 96} className="pk-qr-img" /> : <span className="pk-qr-empty" />}</div>
      <div className="pk-div" />
      {row([["Running", c.run], ["Group", c.group]], { stars: [1.6, 1], full: !!label })}
      {row([["Part A", c.partA], ["Customer", c.customer]], { stars: [1.3, 1] })}
      {row([["Part No.", c.partNo]])}
      {row([["Product Name", c.name]], { two: !label })}
      {row([["Production date", ""], ["Inspection date", ""]])}
      {row([["Delivery date", ""], ["Quantity / Packsize", c.qty]], { stars: [1, 1.15] })}
    </div>
  );
}
