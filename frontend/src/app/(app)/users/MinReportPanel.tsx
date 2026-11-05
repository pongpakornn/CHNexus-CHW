"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { stockIcon, tileStyle } from "@/lib/stockIcons";

// 📋 SETUP › MIN REPORT (ทั้งระบบ ไม่ใช่รายบุคคล): เปิด / ปิด · ค้างที่ MIN กี่วันจึงแจ้งเตือน · กด CANCEL แล้วแจ้งซ้ำทุกกี่นาที / ชม. · คลังที่ใช้
type St = { stkId: number; code: string; name: string; stockType: string | null; isMain: boolean; isLiveView: boolean; on: boolean };
type Cfg = { enabled: boolean; stuckDays: number; remindMinutes: number; updatedBy: string | null; updatedDate: string | null; stocks: St[] };
type Unit = "MIN" | "HR";
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";

export function MinReportPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const [orig, setOrig] = useState<Cfg | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [unit, setUnit] = useState<Unit>("HR");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Cfg>("/minreport/settings");
      setOrig(r);
      setCfg(r);
      setUnit(r.remindMinutes % 60 === 0 ? "HR" : "MIN");
    } catch (e) {
      toast.show("ERROR", "โหลดการตั้งค่า MIN REPORT ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => {
    if (!cfg || !orig) return false;
    return cfg.enabled !== orig.enabled || cfg.stuckDays !== orig.stuckDays || cfg.remindMinutes !== orig.remindMinutes || cfg.stocks.some((s, i) => s.on !== orig.stocks[i]?.on);
  }, [cfg, orig]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!cfg) return <Loading />;
  const set = (p: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...p } : c));
  const remindVal = unit === "HR" ? Math.round((cfg.remindMinutes / 60) * 100) / 100 : cfg.remindMinutes;
  const onCount = cfg.stocks.filter((s) => s.on).length;

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/minreport/settings", {
        method: "POST",
        body: { enabled: cfg.enabled, stuckDays: cfg.stuckDays, remindMinutes: cfg.remindMinutes, stocks: cfg.stocks.filter((s) => s.on).map((s) => s.stkId) },
      });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-xs font-bold text-ink-soft">
        สินค้าที่ค้างอยู่ที่ค่า MIN ครบตามจำนวนวัน = หน้าต่างแจ้งเตือนกลางจอของผู้ที่ดูคลังนั้นได้ ให้กด REPORT ระบุสาเหตุ · กด CANCEL = แจ้งซ้ำตามเวลาด้านล่าง จนกว่าจะรายงาน · ใช้กับทั้งระบบ (ไม่ใช่รายบุคคล)
      </p>

      <div className="mr-set">
        <button type="button" role="switch" aria-checked={cfg.enabled} className={`sw ${cfg.enabled ? "is-on" : ""}`} onClick={() => set({ enabled: !cfg.enabled })}>
          <span className="sw-track" />
          {cfg.enabled ? "แจ้งเตือน : ON" : "แจ้งเตือน : OFF"}
        </button>

        <div>
          <span className={L}>ค้างที่ค่า MIN กี่วันจึงแจ้งเตือน</span>
          <div className="mr-chips">
            {[3, 4, 5].map((d) => (
              <button key={d} type="button" className={cfg.stuckDays === d ? "is-on" : ""} onClick={() => set({ stuckDays: d })}>
                {d} วัน
              </button>
            ))}
            <input type="number" min={1} max={60} value={cfg.stuckDays} onChange={(e) => set({ stuckDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} aria-label="จำนวนวัน" />
            <small>วัน</small>
          </div>
        </div>

        <div>
          <span className={L}>กด CANCEL แล้วแจ้งเตือนซ้ำทุก</span>
          <div className="mr-chips">
            {[
              [30, "30 นาที"],
              [60, "1 ชม."],
              [120, "2 ชม."],
              [240, "4 ชม."],
              [480, "8 ชม."],
            ].map(([m, t]) => (
              <button key={m} type="button" className={cfg.remindMinutes === m ? "is-on" : ""} onClick={() => (set({ remindMinutes: m as number }), setUnit((m as number) % 60 === 0 ? "HR" : "MIN"))}>
                {t}
              </button>
            ))}
            <input
              type="number"
              min={unit === "HR" ? 0.1 : 5}
              step={unit === "HR" ? 0.5 : 5}
              value={remindVal}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                set({ remindMinutes: Math.max(5, Math.min(10080, Math.round(unit === "HR" ? v * 60 : v))) });
              }}
              aria-label="แจ้งซ้ำทุก"
            />
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="หน่วย">
              <option value="MIN">นาที</option>
              <option value="HR">ชม.</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <span className={L}>
          คลังที่ใช้การแจ้งเตือน ({onCount} / {cfg.stocks.length})
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {cfg.stocks.map((r, i) => {
            const [ic, col] = stockIcon(r.code, i, r.stockType);
            const toggle = () => set({ stocks: cfg.stocks.map((x) => (x.stkId === r.stkId ? { ...x, on: !x.on } : x)) });
            const changed = r.on !== orig?.stocks[i]?.on;
            return (
              <div
                key={r.stkId}
                role="switch"
                aria-checked={r.on}
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
                className={`pr-card group ${r.on ? "is-on" : ""}`}
                style={{ "--c": col, animationDelay: `${i * 40}ms` } as React.CSSProperties}
              >
                <span className="pr-card-bar" />
                <div className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={tileStyle(col)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ic} alt="" draggable={false} className="size-6 object-contain" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[16px] font-extrabold text-[#1f2350]">{r.code}</span>
                      {r.isMain && <span className="pr-main">MAIN</span>}
                      {r.isLiveView && <span className="pr-main">LIVE</span>}
                      {changed && <span className="adm-dirty" title="ยังไม่ได้ SAVE" />}
                    </div>
                    <div className="truncate text-xs font-semibold text-ink-soft">{r.name}</div>
                  </div>
                  <span className={`sw ${r.on ? "is-on" : ""} pointer-events-none`}>
                    <span className="sw-track" />
                    ALERT
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-ink-soft">{orig?.updatedBy ? `แก้ล่าสุด: ${orig.updatedBy}` : ""}</span>
        {dirty && <span className="text-xs font-bold text-warning">มีการเปลี่ยนแปลง - กด SAVE</span>}
        <button className="cta-btn is-green ml-auto" disabled={busy || !dirty} onClick={save}>
          💾 SAVE
        </button>
      </div>
    </div>
  );
}
