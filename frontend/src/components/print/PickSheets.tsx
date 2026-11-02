"use client";

import { useLayoutEffect, useRef, useState } from "react";

// 🖨 แผ่นพิมพ์การ์ดแบบ Pick List (ใช้ร่วม: PICK LIST / Inventory Registration › EXPORT QR › PICKING)
//   A4 หลายใบต่อแผ่น หรือฉลาก 62 × 40 mm · พรีวิวย่อพอดีจอ · แปลงเป็น PDF ในเครื่อง

export type CardOpts = { s?: number; qrMm?: number; logoMm?: number; a4?: boolean; label?: boolean };
export type SheetProps<T> = { items: T[]; layout: Layout; keyOf: (c: T) => string; card: (c: T, o: CardOpts) => React.ReactNode; foot: string };

// 🖨 รูปแบบพิมพ์ (หน้าต่าง SELECT PRINTER ของ WPF): A4 หลายใบต่อแผ่น (cols × rows) หรือฉลาก 62 × 40 mm (Brother QL-800)
export type Layout = "A4-10" | "A4-12" | "A4-14" | "A4-21" | "LABEL";
export const LAYOUTS: { key: Layout; title: string; hint: string; cols: number; rows: number }[] = [
  { key: "A4-10", title: "10 / PAGE", hint: "2 × 5 • large", cols: 2, rows: 5 },
  { key: "A4-12", title: "12 / PAGE", hint: "2 × 6 • medium", cols: 2, rows: 6 },
  { key: "A4-14", title: "14 / PAGE", hint: "2 × 7 • compact", cols: 2, rows: 7 },
  { key: "A4-21", title: "21 / PAGE", hint: "3 × 7 • small", cols: 3, rows: 7 },
  { key: "LABEL", title: "LABEL 62 × 40", hint: "Brother QL-800 • 1 ดวง / ใบ", cols: 1, rows: 1 },
];
// ขนาดการ์ด A4 ตามจำนวนใบต่อแผ่น (PackingCardPrintService.CardSizes): s = ตัวคูณขนาดตัวอักษร / QR mm / โลโก้ mm
export const sizes = (cols: number, rows: number) => (cols >= 3 ? { s: 0.56, qr: 13, logo: 6 } : rows >= 7 ? { s: 0.58, qr: 13.5, logo: 6.2 } : rows === 6 ? { s: 0.72, qr: 16, logo: 7.4 } : { s: 0.82, qr: 19, logo: 8.8 });

// ข้อความยาวเกินช่อง = ย่อตัวอักษรทีละนิดจนครบ (เล็กสุด 55%) แบบ FitA4Texts ของ WPF - ไม่ตัด "..."
export function fitTexts(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLElement>(".pk-v").forEach((el) => {
    el.style.fontSize = "";
    const base = parseFloat(getComputedStyle(el).fontSize);
    const lines = el.dataset.lines === "2" ? 2 : 1;
    const lh = base * 1.25;
    for (let f = base; f >= base * 0.55; f -= base * 0.04) {
      el.style.fontSize = `${f}px`;
      const fits = lines === 1 ? el.scrollWidth <= el.clientWidth + 0.5 : el.scrollHeight <= lh * (f / base) * 2 + 1;
      if (fits) break;
    }
  });
}

// แผ่นที่พิมพ์ / Export PDF: A4 (cols × rows ต่อแผ่น) หรือฉลาก 1 ดวงต่อหน้า
export function Sheets<T>({ items, layout, keyOf, card, foot }: SheetProps<T>) {
  const L = LAYOUTS.find((l) => l.key === layout)!;
  if (L.key === "LABEL")
    return (
      <>
        {items.map((c) => (
          <div key={keyOf(c)} className="pk-label-page">
            {card(c, { label: true })}
          </div>
        ))}
      </>
    );
  const per = L.cols * L.rows;
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
  const z = sizes(L.cols, L.rows);
  return (
    <>
      {pages.map((pg, pi) => (
        <div key={pi} className={`pk-page ${L.cols >= 3 ? "is-3" : ""}`}>
          <div className="pk-grid" style={{ gridTemplateColumns: `repeat(${L.cols}, 1fr)`, gridTemplateRows: `repeat(${L.rows}, 1fr)` }}>
            {Array.from({ length: per }, (_, i) => (
              <div key={i} className="pk-cell">
                {pg[i] && (
                  <div className="pk-hold" style={L.cols === 2 && L.rows >= 7 ? { width: `${(5 / L.rows) * 100}%` } : undefined}>
                    {card(pg[i], { s: z.s, qrMm: z.qr, logoMm: z.logo, a4: true })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pk-foot">
            CHR-NEXUS • {foot} • PAGE {pi + 1} / {pages.length}
          </div>
        </div>
      ))}
    </>
  );
}

// พรีวิวแผ่นจริงย่อให้พอดีความกว้างช่อง (มือถือ / แท็บเล็ต / จอใหญ่) - แสดงสูงสุด 6 หน้าแรก
const PREVIEW_MAX = 6;
export function SheetPreview<T>(props: SheetProps<T>) {
  const { items, layout } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const label = layout === "LABEL";
  const L = LAYOUTS.find((l) => l.key === layout)!;
  const per = label ? 1 : L.cols * L.rows;
  const total = Math.max(1, Math.ceil(items.length / per));
  const shown = items.slice(0, PREVIEW_MAX * per);
  const pxW = label ? 234 : 794; // 62 mm / 210 mm ที่ 96 dpi

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(label ? 2.2 : 1, (el.clientWidth - 2) / pxW));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [label, pxW]);

  useLayoutEffect(() => {
    fitTexts(box.current);
  }, [items, layout, scale]);

  return (
    <div className="pk-pv">
      <div className="pk-pv-head">
        <b>PREVIEW</b>
        <span>
          {L.title} • {total} {label ? "LABEL(S)" : "SHEET(S)"}
          {total > PREVIEW_MAX ? ` • แสดง ${PREVIEW_MAX} หน้าแรก` : ""}
        </span>
      </div>
      <div ref={box} className={`pk-pv-pages ${label ? "is-label" : ""}`} key={layout}>
        <SheetsScaled scale={scale} label={label}>
          <Sheets {...props} items={shown} />
        </SheetsScaled>
      </div>
    </div>
  );
}

// ห่อแต่ละแผ่นให้ย่อด้วย transform แต่กินพื้นที่ตามขนาดที่ย่อแล้ว
export function SheetsScaled({ scale, label, children }: { scale: number; label: boolean; children: React.ReactNode }) {
  const w = label ? 234 : 794;
  const h = label ? 151 : 1123;
  return (
    <div className="pk-pv-stack" style={{ "--pv": scale, "--pw": `${w * scale}px`, "--ph": `${h * scale}px` } as React.CSSProperties}>
      {children}
    </div>
  );
}

// แปลงแผ่นที่วาดไว้ (นอกจอ) เป็น PDF ทีละหน้า -> บันทึกไฟล์ · คืนชื่อไฟล์
export async function makePdf(root: HTMLElement, label: boolean, base = "PICKLIST") {
  const [{ jsPDF }, { toJpeg }] = await Promise.all([import("jspdf"), import("html-to-image")]);
  const pages = [...root.querySelectorAll<HTMLElement>(label ? ".pk-label-page" : ".pk-page")];
  if (pages.length === 0) throw new Error("ไม่มีหน้าให้ Export");
  const fmt: [number, number] = label ? [62, 40] : [210, 297];
  const pdf = new jsPDF({ orientation: label ? "landscape" : "portrait", unit: "mm", format: fmt, compress: true });
  for (let i = 0; i < pages.length; i++) {
    const img = await toJpeg(pages[i], { quality: 0.92, pixelRatio: label ? 5 : 2.5, backgroundColor: "#ffffff", cacheBust: false });
    if (i > 0) pdf.addPage(fmt, label ? "landscape" : "portrait");
    pdf.addImage(img, "JPEG", 0, 0, fmt[0], fmt[1]);
  }
  const t = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const name = `${base}_${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}_${p2(t.getHours())}${p2(t.getMinutes())}${label ? "_LABEL" : ""}.pdf`;
  pdf.save(name);
  return name;
}

export function LayoutOption({ l, on, count, onPick }: { l: (typeof LAYOUTS)[number]; on: boolean; count: number; onPick: () => void }) {
  const sheets = l.key === "LABEL" ? count : Math.max(1, Math.ceil(count / (l.cols * l.rows)));
  return (
    <button type="button" onClick={onPick} className={`pk-opt ${on ? "is-on" : ""}`}>
      <span className="pk-mini" style={{ gridTemplateColumns: `repeat(${l.cols}, 1fr)`, aspectRatio: l.key === "LABEL" ? "62 / 40" : "210 / 297" }}>
        {Array.from({ length: l.cols * l.rows }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <span className="min-w-0 text-left">
        <b className="block text-[15px] font-black text-primary">{l.title}</b>
        <span className="block text-[11px] font-bold text-ink-soft">{l.hint}</span>
        <span className="mt-1 block text-[11px] font-extrabold text-accent">
          {count} CARD(S) = {sheets} {l.key === "LABEL" ? "LABEL(S)" : "SHEET(S)"}
        </span>
      </span>
    </button>
  );
}
