"use client";

import { useEffect } from "react";

// 📱 ตารางทั้งระบบ (.data-table): แสดงครบทุกคอลัมน์ได้ = ตารางแบบ Desktop · พื้นที่แคบกว่าที่ตารางต้องใช้ (มือถือ / iPad แนวตั้ง) = แถวละ 1 การ์ด
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

function fit(table: HTMLTableElement) {
  const box = table.parentElement;
  if (!box) return;
  const w = box.clientWidth;
  if (table.classList.contains("is-stacked")) {
    if (w >= Number(table.dataset.need || 0)) table.classList.remove("is-stacked");
    else return;
  }
  if (table.scrollWidth > w + 2 || box.scrollWidth > w + 2) {
    table.dataset.need = String(Math.max(table.scrollWidth, box.scrollWidth) + 4);
    table.classList.add("is-stacked");
  }
}

export function FitTables() {
  useEffect(() => {
    const seen = new Set<HTMLTableElement>();
    const ro = new ResizeObserver((list) => list.forEach((e) => e.target.querySelectorAll<HTMLTableElement>(":scope > table.data-table").forEach(fit)));
    let raf = 0;
    const scan = () => {
      raf = 0;
      const now = new Set<HTMLTableElement>();
      document.querySelectorAll<HTMLTableElement>("table.data-table").forEach((t) => {
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
