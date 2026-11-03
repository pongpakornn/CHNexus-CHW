"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { api } from "@/lib/api";

type DisplayStock = { stkId: number; code: string; value: string; options: { key: string; label: string }[] };

// 🏷️ DISPLAY: ค่าที่แสดงแทนรหัสในหน้า Multi-Scanner ต่อคลัง (ของผู้ใช้คนนี้) - แสดงผลอย่างเดียว ไม่มีผลกับการบันทึก
export function DisplayModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [stocks, setStocks] = useState<DisplayStock[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ stocks: DisplayStock[] }>("/scanner/display")
      .then((r) => setStocks(r.stocks))
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast]);

  async function save() {
    if (!stocks) return;
    setBusy(true);
    try {
      await api("/scanner/display", { method: "POST", body: Object.fromEntries(stocks.map((s) => [s.stkId, s.value])) });
      toast.show("DISPLAY", "บันทึกการแสดงผลแล้ว", "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="🏷️ DISPLAY"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" onClick={save} disabled={busy || !stocks}>
            SAVE
          </button>
        </>
      }
    >
      {!stocks ? (
        <div className="text-center text-ink-soft">⏳ LOADING...</div>
      ) : (
        // เว้นที่ใต้ช่องสุดท้ายให้รายการ Dropdown กางลงได้เต็ม ๆ (ไม่ถูกขอบหน้าต่างตัด)
        <div className="grid gap-3" style={{ paddingBottom: (stocks.at(-1)?.options.length ?? 0) > 7 ? 340 : (stocks.at(-1)?.options.length ?? 0) * 44 + 24 }}>
          {stocks.map((s, i) => (
            <div key={s.stkId} className="relative" style={{ zIndex: stocks.length - i }}>
              <label className="sc-label">{s.code}</label>
              <MenuSelect
                value={s.value}
                onChange={(v) => setStocks((l) => l!.map((x, j) => (j === i ? { ...x, value: v } : x)))}
                options={[
                  ...(!s.options.some((o) => o.key === s.value) ? [{ value: s.value, label: s.value }] : []),
                  ...s.options.map((o) => ({ value: o.key, label: o.label })),
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
