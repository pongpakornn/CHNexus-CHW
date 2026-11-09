"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";

// ⏰ SETUP › EDP ALERT (ทั้งระบบ): แจ้งเตือนการ์ด EDP ที่เลยเวลา START แล้วยังไม่ MARK SUCCESS
//   เปิด / ปิด · เลยเวลากี่นาทีจึงแจ้ง · กด CANCEL แล้วแจ้งซ้ำทุกกี่นาที · เฉพาะแผนที่กด START แล้ว
//   หน้าต่างแจ้งเตือนขึ้นเฉพาะในระบบ EDP PLANNING ของผู้ที่ MARK SUCCESS ได้ · SAVE แล้วทุกเครื่องใช้ค่าใหม่ทันที
type Cfg = { enabled: boolean; graceMinutes: number; remindMinutes: number; onlyStarted: boolean; updatedBy: string | null; updatedDate: string | null };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";

export function EdpAlertPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const [ready, setReady] = useState(true);
  const [orig, setOrig] = useState<Cfg | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ ready: boolean; settings?: Cfg }>("/edp/alert/settings");
      setReady(r.ready);
      if (r.settings) {
        setOrig(r.settings);
        setCfg(r.settings);
      }
    } catch (e) {
      toast.show("ERROR", "โหลดการตั้งค่า EDP ALERT ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => !!cfg && !!orig && (cfg.enabled !== orig.enabled || cfg.graceMinutes !== orig.graceMinutes || cfg.remindMinutes !== orig.remindMinutes || cfg.onlyStarted !== orig.onlyStarted), [cfg, orig]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!ready) return <p className="rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">⚠ Run database/nexus/29_EDP_Alert.sql first - cannot set EDP ALERT yet</p>;
  if (!cfg) return <Loading />;
  const set = (p: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...p } : c));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || 0));

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/edp/alert/settings", { method: "POST", body: { enabled: cfg.enabled, graceMinutes: cfg.graceMinutes, remindMinutes: cfg.remindMinutes, onlyStarted: cfg.onlyStarted } });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const chips = (list: [number, string][], value: number, on: (v: number) => void, min: number, max: number, label: string) => (
    <div className="mr-chips">
      {list.map(([m, t]) => (
        <button key={m} type="button" className={value === m ? "is-on" : ""} onClick={() => on(m)}>
          {t}
        </button>
      ))}
      <input type="number" min={min} max={max} value={value} onChange={(e) => on(clamp(Number(e.target.value), min, max))} aria-label={label} />
      <small>นาที</small>
    </div>
  );

  return (
    <div className="grid gap-4">
      <p className="text-xs font-bold text-ink-soft">
        การ์ดของรอบ / กะปัจจุบันที่เลยเวลา START แล้วแต่ยังไม่กด MARK SUCCESS = หน้าต่างแจ้งเตือนกลางจอ (เฉพาะในระบบ EDP PLANNING ของผู้ที่ MARK SUCCESS ได้) · กด CANCEL = ซ่อนชั่วคราว แล้วแจ้งซ้ำตามเวลาด้านล่าง จนกว่าจะ MARK ครบ · ใช้กับทั้งระบบ
      </p>
      <div className="mr-set">
        <button type="button" role="switch" aria-checked={cfg.enabled} className={`sw ${cfg.enabled ? "is-on" : ""}`} onClick={() => set({ enabled: !cfg.enabled })}>
          <span className="sw-track" />
          {cfg.enabled ? "แจ้งเตือน : ON" : "แจ้งเตือน : OFF"}
        </button>
        <div>
          <span className={L}>เลยเวลา START (ปลาย) กี่นาทีจึงแจ้งเตือน</span>
          {chips(
            [
              [0, "ทันที"],
              [5, "5 นาที"],
              [10, "10 นาที"],
              [15, "15 นาที"],
              [30, "30 นาที"],
            ],
            cfg.graceMinutes,
            (v) => set({ graceMinutes: v }),
            0,
            240,
            "เลยเวลากี่นาที",
          )}
        </div>
        <div>
          <span className={L}>กด CANCEL แล้วแจ้งเตือนซ้ำทุก</span>
          {chips(
            [
              [5, "5 นาที"],
              [10, "10 นาที"],
              [15, "15 นาที"],
              [30, "30 นาที"],
              [60, "1 ชม."],
            ],
            cfg.remindMinutes,
            (v) => set({ remindMinutes: v }),
            1,
            480,
            "แจ้งซ้ำทุก",
          )}
        </div>
        <button type="button" role="switch" aria-checked={cfg.onlyStarted} className={`sw ${cfg.onlyStarted ? "is-on" : ""}`} onClick={() => set({ onlyStarted: !cfg.onlyStarted })}>
          <span className="sw-track" />
          {cfg.onlyStarted ? "เฉพาะแผนที่กด START แล้ว" : "ทุกแผนของกะปัจจุบัน"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-ink-soft">{orig?.updatedBy ? `แก้ล่าสุด: ${orig.updatedBy}` : ""}</span>
        {dirty && <span className="text-xs font-bold text-warning">มีการเปลี่ยนแปลง - กด SAVE</span>}
        <button className="cta-btn is-green ml-auto" disabled={busy || !dirty} onClick={save}>
          {busy ? "…" : "💾 SAVE"}
        </button>
      </div>
    </div>
  );
}
