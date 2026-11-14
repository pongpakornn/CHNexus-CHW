"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { api } from "@/lib/api";
import { hgOf, type Card, type Part } from "../edp";

// ใช้ร่วมกัน: หน้า PLAN SUBMISSION (ปุ่ม EDIT บนการ์ด) + หน้าต่างแจ้งเตือน EDP ALERT
// ✏ แก้ไขการ์ดจากหน้างาน: เปลี่ยนลูกค้า / ชิ้นงาน / จำนวน หรือแจ้งว่าผลิตไม่ได้ (ต้องมีหมายเหตุเสมอ · เก็บประวัติเดิม -> ใหม่)
//   เปิดมาด้วยตัวเลขบนการ์ดตอนนี้ (ยอดที่พิมพ์ค้างไว้) · เลือกชิ้นงานใหม่ = 1 HG / QTY_HG ชิ้น · ชิ้น <-> HG ด้วย QTY_HG (แบบ EditPlanItemView)
export function EditCard({ card, qty0, hg0, onClose, onSaved }: { card: Card; qty0: number; hg0: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [parts, setParts] = useState<Part[] | null>(null);
  const [problem, setProblem] = useState(false);
  const [cust, setCust] = useState(card.customer);
  const [partId, setPartId] = useState<number | null>(card.partId);
  const [qty, setQty] = useState(qty0);
  const [hg, setHg] = useState(hg0);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<Part[]>("/edp/parts")
      .then(setParts)
      .catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  // แบบหน้า PLAN SETTING / .exe: เฉพาะชิ้นงานที่ EDP ใช้ (มี HG QTY / PCS/HG) · PART NO ซ้ำได้ -> แสดง PART CODE ให้แยกออก
  const edp = useMemo(() => (parts ?? []).filter((p) => p.qtyHg > 0 || p.pcsHg > 0), [parts]);
  const custs = useMemo(() => [...new Set(edp.map((p) => p.customer))].filter(Boolean).sort(), [edp]);
  const list = edp.filter((p) => p.customer === cust);
  const part = parts?.find((p) => p.partId === partId) ?? null;

  async function save() {
    if (!remark.trim()) return toast.show("REMARK", "กรุณาระบุหมายเหตุ/ปัญหาที่พบก่อนบันทึก", "warn");
    if (!problem && !partId) return toast.show("PART", "กรุณาเลือกชิ้นงาน", "warn");
    setSaving(true);
    try {
      const r = await api<{ message: string }>("/edp/edit", { method: "POST", body: { pldId: card.pldId, problem, partId, qty, hg, remark } });
      toast.show("SAVED", r.message, "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`✏ EDIT PLAN • ${card.customer} ${card.partNo}`}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className={`cta-btn ${problem ? "is-red" : "is-green"}`} disabled={saving} onClick={save}>
            {saving ? "…" : problem ? "⛔ REPORT PROBLEM" : "💾 SAVE"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="edp-seg is-2" style={{ "--n": problem ? 1 : 0, "--c": 2 } as React.CSSProperties}>
          <span className="edp-seg-glider" aria-hidden />
          <button type="button" className={!problem ? "is-on" : ""} onClick={() => setProblem(false)}>
            ✏ แก้ไขแผน
          </button>
          <button type="button" className={problem ? "is-on" : ""} onClick={() => setProblem(true)}>
            ⛔ ผลิตไม่ได้
          </button>
        </div>
        <div className={`fold ${problem ? "is-closed" : ""}`}>
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="fx">
                <span className="fx-cap">CUSTOMER</span>
                <ComboBox value={cust} onChange={(v) => v !== cust && (setCust(v), setPartId(null), setQty(0), setHg(0))} options={custs.map((c) => ({ value: c, label: c }))} placeholder="พิมพ์ค้นหาลูกค้า" ariaLabel="CUSTOMER" />
              </label>
              <label className="fx">
                <span className="fx-cap">PART NO</span>
                <ComboBox
                  value={partId ? String(partId) : ""}
                  onChange={(v) => {
                    const p = parts?.find((x) => x.partId === +v);
                    // เลือกชิ้นงาน = 1 HG · QTY = HG QTY ของชิ้นงาน (เวลาบนการ์ดคิดใหม่ตาม HG หลังบันทึก)
                    if (p && p.partId !== partId) {
                      setHg(p.qtyHg > 0 ? 1 : 0);
                      setQty(p.qtyHg);
                    }
                    setPartId(+v);
                  }}
                  options={list.map((p) => ({ value: String(p.partId), label: p.partNo, sub: [p.partCode, p.qtyHg ? `${p.qtyHg} PCS/HG` : "", p.partName].filter(Boolean).join(" · ") }))}
                  placeholder={!parts ? "LOADING..." : cust ? `พิมพ์ค้นหา PART NO ของ ${cust} (${list.length})` : "เลือก CUSTOMER ก่อน"}
                  ariaLabel="PART NO"
                />
              </label>
              <label className="fx">
                <span className="fx-cap">QTY PLAN (PCS)</span>
                <input type="number" min={0} className="field fx-in" value={qty} onChange={(e) => (setQty(+e.target.value || 0), setHg(hgOf(+e.target.value || 0, part?.qtyHg ?? card.qtyHg, hg)))} />
              </label>
              <label className="fx">
                <span className="fx-cap">HG PLAN {part ? `(${part.qtyHg} PCS/HG)` : ""}</span>
                <input type="number" min={0} className="field fx-in" value={hg} onChange={(e) => (setHg(+e.target.value || 0), setQty((+e.target.value || 0) * (part?.qtyHg ?? card.qtyHg)))} />
              </label>
            </div>
          </div>
        </div>
        <label className="fx">
          <span className="fx-cap">REMARK / ปัญหาที่พบ *</span>
          <textarea className="field fx-in min-h-[90px]" maxLength={500} value={remark} placeholder="เช่น แม่พิมพ์เสีย · วัตถุดิบไม่พอ · เปลี่ยนแผนตามหัวหน้า" onChange={(e) => setRemark(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
