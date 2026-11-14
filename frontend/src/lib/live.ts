"use client";

import { useEffect, useRef } from "react";
import { deviceName } from "./api";

// ⚡ เรียลไทม์ทันที: ทั้งแท็บใช้การเชื่อมต่อเดียว (long-poll /api/live/wait) ฟังทุกหัวข้อที่หน้าจอสนใจ
//    เซิร์ฟเวอร์ตอบทันทีที่หัวข้อเปลี่ยน -> เรียก callback ของหัวข้อนั้น · เน็ตหลุด = ลองใหม่เอง แล้วรีเฟรชทุกหัวข้อ (ไม่ค้างค่าเก่า)
//    กลับมาที่แท็บ = รีเฟรชทุกหัวข้อทันที · แท็บที่ซ่อนอยู่ = หยุดรอ (คืนการเชื่อมต่อให้แท็บที่ใช้อยู่ เปิดหลายแท็บไม่ค้าง)
type Cb = () => void;
const subs = new Map<string, Set<Cb>>();
let version: number | null = null;
let ctrl: AbortController | null = null;
let running = false;
let topicsKey = "";

function fireAll() {
  for (const set of subs.values()) for (const cb of set) cb();
}

function fire(topics: string[]) {
  const seen = new Set<Cb>();
  for (const t of topics)
    for (const cb of subs.get(t) ?? [])
      if (!seen.has(cb)) {
        seen.add(cb);
        cb();
      }
}

async function loop() {
  if (running) return;
  running = true;
  let fails = 0;
  while (subs.size > 0 && !hidden()) {
    const topics = [...subs.keys()].sort();
    topicsKey = topics.join(",");
    ctrl = new AbortController();
    try {
      const q = new URLSearchParams({ topics: topicsKey });
      if (version !== null) q.set("v", String(version));
      const res = await fetch(`/api/live/wait?${q}`, { credentials: "same-origin", headers: { "X-Client-Device": deviceName() }, signal: ctrl.signal, cache: "no-store" });
      if (res.status === 401) {
        running = false; // Session หมดอายุ: หยุดถาม (AppGate / auth พาออกไปหน้า Login เอง) - ไม่ยิงซ้ำทุก 5 วินาที
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as { v: number; changed: string[] };
      const first = version === null;
      version = r.v;
      if (fails > 0) fireAll(); // เพิ่งต่อกลับได้ -> ดึงข้อมูลล่าสุดทุกหัวข้อ
      else if (!first && r.changed.length) fire(r.changed);
      fails = 0;
    } catch (e) {
      if ((e as Error).name === "AbortError") continue; // หัวข้อเปลี่ยน -> ถามใหม่ด้วยรายการใหม่
      fails++;
      await new Promise((ok) => setTimeout(ok, Math.min(5000, 800 * fails) * (0.75 + Math.random() * 0.5)));
    }
  }
  running = false;
}

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function restart() {
  const key = [...subs.keys()].sort().join(",");
  if (running && key !== topicsKey) ctrl?.abort();
  if (!running && subs.size > 0 && !hidden()) void loop();
}

if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (hidden()) return void ctrl?.abort(); // ออกจากแท็บ = ปิดการรอ
    version = null; // กลับมา = เริ่มนับใหม่ + ดึงข้อมูลล่าสุดทุกหัวข้อ
    fireAll();
    restart();
  });

/**
 * ฟังการเปลี่ยนแปลงแบบทันที: topics เช่น ["store:1"], ["store", "data"], ["data", "pr"]
 * fallbackMs = ถามเองเป็นระยะเผื่อข้อมูลเปลี่ยนจากภายนอกที่เซิร์ฟเวอร์ไม่รู้ (0 = ไม่ถาม)
 * callback ไม่ถูกเรียกซ้อน: ระหว่างทำงานอยู่ถ้ามีสัญญาณใหม่ จะทำอีกรอบเดียวหลังเสร็จ
 */
export function useLive(topics: string[], callback: () => void | Promise<unknown>, fallbackMs = 0) {
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  });
  const key = topics.join(",");

  useEffect(() => {
    let busy = false;
    let again = false;
    const run: Cb = async () => {
      if (busy) return void (again = true);
      busy = true;
      try {
        do {
          again = false;
          await cb.current();
        } while (again);
      } catch {
        /* รอบหน้าลองใหม่ */
      } finally {
        busy = false;
      }
    };
    const list = key.split(",").filter(Boolean);
    for (const t of list) {
      if (!subs.has(t)) subs.set(t, new Set());
      subs.get(t)!.add(run);
    }
    restart();
    const t = fallbackMs > 0 ? setInterval(() => document.visibilityState === "visible" && run(), fallbackMs) : undefined;
    return () => {
      clearInterval(t);
      for (const tp of list) {
        const set = subs.get(tp);
        set?.delete(run);
        if (set && set.size === 0) subs.delete(tp);
      }
      restart();
    };
  }, [key, fallbackMs]);
}

/**
 * โหลดเงียบจากสัญญาณเรียลไทม์แล้วได้ข้อมูลเดิม = ไม่ต้อง setState (ไม่ re-render · ไม่กระพริบ · กราฟ / แอนิเมชันไม่เล่นซ้ำ)
 * ใช้: const last = useRef(""); ... const r = await api(...); if (sameData(last, r)) return; setData(r);
 */
export function sameData(last: { current: string }, value: unknown): boolean {
  const s = JSON.stringify(value);
  if (s === last.current) return true;
  last.current = s;
  return false;
}
