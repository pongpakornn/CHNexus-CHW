"use client";

import Link from "next/link";
import { PageBody } from "@/components/layout/Page";
import { useAuth } from "@/lib/auth";
import { allowed, systemsFor, type MenuItem } from "@/lib/menu";

// 🧭 เลือกระบบ (หลัง Login): การ์ดระบบที่มีสิทธิ์ · กดการ์ด = เข้าหน้าแรกของระบบนั้น (Sidebar เปลี่ยนตามระบบ)
//   เมนูในการ์ด = ลัดเข้าหน้านั้นได้เลย · ระบบใหม่ในอนาคต = เพิ่มใน lib/menu.ts (SYSTEMS)
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((m) => (m.children ? flat(m.children) : [m]));

export default function SystemsPage() {
  const { me } = useAuth();
  const can = me?.can ?? {};
  const list = systemsFor(can);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";

  return (
    <PageBody>
      <div className="sys-hero">
        <small>CHR-NEXUS • MES PLATFORM</small>
        <h2>
          {hello}, {me?.userName}
        </h2>
        <p>เลือกระบบที่ต้องการใช้งาน · สลับระบบได้ตลอดจากเมนู Systems ที่ Sidebar</p>
      </div>
      {list.length === 0 ? (
        <div className="mr-off">ยังไม่มีสิทธิ์ใช้งานระบบใด กรุณาติดต่อ Admin</div>
      ) : (
        <div className="sys-grid">
          {list.map((s, i) => {
            const items = flat(allowed(s.menu, can));
            const start = items[0];
            return (
              <div key={s.key} className="sys-card" style={{ animationDelay: `${i * 70}ms`, ["--tone" as string]: s.tone }}>
                <Link href={start.href} className="sys-main">
                  <span className="sys-ic">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.icon} alt="" />
                  </span>
                  <span className="sys-tx">
                    <b>{s.label}</b>
                    <span>{s.desc}</span>
                  </span>
                  <span className="sys-go" aria-hidden>
                    →
                  </span>
                </Link>
                <div className="sys-links">
                  {items.map((m) => (
                    <Link key={m.href} href={m.href}>
                      {m.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
