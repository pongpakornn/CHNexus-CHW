"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useAuth } from "@/lib/auth";
import { openMinSign } from "@/lib/minSign";
import { dt } from "@/components/print/MinReportSheet";
import { FlowButton, FlowModal } from "@/components/notifications/MinPending";
import { MIN_ALERT_EVENT } from "@/components/notifications/MinReportAlert";

// ✍ MIN REPORT รออนุมัติ : เอกสารที่ FLOW ส่งมาถึงคิวเรา -> หน้าต่างเด้งกลางจอ (เฉพาะระบบ CIMS) ให้คนที่ต้องเซ็นเห็นทันที
//   ✍ SIGN = เปิดเอกสาร แล้วกดช่องของตัวเองเพื่อลงลายเซ็น · 🔀 = ดูว่าเอกสารเดินถึงช่องไหน / ใครเซ็นแล้ว
//   LATER = ซ่อน 10 นาที (จำในเครื่อง) · มีเอกสารใหม่เข้าคิว = เด้งทันที · เซ็นครบ / คนอื่นเซ็นแทน = หายเอง (หัวข้อ minreport)
//   ไม่ซ้อนกับหน้าต่าง MIN STOCK ALERT (รอให้ปิดก่อน)
type Q = { reportId: number; stkId: number; stockCode: string; title: string; sub: string | null; slot: number; slotName: string; reporterName: string | null; reportedBy: string; reportedAt: string; reasonType: string | null };

const LATER_MIN = 10;
const keyOf = (uid: string) => `min-sign-later:${uid}`;

export function MinSignAlert() {
  const path = usePathname() ?? "";
  const { me } = useAuth();
  return path.startsWith("/cims") && me ? <Host uid={me.userId} /> : null;
}

function Host({ uid }: { uid: string }) {
  const [q, setQ] = useState<Q[]>([]);
  const [later, setLater] = useState<{ until: number; ids: string }>({ until: 0, ids: "" });
  const [alertOn, setAlertOn] = useState(false);
  const [flow, setFlow] = useState<Q | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setQ(await api<Q[]>("/minreport/sign/queue"));
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, []);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(keyOf(uid)) ?? "null") as { until: number; ids: string } | null;
      if (v) queueMicrotask(() => setLater(v));
    } catch {
      /* ไม่มี storage */
    }
    const first = setTimeout(load, 3000);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => (clearTimeout(first), clearInterval(t), clearInterval(tick));
  }, [load, uid]);
  useLive(["minreport"], load);
  useEffect(() => {
    const h = (e: Event) => setAlertOn(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(MIN_ALERT_EVENT, h);
    return () => window.removeEventListener(MIN_ALERT_EVENT, h);
  }, []);

  const ids = q.map((x) => x.reportId).sort((a, b) => a - b).join(",");
  // LATER ใช้ได้กับชุดเดิม: มีเอกสารใหม่ที่ยังไม่เคยเห็น = เด้งทันที
  const fresh = q.some((x) => !later.ids.split(",").includes(String(x.reportId)));
  const snoozed = later.until > now && !fresh;
  const show = q.length > 0 && !snoozed && !alertOn;

  function hide() {
    const v = { until: now + LATER_MIN * 60_000, ids }; // now เดินทุก 30 วิ (คลาดได้ไม่เกินครึ่งนาที)
    setLater(v);
    try {
      localStorage.setItem(keyOf(uid), JSON.stringify(v));
    } catch {
      /* ไม่จำก็ได้ */
    }
  }
  function sign(x: Q) {
    hide();
    openMinSign(x.reportId);
  }

  return (
    <>
      {show && (
        <div className="mr-alert-bg" role="dialog" aria-modal="true" aria-label="MIN REPORT รอลงลายเซ็น">
          <div className="mr-alert is-v2 is-sign">
            <div className="mr-alert-head">
              <span className="mr-alert-ic is-sign" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20c3-1 4-5 6-5s1 4 3 4 3-3 4-3M14.5 4.5l5 5-8 8H6.5v-5z" />
                </svg>
              </span>
              <div className="min-w-0">
                <b>
                  MIN REPORT <em>รออนุมัติ</em>
                </b>
                <span>
                  มีเอกสาร <em>{q.length} รายการ</em> ที่ FLOW ส่งมาให้คุณลงลายเซ็น · กด ✍ SIGN เพื่อเปิดเอกสารและเซ็นช่องของคุณ
                </span>
              </div>
            </div>
            <div className="mrp is-soft mr-alert-body">
              <div className="mrp-list">
                {q.map((x, i) => (
                  <div key={x.reportId} className="mrp-row is-sign-q" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                    <div className="mrp-main">
                      <span className="mrp-no">{i + 1}</span>
                      <div className="mrp-part">
                        <b>
                          <em className="mrp-stk">{x.stockCode}</em>
                          {x.title || "ไม่มีรหัส"}
                        </b>
                        <span>{x.sub ?? ""}</span>
                        <div className="mrp-tags">
                          {x.reasonType && <i>หมายเหตุ : {x.reasonType}</i>}
                          <i>รายงานโดย : {x.reporterName ?? x.reportedBy}</i>
                        </div>
                      </div>
                      <div className="mrp-time">
                        <b className="is-sign">✍ รอคุณเซ็นช่อง {x.slotName}</b>
                        <small>รายงานเมื่อ {dt(x.reportedAt)}</small>
                      </div>
                      <div className="mrp-act flex items-center gap-2">
                        <FlowButton onClick={() => setFlow(x)} title="ดู FLOW: เอกสารเดินถึงช่องไหน / ใครเซ็นแล้ว" />
                        <button type="button" className="cta-btn is-purple is-sm" onClick={() => sign(x)}>
                          ✍ SIGN
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mr-alert-foot">
              <small>
                <i>i</i>LATER = ซ่อน {LATER_MIN} นาที แล้วแจ้งอีกครั้ง · มีเอกสารใหม่เข้ามาจะแจ้งทันที · ดูย้อนหลังได้ที่ กระดิ่ง › ประวัติ MIN REPORT
              </small>
              <button type="button" className="cta-btn is-gray" onClick={hide}>
                LATER
              </button>
            </div>
          </div>
        </div>
      )}
      {flow && <FlowModal stkId={flow.stkId} stockCode={flow.stockCode} title={flow.title} reportId={flow.reportId} onClose={() => setFlow(null)} />}
    </>
  );
}
