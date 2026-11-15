"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { api } from "@/lib/api";

// 👤 User Management › System Configuration › Organization Master : ตัวเลือก Dropdown ของหน้า ＋ ADD USER / ✏ EDIT USER
//   POSITION (ตำแหน่ง) = รายการเดียว · ฝ่าย -> แผนก -> หน่วยงาน = กดฝ่ายเพื่อดู / เพิ่มแผนกของฝ่ายนั้น · กดแผนกเพื่อดู / เพิ่มหน่วยงานของแผนกนั้น
//   เพิ่ม / แก้ชื่อในช่อง / ⬆⬇ เลื่อนลำดับ / ✕ ลบ (ลบฝ่าย = ลบแผนก + หน่วยงานข้างใต้) แล้วกด SAVE ครั้งเดียว
//   ผู้ใช้ที่มีอยู่เก็บเป็นข้อความเดิม -> แก้ / ลบตัวเลือกไม่กระทบผู้ใช้
type Kind = "POSITION" | "DIVISION" | "SECTION" | "UNIT";
type Opt = { id: number; kind: Kind; name: string; parentId: number | null };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";
const NONE = 0; // แผนก / หน่วยงานที่ยังไม่สังกัด (ข้อมูลตั้งต้นจากผู้ใช้เดิม)
let seq = 0;
const newId = () => --seq;
const CHILD: Partial<Record<Kind, Kind>> = { DIVISION: "SECTION", SECTION: "UNIT" };
const TH: Record<Kind, string> = { POSITION: "ตำแหน่ง", DIVISION: "ฝ่าย", SECTION: "แผนก", UNIT: "หน่วยงาน" };

export function UserOrgPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [ready, setReady] = useState(true);
  const [orig, setOrig] = useState<Opt[] | null>(null);
  const [rows, setRows] = useState<Opt[] | null>(null);
  const [div, setDiv] = useState<number | null>(null);
  const [sec, setSec] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ ready: boolean; items: Opt[] }>("/setup/user-org");
      setReady(d.ready);
      setOrig(d.items);
      setRows(d.items);
    } catch (e) {
      toast.show("ERROR", "โหลดตัวเลือก ORGANIZATION MASTER ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = useMemo(() => !!rows && !!orig && JSON.stringify(rows.map((r) => [r.id, r.kind, r.name.trim(), r.parentId])) !== JSON.stringify(orig.map((r) => [r.id, r.kind, r.name, r.parentId])), [rows, orig]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  if (!rows) return <Loading />;
  const set = (fn: (r: Opt[]) => Opt[]) => setRows((r) => (r ? fn(r) : r));
  const list = (kind: Kind, parent?: number | null) => rows.filter((r) => r.kind === kind && (parent === undefined || (r.parentId ?? NONE) === (parent ?? NONE)));
  const divs = list("DIVISION");
  const curDiv = div ?? divs[0]?.id ?? NONE;
  const secs = list("SECTION", curDiv);
  const curSec = sec !== null && secs.some((s) => s.id === sec) ? sec : (secs[0]?.id ?? null);
  const units = curSec === null ? [] : list("UNIT", curSec);
  const orphanSecs = list("SECTION", NONE).length;
  const orphanUnits = rows.filter((r) => r.kind === "UNIT" && r.parentId === null).length;

  // เลื่อนในกลุ่มเดียวกัน (สลับกับพี่น้องตัวก่อน / ถัดไปในอาเรย์)
  const move = (o: Opt, d: number) =>
    set((r) => {
      const sib = r.map((x, i) => [x, i] as const).filter(([x]) => x.kind === o.kind && (x.parentId ?? NONE) === (o.parentId ?? NONE));
      const at = sib.findIndex(([x]) => x.id === o.id);
      const to = sib[at + d];
      if (!to) return r;
      const n = [...r];
      [n[sib[at][1]], n[to[1]]] = [n[to[1]], n[sib[at][1]]];
      return n;
    });

  function add(kind: Kind, text: string, parent: number | null) {
    const t = text.trim().replace(/\s+/g, " ");
    if (!t) return false;
    if (t.length > 100) return toast.show("WARNING", "ชื่อยาวได้ไม่เกิน 100 ตัวอักษร", "warn"), false;
    if (list(kind, kind === "POSITION" || kind === "DIVISION" ? undefined : parent).some((r) => r.name.trim().toLowerCase() === t.toLowerCase()))
      return toast.show("WARNING", `มี${TH[kind]} "${t}" อยู่แล้ว`, "warn"), false;
    const o: Opt = { id: newId(), kind, name: t, parentId: kind === "SECTION" || kind === "UNIT" ? (parent === NONE ? null : parent) : null };
    set((r) => [...r, o]);
    if (kind === "DIVISION") setDiv(o.id);
    if (kind === "SECTION") setSec(o.id);
    return true;
  }

  async function remove(o: Opt) {
    const kids = CHILD[o.kind] ? rows!.filter((r) => r.parentId === o.id) : [];
    const grand = kids.flatMap((k) => rows!.filter((r) => r.parentId === k.id));
    const extra = kids.length ? `\n(ลบ${TH[CHILD[o.kind]!]}ข้างใต้ ${kids.length} รายการ${grand.length ? ` + หน่วยงาน ${grand.length} รายการ` : ""} ด้วย)` : "";
    if (o.id > 0 && !(await dlg.confirm({ title: `ลบ${TH[o.kind]}`, message: `ลบ "${o.name}" ?${extra}\nผู้ใช้ที่ใช้ค่านี้อยู่ยังเก็บข้อความเดิม · มีผลเมื่อกด SAVE`, ok: "ลบ", danger: true }))) return;
    const gone = new Set([o.id, ...kids.map((k) => k.id), ...grand.map((g) => g.id)]);
    set((r) => r.filter((x) => !gone.has(x.id)));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/setup/user-org", { method: "POST", body: rows!.map((x) => ({ id: x.id, kind: x.kind, name: x.name.trim(), parentId: x.parentId })) });
      toast.show("Saved", r.message, "ok");
      setDiv(null);
      setSec(null);
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <p className="text-xs font-bold text-ink-soft">
        ตัวเลือก Dropdown ของหน้า ＋ ADD USER / ✏ EDIT USER · POSITION (ตำแหน่ง) · ฝ่าย → แผนก → หน่วยงาน (เลือกฝ่ายแล้วเห็นเฉพาะแผนกของฝ่ายนั้น · เลือกแผนกแล้วเห็นเฉพาะหน่วยงานของแผนกนั้น) · แก้ชื่อในช่องได้เลย · ⬆⬇ เลื่อนลำดับ · กด SAVE ครั้งเดียว
      </p>
      {!ready && <div className="mr-off">ฐานข้อมูลยังไม่มีตาราง Nexus.UserOrgOptions (database/nexus/43_User_Org_Options.sql) · ฟอร์มผู้ใช้ยังใช้ช่องพิมพ์แบบเดิม</div>}

      <div className="uo-box">
        <OrgList title="POSITION (ตำแหน่ง)" kind="POSITION" items={list("POSITION")} ready={ready} placeholder="เช่น Supervisor / Leader / Operator" onAdd={(t) => add("POSITION", t, null)} onEdit={(o, v) => set((r) => r.map((x) => (x.id === o.id ? { ...x, name: v } : x)))} onMove={move} onRemove={remove} />
      </div>

      <div className="uo-tree">
        <OrgList
          title="1 • ฝ่าย (DIVISION)"
          kind="DIVISION"
          items={divs}
          ready={ready}
          placeholder="เช่น ฝ่ายผลิต"
          selected={curDiv}
          onSelect={(id) => (setDiv(id), setSec(null))}
          count={(o) => list("SECTION", o.id).length}
          extra={orphanSecs > 0 ? { label: `— แผนกที่ยังไม่ระบุฝ่าย (${orphanSecs})`, on: curDiv === NONE, pick: () => (setDiv(NONE), setSec(null)) } : undefined}
          onAdd={(t) => add("DIVISION", t, null)}
          onEdit={(o, v) => set((r) => r.map((x) => (x.id === o.id ? { ...x, name: v } : x)))}
          onMove={move}
          onRemove={remove}
        />
        <OrgList
          title={`2 • แผนก (SECTION) ${curDiv === NONE ? "· ยังไม่ระบุฝ่าย" : `· ${divs.find((d) => d.id === curDiv)?.name ?? ""}`}`}
          kind="SECTION"
          items={secs}
          ready={ready && (curDiv !== NONE || orphanSecs > 0 || divs.length === 0)}
          placeholder="เช่น แผนกผลิต 1"
          selected={curSec ?? undefined}
          onSelect={(id) => setSec(id)}
          count={(o) => list("UNIT", o.id).length}
          onAdd={(t) => add("SECTION", t, curDiv)}
          onEdit={(o, v) => set((r) => r.map((x) => (x.id === o.id ? { ...x, name: v } : x)))}
          onMove={move}
          onRemove={remove}
        />
        <OrgList
          title={`3 • หน่วยงาน (UNIT) ${curSec !== null ? `· ${secs.find((s) => s.id === curSec)?.name ?? ""}` : ""}`}
          kind="UNIT"
          items={units}
          ready={ready && curSec !== null}
          placeholder={curSec === null ? "เลือก / เพิ่มแผนกก่อน" : "เช่น ปั๊ม 1"}
          onAdd={(t) => curSec !== null && add("UNIT", t, curSec)}
          onEdit={(o, v) => set((r) => r.map((x) => (x.id === o.id ? { ...x, name: v } : x)))}
          onMove={move}
          onRemove={remove}
        />
      </div>
      {orphanUnits > 0 && <p className="text-xs font-bold text-warning">มีหน่วยงานที่ยังไม่ระบุแผนก {orphanUnits} รายการ (จากข้อมูลผู้ใช้เดิม) · แสดงในฟอร์มผู้ใช้เมื่อยังไม่เลือกแผนก</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs font-bold text-warning">ยังไม่ได้ SAVE</span>}
        <button type="button" className="cta-btn is-gray" onClick={() => (setRows(orig), setDiv(null), setSec(null))} disabled={!dirty || busy}>
          RESET
        </button>
        <button type="button" className="cta-btn is-green" onClick={save} disabled={!ready || !dirty || busy}>
          {busy ? "…" : "💾 SAVE"}
        </button>
      </div>
    </div>
  );
}

function OrgList({
  title,
  kind,
  items,
  ready,
  placeholder,
  selected,
  onSelect,
  count,
  extra,
  onAdd,
  onEdit,
  onMove,
  onRemove,
}: {
  title: string;
  kind: Kind;
  items: Opt[];
  ready: boolean;
  placeholder: string;
  selected?: number;
  onSelect?: (id: number) => void;
  count?: (o: Opt) => number;
  extra?: { label: string; on: boolean; pick: () => void };
  onAdd: (t: string) => boolean | void;
  onEdit: (o: Opt, v: string) => void;
  onMove: (o: Opt, d: number) => void;
  onRemove: (o: Opt) => void;
}) {
  const [text, setText] = useState("");
  const go = () => onAdd(text) && setText("");
  return (
    <div className="uo-col">
      <span className={L}>
        {title} ({items.length})
      </span>
      <div className="rs-add">
        <input id={`uo-add-${kind}`} value={text} maxLength={100} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder={placeholder} disabled={!ready} aria-label={`เพิ่ม${TH[kind]}`} />
        <button type="button" className="cta-btn is-green" onClick={go} disabled={!ready || !text.trim()}>
          ＋ ADD
        </button>
      </div>
      <div className="rs-list uo-list">
        {items.length === 0 && <div className="uo-empty">ยังไม่มี{TH[kind]}</div>}
        {items.map((o, i) => (
          <div key={o.id} className={`rs-row ${o.id > 0 ? "" : "is-new"} ${onSelect ? "is-pick" : ""} ${selected === o.id ? "is-sel" : ""}`} onClick={() => onSelect?.(o.id)}>
            <span>{i + 1}</span>
            <input value={o.name} maxLength={100} disabled={!ready} aria-label={`${TH[kind]}ลำดับ ${i + 1}`} onClick={(e) => (e.stopPropagation(), onSelect?.(o.id))} onChange={(e) => onEdit(o, e.target.value)} />
            {count && <em className="uo-count" title={`จำนวน${TH[CHILD[kind]!]}`}>{count(o)}</em>}
            <div className="rs-btns" onClick={(e) => e.stopPropagation()}>
              <button type="button" title="เลื่อนขึ้น" onClick={() => onMove(o, -1)} disabled={!ready || i === 0}>
                ⬆
              </button>
              <button type="button" title="เลื่อนลง" onClick={() => onMove(o, 1)} disabled={!ready || i === items.length - 1}>
                ⬇
              </button>
              <button type="button" title="ลบ" className="is-del" onClick={() => onRemove(o)} disabled={!ready}>
                ✕
              </button>
            </div>
          </div>
        ))}
        {extra && (
          <button type="button" className={`uo-extra ${extra.on ? "is-sel" : ""}`} onClick={extra.pick}>
            {extra.label}
          </button>
        )}
      </div>
    </div>
  );
}
