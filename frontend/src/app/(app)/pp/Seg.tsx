"use client";

import { motion } from "framer-motion";
import { springSoft } from "@/lib/motion";

// 🎚 ปุ่มสลับแบบแถบ: พื้นขาวเลื่อนไหลไปหาตัวที่เลือก (layoutId) · id ต้องไม่ซ้ำในหน้าเดียวกัน
export function Seg<T extends string>({ id, value, onChange, options }: { id: string; value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="pp-seg" role="tablist">
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={value === o.v} className={value === o.v ? "is-on" : ""} onClick={() => onChange(o.v)}>
          {value === o.v && <motion.span layoutId={"pp-seg-" + id} className="pp-seg-pill" transition={springSoft} />}
          <span className="relative">{o.l}</span>
        </button>
      ))}
    </div>
  );
}
