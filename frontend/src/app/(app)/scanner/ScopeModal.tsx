"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { stockIcon, tileStyle } from "@/lib/stockIcons";
import type { ScannerContext } from "./types";

// ข้อมูลการ์ดคลังแบบหน้า Store (Max-Min) - ไม่มีสิทธิ์ดู Store = แสดงการ์ดโดยไม่มีจำนวนสินค้า
type StoreCard = { stkId: number; stockType: string | null; itemCount: number; unit: string; coil: { totalCount: number; totalKg: number } | null };

// 🏬 SCAN STOCKS: 1 คลัง / หลายคลังสแกนร่วมกัน / AUTO (ALL STOCKS) + ★ คลังที่ตัดก่อนตอนสแกนออก
//    เลือกคลังด้วยการ์ดแบบหน้า Store: กดทั้งใบ = เลือก / ยกเลิก · วงเลือกมุมขวาบนเติมสี + วาดเครื่องหมายถูก · การ์ดที่เลือกเรืองสีประจำคลัง
export function ScopeModal({ ctx, onClose, onSaved }: { ctx: ScannerContext; onClose: () => void; onSaved: (serialized: string) => void }) {
  const toast = useToast();
  const [auto, setAuto] = useState(ctx.scope.auto);
  const [ids, setIds] = useState<number[]>(ctx.scope.ids);
  const [prio, setPrio] = useState<number | null>(ctx.scope.priorityId);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<Record<number, StoreCard>>({});

  useEffect(() => {
    api<{ stocks: StoreCard[] }>("/store/stocks")
      .then((r) => setCards(Object.fromEntries(r.stocks.map((s) => [s.stkId, s]))))
      .catch(() => {}); // ไม่มีสิทธิ์หน้า Store = การ์ดไม่มีจำนวนสินค้า
  }, []);

  const toggle = (id: number) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const chosen = auto ? ctx.stocks.map((s) => s.stkId) : ids;

  async function save() {
    if (!auto && ids.length === 0) return toast.show("WARNING", "กรุณาเลือกคลังอย่างน้อย 1 คลัง", "warn");
    setBusy(true);
    try {
      const r = await api<{ serialized: string }>("/scanner/scope", {
        method: "POST",
        body: { auto, ids, priorityId: prio != null && chosen.includes(prio) && chosen.length > 1 ? prio : null },
      });
      onSaved(r.serialized);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="xl"
      title="🏬 SCAN STOCKS"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-xs font-extrabold text-ink-soft">
            {auto ? "⚡ AUTO — ทุกคลัง" : `เลือกแล้ว ${ids.length} คลัง`}
            {prio != null && chosen.length > 1 && chosen.includes(prio) && ` • ★ OUT FIRST: ${ctx.stocks.find((s) => s.stkId === prio)?.code}`}
          </span>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" onClick={save} disabled={busy}>
            SAVE
          </button>
        </>
      }
    >
      {/* ⚡ AUTO: สวิตช์ใหญ่ */}
      <button type="button" className={`sk-auto ${auto ? "is-on" : ""}`} onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
        <span className="sk-auto-ic">⚡</span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-black tracking-wide">AUTO ( ALL STOCKS )</span>
          <span className="block text-xs font-semibold opacity-80">ระบบหาคลังของสินค้าที่สแกนเอง — ไม่ต้องเลือกคลัง</span>
        </span>
        <span className="sk-switch" aria-hidden>
          <span />
        </span>
      </button>

      <div className={`mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 ${auto ? "sk-locked" : ""}`}>
        {ctx.stocks.map((s, i) => {
          const card = cards[s.stkId];
          const [ic, col] = stockIcon(s.code, i, card?.stockType);
          const on = chosen.includes(s.stkId);
          return (
            <div
              key={s.stkId}
              role="checkbox"
              aria-checked={on}
              aria-disabled={auto}
              tabIndex={auto ? -1 : 0}
              onClick={() => !auto && toggle(s.stkId)}
              onKeyDown={(e) => !auto && (e.key === " " || e.key === "Enter") && (e.preventDefault(), toggle(s.stkId))}
              className={`sk-card card-in group ${on ? "is-on" : ""}`}
              style={{ "--c": col, animationDelay: `${i * 50}ms` } as React.CSSProperties}
            >
              <div className="sk-bar" />
              {/* วงเลือก: เติมสี + วาดเครื่องหมายถูก */}
              <span className="sk-check" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>

              <div className="relative flex items-start gap-3 pr-8">
                <span className="sk-tile grid size-12 shrink-0 place-items-center rounded-[15px]" style={tileStyle(col)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ic} alt="" draggable={false} className="size-7 object-contain" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-lg font-extrabold text-[#1f2350]">{s.code}</span>
                    {s.isMain && <span className="sk-badge" style={{ background: col }}>MAIN</span>}
                    {s.isLiveView && <span className="sk-badge bg-danger">LIVE</span>}
                  </div>
                  <div className="truncate text-sm font-semibold text-ink-soft">{s.name}</div>
                </div>
              </div>

              <div className="relative mt-4 flex items-center gap-3">
                <div className="min-w-0">
                  {card ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[30px] font-extrabold leading-none tabular-nums text-[#1f2350]">{card.itemCount.toLocaleString()}</span>
                        <span className="sk-chip">{card.unit || s.unit}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">ITEMS</div>
                    </>
                  ) : (
                    <span className="sk-chip">{s.unit}</span>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.canScanIn && <span className="sk-io is-in">IN</span>}
                    {s.canScanOut && <span className="sk-io is-out">OUT</span>}
                    {s.supportsReturn && <span className="sk-io is-ret">RETURN</span>}
                  </div>
                </div>
                <span
                  aria-hidden
                  className="sk-art pointer-events-none ml-auto size-[76px] shrink-0"
                  style={{
                    background: `linear-gradient(145deg, color-mix(in srgb, ${col} 55%, white), ${col})`,
                    WebkitMask: `url(${ic}) center / contain no-repeat`,
                    mask: `url(${ic}) center / contain no-repeat`,
                  }}
                />
              </div>

              {card?.coil && (
                <div className="sk-coil mt-3">
                  COIL NO {card.coil.totalCount.toLocaleString()}
                  <span className="mx-1.5 opacity-35">|</span>
                  {qty(card.coil.totalKg)} KG
                </div>
              )}

              {chosen.length > 1 && on && s.canScanOut && (
                <button
                  type="button"
                  onClick={(e) => (e.stopPropagation(), setPrio(prio === s.stkId ? null : s.stkId))}
                  className={`sk-prio mt-3 ${prio === s.stkId ? "is-on" : ""}`}
                  title="★ OUT FIRST: สินค้าอยู่หลายคลัง สแกนออกตัดคลังนี้ก่อน"
                >
                  ★ OUT FIRST
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
