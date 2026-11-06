"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, download } from "@/lib/api";
import { useLive } from "@/lib/live";
import { MIN_SIGN_EVENT, openMinSign } from "@/lib/minSign";
import { refreshNotifications } from "@/lib/support";
import { useToast } from "@/components/notifications/Toasts";
import { ReportPreview, SLOT_NAMES, type MinHistory, type SheetData, type SlotInfo } from "@/components/print/MinReportSheet";

// ✍ MIN REPORT : เอกสารรายงานเดียว (เปิดจาก กระดิ่ง / Toast / การ์ดในแชท / ประวัติ / หลังกด REPORT)
//   ช่อง Prepared / Checked / Checked / Approved: ลงแล้ว = รูปลายเซ็น · รอฉัน = กดเพื่อเซ็น -> ส่งต่อช่องถัดไปจนครบ (DONE)
//   + คอยดูรายการที่รอฉันเซ็น: มีใหม่ = Toast ทันที (กด = เปิดเอกสาร) · กระดิ่งอัพเดทเอง
type Doc = { report: MinHistory; stkId: number; slots: SlotInfo[]; hasSignature: boolean };
type Q = { reportId: number; stockCode: string; title: string; sub: string | null; slotName: string; reporterName: string | null; reportedBy: string };

export function MinSignHost() {
  const toast = useToast();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(0);
  const seen = useRef<Set<number> | null>(null);

  const open = useCallback(
    async (id: number) => {
      try {
        setDoc(await api<Doc>(`/minreport/reports/${id}`));
      } catch (e) {
        toast.show("MIN REPORT", (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const h = (e: Event) => open((e as CustomEvent<number>).detail);
    window.addEventListener(MIN_SIGN_EVENT, h);
    return () => window.removeEventListener(MIN_SIGN_EVENT, h);
  }, [open]);

  // คิวรอเซ็น: ครั้งแรกจำไว้เฉย ๆ (กระดิ่งแสดงอยู่แล้ว) · รอบต่อไปมีรายการใหม่ = Toast
  const poll = useCallback(async () => {
    try {
      const q = await api<Q[]>("/minreport/sign/queue");
      const first = seen.current === null;
      const prev = seen.current ?? new Set<number>();
      const fresh = q.filter((x) => !prev.has(x.reportId));
      seen.current = new Set(q.map((x) => x.reportId));
      if (!first)
        fresh.slice(0, 3).forEach((x) =>
          toast.show(`✍ MIN REPORT รอลงลายเซ็น (${x.slotName})`, `${x.stockCode} · ${x.title}${x.sub ? " · " + x.sub : ""}\nจาก ${x.reporterName ?? x.reportedBy} · กดเพื่อเปิดเอกสาร`, "warn", {
            onClick: () => openMinSign(x.reportId),
            ms: 12000,
          }),
        );
      if (fresh.length) refreshNotifications();
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, [toast]);
  useEffect(() => {
    const t0 = setTimeout(poll, 2500);
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 60_000);
    return () => (clearTimeout(t0), clearInterval(t));
  }, [poll]);
  useLive(["minreport"], poll);

  // เอกสารที่เปิดอยู่มีคนเซ็นจากเครื่องอื่น = โหลดใหม่
  const docId = doc?.report.reportId ?? 0;
  const reload = useCallback(() => {
    if (docId) api<Doc>(`/minreport/reports/${docId}`).then(setDoc).catch(() => {});
  }, [docId]);
  useLive(["minreport"], reload);

  async function sign(slot: number) {
    if (!doc) return;
    if (!doc.hasSignature) return toast.show("ยังไม่มีลายเซ็น", "กรุณาบันทึกลายเซ็นก่อนที่ วงกลมโปรไฟล์ › ลายเซ็นของฉัน", "warn");
    setBusy(slot);
    try {
      const r = await api<{ message: string; doc: Doc }>(`/minreport/reports/${doc.report.reportId}/sign`, { method: "POST", body: { slot } });
      setDoc(r.doc);
      toast.show("✍ SIGNED", r.message, "ok");
      refreshNotifications();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      reload();
    } finally {
      setBusy(0);
    }
  }

  const r = doc?.report;
  // เอกสารเปลี่ยนเฉพาะเมื่อข้อมูลรายงานเปลี่ยน (ไม่วาดใหม่ / ไม่ยกเลิก PDF ที่กำลังสร้างระหว่างรอบตรวจคิว)
  const sheet = useMemo<SheetData | null>(() => (r ? { kind: "history", stock: r.stockCode, from: r.reportedAt, to: r.reportedAt, rows: [r], single: true } : null), [r]);
  const mine = doc?.slots.find((s) => s.mine);
  const note = !r ? null : r.flowStatus === "DONE" ? (
    <span className="mr-flow is-done">✔ ลงนามครบทุกช่องแล้ว</span>
  ) : r.flowStatus === "SIGNING" ? (
    mine ? (
      <span className="mr-flow is-mine">✍ รอคุณลงลายเซ็นช่อง {mine.name} — คลิกช่องที่กระพริบมุมขวาบนของเอกสาร{!doc?.hasSignature ? " (ยังไม่มีลายเซ็น: โปรไฟล์ › ลายเซ็นของฉัน)" : ""}</span>
    ) : (
      <span className="mr-flow">⏳ รอลงลายเซ็นช่อง {SLOT_NAMES[r.nextSlot ?? 0]}</span>
    )
  ) : (
    <span className="mr-flow">คลัง {r.stockCode} ยังไม่ได้ตั้ง FLOW ลายเซ็น (SETUP › SIGN FLOW)</span>
  );

  // วางที่ body ตอนเปิด = อยู่บนสุดเสมอ (ทับหน้าต่าง HISTORY / แชทที่เปิดอยู่)
  if (!doc) return null;
  return createPortal(
    <ReportPreview
      data={sheet}
      onClose={() => setDoc(null)}
      onExcel={async () => void (r && (await download(`/minreport/reports/${r.reportId}/excel`)))}
      signing={doc ? { slots: doc.slots, busy, onSign: sign } : undefined}
      note={note}
    />,
    document.body,
  );
}
