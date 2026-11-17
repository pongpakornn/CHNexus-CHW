"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, SearchBox } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { qty, stamp } from "@/lib/format";
import { sameData, useLive } from "@/lib/live";
import { COIL_ART } from "./coilArt";
import { createEngine, type Engine, type EngineData, type Hit } from "./engine";
import { PLAN_H, PLAN_W, SLOTS, SLOT_BY_ID, ZONES, ZONE_BY_ID, locate, type Zone } from "./plan";

// 🧊 LAYOUT 3D (STOCK MATERIAL): ผังคลังแบบ 3D · กดโซน = ซูมเข้าดู Rack · กด Coil = ข้อมูล + รูป
//   สถานะมาจากการสแกนที่ Multi-Scanner: Coil ที่ยังอยู่ในคลัง (IN) + ตำแหน่ง LAYOUT ที่สแกนไว้ตอนรับเข้า -> มีเหล็ก · ไม่มี = เว้นว่าง
//   อัพเดททันทีเมื่อมีการสแกน / แก้ LAYOUT SETUP (useLive) + เช็คเองทุก 10 วินาที
type ApiCoil = {
  coilId: number;
  coilNo: string;
  motherCoil: string | null;
  partId: number;
  partCode: string;
  partName: string | null;
  customer: string | null;
  stockCode: string;
  weightKg: number;
  receivedDate: string | null;
  layout: string;
  placedAt: string | null;
  placedBy: string | null;
  typeName: string | null;
  locName: string | null;
};
type ApiLoc = { locId: number; typeName: string; locName: string };
type ApiData = { ready: boolean; locations?: ApiLoc[]; coils?: ApiCoil[] };
type PageSel = { kind: "slot"; slotId: string; coilId?: number } | { kind: "floor"; zoneId: string; coilId: number } | null;

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
};
const STOCK_ZONES = ZONES.filter((z) => z.kind !== "scenery");

function Chip({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded-xl border border-line/60 bg-surface px-3 py-1.5 shadow-sm">
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="text-lg font-extrabold tabular-nums leading-none" style={{ color: color ?? "var(--primary)" }}>
        {value}
      </span>
    </div>
  );
}

// รูปสินค้าจากระบบ (api/images/part) · ไม่มีรูป = ภาพ Coil ตัวอย่าง
function CoilImage({ partId }: { partId: number }) {
  const [bad, setBad] = useState(false);
  return (
    <div className="grid h-36 place-items-center overflow-hidden rounded-xl border border-line/60 bg-surface-2">
      {bad ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={COIL_ART} alt="ภาพ Coil เหล็ก (ไม่มีรูปสินค้า)" className="h-32 w-auto" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/images/part/${partId}`} alt="รูปสินค้า" className="max-h-full max-w-full object-contain" onError={() => setBad(true)} />
      )}
    </div>
  );
}

function CoilDetail({ coil, where }: { coil: ApiCoil; where: string }) {
  const rows: [string, string][] = [
    ["Number Coil", coil.coilNo],
    ["Master Coil", coil.motherCoil || "-"],
    ["PD Code", coil.partCode],
    ["ชื่อสินค้า", coil.partName || "-"],
    ["ลูกค้า", coil.customer || "-"],
    ["น้ำหนัก", `${qty(coil.weightKg)} kg`],
    ["วันที่รับเข้า", stamp(coil.receivedDate)],
    ["คลัง", coil.stockCode],
    ["ตำแหน่งที่สแกน", coil.layout],
    ["สแกนวางเมื่อ", `${stamp(coil.placedAt)}${coil.placedBy ? ` · ${coil.placedBy}` : ""}`],
    ["โซน", where],
  ];
  return (
    <>
      <CoilImage key={coil.partId} partId={coil.partId} />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-ink-soft">{k}</dt>
            <dd className="break-all font-bold tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

// ตำแหน่งที่มีหลายม้วน (เช่น 1A วางได้มากกว่า 1 ลูก): การ์ดสเปคทุกม้วน · กดการ์ด = ดูรายละเอียดด้านล่าง
function CoilCards({ list, cur, onPick }: { list: ApiCoil[]; cur?: ApiCoil; onPick: (c: ApiCoil) => void }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-extrabold text-ink-soft">ตำแหน่งนี้มี {list.length} ม้วน · กดการ์ดเพื่อดูรายละเอียด</p>
      {list.map((c) => (
        <button key={c.coilId} type="button" onClick={() => onPick(c)} className={`grid gap-0.5 rounded-lg border px-3 py-2 text-left ${c === cur ? "border-warning bg-warning/10" : "border-line/60 bg-surface"}`}>
          <span className="flex items-start justify-between gap-2 text-sm font-extrabold text-ink">
            <span className="min-w-0 break-all">{c.coilNo}</span>
            <span className="shrink-0 tabular-nums">{qty(c.weightKg)} kg</span>
          </span>
          <span className="break-words text-xs font-semibold text-ink-soft">Master {c.motherCoil || "-"}</span>
          <span className="break-words text-xs font-semibold text-ink-soft">
            PD CODE {c.partCode} · {c.partName || "-"}
          </span>
        </button>
      ))}
    </div>
  );
}

// เหล็กแพ็ค S1–S9: ผังตามหน้างาน (S1–S3 ฝั่ง STORE ท่อ · S7–S9 ฝั่งโต๊ะทำงาน) · ช่องละ 3 แพ็ค · ว่าง / มี / เต็ม
const PLATE_ROWS = [["S1", "S2", "S3"], ["S4", "S5", "S6"], ["S7", "S8", "S9"]];
const PLATE_CAP = 3;
function PlateGrid({ list }: { list: ApiCoil[] }) {
  const n = (s: string) => list.filter((c) => (c.locName ?? "").toUpperCase() === s).length;
  return (
    <div className="mb-3 grid gap-1">
      <span className="text-center text-[10px] font-extrabold uppercase tracking-wide text-ink-soft">↑ ฝั่ง STORE ท่อ</span>
      <div className="grid grid-cols-3 gap-1">
        {PLATE_ROWS.flat().map((s) => {
          const k = n(s);
          return (
            <div
              key={s}
              className={`rounded-md border py-1.5 text-center text-xs font-extrabold ${k > PLATE_CAP ? "border-danger bg-danger text-white ring-2 ring-danger/40" : k >= PLATE_CAP ? "border-transparent bg-danger text-white" : k > 0 ? "border-transparent bg-success text-white" : "border-line bg-surface-2 text-ink-soft"}`}
              title={k >= PLATE_CAP ? "เต็ม" : k > 0 ? "มีเหล็ก" : "ว่าง"}
            >
              {s}
              <span className="block text-[10px] font-bold">{k === 0 ? "ว่าง" : k > PLATE_CAP ? `เก็บเกิน ${k}/${PLATE_CAP}` : `${k}/${PLATE_CAP}`}</span>
            </div>
          );
        })}
      </div>
      <span className="text-center text-[10px] font-extrabold uppercase tracking-wide text-ink-soft">↓ ฝั่งโต๊ะทำงาน</span>
    </div>
  );
}

export default function Layout3DPage() {
  const toast = useToast();
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const perfRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const last = useRef("");
  const failed = useRef(false);
  const [data, setData] = useState<ApiData | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<PageSel>(null);
  // ป้ายชี้: เปลี่ยน state เฉพาะตอนข้อความเปลี่ยน · ตำแหน่งตามเมาส์เขียนลง DOM ตรง ๆ (ไม่ render ทั้งหน้าทุกครั้งที่ขยับเมาส์ = ไม่กระตุก)
  const [tip, setTip] = useState<string | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipPos = useRef({ x: 0, y: 0 });
  const [noGl, setNoGl] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<ApiData>("/layout3d");
      failed.current = false;
      if (sameData(last, r)) return;
      setData(r);
    } catch (e) {
      // แจ้งครั้งเดียว (รอบถัดไปลองใหม่เอง ไม่เด้งซ้ำทุก 10 วินาที)
      if (!failed.current) toast.show("LAYOUT 3D", (e as Error).message, "error");
      failed.current = true;
    }
  }, [toast]);
  useEffect(() => {
    const t0 = setTimeout(load, 0);
    return () => clearTimeout(t0);
  }, [load]);
  useLive(["store", "scanner", "layout", "layout3d"], load, 10_000);

  // Coil ของแต่ละตำแหน่งในโมเดล · นอกโมเดล = สแกนตำแหน่งที่ผังนี้ไม่มี (แสดงเป็นรายการ ไม่ทิ้งเงียบ ๆ)
  const model = useMemo(() => {
    const bySlot = new Map<string, ApiCoil[]>();
    const byZone = new Map<string, ApiCoil[]>();
    const outside: ApiCoil[] = [];
    const kg: Record<number, number> = {};
    for (const c of data?.coils ?? []) {
      kg[c.coilId] = c.weightKg;
      const p = locate(c.typeName, c.locName, c.layout);
      if (!p) outside.push(c);
      else if ("slotId" in p) push(bySlot, p.slotId, c);
      else push(byZone, p.zoneId, c);
    }
    // ตำแหน่งในผังที่สร้างไว้ใน LAYOUT SETUP แล้ว (มี QR ให้สแกน)
    const known = new Set<string>();
    for (const l of data?.locations ?? []) {
      const p = locate(l.typeName, l.locName);
      if (p) known.add("slotId" in p ? p.slotId : p.zoneId);
    }
    return { bySlot, byZone, outside, known, kg };
  }, [data]);

  const countOf = useCallback(
    (z: Zone) => (z.kind === "rack" ? `${z.slots.filter((s) => model.bySlot.has(s.id)).length}/${z.slots.length}` : z.kind === "floor" ? `${model.byZone.get(z.id)?.length ?? 0} ม้วน` : ""),
    [model],
  );

  const onPick = (h: Hit) => {
    setFocus(h.zoneId);
    setSel(h.kind === "slot" ? { kind: "slot", slotId: h.slotId } : h.kind === "floor" ? { kind: "floor", zoneId: h.zoneId, coilId: h.coilId } : null);
  };
  const onHover = (h: Hit | null, x: number, y: number) => {
    if (!h) return setTip((t) => (t === null ? t : null));
    const z = ZONE_BY_ID.get(h.zoneId)!;
    const text =
      h.kind === "slot"
        ? `${h.slotId} · ${(model.bySlot.get(h.slotId)?.length ?? 0) > 1 ? `${model.bySlot.get(h.slotId)!.length} ม้วน` : (model.bySlot.get(h.slotId)?.[0]?.coilNo ?? "ว่าง")}`
        : h.kind === "floor"
          ? `${z.name} · ${model.byZone.get(z.id)?.find((c) => c.coilId === h.coilId)?.coilNo ?? ""}`
          : `${z.name} · ${countOf(z)}`;
    tipPos.current = { x, y };
    if (tipRef.current) tipRef.current.style.transform = `translate3d(${x + 12}px, ${y + 12}px, 0)`;
    setTip((t) => (t === text ? t : text));
  };
  const pickRef = useRef(onPick);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    pickRef.current = onPick;
    hoverRef.current = onHover;
  });

  // สร้างตัววาด 3D ครั้งเดียว · ออกจากหน้า = คืนหน่วยความจำการ์ดจอ
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const eng = createEngine(canvas, stage, {
      onPick: (h) => pickRef.current(h),
      onHover: (h, x, y) => hoverRef.current(h, x, y),
      onPerf: (t) => {
        if (perfRef.current) perfRef.current.textContent = t;
      },
    });
    if (!eng) {
      const t = setTimeout(() => setNoGl(true), 0);
      return () => clearTimeout(t);
    }
    engineRef.current = eng;
    return () => {
      eng.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const d: EngineData = { slots: {}, floors: {}, labels: {}, kg: model.kg };
    for (const [id, list] of model.bySlot) d.slots[id] = list[0].coilId;
    for (const [id, list] of model.byZone) if (id !== "PACK") d.floors[id] = list.map((c) => c.coilId); // PACK: counts in label + S1–S9 grid (no coils drawn on the pack bases)
    for (const z of STOCK_ZONES) d.labels[z.id] = countOf(z);
    engineRef.current?.setData(d);
  }, [model, countOf]);
  useEffect(() => {
    engineRef.current?.setFocus(focus);
  }, [focus]);
  useEffect(() => {
    engineRef.current?.setSelection(sel);
  }, [sel]);

  const zone = focus ? (ZONE_BY_ID.get(focus) ?? null) : null;
  const overview = () => {
    setFocus(null);
    setSel(null);
  };
  const view = (act: "in" | "out" | "rotate") => {
    const eng = engineRef.current;
    if (act === "rotate") eng?.rotate();
    else eng?.zoom(act === "in" ? 0.78 : 1.28);
  };

  /* ---------- ตัวเลขสรุป ---------- */
  const occupied = SLOTS.filter((s) => model.bySlot.has(s.id)).length;
  const onFloor = [...model.byZone.values()].reduce((a, l) => a + l.length, 0);

  /* ---------- ค้นหา ---------- */
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    const out: { key: string; main: string; sub: string; go: () => void }[] = [];
    const slot = SLOT_BY_ID.get(t.toUpperCase());
    if (slot && !model.bySlot.has(slot.id)) out.push({ key: "s" + slot.id, main: `ตำแหน่ง ${slot.id}`, sub: "ว่าง", go: () => (setFocus(slot.zoneId), setSel({ kind: "slot", slotId: slot.id })) });
    const hit = (c: ApiCoil, where: string) => `${c.coilNo} ${c.motherCoil ?? ""} ${c.partCode} ${c.partName ?? ""} ${where}`.toLowerCase().includes(t);
    for (const [id, list] of model.bySlot)
      for (const c of list)
        if (hit(c, id)) out.push({ key: "c" + c.coilId, main: c.coilNo, sub: `${id} · ${c.partCode}`, go: () => (setFocus(SLOT_BY_ID.get(id)!.zoneId), setSel({ kind: "slot", slotId: id, coilId: c.coilId })) });
    for (const [id, list] of model.byZone) {
      const name = ZONE_BY_ID.get(id)!.name;
      for (const c of list) if (hit(c, name)) out.push({ key: "c" + c.coilId, main: c.coilNo, sub: `${name} · ${c.partCode}`, go: () => (setFocus(id), setSel({ kind: "floor", zoneId: id, coilId: c.coilId })) });
    }
    return out.slice(0, 8);
  }, [q, model]);

  /* ---------- ข้อมูลของตำแหน่งที่เลือก ---------- */
  const selSlot = sel?.kind === "slot" ? SLOT_BY_ID.get(sel.slotId) : undefined;
  const slotCoils = selSlot ? (model.bySlot.get(selSlot.id) ?? []) : [];
  const selCoil = sel?.kind === "slot" ? (slotCoils.find((c) => c.coilId === sel.coilId) ?? slotCoils[0]) : sel?.kind === "floor" ? model.byZone.get(sel.zoneId)?.find((c) => c.coilId === sel.coilId) : undefined;
  const selZone = selSlot ? ZONE_BY_ID.get(selSlot.zoneId) : sel?.kind === "floor" ? ZONE_BY_ID.get(sel.zoneId) : undefined;
  const hasSel = !!selSlot || !!selCoil;

  const glass = "rounded-xl border border-white/15 bg-[#0e2247]/90 text-[#e9f1ff] backdrop-blur";

  return (
    <div className="page-in flex flex-col gap-3 p-3 md:p-4 lg:h-full">
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="ตำแหน่ง Rack" value={SLOTS.length} />
        <Chip label="มีเหล็ก" value={occupied} color="var(--success)" />
        <Chip label="ว่าง" value={SLOTS.length - occupied} color="var(--ink-soft)" />
        <Chip label="วางพื้น (ม้วน)" value={onFloor} color="var(--warning)" />
        {model.outside.length > 0 && <Chip label="นอกผัง" value={model.outside.length} color="var(--danger)" />}
        <div className="relative z-30 ml-auto w-full sm:w-80">
          <SearchBox value={q} onChange={setQ} placeholder="ค้นหา Number Coil / PD Code / ตำแหน่ง" />
          {results && (
            <ul className="absolute inset-x-0 top-full mt-1 max-h-72 overflow-auto rounded-xl border border-line/60 bg-surface p-1 shadow-lg">
              {results.length === 0 && <li className="px-3 py-2 text-sm font-semibold text-ink-soft">ไม่พบรายการที่ตรงกับ &quot;{q.trim()}&quot;</li>}
              {results.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-bold text-ink hover:bg-surface-2"
                    onClick={() => {
                      r.go();
                      setQ("");
                    }}
                  >
                    <span className="truncate">{r.main}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-soft">{r.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {data && !data.ready && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm font-bold text-ink">
          ฐานข้อมูลยังไม่มีตาราง LAYOUT หรือทะเบียน Coil จึงยังไม่มีสถานะให้แสดง (รัน database/nexus/20_Storage_Layout.sql แล้วเปิดหน้านี้ใหม่)
        </div>
      )}

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:grid-rows-[minmax(0,1fr)]">
        {/* ---------- โมเดล 3D ---------- */}
        <section ref={stageRef} className="relative h-[58dvh] min-h-[320px] overflow-hidden rounded-2xl border border-line/60 bg-[#081428] shadow-sm lg:h-auto" aria-label="โมเดล 3D ผังคลัง">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className="absolute inset-0 block h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#f6b02c]"
            aria-label="โมเดล 3D ผังคลัง: ลากเพื่อหมุน เลื่อนล้อเมาส์เพื่อซูม กดที่โซนหรือ Coil เพื่อดูข้อมูล"
            onKeyDown={(e) => e.key === "Escape" && overview()}
          />
          {noGl && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm font-bold text-[#93a9d1]">อุปกรณ์นี้เปิด WebGL ไม่ได้ จึงแสดงโมเดล 3D ไม่ได้ ยังดูสถานะจากแผนผังด้านข้างได้</div>}
          {zone && (
            <button type="button" onClick={overview} className={`absolute left-3 top-3 px-3 py-1.5 text-sm font-extrabold hover:bg-[#15305f] ${glass}`}>
              ← ภาพรวม
            </button>
          )}
          <span ref={perfRef} className="pointer-events-none absolute right-3 top-3 rounded-md bg-[#081428]/70 px-2 py-1 text-[11px] font-semibold tabular-nums text-[#93a9d1]" />
          <div className={`pointer-events-none absolute bottom-3 left-3 hidden flex-col gap-1 px-3 py-2 text-xs font-semibold sm:flex ${glass}`}>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-[#3ad685]" />
              มีเหล็ก (สแกนเข้าแล้ว)
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-[#6c7c9a]" />
              ว่าง
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-[#f6b02c]" />
              ตำแหน่งที่เลือก
            </span>
          </div>
          <div className="absolute bottom-3 right-3 flex gap-1.5">
            {(
              [
                ["+", "ซูมเข้า", "in"],
                ["−", "ซูมออก", "out"],
                ["⟳", zone?.kind === "rack" ? "พลิกดูอีกด้านของ Rack" : "หมุนมุมมอง", "rotate"],
              ] as const
            ).map(([txt, label, act]) => (
              <button key={act} type="button" onClick={() => view(act)} aria-label={label} title={label} className={`grid size-9 place-items-center text-lg font-extrabold leading-none hover:bg-[#15305f] ${glass}`}>
                {txt}
              </button>
            ))}
          </div>
          {tip && (
            <div
              ref={(el) => {
                tipRef.current = el;
                if (el) el.style.transform = `translate3d(${tipPos.current.x + 12}px, ${tipPos.current.y + 12}px, 0)`;
              }}
              className="pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded-md border border-white/15 bg-[#15305f] px-2 py-1 text-xs font-bold text-[#e9f1ff] will-change-transform"
            >
              {tip}
            </div>
          )}
        </section>

        {/* ---------- แผงด้านข้าง ---------- */}
        <aside className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto" aria-label="รายละเอียด">
          <Card title={zone ? zone.name : "แผนผังคลัง"} bodyClass="p-3">
            {!zone ? (
              <>
                <p className="mb-2 text-xs font-semibold text-ink-soft">กดโซนที่มีสีเข้มเพื่อซูมเข้า (โซนสีจางเป็นฉากประกอบ)</p>
                <div className="relative w-full overflow-hidden rounded-xl border border-line/60 bg-surface-2" style={{ aspectRatio: `${PLAN_W}/${PLAN_H}` }}>
                  {ZONES.map((z) => {
                    const style = { left: `${(z.px[0] / PLAN_W) * 100}%`, top: `${(z.px[1] / PLAN_H) * 100}%`, width: `${((z.px[2] - z.px[0]) / PLAN_W) * 100}%`, height: `${((z.px[3] - z.px[1]) / PLAN_H) * 100}%`, background: hex(z.color) };
                    const cls = "absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] text-center text-[10px] font-extrabold leading-tight text-[#0b1a33]";
                    return z.kind === "scenery" ? (
                      <div key={z.id} className={`${cls} opacity-40`} style={style} title={z.name}>
                        {z.short}
                      </div>
                    ) : (
                      <button key={z.id} type="button" className={`${cls} transition hover:brightness-110`} style={style} title={z.name} aria-label={`${z.name} ${countOf(z)}`} onClick={() => (setFocus(z.id), setSel(null))}>
                        {z.short}
                        <span className="text-[9px] font-bold">{countOf(z)}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : zone.kind === "rack" ? (
              <>
                <p className="mb-2 text-xs font-semibold text-ink-soft">เรียงตามผังกระดาษ · แถวกลาง = ชั้น 2 (ใต้ชั้นเว้นว่าง) · แถวริม = วางพื้น</p>
                <div className="flex items-center gap-2.5">
                  {zone.racks.map((r) => (
                    <div key={r.x0} className="grid min-w-0 gap-[3px]" style={{ flex: `${r.bays.length} 1 0`, gridTemplateColumns: `repeat(${r.bays.length}, minmax(0, 1fr))` }}>
                      {r.rows.flatMap((row) =>
                        r.bays.map((b) => {
                          const id = row.lv + b;
                          const on = model.bySlot.has(id);
                          const cur = sel?.kind === "slot" && sel.slotId === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setSel({ kind: "slot", slotId: id })}
                              aria-label={`ตำแหน่ง ${id} ${row.name} ${on ? "มีเหล็ก" : "ว่าง"}`}
                              className={`min-w-0 rounded-[4px] border text-center text-[11px] font-extrabold leading-none ${row.y > 0 ? "py-2.5" : "py-1.5"} ${on ? "border-transparent bg-success text-white" : model.known.has(id) ? "border-transparent bg-surface-2 text-ink-soft" : "border-dashed border-line bg-surface text-ink-soft"} ${cur ? "ring-2 ring-warning" : ""}`}
                            >
                              {id}
                              {(model.bySlot.get(id)?.length ?? 0) > 1 && <span className="block text-[9px] font-bold opacity-90">×{model.bySlot.get(id)!.length}</span>}
                            </button>
                          );
                        }),
                      )}
                    </div>
                  ))}
                </div>
                {zone.slots.some((s) => !model.known.has(s.id)) && <p className="mt-2 text-xs font-semibold text-ink-soft">ช่องเส้นประ = ยังไม่มีตำแหน่งนี้ใน LAYOUT SETUP (ยังไม่มี QR ให้สแกน)</p>}
              </>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold text-ink-soft">
                  ทั้งโซนนับเป็น 1 ตำแหน่ง · {model.byZone.get(zone.id)?.length ?? 0} ม้วน
                  {(model.byZone.get(zone.id)?.length ?? 0) > zone.cap ? ` (โมเดลวาดได้ ${zone.cap} ม้วนแรก)` : ""}
                </p>
                {!model.known.has(zone.id) && <p className="mb-2 text-xs font-semibold text-ink-soft">ยังไม่มีตำแหน่งของโซนนี้ใน LAYOUT SETUP (ตั้งชื่อให้มีคำว่า {zone.match[0]})</p>}
                {zone.id === "PACK" && <PlateGrid list={model.byZone.get(zone.id) ?? []} />}
                <ul className="flex flex-col gap-1">
                  {(model.byZone.get(zone.id) ?? []).map((c) => (
                    <li key={c.coilId}>
                      <button
                        type="button"
                        onClick={() => setSel({ kind: "floor", zoneId: zone.id, coilId: c.coilId })}
                        className={`flex w-full flex-wrap items-center justify-between gap-x-2 rounded-lg border px-3 py-1.5 text-left text-sm font-bold text-ink ${sel?.kind === "floor" && sel.coilId === c.coilId ? "border-warning" : "border-line/60"}`}
                      >
                        <span className="min-w-0 break-all">{c.coilNo}</span>
                        <span className="text-xs font-semibold text-ink-soft">
                          {c.locName && c.locName !== zone.id ? `${c.locName} · ` : ""}
                          {c.partCode}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="ข้อมูลตำแหน่ง" bodyClass="flex flex-col gap-3 p-3">
            {!hasSel ? (
              <p className="text-sm font-semibold text-ink-soft">{zone ? "กดที่ Coil หรือช่องว่างในโมเดล เพื่อดูข้อมูลของตำแหน่งนั้น" : "เลือกโซนจากโมเดลหรือแผนผัง แล้วกดที่ Coil เพื่อดูข้อมูล"}</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <b className="text-2xl font-extrabold leading-tight text-primary">{selSlot ? selSlot.id : selZone?.name}</b>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-extrabold ${selCoil ? "bg-success text-white" : "border border-line bg-surface-2 text-ink-soft"}`}>{selCoil ? "มีเหล็กจัดเก็บ" : "ว่าง"}</span>
                </div>
                {selSlot && <p className="text-xs font-semibold text-ink-soft">{selSlot.row.name}</p>}
                {!selCoil && (
                  <p className="text-sm font-semibold text-ink-soft">
                    ยังไม่มีการสแกนเข้าที่ตำแหน่งนี้
                    {selSlot && !model.known.has(selSlot.id) ? " · ยังไม่มีตำแหน่งนี้ใน LAYOUT SETUP" : ""}
                  </p>
                )}
                {selSlot && slotCoils.length > 1 && <CoilCards list={slotCoils} cur={selCoil} onPick={(c) => setSel({ kind: "slot", slotId: selSlot.id, coilId: c.coilId })} />}
                {selCoil && <CoilDetail coil={selCoil} where={selZone?.name ?? "-"} />}
              </>
            )}
          </Card>

          {model.outside.length > 0 && (
            <Card title={`นอกผัง (${model.outside.length})`} bodyClass="p-3">
              <p className="mb-2 text-xs font-semibold text-ink-soft">Coil ที่สแกนตำแหน่งซึ่งผัง 3D นี้ยังไม่มี</p>
              <ul className="flex flex-col gap-1 text-sm">
                {model.outside.slice(0, 30).map((c) => (
                  <li key={c.coilId} className="flex flex-wrap items-center justify-between gap-x-2 rounded-lg border border-line/60 px-3 py-1.5 font-bold text-ink">
                    <span className="min-w-0 break-all">{c.coilNo}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-soft">{c.layout}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
