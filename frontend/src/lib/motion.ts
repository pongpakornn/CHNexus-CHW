// 🎞 ค่าการเคลื่อนไหวกลางของทั้งระบบ (Framer Motion) - ปรับที่ไฟล์นี้ที่เดียว ทุกหน้าเปลี่ยนตาม
//   EASE = เส้นโค้งเดียวกับ Dropdown / --ease-drop ของระบบ · ลดการเคลื่อนไหว (prefers-reduced-motion) = ใช้ fade สั้น ๆ แทน
import type { Transition, Variants } from "framer-motion";

/** เส้นโค้งหลักของระบบ (ตรงกับ --ease-drop) */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** ⏱ ค่าที่ปรับได้ (หน่วยวินาที) */
export const DUR = {
  fast: 0.15, // hover / focus / ตัวเลขเปลี่ยน
  base: 0.25, // เปลี่ยนหน้า / สลับ CHART-TABLE
  card: 0.5, // การ์ดเปิดเข้ามา
  exit: 0.22, // การ์ดหด + จางออก (ลบ)
};

/** 🧲 spring: การ์ดอื่นเลื่อนหลบ / การ์ดดูดลงช่องใหม่ (stiffness = แรงดึง · damping = หน่วง · mass = น้ำหนัก) */
export const springSoft: Transition = { type: "spring", stiffness: 350, damping: 30, mass: 0.8 };
/** spring ที่เด้งเกินนิด ๆ ตอนวาง / ตอนเลือก */
export const springPop: Transition = { type: "spring", stiffness: 420, damping: 22, mass: 0.7 };

/** ช่วงห่างระหว่างการ์ดที่ไล่เข้ามา (stagger) + เพดานรวม */
export const STAGGER = { cards: 0.05, chips: 0.03, page: 0.08, maxTotal: 0.6 };
export const staggerDelay = (i: number, step = STAGGER.cards) => Math.min(i * step, STAGGER.maxTotal);

/** ไล่ขึ้นจากล่าง (การ์ด / แถบ) */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: DUR.card, ease: EASE, delay: staggerDelay(i) } }),
  exit: { opacity: 0, scale: 0.95, transition: { duration: DUR.exit, ease: EASE } },
};

/** ไล่ลงจากบน (แถบเครื่องมือด้านบน) */
export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -10 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: i * STAGGER.page } }),
};

/** การ์ดของหน้า Dashboard (y 24 · ไล่ทีละ 0.08 วินาที) */
export const panelIn: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EASE, delay: i * STAGGER.page } }),
};

/** เปลี่ยนหน้า: จาง + ขยับขึ้น 8px */
export const pageIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
};

/** ชี้การ์ด: ยกขึ้น 2px */
export const cardHover = { y: -2, transition: { duration: DUR.fast, ease: EASE } };
/** กดปุ่ม: ยุบ */
export const press = { scale: 0.97 };

/** ลดการเคลื่อนไหว: variants ที่เหลือแค่ fade สั้น ๆ */
export const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.fast } },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
};
