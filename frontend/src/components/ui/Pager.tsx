"use client";

// 📄 ปุ่มเปลี่ยนหน้า (ดีไซน์ tabs: ช่องสี่เหลี่ยมมน · หน้าที่เลือก = พื้นน้ำเงินเด้งขึ้น + จุดใต้ปุ่ม)
//    หน้าเยอะ = แสดงหน้าแรก / สุดท้าย / รอบ ๆ หน้าปัจจุบัน คั่นด้วย … · ‹ › = หน้าก่อน / ถัดไป
export function Pager({ page, pages, total, size, onPage, note }: { page: number; pages: number; total: number; size: number; onPage: (p: number) => void; note?: string }) {
  const near = new Set([0, pages - 1, page - 1, page, page + 1]);
  if (page <= 2) [1, 2, 3].forEach((x) => near.add(x));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((x) => near.add(x));
  const list = [...near].filter((x) => x >= 0 && x < pages).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  list.forEach((x, i) => {
    if (i > 0 && x - list[i - 1] > 1) items.push("gap");
    items.push(x);
  });
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <nav className="flex flex-col items-center gap-3 pb-6 pt-1" aria-label="เปลี่ยนหน้า">
      <div className="pg-tabs">
        <button type="button" className="pg-btn pg-nav" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="หน้าก่อน">
          ‹
        </button>
        {items.map((x, i) =>
          x === "gap" ? (
            <span key={"g" + i} className="pg-gap" aria-hidden>
              …
            </span>
          ) : (
            <button type="button" key={x} className={`pg-btn ${x === page ? "is-on" : ""}`} aria-current={x === page ? "page" : undefined} onClick={() => x !== page && onPage(x)}>
              <span>{x + 1}</span>
            </button>
          ),
        )}
        <button type="button" className="pg-btn pg-nav" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="หน้าถัดไป">
          ›
        </button>
      </div>
      <div className="text-[11.5px] font-bold text-ink-soft">
        แสดง {from.toLocaleString()}–{to.toLocaleString()} จาก {total.toLocaleString()} รายการ · หน้า {page + 1} / {pages}
        {note && <span className="text-[#9a95a6]"> · {note}</span>}
      </div>
    </nav>
  );
}
