"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loading } from "@/components/layout/Page";
import { EASE } from "@/lib/motion";

// 🧊 LAYOUT 3D ในหน้าคลังหลัก (IsMain = STOCK-MAT / STORE-MAT): ปุ่มวงกลมข้าง MIN REPORT (แทนเมนูใน Sidebar)
//   กด = เปิดผังคลัง 3D เต็มจอ (หน้าเดิมของ CIMS › Layout 3D) · ← BACK / ✕ / Esc = ปิดกลับหน้าคลัง
//   โหลดโมเดล 3D (three.js) ตอนกดเปิดเท่านั้น หน้าคลังปกติไม่ช้าลง
const Layout3D = dynamic(() => import("../layout-3d/Layout3DPage"), { ssr: false, loading: () => <Loading /> });

export function Layout3DButton({ stockCode }: { stockCode: string }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <div className="rm rm-left relative z-40 flex items-center gap-3">
        <span className="rm-caption hidden text-right text-[11px] font-extrabold leading-tight tracking-wide text-ink-soft sm:block">
          LAYOUT 3D
          <br />
          <span className="font-bold text-[#9a95a6]">ผังคลัง · ตำแหน่ง Coil</span>
        </span>
        <div className="relative size-[56px] shrink-0">
          <button type="button" className="rm-fab" style={{ background: "linear-gradient(135deg, #38bdf8, #2563eb)" }} aria-label={`LAYOUT 3D ${stockCode}`} title="เปิดผังคลัง 3D (ตำแหน่ง Coil จากการสแกน LAYOUT)" onClick={() => setOpen(true)}>
            <span className="rm-fab-ic grid place-items-center text-white">
              <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z" />
                <path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                key="l3d"
                className="l3d-ov"
                role="dialog"
                aria-modal="true"
                aria-label={`LAYOUT 3D ${stockCode}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <motion.div className="l3d-box" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }} transition={{ duration: 0.4, ease: EASE }}>
                  <div className="l3d-bar">
                    <button type="button" className="fill-btn is-sm" onClick={() => setOpen(false)}>
                      ← BACK
                    </button>
                    <b>
                      🧊 LAYOUT 3D <span>• {stockCode}</span>
                    </b>
                    <button type="button" className="l3d-x" aria-label="ปิด LAYOUT 3D" title="ปิด (Esc)" onClick={() => setOpen(false)}>
                      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                  <div className="l3d-body">
                    <Layout3D />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
