"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, Loading, PageBody } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { EASE, fadeOnly, panelIn } from "@/lib/motion";
import { catOf, currentShift, fmt, slotsOf, specText, STATUS_TEXT, STATUS_TH, statusOf, type ChemCan, type ChemParam, type ChemReading, type Status } from "@/lib/chem";
import { Ring } from "../../pp/PpChart";
import { ControlChart } from "../ControlChart";
import { ChemHero, PkSeg, SpecBar } from "../ui";
import "../chem.css";

// 🧪 CHEMICAL CONTROL › DASHBOARD
//   แถบสรุปกะปัจจุบัน (ตรวจวัดแล้วกี่ค่า / ต้องตรวจทั้งหมด) · จำนวน IN CONTROL / WARNING / OUT OF SPEC จากผลล่าสุดของแต่ละรายการ
//   ใบบันทึกที่รอฉันลงลายเซ็น · การ์ดพารามิเตอร์ทุกรายการ (ค่าล่าสุด · สถานะ · แผนภูมิย่อ 14 วัน · สถานะใบบันทึกเดือนนี้)
//   กรองตามหมวด · กดการ์ด = แผนภูมิควบคุม · อัพเดทเองเมื่อมีคนบันทึก
type Sheet = { id: number; paramId: number; status: string; nextSlot: number | null };
type Inbox = { id: number; paramId: number; year: number; month: number; slotName: string; submittedAt: string };
type Data = { parameters: ChemParam[]; readings: ChemReading[]; sheets: Sheet[]; inbox: Inbox[]; can: ChemCan; today: string };
const CATS = ["ALL", "CHEMICAL", "WATER", "PAINT", "TEMPERATURE"];

export default function ChemDashboard() {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [d, setD] = useState<Data | null>(null);
  const [cat, setCat] = useState("ALL");
  const last = useRef("");
  // 📌 กันหน้าเด้งขึ้นตอนกรองหมวด: กล่องการ์ดสูงไม่น้อยกว่าครั้งที่สูงที่สุด (PAINT 3 ใบ / TEMPERATURE 4 ใบ เคยทำให้หน้าสั้นลงจน Browser เลื่อนขึ้นเอง)
  //    ความกว้างจอเปลี่ยน (จำนวนคอลัมน์เปลี่ยน) = เริ่มวัดใหม่
  const grid = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState(0);
  useEffect(() => {
    const el = grid.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth;
        setMinH(0);
        return;
      }
      setMinH((m) => Math.max(m, el.scrollHeight));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [d]);
  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<Data>("/chem/dashboard", { query: { days: 14 } });
        if (sameData(last, r) && quiet) return; // เรียลไทม์แต่ข้อมูลเดิม = ไม่วาดใหม่
        setD(r);
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
      }
    },
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["chem"], () => load(true), 60_000);

  const cur = currentShift();
  const view = useMemo(() => {
    if (!d) return null;
    const byP = new Map<number, ChemReading[]>();
    for (const r of d.readings) {
      const l = byP.get(r.paramId) ?? [];
      l.push(r);
      byP.set(r.paramId, l);
    }
    const order = (r: ChemReading) => `${r.date.slice(0, 10)}${r.shift === "D" ? 0 : 1}${r.slot}`;
    const items = d.parameters.map((p) => {
      const rs = (byP.get(p.id) ?? []).sort((a, b) => order(a).localeCompare(order(b)));
      const last = rs[rs.length - 1];
      const need = slotsOf(p, cur.shift).length;
      const done = rs.filter((r) => r.date.slice(0, 10) === cur.date && r.shift === cur.shift).length;
      return { p, rs, last, st: (last ? statusOf(p, last.value) : "NONE") as Status, need, done, sheet: d.sheets.find((s) => s.paramId === p.id) };
    });
    const cnt = { OK: 0, WARN: 0, OUT: 0, NONE: 0 } as Record<Status, number>;
    items.forEach((x) => cnt[x.st]++);
    const need = items.reduce((a, x) => a + x.need, 0);
    const done = items.reduce((a, x) => a + Math.min(x.done, x.need), 0);
    return { items, cnt, need, done };
  }, [d, cur.date, cur.shift]);

  if (!d || !view)
    return (
      <PageBody className="ch-page">
        <ChemHero tag="CHEMICAL CONTROL · ED PAINT LINE" title={["Chemical Control", "Dashboard"]} sub="ระบบควบคุมคุณภาพน้ำยาเคมี" />
        <Loading />
      </PageBody>
    );
  const shown = view.items.filter((x) => cat === "ALL" || x.p.category === cat);

  return (
    <PageBody className="ch-page">
      <ChemHero tag="CHEMICAL CONTROL · ED PAINT LINE" title={["Chemical Control", "Dashboard"]} sub={`ระบบควบคุมคุณภาพน้ำยาเคมี · ${d.parameters.length} พารามิเตอร์ควบคุม · อัพเดทอัตโนมัติ`}>
        {d.can.record && (
          <Link href="/chem/record" className="cta-btn is-purple">
            ＋ บันทึกผลการตรวจวัด
          </Link>
        )}
        <Link href="/chem/chart" className="cta-btn is-teal">
          📈 CONTROL CHART
        </Link>
      </ChemHero>

      {/* แถบสรุปกะปัจจุบัน */}
      <motion.div className="ch-banner" data-reveal="" style={{ "--i": 1 } as React.CSSProperties}>
        <span className="blob b1" aria-hidden />
        <span className="blob b2" aria-hidden />
        <div className="tx">
          <small>CURRENT SHIFT · {cur.shift === "D" ? "DAY (กะกลางวัน)" : "NIGHT (กะกลางคืน)"} · {fmtDate(cur.date, "th-TH", { day: "numeric", month: "long", year: "numeric" }, "date")}</small>
          <h2>{view.done === view.need ? "ตรวจวัดครบทุกรายการแล้ว" : `ตรวจวัดแล้ว ${view.done} / ${view.need} ค่า`}</h2>
          <div className="stats">
            {(["OK", "WARN", "OUT", "NONE"] as Status[]).map((s, i) => (
              <motion.span key={s} className={`is-${s.toLowerCase()}`} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.2 + i * 0.06 }}>
                <small>{STATUS_TEXT[s]}</small>
                <b>{view.cnt[s]}</b>
              </motion.span>
            ))}
          </div>
        </div>
        <Ring
          frac={view.need ? view.done / view.need : 0}
          color="#ffffff"
          color2="#a5f3fc"
          size={116}
          stroke={10}
          label={
            <>
              <b>{view.need ? Math.round((view.done / view.need) * 100) : 0}%</b>
              <small>SHIFT DONE</small>
            </>
          }
        />
      </motion.div>

      {/* ใบบันทึกที่รอฉันลงลายเซ็น */}
      <AnimatePresence>
        {d.inbox.length > 0 && (
          <motion.div variants={reduce ? fadeOnly : panelIn} initial="hidden" animate="show" exit={{ opacity: 0 }}>
            <Card title={`✍ รอคุณลงลายเซ็น • ${d.inbox.length}`}>
              <div className="ch-inbox">
                {d.inbox.map((s) => {
                  const p = d.parameters.find((x) => x.id === s.paramId);
                  return (
                    <Link key={s.id} href={`/chem/chart?p=${s.paramId}&month=${s.year}-${String(s.month).padStart(2, "0")}`} className="ch-inbox-row">
                      <b>{p?.code}</b>
                      <span>{p?.name}</span>
                      <em>
                        {String(s.month).padStart(2, "0")}/{s.year} · รอ {s.slotName}
                      </em>
                      <i>›</i>
                    </Link>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div data-reveal="" style={{ "--i": 3 } as React.CSSProperties}>
      <PkSeg
        id="ch-cat"
        value={cat}
        onChange={setCat}
        options={CATS.map((c) => ({ v: c, l: <>{c === "ALL" ? "ALL" : catOf(c).label} <b className="ch-cnt">{c === "ALL" ? view.items.length : view.items.filter((x) => x.p.category === c).length}</b></> }))}
      />
      </div>
      <motion.div ref={grid} className="ch-grid" layout data-reveal="" style={{ "--i": 4, minHeight: minH || undefined } as React.CSSProperties}>
        <AnimatePresence mode="popLayout">
          {shown.map((x, i) => (
            <motion.div
              key={x.p.id}
              layout
              initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
              transition={{ duration: 0.45, ease: EASE, delay: reduce ? 0 : Math.min(i * 0.035, 0.5) }}
            >
              <Link href={`/chem/chart?p=${x.p.id}`} className={`ch-pcard is-${x.st.toLowerCase()}`} style={{ "--c": catOf(x.p.category).color } as React.CSSProperties}>
                <span className="shine" aria-hidden />
                <div className="h">
                  <span className="cat">
                    <i />
                    {catOf(x.p.category).label}
                  </span>
                  <b>{x.p.code}</b>
                  <em className={`ch-st is-${x.st.toLowerCase()}`}>{STATUS_TEXT[x.st]}</em>
                </div>
                <div className="n">
                  <b title={x.p.name}>{x.p.name}</b>
                  {x.p.nameTh && <small title={x.p.nameTh}>{x.p.nameTh}</small>}
                </div>
                <div className="v">
                  <div className="num">
                    <strong key={x.last?.id ?? "none"}>{x.last ? fmt(x.p, x.last.value) : "–"}</strong>
                    <small>{x.p.unit}</small>
                  </div>
                  <div className="lim">
                    <span>
                      SPEC <b>{specText(x.p)}</b>
                    </span>
                    {x.p.target != null && (
                      <span>
                        TARGET <b>{fmt(x.p, x.p.target)}</b>
                      </span>
                    )}
                  </div>
                </div>
                <SpecBar p={x.p} v={x.last?.value ?? null} />
                <div className="cw">
                  <ControlChart compact p={x.p} ariaLabel={`${x.p.code} trend`} points={x.rs.map((r) => ({ key: String(r.id), label: "", value: r.value, status: statusOf(x.p, r.value), tip: null }))} />
                </div>
                <div className="f">
                  <span className="when">
                    {x.last ? `ล่าสุด ${fmtDate(x.last.date, "th-TH", { day: "numeric", month: "short" }, "date")} ${x.last.shift === "D" ? "กลางวัน" : "กลางคืน"} ${x.last.time ?? ""}` : STATUS_TH.NONE}
                  </span>
                  {x.sheet && <span className={`sheet is-${x.sheet.status.toLowerCase()}`}>{x.sheet.status === "APPROVED" ? "✓ APPROVED" : x.sheet.status === "SIGNING" ? "✍ SIGNING" : "DRAFT"}</span>}
                </div>
                <div className={`prog ${x.done >= x.need && x.need ? "is-done" : ""}`} title={`กะนี้ตรวจแล้ว ${Math.min(x.done, x.need)} จาก ${x.need} ครั้ง`}>
                  <span>
                    กะนี้ <b>{Math.min(x.done, x.need)}</b>/{x.need}
                  </span>
                  <i>
                    <em style={{ transform: `scaleX(${x.need ? Math.min(x.done, x.need) / x.need : 0})` }} />
                  </i>
                </div>
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </PageBody>
  );
}
