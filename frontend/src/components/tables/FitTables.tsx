"use client";

import { useEffect } from "react";

// 📱 ตารางทั้งระบบ (.data-table): แสดงครบทุกคอลัมน์ได้ = ตารางแบบ Desktop · แคบลง = ตารางกระชับ (iPad แนวตั้ง) · ยังไม่พอ = แถวละ 1 การ์ด (มือถือ)
//    แต่ละช่องมีชื่อคอลัมน์กำกับ (data-label จากหัวตาราง) -> เห็นข้อมูลครบโดยไม่ต้องเลื่อนซ้าย-ขวา
//    จำความกว้างที่ตารางต้องใช้ไว้ (data-need) แล้วกลับเป็นตารางเมื่อพื้นที่กว้างพอ · ข้ามตารางหน้าคลัง (มีการ์ดของตัวเอง) และ data-nostack
const SKIP = ".store-table, [data-nostack]";

function label(table: HTMLTableElement) {
  const heads = [...(table.tHead?.rows[0]?.cells ?? [])].map((th) => (th.textContent ?? "").replace(/\s+/g, " ").trim());
  if (!heads.length) return;
  for (const body of table.tBodies)
    for (const tr of body.rows) {
      let i = 0;
      for (const td of tr.cells) {
        const text = td.colSpan > 1 ? "" : (heads[i] ?? "");
        if (td.dataset.label !== text) td.dataset.label = text;
        i += td.colSpan;
      }
    }
}

const over = (table: HTMLTableElement, box: HTMLElement) => table.scrollWidth > box.clientWidth + 2 || box.scrollWidth > box.clientWidth + 2;
const widthOf = (table: HTMLTableElement, box: HTMLElement) => String(Math.max(table.scrollWidth, box.scrollWidth) + 4);

// ตารางเต็ม -> ล้น = ตารางกระชับ (is-tight: ช่องแคบ หัวคอลัมน์ / ข้อความขึ้นบรรทัดใหม่) -> ยังล้น = การ์ด (is-stacked)
//   จำความกว้างที่แต่ละขั้นต้องใช้ (data-need-full / data-need) แล้วถอยกลับขั้นก่อนหน้าเมื่อพื้นที่กว้างพอ
function fit(table: HTMLTableElement) {
  const box = table.parentElement;
  if (!box) return;
  const w = box.clientWidth;
  const cl = table.classList;
  if (cl.contains("is-stacked")) {
    if (w >= Number(table.dataset.need || 0)) cl.remove("is-stacked");
    else return;
  }
  if (cl.contains("is-tight") && w >= Number(table.dataset.needFull || 0)) cl.remove("is-tight");
  if (!over(table, box)) return;
  if (!cl.contains("is-tight")) {
    table.dataset.needFull = widthOf(table, box);
    cl.add("is-tight");
    if (!over(table, box)) return;
  }
  table.dataset.need = widthOf(table, box);
  cl.add("is-stacked");
}

export function FitTables() {
  useEffect(() => {
    const seen = new Set<HTMLTableElement>();
    const ro = new ResizeObserver((list) => list.forEach((e) => e.target.querySelectorAll<HTMLTableElement>(":scope > table.data-table, :scope > table[data-stack]").forEach(fit)));
    let raf = 0;
    const scan = () => {
      raf = 0;
      const now = new Set<HTMLTableElement>();
      document.querySelectorAll<HTMLTableElement>("table.data-table, table[data-stack]").forEach((t) => {
        if (t.matches(SKIP) || t.closest(".store-table") || !t.parentElement) return;
        now.add(t);
        label(t);
        if (!seen.has(t)) ro.observe(t.parentElement);
        fit(t);
      });
      seen.forEach((t) => !now.has(t) && t.parentElement && ro.unobserve(t.parentElement));
      seen.clear();
      now.forEach((t) => seen.add(t));
    };
    const queue = () => (raf ||= requestAnimationFrame(scan));
    // แถว / ข้อมูลเปลี่ยน (โหลดใหม่, เปลี่ยนหน้า, เปิดหน้าต่าง) -> ติดป้ายชื่อคอลัมน์ + วัดใหม่
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    queue();
    return () => (mo.disconnect(), ro.disconnect(), cancelAnimationFrame(raf));
  }, []);
  return null;
}
