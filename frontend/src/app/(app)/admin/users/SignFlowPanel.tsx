"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { stockIcon, tileStyle } from "@/lib/stockIcons";

// ✍ SETUP › SIGN FLOW (MIN REPORT): เลือกคลัง -> กำหนดผู้ลงลายเซ็นทีละช่อง Prepared → Checked → Checked → Approved
//   ไม่ใช้ = ข้ามช่องนี้ · กลุ่ม = ผู้ใช้ในรายชื่อลงได้ทุกคน (คนใดคนหนึ่ง) · รายบุคคล = คนเดียว
//   ส่ง REPORT แล้วเอกสารวิ่งตามลำดับช่องที่ใช้จนครบ (Toast + กระดิ่ง + แชท แจ้งคนถัดไปทันที)
type Mode = "OFF" | "ANY" | "ONE";
type Slot = { slot: number; name: string; mode: Mode; users: string[] };
type U = { userId: string; name: string | null; dept: string | null; sign: boolean };
type Data = { slots: Slot[]; users: U[]; configured: { stkId: number; on: boolean }[] };
type St = { stkId: number; code: string; name: string; stockType: string | null; on: boolean };
const MODES: [Mode, string, string][] = [
  ["OFF", "ไม่ใช้", "ข้ามช่องนี้"],
  ["ANY", "กลุ่ม", "ทุกคนในรายชื่อลงได้"],
  ["ONE", "รายบุคคล", "เลือกได้ 1 คน"],
];

// เอกสารที่ใช้ FLOW ลายเซ็น: MIN REPORT (ต่อคลัง) · CHEMICAL CONTROL (ต่อพารามิเตอร์ · ALL = ค่าเริ่มต้น)
type Src = "min" | "chem";
const SRC: Record<Src, { base: string; label: string; noun: string; doc: string }> = {
  min: { base: "/minreport/settings", label: "MIN REPORT", noun: "คลัง", doc: "เอกสาร MIN REPORT (FM-EN-04-22) ต่อคลัง · ส่ง REPORT แล้วระบบส่งเอกสารให้ช่องแรกที่ใช้ → เซ็นแล้วส่งต่อช่องถัดไปจนครบ (แจ้ง Toast + กระดิ่ง + แชท)" },
  chem: { base: "/chem/settings", label: "CHEMICAL CONTROL", noun: "รายการ", doc: "ใบบันทึกผลการตรวจวัดค่าน้ำยาเคมีประจำเดือน (FM-PD-04-03/1) ต่อพารามิเตอร์ · ALL (DEFAULT) = ใช้กับทุกรายการที่ไม่ได้ตั้งเฉพาะ · กด SUBMIT แล้วส่งตามลำดับจนอนุมัติ" },
};

export function SignFlowPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const [src, setSrc] = useState<Src>("min");
  const [dirtyNow, setDirtyNow] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="sf-src" role="tablist" aria-label="Document">
        {(Object.keys(SRC) as Src[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={src === k} className={src === k ? "is-on" : ""} disabled={dirtyNow && src !== k} title={dirtyNow && src !== k ? "กด SAVE ก่อนเปลี่ยนเอกสาร" : undefined} onClick={() => setSrc(k)}>
            {SRC[k].label}
          </button>
        ))}
      </div>
      <FlowEditor
        key={src}
        src={src}
        onDirty={(v) => {
          setDirtyNow(v);
          onDirty(v);
        }}
      />
    </div>
  );
}

function FlowEditor({ src, onDirty }: { src: Src; onDirty: (v: boolean) => void }) {
  const S = SRC[src];
  const toast = useToast();
  const [stocks, setStocks] = useState<St[] | null>(null);
  const [stk, setStk] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pick, setPick] = useState(0); // ช่องที่กำลังเลือกคน
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ stocks: St[] }>(S.base)
      .then((r) => {
        setStocks(r.stocks);
        if (src === "min") setStk((cur) => cur || r.stocks.find((s) => s.on)?.stkId || r.stocks[0]?.stkId || 0);
      })
      .catch((e: Error) => toast.show("ERROR", e.message, "error"));
  }, [toast, S.base, src]);

  const load = useCallback(async () => {
    if (!stk && src === "min") return;
    try {
      const d = await api<Data>(`${S.base}/flow/${stk}`);
      setData(d);
      setSlots(d.slots);
      setPick(0);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }, [stk, toast, S.base, src]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => !!data && JSON.stringify(slots) !== JSON.stringify(data.slots), [slots, data]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!stocks) return <Loading />;
  const users = data?.users ?? [];
  const uName = (id: string) => users.find((u) => u.userId.toLowerCase() === id.toLowerCase())?.name || id;
  const patch = (n: number, p: Partial<Slot>) => setSlots((ss) => ss.map((s) => (s.slot === n ? { ...s, ...p } : s)));
  const setMode = (n: number, m: Mode) => {
    const s = slots.find((x) => x.slot === n)!;
    patch(n, { mode: m, users: m === "OFF" ? [] : m === "ONE" ? s.users.slice(0, 1) : s.users });
    setPick(m === "OFF" ? 0 : n);
  };
  const toggleUser = (n: number, id: string) => {
    const s = slots.find((x) => x.slot === n)!;
    const has = s.users.some((u) => u.toLowerCase() === id.toLowerCase());
    if (s.mode === "ONE") patch(n, { users: has ? [] : [id] });
    else patch(n, { users: has ? s.users.filter((u) => u.toLowerCase() !== id.toLowerCase()) : [...s.users, id] });
  };
  const ps = slots.find((s) => s.slot === pick);
  const key = q.trim().toLowerCase();
  const list = users.filter((u) => !key || [u.userId, u.name, u.dept].some((v) => v?.toLowerCase().includes(key))).slice(0, 200);
  const active = slots.filter((s) => s.mode !== "OFF" && s.users.length > 0);

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`${S.base}/flow/${stk}`, { method: "POST", body: { slots: slots.map((s) => ({ slot: s.slot, mode: s.mode, users: s.users })) } });
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
      <p className="text-xs font-bold text-ink-soft">FLOW ลายเซ็นของ{S.doc} · ผู้ลงลายเซ็นต้องบันทึกลายเซ็นก่อนที่ โปรไฟล์ › ลายเซ็นของฉัน</p>

      {/* เลือกคลัง */}
      <div className="sf-stocks">
        {stocks.map((s, i) => {
          const [ic, col] = src === "chem" ? ["/icons/DashboardChart.png", s.stkId === 0 ? "#6750a4" : "#2563eb"] : stockIcon(s.code, i, s.stockType);
          const conf = data?.configured.find((c) => c.stkId === s.stkId)?.on;
          return (
            <button key={s.stkId} type="button" className={`sf-stk ${stk === s.stkId ? "is-on" : ""}`} style={{ "--c": col } as React.CSSProperties} onClick={() => !dirty && setStk(s.stkId)} disabled={dirty && stk !== s.stkId} title={dirty && stk !== s.stkId ? `กด SAVE ก่อนเปลี่ยน${S.noun}` : s.name}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px]" style={tileStyle(col)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ic} alt="" className="size-[18px] object-contain" draggable={false} />
              </span>
              <span className="min-w-0 text-left">
                <b>{s.code}</b>
                <small>{conf ? "✍ ตั้ง FLOW แล้ว" : "ยังไม่ตั้ง FLOW"}</small>
              </span>
            </button>
          );
        })}
      </div>

      {!data ? (
        <Loading />
      ) : (
        <>
          {/* ช่อง 4 ช่องเรียงแบบหัวเอกสาร */}
          <div className="sf-slots">
            {slots.map((s) => (
              <div key={s.slot} className={`sf-slot ${s.mode !== "OFF" ? "is-on" : ""} ${pick === s.slot ? "is-pick" : ""}`}>
                <div className="sf-slot-head">
                  <span className="sf-step">{s.slot}</span>
                  <b>{s.name}</b>
                </div>
                <div className="sf-modes">
                  {MODES.map(([m, t, h]) => (
                    <button key={m} type="button" className={s.mode === m ? "is-on" : ""} title={h} onClick={() => setMode(s.slot, m)}>
                      {t}
                    </button>
                  ))}
                </div>
                {s.mode !== "OFF" && (
                  <>
                    <div className="sf-users">
                      {s.users.length === 0 ? (
                        <span className="sf-none">ยังไม่เลือกผู้ลงลายเซ็น</span>
                      ) : (
                        s.users.map((u) => (
                          <span key={u} className="sf-user">
                            {uName(u)}
                            <small>{u}</small>
                            <button type="button" onClick={() => toggleUser(s.slot, u)} aria-label="เอาออก">
                              ✕
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <button type="button" className="sf-pick" onClick={() => setPick(pick === s.slot ? 0 : s.slot)}>
                      {pick === s.slot ? "✓ เสร็จ" : s.mode === "ONE" ? "👤 เลือกผู้ใช้" : "👥 เลือกผู้ใช้"}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* ลำดับ FLOW */}
          <div className="sf-route">
            <small>ลำดับการส่งเอกสาร</small>
            {active.length === 0 ? (
              <span>{src === "chem" ? (stk === 0 ? "ยังไม่ได้ตั้ง (รายการที่ไม่มี FLOW เฉพาะจะส่งอนุมัติไม่ได้)" : "ไม่ได้ตั้งเฉพาะรายการนี้ = ใช้ FLOW ค่าเริ่มต้น (ALL)") : "ยังไม่ได้ตั้ง (รายงานของคลังนี้จะไม่มีขั้นตอนลงลายเซ็น)"}</span>
            ) : (
              active.map((s, i) => (
                <span key={s.slot} className="sf-route-step">
                  {i > 0 && <i>→</i>}
                  <b>{s.name}</b> {s.mode === "ONE" ? uName(s.users[0]) : `${s.users.length} คน (คนใดคนหนึ่ง)`}
                </span>
              ))
            )}
          </div>

          {/* เลือกผู้ใช้ของช่องที่กำลังแก้ */}
          {ps && ps.mode !== "OFF" && (
            <div className="sf-picker">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm font-extrabold text-ink">
                  เลือกผู้ลงลายเซ็นช่อง {ps.name} (#{ps.slot}) · {ps.mode === "ONE" ? "รายบุคคล 1 คน" : "กลุ่ม เลือกได้หลายคน"}
                </b>
                <input className="field !h-9 ml-auto w-full sm:w-[260px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา UserID / ชื่อ / แผนก" />
              </div>
              <div className="sf-list">
                {list.map((u) => {
                  const on = ps.users.some((x) => x.toLowerCase() === u.userId.toLowerCase());
                  return (
                    <button key={u.userId} type="button" className={`sf-item ${on ? "is-on" : ""}`} onClick={() => toggleUser(ps.slot, u.userId)}>
                      <span className="sf-check">{on ? "✓" : ""}</span>
                      <span className="min-w-0 text-left">
                        <b>{u.name || u.userId}</b>
                        <small>
                          {u.userId}
                          {u.dept ? ` · ${u.dept}` : ""}
                        </small>
                      </span>
                      <em className={u.sign ? "is-ok" : ""}>{u.sign ? "✍ มีลายเซ็น" : "ยังไม่มีลายเซ็น"}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {dirty && <span className="text-xs font-bold text-warning">มีการเปลี่ยนแปลง - กด SAVE</span>}
            <button className="cta-btn is-green ml-auto" disabled={busy || !dirty} onClick={save}>
              💾 SAVE FLOW
            </button>
          </div>
        </>
      )}
    </div>
  );
}
