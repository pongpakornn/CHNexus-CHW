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
        <p className="mt-3 break-words rounded-xl bg-surface-2 px-3 py-2 text-left font-mono text-xs text-ink-soft">{error.message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="fill-btn" onClick={() => location.reload()}>
            RELOAD
          </button>
          <button className="cta-btn is-purple" onClick={reset}>
            ↻ TRY AGAIN
          </button>
        </div>
      </div>
    </div>
  );
}
