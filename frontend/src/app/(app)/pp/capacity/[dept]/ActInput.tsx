"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ✍️ ช่องกรอก M/C Actual ในตาราง DAILY
//   NumPick  = พิมพ์ได้ + รายการค่าที่ "ผู้ใช้คนนี้" เคยกรอกล่าสุดเลื่อนลงมาให้เลือก (Working hour มีชั่วโมงตามกะเพิ่มให้ด้วย)
//   ManStep  = ไม่ต้องพิมพ์: ปุ่ม − / + ทีละ 1 คน · กดตัวเลข = เลือกจากค่าล่าสุด
export type Recent = { hr: number[]; stroke: number[]; man: number[] };
export type Preset = { v: number; label: string };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

// รายการลอยบน body (ไม่โดนตารางตัด) วางใต้ช่อง · ล่างไม่พอ = ขึ้นบน · ตามตอนเลื่อนตาราง
function useFloat(open: boolean, anchor: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState({ left: 0, top: 0, up: false });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < 240 && r.top > 240;
      setPos({ left: Math.min(r.left, window.innerWidth - 196), top: up ? r.top - 6 : r.bottom + 6, up });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor]);
  return pos;
}

function SugList({ id, open, anchor, items, hi, onPick, onHi, listRef }: { id?: string; open: boolean; anchor: React.RefObject<HTMLElement | null>; items: { v: number; label?: string; head?: string }[]; hi: number; onPick: (v: number) => void; onHi: (i: number) => void; listRef: React.RefObject<HTMLUListElement | null> }) {
  const pos = useFloat(open, anchor);
  if (!open || items.length === 0 || typeof document === "undefined") return null;
  return createPortal(
    <ul ref={listRef} id={id} role="listbox" className={`cmb-list pp-sug ${pos.up ? "is-up" : ""}`} style={{ left: pos.left, top: pos.top, translate: pos.up ? "0 -100%" : undefined }} onMouseDown={(e) => e.preventDefault()}>
      {items.map((o, i) => (
        <li key={(o.head ?? "") + o.v + (o.label ?? "")} role="option" aria-selected={i === hi} data-head={o.head} className={i === hi ? "is-hi" : ""} style={{ "--i": Math.min(i, 10) } as React.CSSProperties} onMouseEnter={() => onHi(i)} onClick={() => onPick(o.v)}>
          <b>{fmt(o.v)}</b>
          {o.label && <small>{o.label}</small>}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

export function NumPick({ value, onChange, recent, presets = [], label, className = "pp-in" }: { value: string; onChange: (v: string) => void; recent: number[]; presets?: Preset[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const lid = useId();
  const q = value.trim();
  const seen = new Set<number>();
  const items = [
    ...recent.map((v) => ({ v, label: "ล่าสุดของคุณ" })),
    ...presets.map((p) => ({ v: p.v, label: p.label })),
  ].filter((o) => (q === "" || fmt(o.v).startsWith(q)) && fmt(o.v) !== q && !seen.has(o.v) && seen.add(o.v));
  const pick = (v: number) => {
    onChange(fmt(v));
    setOpen(false);
    setHi(-1);
  };
  return (
    <>
      <input
        ref={box}
        className={className}
        inputMode="decimal"
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-label={label}
        aria-expanded={open}
        aria-controls={lid}
        autoComplete="off"
        onFocus={() => (setOpen(true), setHi(-1))}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => (onChange(e.target.value), setOpen(true), setHi(-1))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.max(0, Math.min(items.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
            return;
          }
          if (e.key === "Escape") return setOpen(false);
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (open && items[hi]) return pick(items[hi].v);
          setOpen(false);
          // Enter = ไปช่องวันถัดไป
          const next = (e.target as HTMLElement).closest("td")?.nextElementSibling?.querySelector("input");
          (next as HTMLInputElement | null)?.focus();
        }}
      />
      <SugList id={lid} open={open} anchor={box} items={items} hi={hi} onHi={setHi} onPick={pick} listRef={list} />
    </>
  );
}

export function ManStep({ value, onChange, recent, label }: { value: string; onChange: (v: string) => void; recent: number[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const n = value === "" ? null : Number(value);
  const step = (k: number) => {
    const next = Math.max(0, Math.min(999, (n ?? 0) + k));
    onChange(next === 0 && k < 0 && (n ?? 0) <= 1 ? "" : String(next));
  };
  const items = recent.filter((v) => v !== n).map((v) => ({ v, label: "ล่าสุดของคุณ" }));
  return (
    <span className={`pp-man ${n != null ? "has-v" : ""}`}>
      <button type="button" className="pp-man-b" aria-label={`ลด ${label}`} disabled={!n} onClick={() => step(-1)}>
        −
      </button>
      <button
        ref={box}
        type="button"
        className="pp-man-v"
        aria-label={`${label}: ${value || "ว่าง"} (กดเพื่อเลือกค่าล่าสุด)`}
        title={items.length ? "กดเพื่อเลือกค่าล่าสุดของคุณ" : undefined}
        onClick={() => items.length && setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "+") return e.preventDefault(), step(1);
          if (e.key === "ArrowDown" || e.key === "-") return e.preventDefault(), step(-1);
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <span key={value}>{value || "–"}</span>
      </button>
      <button type="button" className="pp-man-b is-up" aria-label={`เพิ่ม ${label}`} onClick={() => step(1)}>
        +
      </button>
      <SugList
        open={open}
        anchor={box}
        items={items}
        hi={hi}
        onHi={setHi}
        listRef={list}
        onPick={(v) => {
          onChange(fmt(v));
          setOpen(false);
        }}
      />
    </span>
  );
}
