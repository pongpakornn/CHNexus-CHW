"use client";

import Link from "next/link";
import { PageBody } from "@/components/layout/Page";
import { useAuth } from "@/lib/auth";
import { allowed, systemsFor, type MenuItem } from "@/lib/menu";

// 🧭 เลือกระบบ (หลัง Login): ภาพ Smart Factory Stamping Cell ด้านบน (มีข้อความ "Select a System for Your Work" ในภาพ)
//   ตามด้วยการ์ดระบบที่มีสิทธิ์ (ภาพประกอบลอยเบา ๆ + ชื่อ + คำอธิบาย + ขีดสีระบบ · ชี้ = เด้งขึ้น)
//   กดการ์ด = เข้าหน้าแรกของระบบนั้น (Sidebar เปลี่ยนตามระบบ) · ระบบใหม่ = เพิ่มใน lib/menu.ts (SYSTEMS)
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((m) => (m.children ? flat(m.children) : [m]));

export default function SystemsPage() {
  const { me } = useAuth();
  const can = me?.can ?? {};
  const list = systemsFor(can);

  return (
    <PageBody>
      <div className="sys-hero" data-reveal="own">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/systems/stamping-cell.webp" alt="Select a System for Your Work - เลือกระบบที่ต้องการใช้งาน" width={1672} height={941} />
      </div>
      {list.length === 0 ? (
        <div className="mr-off mt-5">ยังไม่มีสิทธิ์ใช้งานระบบใด กรุณาติดต่อ Admin</div>
      ) : (
        <div className="sys-grid">
          {list.map((s, i) => (
            <Link
              key={s.key}
              href={flat(allowed(s.menu, can))[0].href}
              title={s.desc}
              className="sys-card"
              data-reveal="own"
              style={{ animationDelay: `${120 + i * 70}ms`, ["--c" as string]: s.color }}
            >
              <span className="sys-art" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.art} alt="" loading="lazy" style={{ animationDelay: `${i * -1.1}s` }} />
              </span>
              <span className="sys-tx">
                <b>{s.name}</b>
                <span>{s.sub}</span>
              </span>
              <span className="sys-line" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </PageBody>
  );
}
