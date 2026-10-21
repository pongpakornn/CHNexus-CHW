"use client";

import { useSyncExternalStore } from "react";

// มุมจอของวงกลมโปรไฟล์ (ลากย้ายได้ 4 มุม จำไว้ในเครื่อง) - Toast ใช้ค่านี้หลบไม่ให้ทับกัน
export type Corner = "tl" | "tr" | "bl" | "br";

const KEY = "nexus.profileCorner";
const EVT = "nexus-profile-corner";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];
let mounted = false;

function read(): Corner {
  try {
    const v = localStorage.getItem(KEY) as Corner | null;
    if (v && CORNERS.includes(v)) return v;
  } catch {
    /* ไม่มี localStorage = ใช้มุมเริ่มต้น */
  }
  return "br";
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function setCorner(c: Corner) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* จำไม่ได้ก็ใช้ได้ในหน้านี้ */
  }
  window.dispatchEvent(new Event(EVT));
}

// วงกลมโปรไฟล์แสดงอยู่หรือไม่ (หน้า Login ไม่มี)
export function setBubbleMounted(v: boolean) {
  mounted = v;
  window.dispatchEvent(new Event(EVT));
}

export function useCorner(): Corner {
  return useSyncExternalStore(subscribe, read, () => "br");
}

// มุมที่วงกลมโปรไฟล์อยู่ตอนนี้ / null = ไม่มีวงกลมบนจอ
export function useBubbleCorner(): Corner | null {
  return useSyncExternalStore(subscribe, () => (mounted ? read() : null), () => null);
}
