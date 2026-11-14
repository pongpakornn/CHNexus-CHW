"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";

// 🏷 SETUP › MIN REPORT › รูปแบบการแสดงสินค้า (ต่อคลัง): บรรทัดที่ 1 (ตัวหนา) / บรรทัดที่ 2 แสดงช่องไหน เรียงลำดับเองได้
//   ตัวเลือก = คอลัมน์ของตาราง Store (Max-Min) ของคลังนั้น เช่น STORE-PC : บรรทัด 1 = PART A · บรรทัด 2 = PART NO › PRODUCT NAME
//   ใช้ทั้งหน้าต่างแจ้งเตือน / PENDING / HISTORY / เอกสาร PDF / Excel · SAVE แล้วทุกเครื่องเห็นทันที (เรียลไทม์)
type Field = { key: string; label: string };
type Sample = Record<string, string | null>;
type Data = { fields: Field[]; line1: string[]; line2: string[]; sample: Sample[] };
type St = { stkId: number; code: string; on: boolean };

const VAL: Record<string, string> = { CODE: "partCode", NAME: "partName", PARTA: "partA", PARTB: "partB", PARTNO: "partNo", MODEL: "model", CUSTOMER: "customer", SUPPLIER: "supplier", CATEGORY: "category", BIN: "bin", PACKSIZE: "packSize" };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";

export function MinDisplayPanel({ stocks }: { stocks: St[] }) {
  const toast = useToast();
  const [stk, setStk] = useState<number>(() => stocks.find((s) => s.on)?.stkId ?? stocks[0]?.stkId ?? 0);
  const [data, setData] = useState<Data | null>(null);
  const [l1, setL1] = useState<string[]>([]);
  const [l2, setL2] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!stk) return;
    try {
      const d = await api<Data>(`/minreport/settings/display/${stk}`);
      setData(d);
      setL1(d.line1);
      setL2(d.line2);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }, [stk, toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!stocks.length) return null;
  const label = (k: string) => data?.fields.find((f) => f.key === k)?.label ?? k;
  const dirty = !!data && (l1.join() !== data.line1.join() || l2.join() !== data.line2.join());
  const s0 = data?.sample[0];
  const preview = (keys: string[]) => (s0 ? keys.map((k) => (s0[VAL[k]] ?? "").toString().trim()).filter((v) => v && v !== "-").join(" · ") : keys.map(label).join(" · "));

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/minreport/settings/display/${stk}`, { method: "POST", body: { line1: l1, line2: l2 } });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // บรรทัดเดียว: ชิปที่เลือก (เรียงตามลำดับ · ◀ ▶ ย้าย · ✕ เอาออก) + ปุ่ม ＋ ช่องที่ยังไม่เลือก
  const line = (n: 1 | 2, list: string[], set: (v: string[]) => void) => {
    const move = (i: number, d: number) => {
      const a = [...list];
      const j = i + d;
      if (j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]];
      set(a);
    };
    return (
      <div className="mds-line">
        <span className={L}>{n === 1 ? "บรรทัดที่ 1 (ตัวหนา) — แสดงก่อน" : "บรรทัดที่ 2"}</span>
        <div className="mds-chips">
          {list.length === 0 && <span className="mds-empty">ยังไม่เลือก</span>}
          {list.map((k, i) => (
            <span key={k} className="mds-chip">
              <b>{i + 1}</b>
              {label(k)}
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="เลื่อนไปก่อน">
                ◀
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="เลื่อนไปหลัง">
                ▶
              </button>
              <button type="button" onClick={() => set(list.filter((x) => x !== k))} aria-label="เอาออก">
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="mds-add">
          {data?.fields
            .filter((f) => !list.includes(f.key))
            .map((f) => (
              <button key={f.key} type="button" onClick={() => set([...list, f.key])}>
                ＋ {f.label}
              </button>
            ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mds">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className={L}>รูปแบบการแสดงสินค้า · เลือกคลัง</span>
          <MenuSelect compact className="w-[220px]" value={String(stk)} options={stocks.map((s) => ({ value: String(s.stkId), label: s.code + (s.on ? " • ALERT" : "") }))} onChange={(v) => setStk(Number(v))} />
        </div>
        <p className="min-w-0 flex-1 text-xs font-semibold text-ink-soft">ตัวเลือกมาจากคอลัมน์ของตาราง Store (Max-Min) ของคลังนี้ · กด ＋ ตามลำดับที่ต้องการแสดง · ช่องที่ว่าง (เช่น รหัส &quot;-&quot;) จะถูกข้ามให้เอง</p>
      </div>
      {!data ? (
        <Loading compact />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {line(1, l1, setL1)}
            {line(2, l2, setL2)}
          </div>
          <div className="mds-prev">
            <small>ตัวอย่าง{s0 ? " (สินค้าจริงของคลังนี้)" : ""}</small>
            <b>{preview(l1) || "ไม่มีรหัส"}</b>
            <span>{preview(l2)}</span>
          </div>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs font-bold text-warning">มีการเปลี่ยนแปลง - กด SAVE</span>}
            <button className="cta-btn is-green ml-auto" disabled={busy || !dirty} onClick={save}>
              💾 SAVE DISPLAY
            </button>
          </div>
        </>
      )}
    </div>
  );
}
