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
const SOON: { key: string; name: string; sub: string; art: string; color: string }[] = [
  { key: "scheduling", name: "Production Scheduling & Work Order", sub: "Plan · Work Order", art: "/images/systems/scheduling.webp", color: "#2563eb" },
  { key: "kanban", name: "Kanban Control", sub: "Production Order · Work Call", art: "/images/systems/kanban.webp", color: "#0284c7" },
  { key: "bom", name: "Product Structure (BOM)", sub: "Process · Work Order · Kanban", art: "/images/systems/bom.webp", color: "#6750a4" },
  { key: "logistics", name: "Delivery & Logistics Planning", sub: "Shipment Plan · Customer Delivery", art: "/images/systems/logistics.webp", color: "#0369a1" },
];

// Launcher groups (key = live system in lib/menu.ts SYSTEMS, or a SOON card) · group hidden when the user has none of it
const GROUPS: { key: string; title: string; th: string; items: string[] }[] = [
  { key: "core", title: "CORE PRODUCTION SYSTEMS", th: "ระบบหลักสำหรับการผลิต", items: ["cims", "pp", "edp"] },
  { key: "dept", title: "DEPARTMENT WORKSPACES", th: "ระบบเฉพาะหน่วยงาน", items: ["pc-workspace", "chem"] },
  { key: "plan", title: "ON PLAN", th: "ระบบที่อยู่ระหว่างพัฒนาตามแผน", items: ["scheduling", "kanban", "bom", "logistics"] },
  { key: "admin", title: "ADMINISTRATION", th: "การจัดการข้อมูลกลางและผู้ใช้งาน", items: ["master", "admin"] },
];

export default function SystemsPage() {
  const { me } = useAuth();
  const can = me?.can ?? {};
  const all = systemsFor(can);
  // live system not listed in GROUPS (new one in lib/menu.ts) -> shown in the first group so it never disappears
  const known = new Set(GROUPS.flatMap((g) => g.items));
  const groups = GROUPS.map((g, gi) => ({
    ...g,
    cards: [...(gi === 0 ? all.filter((x) => !known.has(x.key)).map((x) => x.key) : []), ...g.items].filter(
      (k) => all.some((x) => x.key === k) || SOON.some((x) => x.key === k),
    ),
  })).filter((g) => g.cards.length > 0);
  let n = 0; // card index across groups (stagger)
  const dlg = useDialogs();
  let w = 0; // ลำดับคำ (หน่วงทีละคำ)

  const sysCard = (s: (typeof all)[number], i: number) => (
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
  );

  const soonCard = (s: (typeof SOON)[number], i: number) => (
    <button
      key={s.key}
      type="button"
      title={`${s.name} · อยู่ระหว่างดำเนินงานตามแผน`}
      className="sys-card is-soon"
      style={{ "--i": i, "--c": s.color } as React.CSSProperties}
      onClick={() =>
        dlg.alert({
          title: `🚧 ${s.name.toUpperCase()}`,
          message: `ระบบ ${s.name} อยู่ระหว่างดำเนินงานตามแผน
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
          {s.name} <em className="sys-soon">ON PLAN</em>
        </b>
        <span>{s.sub}</span>
      </span>
      <span className="sys-go" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );

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

        {groups.length === 0 ? (
          <div className="mr-off sys-empty">ยังไม่มีสิทธิ์ใช้งานระบบใด กรุณาติดต่อ Admin</div>
        ) : (
          <div className="sys-groups">
            {groups.map((g) => (
              <div key={g.key} className={`sys-group is-${g.key}`} role="group" aria-label={g.title}>
                <h3 className="sys-group-h" style={{ "--i": n } as React.CSSProperties}>
                  <b>{g.title}</b>
                  <span>{g.th}</span>
                </h3>
                <div className="sys-grid">
                  {g.cards.map((k) => {
                    const live = all.find((x) => x.key === k);
                    return live ? sysCard(live, n++) : soonCard(SOON.find((x) => x.key === k)!, n++);
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PageBody>
  );
}
