"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/modals/Modal";
import { Checkbox } from "@/components/forms/Checkbox";
import { Empty, Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { LayoutExport } from "@/app/(app)/admin/users/LayoutExport";
import type { LayoutData, Loc } from "@/app/(app)/admin/users/layoutTypes";

// ▣ Product Control › EXCEL · QR › EXPORT QR CODE LAYOUT
//   ตาราง Locations ทั้งหมด (จาก SETUP › LAYOUT SETUP) -> ติ๊กเลือก -> EXPORT (PDF A4 แบบเดียวกับ EXPORT QR ของสินค้า)
//   QR = ข้อความตามรูปแบบที่ตั้งไว้ปัจจุบัน · หน้า Multi-Scanner รับได้ทุกรูปแบบ
export function LayoutQrPicker({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<LayoutData | null>(null);
  const [type, setType] = useState("ALL");
  const [key, setKey] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState<Loc[] | null>(null);

  const load = useCallback(() => {
    api<LayoutData>("/layout")
      .then(setData)
      .catch((e: Error) => (toast.show("ERROR", "โหลดตำแหน่งจัดเก็บไม่สำเร็จ\n" + e.message, "error"), setData({ ready: false })));
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["layout"], load);

  const all = useMemo(() => (data?.types ?? []).flatMap((t) => t.locations.map((l) => ({ ...l, typeName: t.typeName }))), [data]);
  const k = key.trim().toUpperCase();
  const rows = all.filter((l) => (type === "ALL" || l.typeName === type) && (!k || `${l.typeName} ${l.locName} ${l.qr}`.toUpperCase().includes(k)));
  const picked = all.filter((l) => sel.has(l.locId));
  const allOn = rows.length > 0 && rows.every((l) => sel.has(l.locId));
  const toggle = (ids: number[], on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
      return n;
    });
  const fmt = data?.settings ? data.settings.fields.join(` "${data.settings.sep}" `) : "";

  return (
    <>
      <Modal
        open
        size="xl"
        title="▣ EXPORT QR CODE LAYOUT • LOCATIONS"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-bold text-ink-soft">
              เลือกแล้ว {picked.length.toLocaleString()} / {all.length.toLocaleString()} ตำแหน่ง{fmt ? ` · รูปแบบ QR : ${fmt}` : ""}
            </span>
            <button className="fill-btn" onClick={onClose}>
              CANCEL
            </button>
            <button className="cta-btn is-purple" disabled={picked.length === 0} onClick={() => setExporting(picked)}>
              ▣ EXPORT QR {picked.length ? `(${picked.length})` : ""}
            </button>
          </div>
        }
      >
        {!data ? (
          <Loading />
        ) : !data.ready ? (
          <Empty>ยังไม่มีตาราง LAYOUT</Empty>
        ) : all.length === 0 ? (
          <Empty>ยังไม่มีตำแหน่งจัดเก็บ (Admin เพิ่มได้ที่ User Management › SETUP › LAYOUT SETUP)</Empty>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="mrs-tabs">
                {["ALL", ...(data.types ?? []).map((t) => t.typeName)].map((t) => (
                  <button key={t} type="button" className={type === t ? "is-on" : ""} onClick={() => setType(t)}>
                    {t}
                    <b>{t === "ALL" ? all.length : all.filter((l) => l.typeName === t).length}</b>
                  </button>
                ))}
              </div>
              <input className="mr-search" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ค้นหาประเภท / ตำแหน่ง / ข้อความ QR" />
            </div>
            <div className="lqp-wrap">
              <table className="lqp">
                <thead>
                  <tr>
                    <th className="w-10">
                      <Checkbox checked={allOn} onChange={(v) => toggle(rows.map((l) => l.locId), v)} />
                    </th>
                    <th className="w-12">NO.</th>
                    <th>TYPE</th>
                    <th>LOCATION</th>
                    <th>QR TEXT</th>
                    <th className="max-sm:hidden">CREATED</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => (
                    <tr key={l.locId} className={sel.has(l.locId) ? "is-on" : ""} onClick={() => toggle([l.locId], !sel.has(l.locId))}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={sel.has(l.locId)} onChange={(v) => toggle([l.locId], v)} />
                      </td>
                      <td>{i + 1}</td>
                      <td className="font-mono font-bold">{l.typeName}</td>
                      <td className="font-mono font-extrabold">{l.locName}</td>
                      <td>
                        <code>{l.qr}</code>
                      </td>
                      <td className="text-xs text-ink-soft max-sm:hidden">
                        {l.createdBy ?? "-"} · {new Date(l.createdAt).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <Empty>ไม่พบตำแหน่งที่ค้นหา</Empty>}
            </div>
          </div>
        )}
      </Modal>
      {exporting && createPortal(<LayoutExport items={exporting} onClose={() => setExporting(null)} />, document.body)}
    </>
  );
}
