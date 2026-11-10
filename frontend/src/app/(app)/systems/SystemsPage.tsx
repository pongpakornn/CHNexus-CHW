"use client";

import Link from "next/link";
import { PageBody } from "@/components/layout/Page";
import { useAuth } from "@/lib/auth";
import { useDialogs } from "@/components/modals/Dialogs";
import { allowed, systemsFor, type MenuItem } from "@/lib/menu";

// 🧭 เลือกระบบ (หลัง Login): แผงพื้นฟ้าอ่อน = หัวข้อซ้าย + ภาพ Smart Factory Stamping Cell ขวา + การ์ดระบบด้านล่าง
//   เปิดหน้า: แสงกวาดผ่านแผง · หัวข้อโผล่ทีละคำ · ขีดยืดออก · ภาพเลื่อนเข้าจากขวาแล้วลอยเบา ๆ · การ์ดลอยขึ้นทีละใบ
//   กดการ์ด = เข้าหน้าแรกของระบบนั้น (Sidebar เปลี่ยนตามระบบ) · ระบบใหม่ = เพิ่มใน lib/menu.ts (SYSTEMS)
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((m) => (m.children ? flat(m.children) : [m]));

const TITLE = ["Choose Your", "Workspace"];

// 🚧 ระบบที่กำลังพัฒนา: แสดงการ์ดไว้ก่อน (ทุกคนเห็น) กดแล้วแจ้งว่าอยู่ระหว่างการอัพเดทระบบ · เปิดใช้จริง = ย้ายไปเพิ่มใน lib/menu.ts (SYSTEMS)
const SOON: { key: string; name: string; sub: string; art: string; color: string }[] = []; // Production Plan เปิดใช้แล้ว (lib/menu.ts › PP)

export default function SystemsPage() {
  const { me } = useAuth();
  const can = me?.can ?? {};
  const list = systemsFor(can);
  const dlg = useDialogs();
  let w = 0; // ลำดับคำ (หน่วงทีละคำ)

  return (
    <PageBody>
      <section className="sys-stage" data-reveal="own">
        <div className="sys-hero">
          <div className="sys-hero-tx">
            <small>CHR-NEXUS · SMART FACTORY PLATFORM</small>
            <h2>
              {TITLE.map((line) => (
                <span key={line} className="sys-line">
                  {line.split(" ").map((word) => (
                    <span key={word} className="sys-word" style={{ "--w": w++ } as React.CSSProperties}>
                      {word}
                    </span>
                  ))}
                </span>
              ))}
            </h2>
            <i aria-hidden />
            <p>เลือกระบบที่ต้องการใช้งาน</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sys-hero-art" src="/images/systems/stamping-cell-art.webp" alt="" width={972} height={941} />
        </div>

        {list.length === 0 && SOON.length === 0 ? (
          <div className="mr-off sys-empty">ยังไม่มีสิทธิ์ใช้งานระบบใด กรุณาติดต่อ Admin</div>
        ) : (
          <div className="sys-grid">
            {list.map((s, i) => (
              <Link
                key={s.key}
                href={flat(allowed(s.menu, can))[0].href}
                title={s.desc}
                className="sys-card"
                style={{ "--i": i, "--c": s.color } as React.CSSProperties}
              >
                <span className="sys-art" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.art} alt="" />
                </span>
                <span className="sys-tx">
                  <b>{s.name}</b>
                  <span>{s.sub}</span>
                </span>
                <span className="sys-go" aria-hidden>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            ))}
            {SOON.map((s, i) => (
              <button
                key={s.key}
                type="button"
                title={`${s.name} · อยู่ระหว่างการอัพเดทระบบ`}
                className="sys-card is-soon"
                style={{ "--i": list.length + i, "--c": s.color } as React.CSSProperties}
                onClick={() =>
                  dlg.alert({
                    title: `🚧 ${s.name.toUpperCase()}`,
                    message: `ระบบ ${s.name} อยู่ระหว่างการอัพเดทระบบ
ยังไม่เปิดให้ใช้งานในตอนนี้ จะแจ้งให้ทราบเมื่อพร้อมใช้งาน`,
                  })
                }
              >
                <span className="sys-art" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.art} alt="" />
                </span>
                <span className="sys-tx">
                  <b>
                    {s.name} <em className="sys-soon">UPDATING</em>
                  </b>
                  <span>{s.sub}</span>
                </span>
                <span className="sys-go" aria-hidden>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </PageBody>
  );
}
