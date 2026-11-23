"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { api } from "@/lib/api";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import type { PcFlowStep, PcMeta, PcUser } from "@/lib/pcwof";
import "../wof/wof.css";

type RawStep = { stepNo: number; title: string; userIds?: string[]; users?: PcUser[] };

// 🗂 PC › SETUP FLOW : ขั้นตอนอนุมัติของ WORK ORDER FOLLOW (เรียงตามลำดับ · แต่ละขั้นมีผู้อนุมัติ 1 คนขึ้นไป · ใครก็ได้ในขั้นนั้นเซ็นได้)
//   ส่ง SEND FOR SIGN แล้วเอกสารวิ่งตามลำดับขั้นจนครบ (Toast + กระดิ่ง + แชทแจ้งคนถัดไป)
export default function SetupFlow() {
  const toast = useToast();
  const [meta, setMeta] = useState<PcMeta | null>(null);
  const [steps, setSteps] = useState<PcFlowStep[] | null>(null);
  const [users, setUsers] = useState<PcUser[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useUnsavedGuard(dirty);

  useEffect(() => {
    api<PcMeta>("/pcwof/meta")
      .then((m) => {
        setMeta(m);
        if (!m.ready || !m.can.setup) return;
        api<RawStep[]>("/pcwof/flow")
          .then((r) => setSteps(r.map((s) => ({ stepNo: s.stepNo, title: s.title, userIds: s.userIds ?? s.users?.map((u) => u.userId) ?? [] }))))
          .catch((e) => (toast.show("ERROR", (e as Error).message, "error"), setSteps([])));
        api<{ users: PcUser[] }>("/users")
          .then((r) => setUsers(r.users))
          .catch(() => {});
      })
      .catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);

  const nameOf = useMemo(() => new Map(users.map((u) => [u.userId.toLowerCase(), u.name])), [users]);
  const edit = (f: (s: PcFlowStep[]) => PcFlowStep[]) => (setSteps((s) => f(s ?? [])), setDirty(true));
  const patch = (i: number, p: Partial<PcFlowStep>) => edit((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) =>
    edit((s) => {
      const n = [...s];
      [n[i], n[i + dir]] = [n[i + dir], n[i]];
      return n;
    });

  async function save() {
    const list = steps ?? [];
    if (list.some((s) => !s.title.trim() || s.userIds.length === 0)) return toast.show("WARNING", "ทุกขั้นต้องมีชื่อขั้นตอนและผู้อนุมัติอย่างน้อย 1 คน", "warn");
    setBusy(true);
    try {
      await api("/pcwof/flow", { method: "PUT", body: list.map((s, i) => ({ stepNo: i + 1, title: s.title.trim(), userIds: s.userIds })) });
      toast.show("Saved", "บันทึก FLOW แล้ว", "ok");
      setDirty(false);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageBody>
      <PageHeader
        icon="/icons/management.png"
        title="SETUP FLOW"
        subtitle="ขั้นตอนอนุมัติ WORK ORDER FOLLOW"
        actions={
          meta?.can.setup && (
            <button type="button" className="cta-btn is-purple" disabled={!dirty || busy} onClick={save}>
              SAVE
            </button>
          )
        }
      />
      {!meta ? (
        <Loading />
      ) : !meta.ready ? (
        <div className="mr-off">รอติดตั้งฐานข้อมูล</div>
      ) : !meta.can.setup ? (
        <div className="mr-off">ไม่มีสิทธิ์ตั้งค่า FLOW (ต้องเป็นผู้อนุมัติหรือ Admin Level 1)</div>
      ) : !steps ? (
        <Loading />
      ) : (
        <Card title="APPROVAL STEPS">
          <div className="wof-steps p-3">
            {steps.length === 0 && <small className="text-ink-soft">ยังไม่มีขั้นตอน · กด + ADD STEP</small>}
            {steps.map((s, i) => (
              <div key={i} className="wof-stepcard">
                <div className="wof-stepcard-h">
                  <b>STEP {i + 1}</b>
                  <input value={s.title} placeholder="ชื่อขั้นตอน เช่น Prepared / Checked / Approved" onChange={(e) => patch(i, { title: e.target.value })} />
                  <button type="button" className="cta-btn is-sm is-gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="ย้ายขึ้น">
                    ▲
                  </button>
                  <button type="button" className="cta-btn is-sm is-gray" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="ย้ายลง">
                    ▼
                  </button>
                  <button type="button" className="cta-btn is-sm is-red" onClick={() => edit((l) => l.filter((_, j) => j !== i))}>
                    REMOVE
                  </button>
                </div>
                <div className="wof-apprs">
                  {s.userIds.map((u) => (
                    <span key={u} className="wof-appr">
                      {nameOf.get(u.toLowerCase()) ? `${u} · ${nameOf.get(u.toLowerCase())}` : u}
                      <button type="button" aria-label={`เอา ${u} ออก`} onClick={() => patch(i, { userIds: s.userIds.filter((x) => x !== u) })}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <ComboBox
                    ariaLabel="เพิ่มผู้อนุมัติ"
                    value=""
                    onChange={(v) => v && patch(i, { userIds: [...s.userIds, v] })}
                    placeholder="+ ผู้อนุมัติ… (พิมพ์ค้นหา)"
                    className="w-[240px] max-w-full"
                    options={users.filter((u) => !s.userIds.includes(u.userId)).map((u) => ({ value: u.userId, label: u.userId, sub: u.name }))}
                  />
                </div>
              </div>
            ))}
            <button type="button" className="cta-btn is-teal self-start" onClick={() => edit((l) => [...l, { stepNo: l.length + 1, title: "", userIds: [] }])}>
              + ADD STEP
            </button>
          </div>
        </Card>
      )}
    </PageBody>
  );
}
