"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loading, PageBody, SearchBox } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EASE } from "@/lib/motion";
import { useDebounced } from "@/lib/useDebounced";
import { catOf, currentShift, fmt, isoDate, slotsOf, specText, STATUS_TEXT, statusOf, type ChemCan, type ChemParam, type ChemReading } from "@/lib/chem";
import { ChemHero, PkSeg, SpecBar } from "../ui";
import { DateField } from "@/components/forms/DateField";
import "../chem.css";

// 📝 CHEMICAL CONTROL › INSPECTION RECORD (บันทึกผลการตรวจวัด)
//   เลือกวันที่ + กะ (เริ่มที่กะปัจจุบัน) -> ทุกพารามิเตอร์แสดงช่องตามเวลาตรวจวัดของกะนั้น · พิมพ์ค่า = สถานะเปลี่ยนสีทันที (เขียว / ส้ม / แดง)
//   นอกข้อกำหนด = ลิงก์ไปบันทึกการแก้ไข · ใบบันทึกที่ส่งอนุมัติแล้ว = ล็อก · SAVE ลอยล่างเมื่อมีการแก้ไข · Enter = ช่องถัดไป
type Data = { parameters: ChemParam[]; readings: ChemReading[]; can: ChemCan };
type Draft = Record<string, string>; // key = paramId-slot

export default function ChemRecord() {
  const toast = useToast();
  const dlg = useDialogs();
  const reduce = useReducedMotion();
  const start = currentShift();
  const [date, setDate] = useState(start.date);
  const [shift, setShift] = useState<"D" | "N">(start.shift);
  const [d, setD] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const k = useDebounced(q, 150).trim().toUpperCase();
  const dirty = Object.keys(draft).length;
  const dirtyRef = useRef(0);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const load = useCallback(
    async (quiet = false) => {
      try {
        setD(await api<Data>("/chem/day", { query: { date } }));
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
      }
    },
    [date, toast],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["chem"], () => (dirtyRef.current ? undefined : load(true)));
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const saved = useMemo(() => {
    const m = new Map<string, ChemReading>();
    for (const r of d?.readings ?? []) if (r.shift === shift) m.set(`${r.paramId}-${r.slot}`, r);
    return m;
  }, [d, shift]);
  const val = (pid: number, slot: number) => draft[`${pid}-${slot}`] ?? (saved.get(`${pid}-${slot}`)?.value.toString() ?? "");
  const edit = (p: ChemParam, slot: number, v: string) => {
    if (!/^-?\d*\.?\d*$/.test(v)) return;
    const key = `${p.id}-${slot}`;
    const orig = saved.get(key)?.value.toString() ?? "";
    setDraft((o) => {
      const n = { ...o };
      if (v === orig) delete n[key];
      else n[key] = v;
      return n;
    });
  };

  const groups = useMemo(() => {
    const ps = (d?.parameters ?? []).filter((p) => slotsOf(p, shift).length > 0 && (!k || [p.code, p.name, p.nameTh, p.process].some((x) => (x ?? "").toUpperCase().includes(k))));
    const g: { name: string; items: ChemParam[] }[] = [];
    for (const p of ps) {
      const key = p.process ?? p.category;
      const x = g.find((y) => y.name === key);
      if (x) x.items.push(p);
      else g.push({ name: key, items: [p] });
    }
    return g;
  }, [d, shift, k]);
  const total = groups.reduce((a, g) => a + g.items.reduce((b, p) => b + slotsOf(p, shift).length, 0), 0);
  const filled = groups.reduce((a, g) => a + g.items.reduce((b, p) => b + slotsOf(p, shift).filter((_, i) => val(p.id, i + 1) !== "").length, 0), 0);

  function change(fn: () => void) {
    if (dirty) return toast.show("WARNING", "มีค่าที่ยังไม่ได้ SAVE · กด SAVE หรือ CANCEL ก่อน", "warn");
    fn();
  }
  async function save() {
    if (!d) return;
    const cells = Object.entries(draft).map(([key, v]) => {
      const [pid, slot] = key.split("-").map(Number);
      const p = d.parameters.find((x) => x.id === pid)!;
      return { paramId: pid, slot, time: slotsOf(p, shift)[slot - 1] ?? null, value: v.trim() === "" ? null : Number(v), remark: null };
    });
    if (cells.some((c) => c.value != null && !isFinite(c.value))) return toast.show("WARNING", "ตัวเลขไม่ถูกต้อง", "warn");
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/chem/readings", { method: "POST", body: { date, shift, cells } });
      toast.show("SAVED", r.message, "ok");
      setDraft({});
      await load(true);
      const outs = cells.filter((c) => c.value != null && statusOf(d.parameters.find((p) => p.id === c.paramId)!, c.value) === "OUT");
      if (outs.length)
        toast.show("OUT OF SPEC", `${outs.length} ค่าอยู่นอกข้อกำหนด · กรุณาบันทึกการแก้ไขและปรับค่าน้ำยาที่หน้า CONTROL CHART`, "warn");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const shiftDay = (n: number) => {
    const x = new Date(date);
    x.setDate(x.getDate() + n);
    change(() => setDate(isoDate(x)));
  };

  return (
    <PageBody className="ch-page">
      <ChemHero tag="CHEMICAL CONTROL · ED PAINT LINE" title={["Inspection", "Record"]} sub="บันทึกผลการตรวจวัดค่าน้ำยาเคมีประจำกะ · สีสถานะเปลี่ยนทันทีเมื่อกรอกค่า">
        <button type="button" className="cta-btn is-purple" onClick={() => change(() => (setDate(start.date), setShift(start.shift)))}>
          ⟲ กะปัจจุบัน
        </button>
      </ChemHero>

      <div className="ch-toolbar" data-reveal="" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="ch-date">
          <button type="button" className="pk-step" aria-label="Previous day" onClick={() => shiftDay(-1)}>
            ‹
          </button>
          <DateField label="DATE" value={date} onChange={(v) => v && v <= isoDate(new Date()) && change(() => setDate(v))} className="w-[190px]" />
          <button type="button" className="pk-step" aria-label="Next day" onClick={() => shiftDay(1)} disabled={date >= isoDate(new Date())}>
            ›
          </button>
        </div>
        <PkSeg id="ch-shift" value={shift} onChange={(v) => change(() => setShift(v))} options={[{ v: "D", l: "☀ DAY SHIFT" }, { v: "N", l: "☾ NIGHT SHIFT" }]} />
        <div className="ch-progress" title={`${filled} / ${total}`}>
          <span>
            <b>{filled}</b> / {total} ค่า
          </span>
          <i>
            <motion.em initial={false} animate={{ scaleX: total ? filled / total : 0 }} transition={{ duration: 0.6, ease: EASE }} />
          </i>
        </div>
        <SearchBox fancy value={q} onChange={setQ} placeholder="ค้นหารหัส / ชื่อ / บ่อ" className="ch-search" />
      </div>

      {!d ? (
        <Loading />
      ) : (
        <div className="ch-groups" data-reveal="" style={{ "--i": 2 } as React.CSSProperties}>
          {groups.map((g, gi) => (
            <motion.section
              key={g.name}
              className="ch-group"
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 0.45, ease: EASE, delay: Math.min(gi * 0.04, 0.3) }}
            >
              <h3>{g.name}</h3>
              {g.items.map((p) => {
                const slots = slotsOf(p, shift);
                const worst = slots.map((_, i) => statusOf(p, val(p.id, i + 1) === "" ? null : Number(val(p.id, i + 1)))).sort((a, b) => ["OUT", "WARN", "OK", "NONE"].indexOf(a) - ["OUT", "WARN", "OK", "NONE"].indexOf(b))[0];
                return (
                  <div key={p.id} className={`ch-row is-${worst.toLowerCase()}`} style={{ "--c": catOf(p.category).color } as React.CSSProperties}>
                    <div className="info">
                      <b>{p.code}</b>
                      <span>{p.name}</span>
                      <SpecBar p={p} v={(() => {
                        const vs = slots.map((_, i) => val(p.id, i + 1)).filter((x) => x !== "");
                        return vs.length ? Number(vs[vs.length - 1]) : null;
                      })()} />
                      <small>
                        SPEC {specText(p)} {p.unit}
                        {p.ucl != null || p.lcl != null ? ` · CL ${p.lcl != null ? fmt(p, p.lcl) : "–"} / ${p.ucl != null ? fmt(p, p.ucl) : "–"}` : ""}
                      </small>
                    </div>
                    <div className="slots">
                      {slots.map((t, i) => {
                        const v = val(p.id, i + 1);
                        const st = statusOf(p, v === "" ? null : Number(v));
                        const r = saved.get(`${p.id}-${i + 1}`);
                        return (
                          <label key={t} className={`ch-slot is-${st.toLowerCase()} ${draft[`${p.id}-${i + 1}`] != null ? "is-dirty" : ""}`} title={r?.inspector ? `บันทึกโดย ${r.inspector}` : undefined}>
                            <span>
                              {t}
                              {r?.inspector && <em>{r.inspector.split(" ")[0]}</em>}
                            </span>
                            <input
                              inputMode="decimal"
                              value={v}
                              readOnly={!d.can.record}
                              placeholder="–"
                              onChange={(e) => edit(p, i + 1, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                const all = Array.from(document.querySelectorAll<HTMLInputElement>(".ch-slot input"));
                                all[all.indexOf(e.currentTarget) + 1]?.focus();
                              }}
                              aria-label={`${p.code} ${t}`}
                            />
                            <i>{p.unit}</i>
                          </label>
                        );
                      })}
                    </div>
                    <div className="act">
                      <em className={`ch-st is-${worst.toLowerCase()}`}>{STATUS_TEXT[worst]}</em>
                      {worst === "OUT" && (
                        <Link href={`/chem/chart?p=${p.id}&month=${date.slice(0, 7)}&action=${date}`} className="ch-fix">
                          ＋ บันทึกการแก้ไข
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </motion.section>
          ))}
          {groups.length === 0 && <div className="ch-none">ไม่พบพารามิเตอร์ที่ตรวจวัดในกะนี้</div>}
        </div>
      )}

      <AnimatePresence>
        {dirty > 0 && (
          <motion.div className="ch-savebar" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
            <span>
              แก้ไข <b>{dirty}</b> ค่า · {shift === "D" ? "กะกลางวัน" : "กะกลางคืน"} {new Date(date).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
            </span>
            <button
              type="button"
              className="cta-btn is-gray"
              disabled={busy}
              onClick={async () => (await dlg.confirm({ title: "CANCEL", message: `ยกเลิกการแก้ไข ${dirty} ค่า ?`, ok: "YES, CANCEL", danger: true })) && setDraft({})}
            >
              ✕ CANCEL
            </button>
            <button type="button" className="cta-btn is-green" disabled={busy} onClick={save}>
              {busy ? "…" : "💾 SAVE"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </PageBody>
  );
}
