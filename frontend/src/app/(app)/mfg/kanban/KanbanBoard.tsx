"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { n0, PartImg, Rise, useKanbanData, type Order } from "./shared";
import "./board.css";

// 🗂 KANBAN › KANBAN BOARD (look of the WORKLOAD table): rows = work orders of the zone · columns = 30-minute slots · the card sits in its planned-start slot
//   opens at the current time slot (NOW) · scroll left = past slots: orders whose time has passed with no update yet stay there (red) until someone updates them
//   ZONE filter buttons · live (topic "kanban") · progress = cards done / all cards
const SLOT = 30 * 60_000;
const BACK = 2 * 86_400_000; // look back at most 2 days
const AHEAD = 12 * 3_600_000; // show at least 12 hours ahead
const slotOf = (t: number) => Math.floor(t / SLOT) * SLOT;
const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dmy = (t: number) => new Date(t).toLocaleDateString("en-GB").replaceAll("/", "-");
const timeOf = (o: Order) => new Date(o.plannedStart ?? o.createdAt).getTime();

type State = "done" | "run" | "late" | "wait";
const STATE: Record<State, { label: string; cls: string }> = {
  late: { label: "เลยเวลา · ยังไม่อัพเดท", cls: "is-late" },
  run: { label: "กำลังผลิต", cls: "is-run" },
  wait: { label: "รอผลิต", cls: "is-wait" },
  done: { label: "ผลิตครบแล้ว", cls: "is-done" },
};
const stateOf = (o: Order, nowSlot: number): State => (o.done >= o.cards ? "done" : o.done > 0 || o.running > 0 ? "run" : slotOf(timeOf(o)) < nowSlot ? "late" : "wait");

/** live clock in its own component (ticks every second without re-rendering the table) */
function Clock() {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setT(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => (clearTimeout(first), clearInterval(id));
  }, []);
  return <b className="font-mono">{t ? `${dmy(t)} : ${new Date(t).toLocaleTimeString("en-GB")}` : "--"}</b>;
}

export default function KanbanBoard() {
  const { data } = useKanbanData();
  const [zone, setZone] = useState("ALL");
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);

  // the NOW column moves every 30 minutes: re-check twice a minute
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const nowSlot = slotOf(now);

  const zones = useMemo(() => {
    const used = new Set((data?.orders ?? []).flatMap((o) => o.steps.map((s) => s.zone)));
    return [...new Set([...(data?.options.zones ?? []), ...used])].filter(Boolean).sort();
  }, [data]);

  // orders of the zone: everything not finished + finished ones still inside the window
  const inZone = (o: Order, z: string) => z === "ALL" || o.steps.some((s) => s.zone === z) || o.zone === z;
  const rows = useMemo(() => {
    const from = nowSlot - BACK;
    return (data?.orders ?? [])
      .filter((o) => inZone(o, zone) && (o.done < o.cards || timeOf(o) >= from))
      .sort((a, b) => timeOf(a) - timeOf(b) || a.id - b.id);
  }, [data, zone, nowSlot]);
  const count = (z: string) => (data?.orders ?? []).filter((o) => inZone(o, z) && o.done < o.cards).length;

  // time columns: from the oldest open order (max 2 days back) to 12 h ahead / the last order
  const slots = useMemo(() => {
    const ts = rows.map((o) => slotOf(timeOf(o)));
    const start = Math.max(nowSlot - BACK, Math.min(nowSlot, ...ts));
    const end = Math.min(nowSlot + 3 * 86_400_000, Math.max(nowSlot + AHEAD, ...ts.map((t) => t + SLOT)));
    return Array.from({ length: (end - start) / SLOT + 1 }, (_, i) => start + i * SLOT);
  }, [rows, nowSlot]);
  const colOf = (o: Order) => Math.round((Math.min(slots.at(-1)!, Math.max(slots[0], slotOf(timeOf(o)))) - slots[0]) / SLOT); // older / later than the window = first / last column
  const late = rows.filter((o) => stateOf(o, nowSlot) === "late");

  // open at NOW (first visible column) · again when the zone changes
  const jump = (t: number, smooth = true) => {
    const el = scroller.current;
    const th = el?.querySelector<HTMLElement>(`[data-slot="${t}"]`);
    const stick = el?.querySelector<HTMLElement>(".kbb-stick");
    if (el && th) el.scrollTo({ left: th.offsetLeft - (stick?.offsetWidth ?? 0), behavior: smooth ? "smooth" : "auto" });
  };
  const ready = !!data;
  useLayoutEffect(() => {
    if (ready) jump(nowSlot, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zone]);

  return (
    <PageBody className="md-gray md-partner kb">
      <PageHeader icon="/icons/DashboardChart.png" title="KANBAN BOARD" subtitle="KANBAN · ใบสั่งผลิตตามเวลาเริ่มตามแผน · เลื่อนซ้ายเพื่อดูรายการที่เลยเวลาแล้วยังไม่อัพเดท" />
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <Rise>
            <div className="kbb-filter" role="group" aria-label="เลือก ZONE">
              {["ALL", ...zones].map((z) => (
                <button key={z} type="button" className={`fill-btn is-sm ${zone === z ? "is-on" : ""}`} aria-pressed={zone === z} onClick={() => setZone(z)}>
                  {z === "ALL" ? "ALL ZONES" : z}
                  <b>{n0(count(z))}</b>
                </button>
              ))}
            </div>
          </Rise>
          <Rise i={1}>
            <Card bodyClass="p-0">
              <div className="kbb-bar">
                <span>
                  ZONE : <b>{zone === "ALL" ? "ALL ZONES" : zone}</b>
                  {zone !== "ALL" && data.options.zoneInfo.find((x) => x.code === zone)?.name && <i>{data.options.zoneInfo.find((x) => x.code === zone)?.name}</i>}
                </span>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {late.length > 0 && (
                    <button type="button" className="kbb-btn is-late" onClick={() => jump(slots[colOf(late[0])])} title="เลื่อนไปดูรายการที่เลยเวลาแล้วยังไม่อัพเดท">
                      ◀ ค้างอัพเดท {n0(late.length)}
                    </button>
                  )}
                  <button type="button" className="kbb-btn" onClick={() => jump(nowSlot)}>
                    ● NOW
                  </button>
                  <span className="kbb-date">
                    DATE : <Clock />
                  </span>
                </span>
              </div>
              {rows.length === 0 ? (
                <Empty>{zone === "ALL" ? "ยังไม่มีใบสั่งผลิต" : `ไม่มีใบสั่งผลิตใน ZONE ${zone}`}</Empty>
              ) : (
                <div ref={scroller} className="kbb-scroll">
                  <table className="kbb-table">
                    <thead>
                      <tr>
                        <th className="kbb-stick kbb-corner">WORK ORDER</th>
                        {slots.map((t, i) => (
                          <th key={t} data-slot={t} className={t === nowSlot ? "is-now" : t < nowSlot ? "is-past" : ""}>
                            {(i === 0 || hm(t) === "00:00") && <span className="kbb-day">{dmy(t)}</span>}
                            {hm(t)}
                            {t === nowSlot && <span className="kbb-now">NOW</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o, r) => {
                        const st = stateOf(o, nowSlot);
                        const col = colOf(o);
                        const pct = o.cards ? Math.round((o.done / o.cards) * 100) : 0;
                        return (
                          <tr key={o.id} style={{ "--i": Math.min(r, 12) } as React.CSSProperties}>
                            <th scope="row" className="kbb-stick kbb-name">
                              <span>WORK ORDER {r + 1}</span>
                              <small className="font-mono">
                                #{o.id} · {o.code}
                              </small>
                            </th>
                            {slots.map((t, i) => (
                              <td key={t} className={t === nowSlot ? "is-now" : t < nowSlot ? "is-past" : ""}>
                                {i === col && (
                                  <div className={`kbb-card ${STATE[st].cls}`} title={`${STATE[st].label} · เริ่มตามแผน ${dmy(timeOf(o))} ${hm(timeOf(o))}`}>
                                    <span className="kbb-x">x{n0(o.cards)} ใบ</span>
                                    <div className="flex items-center gap-2">
                                      <span className="kbb-img">
                                        <PartImg partId={o.partId} className="size-full !text-xl" />
                                      </span>
                                      <div className="min-w-0">
                                        <b className="block truncate font-mono">{o.partA || o.code}</b>
                                        <small className="block truncate">{o.name}</small>
                                      </div>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                      <span className="kb-track flex-1">
                                        <span className={`kb-fill block ${pct >= 100 ? "is-ok" : ""}`} style={{ width: `${pct}%` }} />
                                      </span>
                                      <b className="font-mono text-[10.5px]">
                                        {n0(o.done)}/{n0(o.cards)}
                                      </b>
                                    </div>
                                    <p className="kbb-st">
                                      {STATE[st].label} · {n0(o.qty)} ชิ้น
                                    </p>
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="kbb-legend">
                {(["late", "run", "wait", "done"] as State[]).map((s) => (
                  <span key={s}>
                    <i className={`kbb-dot ${STATE[s].cls}`} /> {STATE[s].label}
                  </span>
                ))}
                <span>คอลัมน์สีม่วง = ช่วงเวลาปัจจุบัน (30 นาที) · เลื่อนซ้ายเพื่อดูช่วงเวลาที่ผ่านมา</span>
              </div>
            </Card>
          </Rise>
        </div>
      )}
    </PageBody>
  );
}
