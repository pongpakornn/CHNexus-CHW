"use client";

import { memo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, rectSwappingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fadeOnly, fadeUp, springSoft } from "@/lib/motion";

// 🃏 ตารางการ์ดที่ลากสลับได้ (Plan Submission) - การเคลื่อนไหวชุดเดียวกับ Plan Setting
//   ลากที่หัวการ์ด -> การ์ดยกขึ้นตามเมาส์ (DragOverlay) · ช่องเดิมเป็นเส้นประจาง · การ์ดปลายทางเลื่อนหลบแบบ spring · ปล่อย = onSwap (ยืนยันก่อนสลับจริง)
//   การ์ดที่ล็อก (เสร็จแล้ว / ผลิตไม่ได้ / ไม่มีสิทธิ์) ลากไม่ได้และไม่รับการวาง

export type DragHandle = React.HTMLAttributes<HTMLElement> | undefined;

// ⏱ ค่าเดียวกับ SetCards.tsx (DRAG) - ปรับให้ตรงกันถ้าจูน
const DRAG = {
  activate: 6,
  shift: { duration: 320, easing: "cubic-bezier(0.34, 1.32, 0.64, 1)" },
  drop: { duration: 340, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" },
};

export function DragGrid<T>({
  items,
  idOf,
  locked,
  render,
  onSwap,
}: {
  items: T[];
  idOf: (x: T) => number;
  locked: (x: T) => boolean;
  render: (x: T, i: number, handle: DragHandle, lifted: boolean) => React.ReactNode;
  onSwap: (a: number, b: number) => void;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG.activate } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const idx = active == null ? -1 : items.findIndex((x) => idOf(x) === active);

  const onStart = (ev: DragStartEvent) => setActive(Number(ev.active.id));
  const onEnd = (ev: DragEndEvent) => {
    setActive(null);
    if (ev.over && ev.active.id !== ev.over.id) onSwap(Number(ev.active.id), Number(ev.over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <SortableContext items={items.map(idOf)} strategy={rectSwappingStrategy}>
        <div className="edp-cards">
          {items.map((x, i) => (
            <motion.div key={idOf(x)} layout={!reduce} custom={Math.min(i, 12)} variants={reduce ? fadeOnly : fadeUp} initial="hidden" animate="show" transition={springSoft} className="edp-slot">
              <Slot id={idOf(x)} disabled={locked(x)}>
                {(h) => render(x, i, h, false)}
              </Slot>
            </motion.div>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={reduce ? null : DRAG.drop}>{idx >= 0 ? render(items[idx], idx, undefined, true) : null}</DragOverlay>
    </DndContext>
  );
}

const Slot = memo(function Slot({ id, disabled, children }: { id: number; disabled: boolean; children: (h: DragHandle) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled, transition: DRAG.shift });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={isDragging ? "edp-placeholder" : undefined}>
      {children(disabled ? undefined : { ...attributes, ...listeners })}
    </div>
  );
});
