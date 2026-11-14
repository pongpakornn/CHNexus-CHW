"use client";

import { useEffect } from "react";
import { reportBug } from "@/lib/bugReport";

// 🛡 หน้าใดหน้าหนึ่งพัง: ส่งเข้า BUG LOG แล้วให้กดลองใหม่ได้ทันที (เมนู / หน้าอื่นยังใช้งานต่อได้ ไม่ค้างทั้งระบบ)
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportBug("PAGE", error.message || "Page crashed", (error.stack ?? "") + (error.digest ? `\ndigest: ${error.digest}` : ""));
  }, [error]);

  return (
    <div className="page-in grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-md rounded-[26px] bg-surface p-7 text-center shadow-[0_30px_70px_-30px_rgb(20_20_50/0.45)]">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#ffebee] text-2xl">🐞</div>
        <h2 className="mt-4 text-lg font-extrabold uppercase tracking-wide text-primary">หน้านี้ขัดข้องชั่วคราว</h2>
        <p className="mt-2 text-sm font-semibold text-ink-soft">ระบบบันทึกปัญหาลง BUG LOG ให้ Admin แล้ว - กดลองใหม่ หรือเลือกเมนูอื่นเพื่อใช้งานต่อ</p>
        {/* the technical message is for Admin (it is already in BUG LOG): hidden unless asked for */}
        <details className="mt-3 text-left">
          <summary className="cursor-pointer text-center text-xs font-bold text-ink-soft">รายละเอียด</summary>
          <p className="mt-2 break-words rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs text-ink-soft">{error.message}</p>
        </details>
        <div className="mt-5 flex justify-center gap-2">
          <button className="fill-btn" onClick={() => location.reload()}>
            โหลดหน้าใหม่
          </button>
          <button className="cta-btn is-purple" onClick={reset}>
            ลองอีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}
