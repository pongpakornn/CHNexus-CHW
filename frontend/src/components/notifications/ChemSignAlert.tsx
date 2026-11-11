"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useAuth } from "@/lib/auth";

// ✍ CHEMICAL CONTROL รออนุมัติ : ใบบันทึกที่ FLOW (User Management › SETUP › SIGN FLOW › CHEMICAL CONTROL) ส่งมาถึงคิวเรา
//   หน้าต่างเด้งกลางจอแบบเดียวกับ MIN REPORT (เฉพาะหน้าในระบบ Chemical Control)
//   ✍ SIGN = เปิด Control Chart ของพารามิเตอร์ / เดือนนั้น แล้วลงลายเซ็นช่องของตัวเอง
//   LATER = ซ่อน 10 นาที (จำในเครื่อง) · มีใบใหม่เข้าคิว = เด้งทันที · เซ็นครบ / คนอื่นเซ็นแทน = หายเอง (หัวข้อ chem)
type Q = { id: number; paramId: number; year: number; month: number; code: string; name: string; slotName: string; submittedAt: string | null };

const LATER_MIN = 10;
const keyOf = (uid: string) => `chem-sign-later:${uid}`;
const ym = (x: Q) => `${x.year}-${String(x.month).padStart(2, "0")}`;

export function ChemSignAlert() {
  const path = usePathname() ?? "";
  const { me } = useAuth();
  const can = !!(me?.can?.chemRecord || me?.can?.chemSetup);
  return path.startsWith("/chem") && me && can ? <Host uid={me.userId} /> : null;
}

function Host({ uid }: { uid: string }) {
  const router = useRouter();
  const [q, setQ] = useState<Q[]>([]);
  const [later, setLater] = useState<{ until: number; ids: string }>({ until: 0, ids: "" });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setQ(await api<Q[]>("/chem/sheets/inbox"));
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
    const first = setTimeout(load, 1500);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => (clearTimeout(first), clearInterval(t), clearInterval(tick));
  }, [load, uid]);
  useLive(["chem"], load);

  const ids = q.map((x) => x.id).sort((a, b) => a - b).join(",");
  const fresh = q.some((x) => !later.ids.split(",").includes(String(x.id)));
  const show = q.length > 0 && !(later.until > now && !fresh);

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
    router.push(`/chem/chart?p=${x.paramId}&month=${ym(x)}`);
  }

  if (!show) return null;
  return (
    <div className="mr-alert-bg" role="dialog" aria-modal="true" aria-label="CHEMICAL CONTROL รอลงลายเซ็น">
      <div className="mr-alert is-v2 is-sign">
        <div className="mr-alert-head">
          <span className="mr-alert-ic is-sign" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20c3-1 4-5 6-5s1 4 3 4 3-3 4-3M14.5 4.5l5 5-8 8H6.5v-5z" />
            </svg>
          </span>
          <div className="min-w-0">
            <b>
              CHEMICAL CONTROL <em>รออนุมัติ</em>
            </b>
            <span>
              มีใบบันทึก <em>{q.length} รายการ</em> ที่ FLOW ส่งมาให้คุณลงลายเซ็น · กด ✍ SIGN เพื่อเปิด Control Chart แล้วเซ็นช่องของคุณ
            </span>
          </div>
        </div>
        <div className="mrp is-soft mr-alert-body">
          <div className="mrp-list">
            {q.map((x, i) => (
              <div key={x.id} className="mrp-row is-sign-q" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <div className="mrp-main">
                  <span className="mrp-no">{i + 1}</span>
                  <div className="mrp-part">
                    <b>
                      <em className="mrp-stk">{x.code}</em>
                      {x.name}
                    </b>
                    <span>ใบบันทึกประจำเดือน {String(x.month).padStart(2, "0")}/{x.year}</span>
                  </div>
                  <div className="mrp-time">
                    <b className="is-sign">✍ รอคุณเซ็นช่อง {x.slotName}</b>
                    {x.submittedAt && <small>ส่งเมื่อ {new Date(x.submittedAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>}
                  </div>
                  <div className="mrp-act flex items-center gap-2">
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
            <i>i</i>LATER = ซ่อน {LATER_MIN} นาที แล้วแจ้งอีกครั้ง · มีใบใหม่เข้ามาจะแจ้งทันที · ดูได้ที่ Dashboard › รอคุณลงลายเซ็น
          </small>
          <button type="button" className="cta-btn is-gray" onClick={hide}>
            LATER
          </button>
        </div>
      </div>
    </div>
  );
}
