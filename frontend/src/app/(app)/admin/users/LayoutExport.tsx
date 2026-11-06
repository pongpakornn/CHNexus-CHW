"use client";

import { useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { QrImage } from "@/components/print/QrImage";
import { download } from "@/lib/api";
import type { Loc } from "./layoutTypes";

// ▣ EXPORT QR ตำแหน่งจัดเก็บ = รูปแบบเดียวกับ Product Control › EXPORT QR › EXPORT SELECTED
//   A4 · 4 ดวงต่อแถว · QR (ข้อมูลตามรูปแบบที่ตั้ง) + "RACK1 : 3A" ตัวหนาใต้ QR · PDF สร้างที่ Server (ลง Activity Log)
export function LayoutExport({ items, onClose }: { items: Loc[] | null; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const n = items?.length ?? 0;

  async function pdf() {
    if (!items?.length) return;
    setBusy(true);
    try {
      const name = await download("/layout/qr-pdf", undefined, { ids: items.map((c) => c.locId), mode: "pdf" });
      toast.show("EXPORT QR", `บันทึกไฟล์ ${name} แล้ว (${items.length} QR)`, "ok");
      onClose();
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!items}
      size="xl"
      title={`▣ EXPORT QR • LAYOUT • ${n.toLocaleString()} QR`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs font-bold text-ink-soft">A4 · 4 ดวงต่อแถว · แบบเดียวกับ EXPORT QR ของ Product Control</span>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-red" onClick={pdf} disabled={busy || n === 0}>
            {busy ? "กำลังสร้าง PDF…" : "⬇ EXPORT PDF"}
          </button>
        </>
      }
    >
      {/* ตัวอย่างหน้ากระดาษ A4 (ย่อ) */}
      <div className="loq-sheet">
        {(items ?? []).slice(0, 80).map((c) => (
          <div key={c.locId} className="loq-cell">
            <QrImage text={c.qr} size={120} className="loq-img" />
            <b>{c.label}</b>
          </div>
        ))}
        {n > 80 && <p className="loq-more">… และอีก {n - 80} ดวงในไฟล์ PDF</p>}
      </div>
    </Modal>
  );
}
