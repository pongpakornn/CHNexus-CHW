"use client";

import { motion, useReducedMotion } from "framer-motion";
import { fadeOnly, pageIn } from "@/lib/motion";

// 🎬 เปลี่ยนหน้าในระบบ Production Plan (Dashboard / Capacity): จาง + ขยับขึ้น 8px
export default function ChemTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div variants={reduce ? fadeOnly : pageIn} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}
