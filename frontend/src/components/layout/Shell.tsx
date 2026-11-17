"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { allowed, findItem, menuOf, systemOf, type SystemKey } from "@/lib/menu";
import { Icon } from "@/components/icons";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { MinReportAlert } from "@/components/notifications/MinReportAlert";
import { EdpAlert } from "@/components/notifications/EdpAlert";
import { PcwofSignHost } from "@/components/notifications/PcwofSignHost";
import { MinSignHost } from "@/components/notifications/MinSignHost";
import { MinSignAlert } from "@/components/notifications/MinSignAlert";
import { ChemSignAlert } from "@/components/notifications/ChemSignAlert";
import { ProfileBubble } from "@/components/profile/ProfileBubble";
import { SupportButton } from "@/components/chat/SupportButton";
import { SupportChat } from "@/components/chat/SupportChat";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { FitTables } from "@/components/tables/FitTables";
import { SidebarBrand, SidebarFooter, SidebarNav } from "@/components/sidebars/Sidebar";

// ชื่อหน้าบนแถบด้านบน + OPEN_PAGE ลง Activity Log ครั้งเดียวต่อการเปิดหน้า (อ่าน ?type= ของ Product Control ด้วย)
function PageTitle({ uid }: { uid?: string }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const title = findItem(path, "?" + search)?.title;
  const logged = useRef("");
  useEffect(() => {
    const k = `${uid}|${path}?${search}`;
    if (!title || !uid || logged.current === k) return;
    logged.current = k;
    api("/log/page", { method: "POST", body: { title } }).catch(() => {});
  }, [path, search, title, uid]);
  return <h1 className="truncate text-base font-extrabold uppercase tracking-wide text-primary md:text-lg">{title ?? "CHR-NEXUS"}</h1>;
}

// 🧭 หน้าหลัก: Sidebar (กาง 260 / พับ 80 แบบเดิม) + แถบชื่อหน้า - จอเล็ก (มือถือ / แท็บเล็ต) = เมนูเลื่อนออกด้านซ้าย
//   Sidebar ตามระบบ: /cims = เมนู CIMS · /systems /master = เมนูหลัก (เลือกระบบ · MASTER DATA · USER MANAGEMENT)
//   /admin (ใช้ร่วมทุกระบบ) = คง Sidebar ของระบบที่กดมา
//   ปุ่มสามขีด: กางอยู่ = สามขีด · พับอยู่ = ขีดหมุนเป็นลูกศร
export function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(false); // จอมือถือ (< 768) = เมนูเลื่อนออกด้านซ้าย
  const [sys, setSys] = useState<SystemKey>(() => systemOf(path) ?? "root");
  const here = systemOf(path);
  if (here && here !== sys) setSys(here);
  const can = { ...me?.can, level1: me?.userLevel === 1 }; // level1 = เมนู SYSTEM CONFIGURATION (Admin Level 1)
  const items = allowed(menuOf(sys), can);

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

  // เปลี่ยนหน้า = ปิดเมนูมือถือ (ปรับตอนวาด ไม่ต้องรอ effect)
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setMobile(false);
  }
  // มือถือ: เมนูปิด = สามขีด, เปิด = ลูกศร · จอใหญ่: กาง = สามขีด, พับ = ลูกศร
  const menuOpen = narrow ? mobile : open;
  const arrow = narrow ? mobile : !open;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar จอใหญ่: กล่องนอกเลื่อนกว้าง 80 <-> 260 ส่วนข้างในกว้าง 260 ตลอด (ซ่อนส่วนเกิน) = ไอคอนอยู่ที่เดิม ตัวหนังสือไม่ถูกบีบ */}
      <aside className="sb-panel hidden shrink-0 overflow-hidden bg-sidebar shadow-xl backdrop-blur md:flex" style={{ width: open ? 260 : 80 }}>
        <div className="flex h-full w-[260px] shrink-0 flex-col">
          <SidebarBrand compact={!open} system={sys === "cims" ? "CIMS" : sys === "edp" ? "EDP" : sys === "pp" ? "PLAN" : sys === "chem" ? "CHEM" : sys === "pc" ? "PC" : sys === "wof" ? "WOF" : undefined} />
          <Suspense>
            <SidebarNav items={items} compact={!open} onExpand={() => setOpen(true)} />
          </Suspense>
          <SidebarFooter compact={!open} />
        </div>
      </aside>

      {/* Sidebar มือถือ: เลื่อนเข้าจากซ้าย + พื้นหลังค่อยๆ มืด */}
      <div className={`fixed inset-0 z-50 md:hidden ${mobile ? "" : "pointer-events-none"}`} aria-hidden={!mobile} inert={!mobile}>
        <div className={`sb-dim absolute inset-0 bg-black/40 ${mobile ? "opacity-100" : "opacity-0"}`} onClick={() => setMobile(false)} />
        <aside className={`sb-drawer absolute inset-y-0 left-0 flex w-[260px] flex-col bg-sidebar shadow-2xl backdrop-blur ${mobile ? "translate-x-0" : "-translate-x-full"}`}>
          <SidebarBrand compact={false} system={sys === "cims" ? "CIMS" : sys === "edp" ? "EDP" : sys === "pp" ? "PLAN" : sys === "chem" ? "CHEM" : sys === "pc" ? "PC" : sys === "wof" ? "WOF" : undefined} />
          <Suspense>
            <SidebarNav items={items} compact={false} onNavigate={() => setMobile(false)} />
          </Suspense>
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
          {/* ↩ กลับหน้าเลือกระบบ (ทุกหน้ายกเว้นหน้าเลือกระบบเอง) */}
          {path !== "/systems" && (
            <Link href="/systems" className="sys-back" aria-label="กลับหน้าเลือกระบบ" title="กลับหน้าเลือกระบบ (SELECT SYSTEM)">
              <svg viewBox="0 0 24 24" className="sys-back-ic" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m14 6-6 6 6 6" />
              </svg>
              <span className="sys-back-tx">SYSTEMS</span>
            </Link>
          )}
          <Suspense>
            <PageTitle uid={me?.userId} />
          </Suspense>
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
      <EdpAlert />
      <MinSignAlert />
      <ChemSignAlert />
      <MinSignHost />
      <PcwofSignHost />
    </div>
  );
}
