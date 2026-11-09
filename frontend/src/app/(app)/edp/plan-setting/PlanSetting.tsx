"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card as Box, Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { useToast } from "@/components/notifications/Toasts";
import { Select } from "@/components/dropdowns/Select";
import { RowAction } from "@/components/button-action/RowAction";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { EdpBar } from "../EdpBar";
import { baseHgOf, cascade, dmy, hgOf, imgOf, nowSlot, roundLabel, shiftStart, slotSwap, sortMin, timesOf, type Card, type CardsRes, type Meta, type Part, type Round, type Scope, type Shift, type Times } from "../edp";
import "../edp.css";

// 🏭 EDP › PLAN SETTING (ผู้วางแผน) - ย้ายจากหน้า Plan Setting ของ EDP Systems
//   วางแผนรายรอบ: เพิ่มการ์ด · เลือกลูกค้า / ชิ้นงาน (STORE-PC) · ชิ้น <-> HG · เวลา START / OUT · SHOW / HIDE · ลบ · ลากสลับ
//   แก้ HG = เวลาการ์ดถัดไปในรอบเลื่อนตาม (3.25 นาที / HG) · แก้เวลาเอง = ยึดเวลาบนจอเป็นฐานใหม่ · ลงฐานข้อมูลตอนกด SAVE ALL
//   ALL = ภาพรวมทั้งวัน (กะ -> รอบ -> การ์ด) กด EDIT ที่รอบ = ไปแก้รอบนั้น · แม่แบบ (บันทึก / ใช้) · คัดลอกแผนจากวันอื่น · ล้างแผน
type Ed = { key: number; partId: number | null; customer: string; qty: number; hg: number; pcsHg: number; t: Times; base: Times; baseHg: number; visible: boolean; roundId: number; done: boolean; img: string | null; partName: string | null };
type Tpl = { tplId: number; tplName: string; shift: string | null; roundId: number | null; createBy: string | null; createAt: string; updateAt: string | null; cardCount: number };
let seq = 0;
const nextKey = () => --seq;

const toEd = (c: Card): Ed => {
  const t = timesOf(c.timeStart, c.timeEnd);
  return { key: c.pldId, partId: c.partId, customer: c.customer, qty: c.qtyPlan, hg: c.hgPlan, pcsHg: c.pcsHg, t, base: t, baseHg: baseHgOf(c.hgPlan, t), visible: c.isVisible, roundId: c.roundId, done: c.isDone, img: imgOf(c), partName: c.partName };
};
const out = (e: Ed) => ({ partId: e.partId, timeStart: `${e.t.sb}-${e.t.se}`, timeEnd: `${e.t.ob}-${e.t.oe}`, qty: e.qty, hg: e.hg, visible: e.visible, roundId: e.roundId });

export default function PlanSetting() {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [date, setDate] = useState("");
  const [shift, setShift] = useState<Scope>("DAY");
  const [round, setRound] = useState<number | null>(null);
  const [eds, setEds] = useState<Ed[] | null>(null);
  const [all, setAll] = useState<Card[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [modal, setModal] = useState<"save" | "tpl" | "apply" | "clear" | null>(null);
  const loadVer = useRef(0);

  useEffect(() => {
    Promise.all([api<Meta>("/edp/meta"), api<Part[]>("/edp/parts")])
      .then(([m, p]) => {
        setMeta(m);
        setParts(p);
        const s = nowSlot(m.rounds);
        setDate(s.date);
        setShift(s.shift);
        setRound(s.round);
      })
      .catch((e) => toast.show("ERROR", "โหลดข้อมูลตั้งต้นไม่สำเร็จ\n" + (e as Error).message, "error"));
  }, [toast]);

  const rounds = useMemo(() => meta?.rounds ?? [], [meta]);
  const cur: Round | undefined = rounds.find((r) => r.roundId === round);
  // รอบต้องเป็นของกะที่เลือก (เปลี่ยนกะ = รอบแรกของกะนั้น)
  const fixRound = (s: Scope) => (s === "ALL" ? null : rounds.find((r) => r.shift === s)?.roundId ?? null);

  const load = useCallback(async () => {
    if (!date) return;
    const v = ++loadVer.current;
    try {
      if (shift === "ALL") {
        const r = await api<CardsRes>("/edp/cards", { query: { date, shift: "ALL" } });
        if (v === loadVer.current) {
          setAll(r.cards);
          setEds(null);
        }
      } else if (round) {
        const r = await api<CardsRes>("/edp/cards", { query: { date, shift, round } });
        if (v !== loadVer.current) return;
        const s = shiftStart(shift);
        setEds(r.cards.map(toEd).sort((a, b) => sortMin(a.t.sb, s) - sortMin(b.t.sb, s)));
        setAll(null);
        setDirty(false);
      }
    } catch (e) {
      toast.show("ERROR", "โหลดแผนงานไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [date, shift, round, toast]);
  useEffect(() => {
    const t = setTimeout(() => (setEds(null), setAll(null), load()), 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["edp"], () => (dirty ? undefined : load()));

  async function leave(fn: () => void) {
    if (dirty && !(await dlg.confirm({ title: "UNSAVED", message: "ยังไม่ได้กด SAVE ALL · ออกจากรอบนี้แล้วการแก้ไขจะหายไป ?", ok: "LEAVE" }))) return;
    fn();
  }

  // แก้ HG / ชิ้น = คิดเวลาใหม่ทั้งรอบจากฐาน · แก้เวลาเอง = ฐานใหม่ทั้งรอบ
  const sorted = (list: Ed[]) => {
    const s = shiftStart((shift === "ALL" ? "DAY" : shift) as Shift);
    return [...list].sort((a, b) => sortMin(a.base.sb, s) - sortMin(b.base.sb, s));
  };
  function setHg(key: number, hg: number, qty: number) {
    setDirty(true);
    setEds((list) => {
      if (!list) return list;
      const next = list.map((e) => (e.key === key ? { ...e, hg, qty } : e));
      const t = cascade(sorted(next).map((e) => ({ key: e.key, shift: "DAY" as Shift, base: e.base, baseHg: e.baseHg, hg: e.hg })));
      return next.map((e) => ({ ...e, t: t.get(e.key) ?? e.t }));
    });
  }
  function setTime(key: number, k: keyof Times, v: string) {
    setDirty(true);
    setEds((list) => list && list.map((e) => (e.key === key ? { ...e, t: { ...e.t, [k]: v } } : e)).map((e) => ({ ...e, base: e.t, baseHg: baseHgOf(e.hg, e.t) })));
  }
  function patch(key: number, p: Partial<Ed>) {
    setDirty(true);
    setEds((list) => list && list.map((e) => (e.key === key ? { ...e, ...p } : e)));
  }
  function add() {
    if (!cur) return;
    const b = `${String(cur.startHour % 24).padStart(2, "0")}:00`;
    const t = { sb: b, se: b, ob: b, oe: b };
    setDirty(true);
    setEds((l) => [...(l ?? []), { key: nextKey(), partId: null, customer: "", qty: 0, hg: 0, pcsHg: 0, t, base: t, baseHg: 0, visible: true, roundId: cur.roundId, done: false, img: null, partName: null }]);
  }
  async function remove(e: Ed) {
    const name = e.partId ? `${e.customer} ${parts.find((p) => p.partId === e.partId)?.partNo ?? ""}` : "การ์ดใหม่ (ยังไม่ได้เลือกชิ้นงาน)";
    if (!(await dlg.confirm({ title: "DELETE CARD", message: `ลบการ์ด ${name}\nเวลา ${e.t.sb}-${e.t.se} ออกจากรอบนี้ใช่หรือไม่?\n\n* การ์ดจะหายจากแผนจริงหลังกด SAVE ALL`, ok: "DELETE", danger: true }))) return;
    setDirty(true);
    setEds((l) => l && l.filter((x) => x.key !== e.key));
  }
  function swap(a: number, b: number) {
    if (!eds || a === b) return;
    const ord = sorted(eds);
    const ia = ord.findIndex((e) => e.key === a),
      ib = ord.findIndex((e) => e.key === b);
    const ch = slotSwap(ord.map((e) => ({ ...e.t, hg: e.hg })), ia, ib);
    const upd = ord.map((e, k) => (ch.has(k) ? { ...e, t: ch.get(k)! } : e)).map((e) => ({ ...e, base: e.t, baseHg: baseHgOf(e.hg, e.t) }));
    setDirty(true);
    setEds(sorted(upd));
  }

  const can = meta?.can ?? { add: false, edit: false, delete: false, submit: false, planning: false };
  const custs = useMemo(() => [...new Set(parts.map((p) => p.customer))].filter(Boolean), [parts]);
  const ro = !can.add;

  if (!meta) return <Loading />;
  return (
    <PageBody>
      <PageHeader icon="/icons/CalculatorMxMn.png" title="EDP • PLAN SETTING" subtitle="วางแผนผลิตรายรอบ · แก้ HG แล้วเวลาการ์ดถัดไปเลื่อนตาม · กด SAVE ALL เพื่อบันทึกจริง" />
      <EdpBar
        date={date}
        onDate={(d) => leave(() => setDate(d))}
        shift={shift}
        onShift={(s) => leave(() => (setShift(s), setRound(fixRound(s))))}
        rounds={rounds}
        round={round}
        onRound={(r) => leave(() => setRound(r ?? fixRound(shift)))}
      >
        {shift !== "ALL" && (
          <>
            {can.edit && (
              <button type="button" className="fill-btn" onClick={() => setModal("apply")}>
                ⤓ TEMPLATE / COPY
              </button>
            )}
            {can.add && (
              <button type="button" className="fill-btn" onClick={() => setModal("tpl")}>
                ★ SAVE TEMPLATE
              </button>
            )}
            {can.delete && (
              <button type="button" className="fill-btn is-red" onClick={() => setModal("clear")}>
                ✖ CLEAR
              </button>
            )}
            {can.add && (
              <button type="button" className={`cta-btn is-green ${dirty ? "edp-pulse" : ""}`} onClick={() => setModal("save")}>
                💾 SAVE ALL
              </button>
            )}
          </>
        )}
      </EdpBar>

      {shift === "ALL" ? (
        !all ? (
          <Loading />
        ) : (
          <Overview cards={all} rounds={rounds} onEdit={(s, r) => (setShift(s), setRound(r))} date={date} />
        )
      ) : !eds ? (
        <Loading />
      ) : (
        <Box title={`${dmy(date)} · กะ ${shift} · ${cur ? roundLabel(cur) : "-"} · ${eds.length} การ์ด${dirty ? " · ยังไม่บันทึก" : ""}`}>
          {eds.length === 0 && <Empty>ยังไม่มีการ์ดในรอบนี้ · กด ＋ ADD CARD หรือใช้แม่แบบ</Empty>}
          <div className="edp-cards is-edit">
            {sorted(eds).map((e, i) => {
              const list = parts.filter((p) => p.customer === e.customer);
              return (
                <article
                  key={e.key}
                  className={`edp-card ${e.visible ? "" : "is-hidden"} ${e.done ? "is-done" : ""} ${drag === e.key ? "is-drag" : ""}`}
                  style={{ "--i": Math.min(i, 16) } as React.CSSProperties}
                  draggable={!ro}
                  onDragStart={() => setDrag(e.key)}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(ev) => drag != null && drag !== e.key && ev.preventDefault()}
                  onDrop={(ev) => (ev.preventDefault(), drag != null && swap(drag, e.key), setDrag(null))}
                >
                  <header>
                    <span className="edp-round">#{i + 1}</span>
                    {e.done && <span className="edp-badge is-ok">✔ MARKED</span>}
                    {!e.visible && <span className="edp-badge">HIDE</span>}
                    {!ro && (
                      <span className="ml-auto flex gap-1">
                        <RowAction kind="hide" shown={e.visible} onClick={() => patch(e.key, { visible: !e.visible })} />
                        <RowAction kind="delete" onClick={() => remove(e)} />
                      </span>
                    )}
                  </header>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="fx">
                      <span className="fx-cap">CUSTOMER</span>
                      {ro ? <b>{e.customer || "-"}</b> : <Select value={e.customer} onChange={(v) => patch(e.key, { customer: v, partId: null, pcsHg: 0, img: null, partName: null })} options={[{ value: "", label: "เลือกลูกค้า" }, ...custs.map((c) => ({ value: c, label: c }))]} ariaLabel="CUSTOMER" />}
                    </label>
                    <label className="fx">
                      <span className="fx-cap">PART NO</span>
                      {ro ? (
                        <b>{parts.find((p) => p.partId === e.partId)?.partNo ?? "-"}</b>
                      ) : (
                        <Select
                          value={e.partId ? String(e.partId) : ""}
                          onChange={(v) => {
                            const p = parts.find((x) => x.partId === +v);
                            if (!p) return;
                            patch(e.key, { partId: p.partId, pcsHg: p.pcsHg, img: p.img ? `/api/images/part/${p.partId}` : null, partName: p.partName });
                            setHg(e.key, p.qtyHg || e.hg, (p.qtyHg || e.hg) * p.pcsHg);
                          }}
                          options={[{ value: "", label: "เลือกชิ้นงาน" }, ...list.map((p) => ({ value: String(p.partId), label: p.partNo }))]}
                          ariaLabel="PART NO"
                        />
                      )}
                    </label>
                  </div>
                  {e.partName && <div className="edp-name">{e.partName}</div>}
                  <div className="edp-qty">
                    <label>
                      <small>QTY (PCS)</small>
                      <input type="number" min={0} className="field" disabled={ro} value={e.qty} onChange={(v) => setHg(e.key, hgOf(+v.target.value || 0, e.pcsHg), +v.target.value || 0)} />
                    </label>
                    <label>
                      <small>HG {e.pcsHg ? `(${e.pcsHg}/HG)` : ""}</small>
                      <input type="number" min={0} className="field" disabled={ro} value={e.hg} onChange={(v) => setHg(e.key, +v.target.value || 0, (+v.target.value || 0) * e.pcsHg)} />
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
                        <input type="time" className="field" disabled={ro} value={e.t[a]} onChange={(v) => v.target.value && setTime(e.key, a, v.target.value)} />
                        <span>-</span>
                        <input type="time" className="field" disabled={ro} value={e.t[b]} onChange={(v) => v.target.value && setTime(e.key, b, v.target.value)} />
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
            {!ro && cur && (
              <button type="button" className="edp-add" onClick={add}>
                <span>＋</span>ADD CARD
              </button>
            )}
          </div>
        </Box>
      )}

      {modal === "save" && cur && eds && <SaveDialog date={date} shift={shift as Shift} round={cur.roundId} rounds={rounds} cards={eds} onClose={() => setModal(null)} onSaved={(d, s, r) => (setModal(null), setDirty(false), setDate(d), setShift(s), setRound(r), load())} />}
      {modal === "tpl" && cur && eds && <SaveTemplate date={date} shift={shift as Shift} round={cur} cards={eds} canDelete={can.delete} onClose={() => setModal(null)} />}
      {modal === "apply" && <ApplyDialog date={date} shift={shift as Shift} round={round} rounds={rounds} onClose={() => setModal(null)} onDone={() => (setModal(null), load())} />}
      {modal === "clear" && <ClearDialog date={date} shift={shift as Shift} round={round} onClose={() => setModal(null)} onDone={() => (setModal(null), load())} />}
    </PageBody>
  );
}

// 🗓 ภาพรวมทั้งวัน: กะ -> รอบ -> การ์ด (ดูอย่างเดียว) · รอบว่างก็แสดงหัวข้อ · การ์ดที่ไม่เข้ารอบรวมไว้ถังเดียว
function Overview({ cards, rounds, date, onEdit }: { cards: Card[]; rounds: Round[]; date: string; onEdit: (s: Shift, r: number) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {(["DAY", "NIGHT"] as Shift[]).map((s) => {
        const mine = cards.filter((c) => c.shift === s);
        const st = shiftStart(s);
        const rs = rounds.filter((r) => r.shift === s).sort((a, b) => ((a.startHour - st + 24) % 24) - ((b.startHour - st + 24) % 24));
        const orphan = mine.filter((c) => !rs.some((r) => r.roundId === c.roundId));
        return (
          <Box key={s} title={`${s === "DAY" ? "☀ DAY" : "🌙 NIGHT"} · ${dmy(date)} · ${mine.length} การ์ด`}>
            <div className="grid gap-3">
              {[...rs.map((r) => ({ r, list: mine.filter((c) => c.roundId === r.roundId) })), ...(orphan.length ? [{ r: null as Round | null, list: orphan }] : [])].map(({ r, list }) => (
                <section key={r?.roundId ?? "x"} className="edp-ov">
                  <header>
                    <b>{r ? roundLabel(r) : "ไม่ระบุรอบ"}</b>
                    <span>{list.length ? `${list.length} การ์ด` : "ยังว่าง"}</span>
                    {r && (
                      <button type="button" className="fill-btn is-sm ml-auto" onClick={() => onEdit(s, r.roundId)}>
                        ✏ EDIT
                      </button>
                    )}
                  </header>
                  {list
                    .sort((a, b) => sortMin(timesOf(a.timeStart, a.timeEnd).sb, st) - sortMin(timesOf(b.timeStart, b.timeEnd).sb, st))
                    .map((c) => (
                      <div key={c.pldId} className={`edp-ov-row ${c.isVisible ? "" : "is-hidden"} ${c.isDone ? "is-done" : ""}`}>
                        <span className="font-mono">{c.timeStart}</span>
                        <b className="truncate">{c.partNo || "(ยังไม่เลือกชิ้นงาน)"}</b>
                        <span className="truncate">{c.customer}</span>
                        <span>{c.hgPlan} HG</span>
                      </div>
                    ))}
                </section>
              ))}
            </div>
          </Box>
        );
      })}
    </div>
  );
}

// 💾 ยืนยัน วันที่ / กะ / รอบ ที่จะบันทึกลงไป (ทับเฉพาะรอบนั้น)
function SaveDialog({ date, shift, round, rounds, cards, onClose, onSaved }: { date: string; shift: Shift; round: number; rounds: Round[]; cards: Ed[]; onClose: () => void; onSaved: (d: string, s: Shift, r: number) => void }) {
  const toast = useToast();
  const [d, setD] = useState(date);
  const [s, setS] = useState<Shift>(shift);
  const [r, setR] = useState(round);
  const [busy, setBusy] = useState(false);
  async function save() {
    // การ์ดที่ยังไม่เลือกชิ้นงานบันทึกได้ (= ช่องเวลาอย่างเดียว หน้างานไม่เห็น)
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/edp/save", { method: "POST", body: { date: d, shift: s, round: r, cards: cards.map(out) } });
      toast.show("SAVE SUCCESS", res.message, "ok");
      onSaved(d, s, r);
    } catch (e) {
      toast.show("ERROR", "เกิดข้อผิดพลาดในการบันทึก\n" + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="💾 SAVE PLAN"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" disabled={busy} onClick={save}>
            {busy ? "…" : `SAVE ${cards.length} CARDS`}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm font-semibold text-ink-soft">บันทึกการ์ด {cards.length} ใบลงวันที่ / กะ / รอบ ด้านล่าง · การ์ดเดิมของรอบนั้นจะถูกแทนที่ (รอบอื่นไม่ถูกแตะ)</p>
        <label className="fx">
          <span className="fx-cap">DATE</span>
          <input type="date" className="field fx-in" value={d} onChange={(e) => e.target.value && setD(e.target.value)} />
        </label>
        <label className="fx">
          <span className="fx-cap">SHIFT / ROUND</span>
          <Select
            value={`${s}|${r}`}
            onChange={(v) => {
              const [a, b] = v.split("|");
              setS(a as Shift);
              setR(+b);
            }}
            options={rounds.map((x) => ({ value: `${x.shift}|${x.roundId}`, label: `${x.shift} · ${roundLabel(x)}` }))}
            ariaLabel="SHIFT / ROUND"
          />
        </label>
      </div>
    </Modal>
  );
}

// ★ บันทึกแม่แบบ: รอบนี้ (การ์ดบนจอ) หรือทั้งกะ (การ์ดบนจอ + รอบอื่นของกะที่บันทึกไว้) · ชื่อซ้ำ = เขียนทับ · ลบแม่แบบเก่าได้
function SaveTemplate({ date, shift, round, cards, canDelete, onClose }: { date: string; shift: Shift; round: Round; cards: Ed[]; canDelete: boolean; onClose: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [whole, setWhole] = useState(false);
  const [name, setName] = useState(`${shift} รอบ ${round.roundId}`);
  const [tpls, setTpls] = useState<Tpl[] | null>(null);
  const [busy, setBusy] = useState(false);
  const loadT = useCallback(() => api<Tpl[]>("/edp/templates").then(setTpls).catch(() => setTpls([])), []);
  useEffect(() => void loadT(), [loadT]);
  async function save() {
    if (!name.trim()) return toast.show("NAME", "กรุณาตั้งชื่อแม่แบบก่อนบันทึก", "warn");
    if (tpls?.some((t) => t.tplName === name.trim()) && !(await dlg.confirm({ title: "OVERWRITE", message: `มีแม่แบบชื่อ "${name.trim()}" อยู่แล้ว · เขียนทับ ?`, ok: "OVERWRITE" }))) return;
    setBusy(true);
    try {
      let list = cards.map(out);
      if (whole) {
        const r = await api<CardsRes>("/edp/cards", { query: { date, shift } });
        const st = shiftStart(shift);
        list = [...r.cards.filter((c) => c.roundId !== round.roundId).map((c) => out(toEd(c))), ...list].sort((a, b) => sortMin(a.timeStart.slice(0, 5), st) - sortMin(b.timeStart.slice(0, 5), st));
      }
      if (list.length === 0) return toast.show("NOTHING TO SAVE", "ยังไม่มีการ์ด จึงบันทึกเป็นแม่แบบไม่ได้", "warn");
      const res = await api<{ message: string }>("/edp/templates", { method: "POST", body: { name, shift, round: whole ? null : round.roundId, cards: list } });
      toast.show("TEMPLATE SAVED", res.message, "ok");
      onClose();
    } catch (e) {
      toast.show("ERROR", "บันทึกแม่แบบไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function del(t: Tpl) {
    if (!(await dlg.confirm({ title: "DELETE TEMPLATE", message: `ลบแม่แบบ "${t.tplName}" (${t.cardCount} การ์ด) ?`, ok: "DELETE", danger: true }))) return;
    try {
      await api(`/edp/templates/${t.tplId}`, { method: "DELETE" });
      loadT();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }
  return (
    <Modal
      open
      title="★ SAVE TEMPLATE"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" disabled={busy} onClick={save}>
            {busy ? "…" : "SAVE TEMPLATE"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm font-semibold text-ink-soft">
          {dmy(date)} · กะ {shift} · รอบนี้ {cards.length} การ์ด
        </p>
        <div className="edp-seg is-2" style={{ "--n": whole ? 1 : 0, "--c": 2 } as React.CSSProperties}>
          <span className="edp-seg-glider" aria-hidden />
          <button type="button" className={!whole ? "is-on" : ""} onClick={() => (setWhole(false), setName(`${shift} รอบ ${round.roundId}`))}>
            รอบนี้
          </button>
          <button type="button" className={whole ? "is-on" : ""} onClick={() => (setWhole(true), setName(`${shift} ทั้งกะ`))}>
            ทั้งกะ
          </button>
        </div>
        <label className="fx">
          <span className="fx-cap">TEMPLATE NAME</span>
          <input className="field fx-in" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="edp-tpls">
          {(tpls ?? []).map((t) => (
            <div key={t.tplId} className="edp-tpl">
              <button type="button" onClick={() => setName(t.tplName)}>
                <b>{t.tplName}</b>
                <small>
                  {t.shift ?? "-"} · {t.roundId ? `รอบ ${t.roundId}` : "ทั้งกะ"} · {t.cardCount} การ์ด
                </small>
              </button>
              {canDelete && <RowAction kind="delete" onClick={() => del(t)} />}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ⤓ ใช้แม่แบบ / คัดลอกแผนจากวันอื่น -> วันที่ + กะ + รอบ (หรือทั้งกะ / ทั้งวัน) · ทับแผนเดิมของช่วงนั้น
function ApplyDialog({ date, shift, round, rounds, onClose, onDone }: { date: string; shift: Shift; round: number | null; rounds: Round[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [mode, setMode] = useState<"tpl" | "copy">("tpl");
  const [tpls, setTpls] = useState<Tpl[] | null>(null);
  const [tpl, setTpl] = useState("");
  const [scope, setScope] = useState<"round" | "shift" | "day">("round");
  const [src, setSrc] = useState(() => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [count, setCount] = useState<{ total: number; done: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Tpl[]>("/edp/templates")
      .then(setTpls)
      .catch(() => setTpls([]));
  }, []);
  const tr = scope === "round" ? round : null;
  useEffect(() => {
    if (scope === "day") return;
    api<{ total: number; done: number }>("/edp/count", { query: { date, shift, round: tr ?? undefined } })
      .then(setCount)
      .catch(() => setCount(null));
  }, [date, shift, tr, scope]);
  const r = rounds.find((x) => x.roundId === round);
  const target = scope === "day" ? `ทั้งวัน ${dmy(date)} (DAY + NIGHT)` : `${dmy(date)} · กะ ${shift} · ${scope === "round" && r ? roundLabel(r) : "ทั้งกะ"}`;

  async function go() {
    if (mode === "tpl" && !tpl) return toast.show("TEMPLATE", "กรุณาเลือกแม่แบบ", "warn");
    if (count && count.total > 0 && !(await dlg.confirm({ title: "OVERWRITE", message: `ปลายทาง ${target} มีการ์ดอยู่แล้ว ${count.total} ใบ${count.done ? ` (MARK แล้ว ${count.done})` : ""}\nจะถูกแทนที่ทั้งหมด ยืนยัน ?`, ok: "OVERWRITE", danger: true }))) return;
    setBusy(true);
    try {
      const res =
        mode === "tpl"
          ? await api<{ message: string }>("/edp/templates/apply", { method: "POST", body: { tplId: +tpl, date, shift: scope === "day" ? "ALL" : shift, round: tr } })
          : await api<{ message: string }>("/edp/copy", { method: "POST", body: { srcDate: src, srcShift: shift, srcRound: tr, tgtDate: date, tgtShift: shift, tgtRound: tr } });
      toast.show("DONE", res.message, "ok");
      onDone();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const sel = tpls?.find((t) => String(t.tplId) === tpl);
  return (
    <Modal
      open
      title="⤓ TEMPLATE / COPY PLAN"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" disabled={busy} onClick={go}>
            {busy ? "…" : "APPLY"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="edp-seg is-2" style={{ "--n": mode === "copy" ? 1 : 0, "--c": 2 } as React.CSSProperties}>
          <span className="edp-seg-glider" aria-hidden />
          <button type="button" className={mode === "tpl" ? "is-on" : ""} onClick={() => setMode("tpl")}>
            ★ ใช้แม่แบบ
          </button>
          <button type="button" className={mode === "copy" ? "is-on" : ""} onClick={() => (setMode("copy"), scope === "day" && setScope("round"))}>
            ⧉ คัดลอกจากวันอื่น
          </button>
        </div>
        <div className="edp-seg" style={{ "--n": ["round", "shift", "day"].indexOf(scope), "--c": mode === "tpl" ? 3 : 2 } as React.CSSProperties}>
          <span className="edp-seg-glider" aria-hidden />
          <button type="button" className={scope === "round" ? "is-on" : ""} disabled={!round} onClick={() => setScope("round")}>
            รอบนี้
          </button>
          <button type="button" className={scope === "shift" ? "is-on" : ""} onClick={() => setScope("shift")}>
            ทั้งกะ
          </button>
          {mode === "tpl" && (
            <button type="button" className={scope === "day" ? "is-on" : ""} onClick={() => setScope("day")}>
              ทั้งวัน
            </button>
          )}
        </div>
        {mode === "tpl" ? (
          <label className="fx">
            <span className="fx-cap">TEMPLATE</span>
            <Select value={tpl} onChange={setTpl} ariaLabel="TEMPLATE" options={[{ value: "", label: tpls ? "เลือกแม่แบบ" : "LOADING..." }, ...(tpls ?? []).map((t) => ({ value: String(t.tplId), label: `${t.tplName} · ${t.cardCount} การ์ด` }))]} />
            {sel && (
              <small className="mt-1 text-xs font-semibold text-ink-soft">
                {sel.shift === "ALL" ? "แม่แบบทั้งวัน 6 รอบ" : `${sel.shift ?? "-"} · ${sel.roundId ? `รอบ ${sel.roundId}` : "ทั้งกะ"}`} · โดย {sel.createBy ?? "-"}
              </small>
            )}
          </label>
        ) : (
          <label className="fx">
            <span className="fx-cap">SOURCE DATE (กะ {shift} · {scope === "round" ? `รอบ ${round}` : "ทั้งกะ"})</span>
            <input type="date" className="field fx-in" value={src} onChange={(e) => e.target.value && setSrc(e.target.value)} />
          </label>
        )}
        <p className="md-meta">
          <span>
            ปลายทาง: <b>{target}</b>
          </span>
          {count && scope !== "day" && <span>มีการ์ดอยู่ {count.total} ใบ · จะถูกแทนที่</span>}
        </p>
      </div>
    </Modal>
  );
}

// ✖ ล้างแผน (เผื่อเลือกแม่แบบ / แผนผิด) · ค่าเริ่มต้นเก็บการ์ดที่ MARK SUCCESS แล้วไว้
function ClearDialog({ date, shift, round, onClose, onDone }: { date: string; shift: Shift; round: number | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [whole, setWhole] = useState(!round);
  const [inc, setInc] = useState(false);
  const [count, setCount] = useState<{ total: number; done: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const r = whole ? null : round;
  useEffect(() => {
    api<{ total: number; done: number }>("/edp/count", { query: { date, shift, round: r ?? undefined } })
      .then(setCount)
      .catch(() => setCount(null));
  }, [date, shift, r]);
  async function go() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/edp/clear", { method: "POST", body: { date, shift, round: r, includeDone: inc } });
      toast.show("CLEARED", res.message, "ok");
      onDone();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const n = count ? (inc ? count.total : count.total - count.done) : 0;
  return (
    <Modal
      open
      title="✖ CLEAR PLAN"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-red" disabled={busy || n === 0} onClick={go}>
            {busy ? "…" : `DELETE ${n} CARDS`}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="edp-seg is-2" style={{ "--n": whole ? 1 : 0, "--c": 2 } as React.CSSProperties}>
          <span className="edp-seg-glider" aria-hidden />
          <button type="button" className={!whole ? "is-on" : ""} disabled={!round} onClick={() => setWhole(false)}>
            รอบ {round ?? "-"}
          </button>
          <button type="button" className={whole ? "is-on" : ""} onClick={() => setWhole(true)}>
            ทั้งกะ {shift}
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={inc} onChange={(e) => setInc(e.target.checked)} />
          ลบการ์ดที่ MARK SUCCESS แล้วด้วย (ยอดผลิตจริงจะหายไป)
        </label>
        <p className="md-meta">
          <span>
            {dmy(date)} · กะ {shift} · {whole ? "ทั้งกะ" : `รอบ ${round}`}
          </span>
          <span>{count ? `ทั้งหมด ${count.total} ใบ · MARK แล้ว ${count.done} ใบ · จะลบ ${n} ใบ` : "LOADING..."}</span>
        </p>
      </div>
    </Modal>
  );
}
