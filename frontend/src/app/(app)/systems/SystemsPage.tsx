"use client";

import Link from "next/link";
import { PageBody } from "@/components/layout/Page";
import { useAuth } from "@/lib/auth";
import { allowed, systemsFor, type MenuItem } from "@/lib/menu";

// 🧭 เลือกระบบ (หลัง Login): การ์ดสี่เหลี่ยมของระบบที่มีสิทธิ์ · ไอคอนสี + ชื่อ + คำอธิบายสั้น · ชี้ = เด้งขึ้น
//   กดการ์ด = เข้าหน้าแรกของระบบนั้น (Sidebar เปลี่ยนตามระบบ) · ระบบใหม่ = เพิ่มใน lib/menu.ts (SYSTEMS)
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((m) => (m.children ? flat(m.children) : [m]));

export default function SystemsPage() {
  const { me } = useAuth();
  const can = me?.can ?? {};
  const list = systemsFor(can);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";

  return (
    <PageBody>
      <div className="sys-head">
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
          {list.map((s, i) => (
            <Link
              key={s.key}
              href={flat(allowed(s.menu, can))[0].href}
              title={s.desc}
              className="sys-card"
              data-reveal="own"
              style={{ animationDelay: `${i * 60}ms`, ["--c" as string]: s.color }}
            >
              <span className="sys-ic">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.icon} alt="" />
              </span>
              <span className="sys-tx">
                <b>{s.name}</b>
                <span>{s.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </PageBody>
  );
}
