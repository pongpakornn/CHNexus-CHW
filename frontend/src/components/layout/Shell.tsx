"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MENU } from "@/lib/menu";
import { Icon } from "@/components/icons";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { MinReportAlert } from "@/components/notifications/MinReportAlert";
import { ProfileBubble } from "@/components/profile/ProfileBubble";
import { SupportButton } from "@/components/chat/SupportButton";
import { SupportChat } from "@/components/chat/SupportChat";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { FitTables } from "@/components/tables/FitTables";
import { SidebarBrand, SidebarFooter, SidebarNav } from "@/components/sidebars/Sidebar";

// 🧭 หน้าหลัก: Sidebar (กาง 260 / พับ 80 แบบเดิม) + แถบชื่อหน้า - จอเล็ก (มือถือ / แท็บเล็ต) = เมนูเลื่อนออกด้านซ้าย
//   ปุ่มสามขีด: กางอยู่ = สามขีด · พับอยู่ = ขีดหมุนเป็นลูกศร
export function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(false); // จอมือถือ (< 768) = เมนูเลื่อนออกด้านซ้าย
  const items = MENU.filter((m) => me?.can[m.can]);
  const current = MENU.find((m) => path === m.href || path.startsWith(m.href + "/"));

  // หน้าต่างแคบกว่า 1500 -> พับ Sidebar ให้เหลือแต่ไอคอนเอง (เหมือน SidebarAutoWidth ของ WPF)
  useEffect(() => {
    const fit = () => {
      setOpen(window.innerWidth >= 1500);
      setNarrow(window.innerWidth < 768);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // OPEN_PAGE ลง Activity Log ครั้งเดียวต่อการเปิดหน้า (ข้อมูลผู้ใช้รีเฟรช / วาดซ้ำ ไม่ลงซ้ำ)
  const logged = useRef("");
  const uid = me?.userId;
  const title = current?.title;
  // เปลี่ยนหน้า = ปิดเมนูมือถือ (ปรับตอนวาด ไม่ต้องรอ effect)
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setMobile(false);
  }
  useEffect(() => {
    const k = `${uid}|${path}`;
    if (!title || !uid || logged.current === k) return;
    logged.current = k;
    api("/log/page", { method: "POST", body: { title } }).catch(() => {});
  }, [path, title, uid]);

  // 🟣 แถบเมนูที่เลือก (glider): กล่องเดียวเลื่อนไหลไปหาเมนูที่เลือก (เด้งนิด ๆ) · เต็มความกว้าง Sidebar + ขีดขาวชิดขอบซ้ายมีแสงเรือง
  const navBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    navBox.current?.querySelectorAll<HTMLElement>(".sb-nav").forEach((nav) => {
      const g = nav.querySelector<HTMLElement>(".sb-glider");
      const a = nav.querySelector<HTMLElement>("[data-active='true']");
      if (!g) return;
      if (!a) return void (g.style.opacity = "0");
      g.style.height = `${a.offsetHeight}px`;
      g.style.transform = `translateY(${a.offsetTop}px)`;
      g.style.opacity = "1";
    });
  }, [path, items.length, open, mobile]);

  // มือถือ: เมนูปิด = สามขีด, เปิด = ลูกศร · จอใหญ่: กาง = สามขีด, พับ = ลูกศร
  const menuOpen = narrow ? mobile : open;
  const arrow = narrow ? mobile : !open;

  return (
    <div ref={navBox} className="flex h-dvh overflow-hidden">
      {/* Sidebar จอใหญ่: กล่องนอกเลื่อนกว้าง 80 <-> 260 ส่วนข้างในกว้าง 260 ตลอด (ซ่อนส่วนเกิน) = ไอคอนอยู่ที่เดิม ตัวหนังสือไม่ถูกบีบ */}
      <aside className="sb-panel hidden shrink-0 overflow-hidden bg-sidebar shadow-xl backdrop-blur md:flex" style={{ width: open ? 260 : 80 }}>
        <div className="flex h-full w-[260px] shrink-0 flex-col">
          <SidebarBrand compact={!open} />
          <SidebarNav items={items} current={current} compact={!open} />
          <SidebarFooter compact={!open} />
        </div>
      </aside>

      {/* Sidebar มือถือ: เลื่อนเข้าจากซ้าย + พื้นหลังค่อยๆ มืด */}
      <div className={`fixed inset-0 z-50 md:hidden ${mobile ? "" : "pointer-events-none"}`} aria-hidden={!mobile} inert={!mobile}>
        <div className={`sb-dim absolute inset-0 bg-black/40 ${mobile ? "opacity-100" : "opacity-0"}`} onClick={() => setMobile(false)} />
        <aside className={`sb-drawer absolute inset-y-0 left-0 flex w-[260px] flex-col bg-sidebar shadow-2xl backdrop-blur ${mobile ? "translate-x-0" : "-translate-x-full"}`}>
          <SidebarBrand compact={false} />
          <SidebarNav items={items} current={current} compact={false} />
          <SidebarFooter compact={false} />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* แถบบน z-48: เมนูแจ้งเตือน / Support กางทับปุ่มในหน้า (เมนูวงกลม z-40) ได้ · ต่ำกว่าเมนูมือถือ (50) และหน้าต่าง (90+) */}
        <header className="relative z-[48] flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-3 text-ink md:px-5">
          <button
            type="button"
            onClick={() => (window.innerWidth < 768 ? setMobile((v) => !v) : setOpen((o) => !o))}
            className={`menu-toggle ${arrow ? "is-arrow" : ""}`}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className="bars" id="bar1" />
            <span className="bars" id="bar2" />
            <span className="bars" id="bar3" />
          </button>
          <h1 className="truncate text-base font-extrabold uppercase tracking-wide text-primary md:text-lg">{current?.title ?? "CHR-NEXUS"}</h1>
          <div className="ml-auto flex items-center gap-3">
            <SupportButton />
            <NotificationBell />
            <button type="button" onClick={logout} className="logout-btn" aria-label="Logout">
              <span className="logout-ico">
                <Icon name="logout" className="size-5" />
              </span>
              <span className="logout-txt">Logout</span>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        <FitTables />
      </div>
      <ProfileBubble />
      <SupportChat />
      <ChatFeed />
      <MinReportAlert />
    </div>
  );
}
