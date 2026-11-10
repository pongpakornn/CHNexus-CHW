import { api } from "@/lib/api";
import type { useDialogs } from "@/components/modals/Dialogs";

// 📋 หลังเพิ่ม / ลงทะเบียนสินค้า: ป้ายของสินค้านี้ที่ยังค้างใน NOT DEDUCTED (ระบบผูก PD CODE ให้แล้ว)
//    ready = ป้ายที่ตัด Master Coil ในคลังต้นทางได้ครบตอนนี้ -> ถามว่าจะรับเข้า + ตัดคลังต้นทาง (เช่น STOCK-PANTA) ให้เลยไหม
export type DeductMore = { count: number; ready: number[]; readyKg: number; source: string | null; target: string | null; canApprove: boolean };

const kg = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

export async function askCutPending(dlg: ReturnType<typeof useDialogs>, more: DeductMore | null | undefined, partCode: string): Promise<boolean> {
  if (!more || more.count === 0) return false;
  const src = more.source ?? "คลังต้นทาง";
  const waitOnly = more.count - more.ready.length;
  if (!more.canApprove || more.ready.length === 0) {
    await dlg.alert({
      title: "NOT DEDUCTED",
      tone: "warn",
      message:
        `${partCode} มีป้ายค้างอยู่ที่ NOT DEDUCTED ${more.count} ป้าย (ผูก PD CODE ให้แล้ว)\n\n` +
        (more.ready.length === 0 ? `ยังตัด ${src} ไม่ได้ (ไม่มี Master Coil / น้ำหนักไม่พอ)` : `ต้องให้ผู้มีสิทธิ์ APPROVE ของ Multi-Scanner กด APPROVE ที่หน้า Multi-Scanner`),
    });
    return false;
  }
  const ok = await dlg.confirm({
    title: "CUT " + src,
    ok: "✔ RECEIVE & CUT",
    message:
      `${partCode} มีป้ายค้างอยู่ที่ NOT DEDUCTED ${more.count} ป้าย\n\n` +
      `ตัด Master Coil ใน ${src} ได้ครบตอนนี้ ${more.ready.length} ป้าย (${kg(more.readyKg)} KG)\n` +
      (waitOnly > 0 ? `อีก ${waitOnly} ป้ายยังตัดไม่ได้ (ค้างไว้เหมือนเดิม)\n` : "") +
      `\nต้องการรับเข้า ${more.target ?? ""} + ตัด ${src} ให้เลยหรือไม่?`,
  });
  if (!ok) return false;
  try {
    const r = await api<{ message: string }>("/scanner/deduct/approve-ready", { method: "POST", body: { ids: more.ready } });
    await dlg.alert({ title: "NOT DEDUCTED", message: r.message, tone: r.message.includes("ไม่สำเร็จ") ? "warn" : "ok" });
    return true;
  } catch (e) {
    await dlg.alert({ title: "NOT DEDUCTED", tone: "error", message: (e as Error).message });
    return false;
  }
}
