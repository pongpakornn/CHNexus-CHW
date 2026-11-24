"use client";

import { useMemo } from "react";
import { FlowDiagram, type FlowColumn, type FlowNode } from "@/components/flow/FlowDiagram";
import { Modal } from "@/components/modals/Modal";
import { ALL_STATIONS, n0, PartImg, type Kanban, type KanbanData, type Step } from "./shared";

// 👁 KANBAN › PREVIEW FLOW: Kanban Post -> each flow step (ALL = every workstation of the zone in parallel) -> Line-side Store of the last zone
const C = { kanban: "#7c3aed", station: "#2563eb", machine: "#0891b2", store: "#15803d", none: "#94a3b8" };

export function flowColumns(k: Pick<Kanban, "code" | "partId" | "partA" | "name" | "perBox">, steps: Step[], options: KanbanData["options"]): FlowColumn[] {
  const info = (z: string) => options.zoneInfo.find((x) => x.code === z);
  const people = (n: number) => `👤 ${n0(n)} คน`;
  const cols: FlowColumn[] = [
    {
      key: "kanban",
      label: "KANBAN POST",
      sub: "จุดรับ Kanban",
      nodes: [
        {
          id: "kanban",
          title: k.partA || k.code || "KANBAN",
          sub: k.name || k.code,
          meta: `PACKING ${n0(k.perBox)} ชิ้น / กล่อง`,
          color: C.kanban,
          icon: k.partId ? <PartImg partId={k.partId} className="size-full p-0.5" /> : "📦",
        },
      ],
    },
  ];
  steps.forEach((s, i) => {
    const st = options.stations.filter((x) => x.zone === s.zone);
    let nodes: FlowNode[];
    if (s.point === ALL_STATIONS)
      nodes = st.length
        ? st.map((x) => ({ id: `${i}-${x.code}`, title: x.code, sub: x.name ?? x.machine ?? undefined, meta: [x.machine, people(x.operators)].filter(Boolean).join(" · "), color: C.station, icon: "🧑‍🔧" }))
        : [{ id: `${i}-all`, title: "ทุกสถานีงาน", sub: "ยังไม่มีสถานีงานใน Master Data", color: C.none, icon: "⚠", muted: true }];
    else {
      const w = st.find((x) => x.code === s.point);
      const m = options.machines.find((x) => x.code === s.point);
      nodes = [
        w
          ? { id: `${i}-${w.code}`, title: w.code, sub: w.name ?? w.machine ?? undefined, meta: [w.machine, people(w.operators)].filter(Boolean).join(" · "), color: C.station, icon: "🧑‍🔧" }
          : { id: `${i}-${s.point || "?"}`, title: s.point || "ยังไม่เลือกจุด", sub: m?.name ?? (m ? m.type : undefined), meta: m ? "เครื่องจักร" : undefined, color: s.point ? C.machine : C.none, icon: "⚙", muted: !s.point },
      ];
    }
    const z = info(s.zone);
    cols.push({ key: `s${i}`, label: `${i + 1} · ZONE ${s.zone || "-"}`, sub: z?.name ?? (s.point === ALL_STATIONS ? `${nodes.length} สถานีทำงานขนานกัน` : undefined), nodes });
  });
  const last = info(steps.at(-1)?.zone ?? "");
  cols.push({
    key: "store",
    label: "LINE-SIDE STORE",
    sub: "สโตร์ข้างไลน์",
    nodes: [
      last?.store
        ? { id: "store", title: last.store, sub: last.storeName ?? undefined, meta: `ปลายทางของ ZONE ${last.code}`, color: C.store, icon: "🏬" }
        : { id: "store", title: "ยังไม่กำหนด", sub: steps.length ? `ZONE ${steps.at(-1)?.zone || "-"} ยังไม่ได้เลือก Line-side Store` : "ยังไม่ได้ตั้งค่า FLOW", color: C.none, icon: "🏬", muted: true },
    ],
  });
  return cols;
}

export function FlowPreview({ k, steps, options, onClose }: { k: Kanban; steps: Step[]; options: KanbanData["options"]; onClose: () => void }) {
  const cols = useMemo(() => flowColumns(k, steps, options), [k, steps, options]);
  const people = steps.reduce((a, s) => a + (s.point === ALL_STATIONS ? options.stations.filter((x) => x.zone === s.zone) : options.stations.filter((x) => x.zone === s.zone && x.code === s.point)).reduce((b, x) => b + x.operators, 0), 0);
  return (
    <Modal
      open
      size="xl"
      title={`👁 PREVIEW FLOW • ${k.partA || k.code}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs font-bold text-ink-soft">
            {n0(steps.length)} จุด · พนักงานตาม FLOW {n0(people)} คน {options.zoneMaster ? "" : "· ยังไม่มี Zone & Workstation Information (script 74)"}
          </span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            CLOSE
          </button>
        </>
      }
    >
      {steps.length === 0 ? (
        <p className="py-10 text-center text-sm font-bold text-ink-soft">ยังไม่ได้ตั้งค่า FLOW · กด SET FLOW ก่อน</p>
      ) : (
        <FlowDiagram columns={cols} ariaLabel={`FLOW ของ ${k.code}: ${steps.map((s) => s.point).join(" → ")}`} />
      )}
    </Modal>
  );
}
