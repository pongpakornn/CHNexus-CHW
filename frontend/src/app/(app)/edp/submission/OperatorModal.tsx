"use client";

import { useState } from "react";
import { Modal } from "@/components/modals/Modal";

// 👷 ถามรหัสพนักงาน (OPERATOR) ของกะ แล้วให้ยืนยันก่อนบันทึก · ใช้ตอน START PLAN และตอนเข้ากะ NIGHT
export function OperatorModal({ title, shift, onSave, onCancel }: { title: string; shift: string; onSave: (code: string) => Promise<void>; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = code.trim();
  async function save() {
    setBusy(true);
    try {
      await onSave(c);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="fill-btn" disabled={busy} onClick={sure ? () => setSure(false) : onCancel}>
            {sure ? "BACK" : "CANCEL"}
          </button>
          {sure ? (
            <button className="cta-btn is-green" disabled={busy} onClick={save}>
              ✔ CONFIRM
            </button>
          ) : (
            <button className="cta-btn is-green" disabled={!c} onClick={() => setSure(true)}>
              NEXT
            </button>
          )}
        </>
      }
    >
      {sure ? (
        <p className="text-sm font-bold">
          ยืนยัน OPERATOR กะ {shift} คือ <span className="text-lg">{c}</span> ?
        </p>
      ) : (
        <label className="grid gap-2 text-sm font-bold">
          OPERATOR (รหัสพนักงาน) กะ {shift}
          <input
            className="field"
            autoFocus
            maxLength={30}
            placeholder="EMPLOYEE CODE *"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && c && setSure(true)}
          />
        </label>
      )}
    </Modal>
  );
}
