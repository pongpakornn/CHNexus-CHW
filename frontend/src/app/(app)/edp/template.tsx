"use client";

import { motion, useReducedMotion } from "framer-motion";
import { fadeOnly, pageIn } from "@/lib/motion";

// 🎬 เปลี่ยนหน้าในระบบ EDP (Dashboard / Plan Submission / EDP Planning / Plan Setting): จาง + ขยับขึ้น 8px (0.25 วินาที)
export default function EdpTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div variants={reduce ? fadeOnly : pageIn} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}
