"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { findItem, type MenuItem } from "@/lib/menu";

// 🧭 ชิ้นส่วน Sidebar (โลโก้ / เมนู / ท้าย) - Shell วางทั้งแบบ Desktop (กาง 260 / พับ 80) และ Drawer มือถือ
//   เมนูหลัก = แถบ glider เลื่อนไหลไปหาเมนูที่เลือก · เมนูย่อย (MASTER DATA) = กาง / พับนุ่ม ๆ (.fold) ตามหน้าที่อยู่
//   Product Control: Part / Material / Component … กางต่อเป็นรายชื่อคลังของประเภทนั้น (เฉพาะคลังที่มีสิทธิ์ดู)

// ตัวหนังสือในเมนู: วาดไว้ตลอด แค่จาง / เลื่อนออกตอนพับ = กาง-พับลื่น ไม่กระตุกจากการสร้าง / ลบ element
const hide = (compact: boolean) => (compact ? "pointer-events-none -translate-x-2 opacity-0" : "translate-x-0 opacity-100");

type MenuStock = { stkId: number; code: string; name: string; type: string };

// คลังของ Product Control (โหลดครั้งเดียวต่อการเปิดเว็บ ใช้ร่วมกันทั้ง Sidebar จอใหญ่ + มือถือ)
let stockCache: Promise<MenuStock[]> | null = null;
function useMenuStocks(on: boolean) {
  const [list, setList] = useState<MenuStock[]>([]);
  useEffect(() => {
    if (!on) return;
    stockCache ??= api<MenuStock[]>("/master/menu").catch(() => ((stockCache = null), []));
    let alive = true;
    stockCache.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [on]);
  return list;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" className={`sb-chev ${open ? "is-open" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export function SidebarNav({ items, compact, onExpand, onNavigate }: { items: MenuItem[]; compact: boolean; onExpand?: () => void; onNavigate?: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const current = findItem(path, "?" + search);
  const stk = Number(params.get("stk")) || 0;
  const hasStocks = items.some((m) => m.children?.some((c) => c.stockType));
  const stocks = useMenuStocks(hasStocks);

  // กลุ่มที่กางอยู่: กลุ่มของหน้าปัจจุบันกางเอง · ผู้ใช้กด = สลับ
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const inGroup = (m: MenuItem) => !!m.children?.some((c) => c === current || c.href === current?.href);
  const isOpen = (key: string, auto: boolean) => open[key] ?? auto;
  const toggle = (key: string, auto: boolean) => {
    if (compact) {
      onExpand?.();
      return setOpen((o) => ({ ...o, [key]: true }));
    }
    setOpen((o) => ({ ...o, [key]: !(o[key] ?? auto) }));
  };

  // 🟣 แถบ glider: เลื่อนไปหาเมนูหลักที่เลือก · เมนูย่อยกาง / พับ (ความสูงเปลี่ยน) = ตามไปเอง
  const box = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = box.current;
    if (!nav) return;
    const place = () => {
      const g = nav.querySelector<HTMLElement>(":scope > .sb-glider");
      const a = nav.querySelector<HTMLElement>(":scope > .sb-list > [data-top] > [data-active='true']");
      if (!g) return;
      if (!a) return void (g.style.opacity = "0");
      g.style.height = `${a.offsetHeight}px`;
      g.style.transform = `translateY(${a.offsetTop}px)`;
      g.style.opacity = "1";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav.querySelector(".sb-list") ?? nav);
    return () => ro.disconnect();
  }, [path, search, items, compact]);

  const top = (m: MenuItem, active: boolean, extra?: React.ReactNode) => (
    <>
      {!active && <span className="absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-white opacity-0 transition-all duration-300 group-hover:h-4 group-hover:opacity-70" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={m.icon}
        alt=""
        className={`h-7 w-7 shrink-0 object-contain brightness-0 invert transition-transform duration-300 ${active ? "scale-110 drop-shadow-[0_2px_6px_rgba(0,0,0,.35)]" : "group-hover:-rotate-6 group-hover:scale-110"}`}
      />
      <span className={`sb-text truncate ${hide(compact)}`}>{m.label}</span>
      {extra}
    </>
  );
  const topCls = (active: boolean) =>
    `group relative z-[1] flex w-full items-center gap-3 overflow-hidden py-2.5 pl-[26px] pr-4 text-left text-sm font-bold transition-all duration-300 ${
      active ? "sb-sheen text-white" : `text-white/65 hover:bg-white/[.06] hover:text-white ${compact ? "" : "hover:pl-[30px]"}`
    }`;

  return (
    <nav ref={box} className="sb-nav relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden py-2" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <span className="sb-glider" aria-hidden />
      <div className="sb-list flex flex-col gap-1">
        {items.map((m) => {
          if (!m.children) {
            const active = current?.href === m.href;
            return (
              <div key={m.href} data-top>
                <Link href={m.href} data-active={active} title={compact ? m.label : undefined} className={topCls(active)}>
                  {top(m, active, m.ready === false && <span className={`sb-text ml-auto rounded bg-white/15 px-1.5 text-[10px] font-bold ${hide(compact)}`}>SOON</span>)}
                </Link>
              </div>
            );
          }
          // กลุ่มเมนูย่อย (MASTER DATA): หัวกลุ่ม = กาง / พับ · อยู่ในกลุ่มนี้ = หัวกลุ่มมีแถบ glider
          const active = inGroup(m) || current?.href === m.href;
          const opened = !compact && isOpen(m.href, active);
          return (
            <div key={m.href} data-top>
              <button type="button" data-active={active} aria-expanded={opened} title={compact ? m.label : undefined} className={topCls(active)} onClick={() => toggle(m.href, active)}>
                {top(m, active, <span className={`sb-text ml-auto ${hide(compact)}`}><Chevron open={opened} /></span>)}
              </button>
              <div className={`fold ${opened ? "" : "is-closed"}`} inert={!opened}>
                <div>
                  <div className="sb-sub">
                    {m.children.map((c) => {
                      const kids = c.stockType ? stocks.filter((s) => s.type === c.stockType) : [];
                      if (c.stockType && kids.length === 0) return null; // ไม่มีคลังประเภทนี้ที่ดูได้ = ไม่แสดง
                      const on = current?.href === c.href;
                      const sub = isOpen(c.href, on);
                      return (
                        <div key={c.href}>
                          {c.caption && <div className="sb-cap">{c.caption}</div>}
                          <div className={`sb-sub-row ${on && !stk ? "is-on" : ""}`}>
                            <Link href={c.href} className="sb-sub-link" onClick={() => kids.length && setOpen((o) => ({ ...o, [c.href]: true }))}>
                              <span className="sb-dot" />
                              <span className="truncate">{c.label}</span>
                            </Link>
                            {kids.length > 0 && (
                              <button type="button" className="sb-sub-tog" aria-label={sub ? "พับ" : "กาง"} aria-expanded={sub} onClick={() => toggle(c.href, on)}>
                                <Chevron open={sub} />
                              </button>
                            )}
                          </div>
                          {kids.length > 0 && (
                            <div className={`fold ${sub ? "" : "is-closed"}`} inert={!sub}>
                              <div>
                                <div className="sb-stk">
                                  {kids.map((s, k) => (
                                    <Link
                                      key={s.stkId}
                                      href={`${c.href}&stk=${s.stkId}`}
                                      title={s.name}
                                      className={`sb-stk-link ${on && stk === s.stkId ? "is-on" : ""}`}
                                      style={{ "--i": k } as React.CSSProperties}
                                    >
                                      <b>{s.code}</b>
                                      {s.name && s.name !== s.code && <span>{s.name}</span>}
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function SidebarBrand({ compact, system }: { compact: boolean; system?: string }) {
  return (
    <div className="flex h-[92px] shrink-0 items-center gap-2.5 px-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/logo.png" alt="CHR-Nexus" className="h-10 w-10 shrink-0 object-contain" />
      <div className={`sb-text min-w-0 leading-tight ${hide(compact)}`}>
        <div className="flex items-center gap-1.5 whitespace-nowrap text-lg font-extrabold text-white">
          CHR-Nexus
          {system && <span className="sb-sys">{system}</span>}
        </div>
        <div className="whitespace-nowrap text-[9.5px] font-semibold text-white/75">CH.RADIATORS COMPANY LIMITED</div>
        <div className="whitespace-nowrap text-[10px] font-medium text-white/55">บริษัท ซีเอช เรดิเอเตอร์ จำกัด</div>
      </div>
    </div>
  );
}

// ท้าย Sidebar: "P.U." (กลาง 80) กับข้อความเต็ม (กลาง 260) จางสลับกัน
export function SidebarFooter({ compact }: { compact: boolean }) {
  return (
    <div className="relative h-9 shrink-0 whitespace-nowrap text-[10px] text-white/45">
      <span className={`sb-text absolute left-0 top-1 w-20 text-center ${compact ? "opacity-100" : "opacity-0"}`}>P.U.</span>
      <span className={`sb-text absolute inset-x-0 top-1 text-center ${hide(compact)}`}>© 2026 CHR-Nexus • Pongpakorn Urang</span>
    </div>
  );
}
