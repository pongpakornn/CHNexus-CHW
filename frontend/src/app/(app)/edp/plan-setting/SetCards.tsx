"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, rectSwappingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RowAction } from "@/components/button-action/RowAction";
import { ComboBox, TimeField } from "@/components/dropdowns/ComboBox";
import { DUR, EASE, fadeOnly, fadeUp, springSoft } from "@/lib/motion";
import { hgOf, type Part, type Times } from "../edp";

// 🃏 การ์ดแผนของหน้า Plan Setting + การลากสลับ (dnd-kit) + การเคลื่อนไหว (Framer Motion)
//   ลากที่หัวการ์ด (#1 / รูป) -> การ์ดยกขึ้นตามเมาส์ (DragOverlay) · ช่องเดิมเป็นเส้นประจาง · การ์ดปลายทางเลื่อนสลับแบบ spring
//   ปล่อย = สลับเวลา 2 ใบ (เงื่อนไขเดิม slotSwap: การ์ดระหว่างกลางเลื่อนตาม) · ลบ = หด + จาง แล้วการ์ดที่เหลือเลื่อนมาเติม
//   rectSwappingStrategy (ไม่ใช่ sorting) เพราะผลจริงคือ "สลับ 2 ใบ" ตำแหน่งตอนลากจึงตรงกับผลหลังปล่อย

// perHg = ชิ้นต่อ 1 HG (QTY_HG ของชิ้นงาน) ใช้แปลง ชิ้น <-> HG
export type Ed = { key: number; partId: number | null; customer: string; qty: number; hg: number; perHg: number; t: Times; base: Times; baseHg: number; visible: boolean; roundId: number; done: boolean; img: string | null; partName: string | null };

export type CardActions = {
  patch: (key: number, p: Partial<Ed>) => void;
  setHg: (key: number, hg: number, qty: number) => void;
  setTime: (key: number, k: keyof Times, v: string) => void;
  remove: (e: Ed) => void;
  pickPart: (e: Ed, p: Part) => void;
};

// ⏱ ค่าที่ปรับได้ของการลาก
const DRAG = {
  activate: 6, // ต้องลากเกินกี่ px ถึงเริ่มลาก (กันกดพลาด)
  shift: { duration: 320, easing: "cubic-bezier(0.34, 1.32, 0.64, 1)" }, // การ์ดปลายทางเลื่อนหลบ (มี overshoot นิด ๆ)
  drop: { duration: 340, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" }, // ดูดลงช่องใหม่
};

export function SetCards({
  eds,
  parts,
  custs,
  ro,
  actions,
  onSwap,
  addSlot,
}: {
  eds: Ed[];
  parts: Part[];
  custs: string[];
  ro: boolean;
  actions: CardActions;
  onSwap: (a: number, b: number) => void;
  addSlot?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG.activate } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const dragging = eds.find((e) => e.key === active) ?? null;

  const onStart = (ev: DragStartEvent) => setActive(Number(ev.active.id));
  const onEnd = (ev: DragEndEvent) => {
    setActive(null);
    if (ev.over && ev.active.id !== ev.over.id) onSwap(Number(ev.active.id), Number(ev.over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <SortableContext items={eds.map((e) => e.key)} strategy={rectSwappingStrategy}>
        <motion.div className="edp-cards is-edit" initial="hidden" animate="show">
          <AnimatePresence mode="popLayout" initial={false}>
            {eds.map((e, i) => (
              <motion.div
                key={e.key}
                layout={!reduce}
                custom={i}
                variants={reduce ? fadeOnly : fadeUp}
                initial="hidden"
                animate="show"
                exit="exit"
                transition={springSoft}
                className="edp-slot"
              >
                <SortCard e={e} index={i} parts={parts} custs={custs} ro={ro} actions={actions} />
              </motion.div>
            ))}
          </AnimatePresence>
          {addSlot}
        </motion.div>
      </SortableContext>
      {/* การ์ดที่กำลังลาก: ยกขึ้น 1.03 · เงาเข้ม · ขอบเรืองม่วง · ตามเมาส์ (transform อย่างเดียว) */}
      <DragOverlay dropAnimation={reduce ? null : DRAG.drop}>
        {dragging ? <CardBody e={dragging} index={eds.indexOf(dragging)} parts={parts} custs={custs} ro actions={actions} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}

const SortCard = memo(function SortCard(props: { e: Ed; index: number; parts: Part[]; custs: string[]; ro: boolean; actions: CardActions }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.e.key, disabled: props.ro, transition: DRAG.shift });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={isDragging ? "edp-placeholder" : undefined}>
      <CardBody {...props} handle={{ ...attributes, ...listeners }} />
    </div>
  );
});

// 📄 เนื้อการ์ด (memo: วาดใหม่เฉพาะการ์ดที่ค่าของตัวเองเปลี่ยน)
const CardBody = memo(function CardBody({
  e,
  index,
  parts,
  custs,
  ro,
  actions,
  handle,
  lifted,
}: {
  e: Ed;
  index: number;
  parts: Part[];
  custs: string[];
  ro: boolean;
  actions: CardActions;
  handle?: React.HTMLAttributes<HTMLElement>;
  lifted?: boolean;
}) {
  const part = parts.find((p) => p.partId === e.partId);
  const list = e.customer ? parts.filter((p) => p.customer === e.customer) : parts;
  return (
    <article className={`edp-card is-set ${e.visible ? "" : "is-hidden"} ${e.done ? "is-done" : ""} ${lifted ? "is-lifted" : ""}`}>
      <header className={ro ? "" : "edp-handle"} {...(ro ? {} : handle)} title={ro ? undefined : "ลากเพื่อสลับเวลากับการ์ดอื่น"}>
        <span className="edp-round edp-num">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={index} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: DUR.fast, ease: EASE }}>
              #{index + 1}
            </motion.span>
          </AnimatePresence>
        </span>
        {e.done && <span className="edp-badge is-ok">✔ MARKED</span>}
        {!e.visible && <span className="edp-badge">HIDE</span>}
        {!ro && !lifted && (
          <span className="ml-auto flex gap-1" onPointerDown={(v) => v.stopPropagation()}>
            <RowAction kind="hide" shown={e.visible} onClick={() => actions.patch(e.key, { visible: !e.visible })} />
            <RowAction kind="delete" onClick={() => actions.remove(e)} />
          </span>
        )}
      </header>
      {/* รูป + ชื่อชิ้นงาน */}
      <div className="edp-set-head">
        <div className="edp-img">
          {e.img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.img} alt="" loading="lazy" draggable={false} onError={(v) => (v.currentTarget.style.display = "none")} />
          ) : (
            <span>NO IMAGE</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="edp-part">{part?.partNo ?? "เลือกชิ้นงาน"}</div>
          <div className="edp-name">{e.partName ?? (e.customer || "-")}</div>
        </div>
      </div>
      {/* ลูกค้า / ชิ้นงาน: พิมพ์ค้นหาได้ */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="fx">
          <span className="fx-cap">CUSTOMER</span>
          {ro ? (
            <b className="edp-ro">{e.customer || "-"}</b>
          ) : (
            <ComboBox value={e.customer} onChange={(v) => v !== e.customer && actions.patch(e.key, { customer: v, partId: null, perHg: 0, img: null, partName: null })} options={custs.map((c) => ({ value: c, label: c }))} placeholder="พิมพ์ค้นหาลูกค้า" ariaLabel="CUSTOMER" />
          )}
        </label>
        <label className="fx">
          <span className="fx-cap">PART NO</span>
          {ro ? (
            <b className="edp-ro">{part?.partNo ?? "-"}</b>
          ) : (
            <ComboBox
              value={e.partId ? String(e.partId) : ""}
              onChange={(v) => {
                const p = parts.find((x) => x.partId === +v);
                if (p) actions.pickPart(e, p);
              }}
              options={list.map((p) => ({ value: String(p.partId), label: p.partNo, sub: [e.customer ? "" : p.customer, p.partName].filter(Boolean).join(" · ") }))}
              placeholder="พิมพ์ค้นหา PART NO / ชื่อ"
              ariaLabel="PART NO"
            />
          )}
        </label>
      </div>
      <div className="edp-qty">
        <label>
          <small>QTY (PCS)</small>
          <input type="number" min={0} className="field" disabled={ro} value={e.qty} onChange={(v) => actions.setHg(e.key, hgOf(+v.target.value || 0, e.perHg, e.hg), +v.target.value || 0)} />
        </label>
        <label>
          <small>HG {e.perHg ? `(${e.perHg} PCS/HG)` : ""}</small>
          <input type="number" min={0} className="field" disabled={ro} value={e.hg} onChange={(v) => actions.setHg(e.key, +v.target.value || 0, (+v.target.value || 0) * e.perHg)} />
        </label>
      </div>
      <div className="edp-timegrid">
        {(
          [
            ["START", "sb", "se"],
            ["OUT", "ob", "oe"],
          ] as const
        ).map(([cap, a, b]) => (
          <div key={cap}>
            <small>{cap}</small>
            {/* เวลาเปลี่ยน (คิดใหม่จากการ์ดก่อนหน้า) = ตัวเลขเลื่อนขึ้นจาง ๆ · ช่องเดิมไม่ถูกสร้างใหม่ (ไม่บีบ / ไม่หลุดโฟกัส) */}
            <Tick v={e.t[a]}>
              <TimeField value={e.t[a]} disabled={ro} ariaLabel={`${cap} BEGIN`} onChange={(v) => actions.setTime(e.key, a, v)} />
            </Tick>
            <span>-</span>
            <Tick v={e.t[b]}>
              <TimeField value={e.t[b]} disabled={ro} ariaLabel={`${cap} END`} onChange={(v) => actions.setTime(e.key, b, v)} />
            </Tick>
          </div>
        ))}
      </div>
    </article>
  );
});

// ⏱ ค่าเปลี่ยน = เลื่อนขึ้นจาง ๆ 0.3 วิ บนช่องเดิม (Web Animations) · ไม่ใช้ key สร้างช่องใหม่ ช่องเวลาจึงไม่ยุบ / ไม่หลุดโฟกัสระหว่างพิมพ์
function Tick({ v, children }: { v: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ opacity: 0.25, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [v]);
  return (
    <span ref={ref} className="edp-tf">
      {children}
    </span>
  );
}
