"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { QrImage } from "@/components/print/QrImage";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { LayoutExport } from "./LayoutExport";
import type { LayoutData, Loc, LType } from "./types";

// 📍 LAYOUT SETUP (เมนู Sidebar): ตำแหน่งจัดเก็บ
//   1) ช่องแรก = ประเภท (RACK1) · ช่องที่สอง = ชื่อตำแหน่ง พิมพ์หลายตัวได้ (3A 3B 3C) -> ADD = บันทึกทันที
//   2) รูปแบบข้อมูลใน QR (ช่อง + ตัวคั่น) = ค่าที่หน้า Multi-Scanner แสดงเมื่อสแกน เช่น "RACK1 3A" / "3A" · ใต้ QR พิมพ์ "RACK1 : 3A"
//   3) เลือกตำแหน่ง -> EXPORT QR (A4 / ฉลาก 62 × 40) · ใช้ที่ Multi-Scanner: คลังที่เปิดปุ่ม 📍 LAYOUT (PERMISSION > SCAN STOCKS)
const FORMATS = [
  { key: "TYPE,NAME", title: "TYPE + NAME", hint: "เช่น RACK1 3A" },
  { key: "NAME,TYPE", title: "NAME + TYPE", hint: "เช่น 3A RACK1" },
  { key: "NAME", title: "NAME ONLY", hint: "เช่น 3A" },
];
const SEPS = [
  { value: " ", label: "SPACE" },
  { value: "|", label: "|" },
  { value: "-", label: "-" },
  { value: ":", label: ":" },
  { value: ";", label: ";" },
  { value: ",", label: "," },
];
const up = (v: string) => v.toUpperCase().replace(/[^A-Z0-9_./#-]/g, "");
const upList = (v: string) => v.toUpperCase().replace(/[^A-Z0-9_./#\s,;-]/g, "");
const qrOf = (fields: string[], sep: string, type: string, name: string) => fields.map((f) => (f === "TYPE" ? type : name)).join(sep);

export default function LayoutPage() {
  const toast = useToast();
  const [data, setData] = useState<LayoutData | null>(null);
  const [type, setType] = useState("");
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [fmt, setFmt] = useState<{ fields: string[]; sep: string } | null>(null);
  const [exporting, setExporting] = useState<Loc[] | null>(null);
  const [editing, setEditing] = useState<{ kind: "type" | "loc"; id: number; value: string } | null>(null);
  const namesRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((d: LayoutData) => {
    setData(d);
    if (d.settings) setFmt((f) => f ?? { fields: d.settings!.fields, sep: d.settings!.sep });
    // ตำแหน่งที่ถูกลบไปแล้ว -> เอาออกจากที่เลือก
    const ids = new Set((d.types ?? []).flatMap((t) => t.locations.map((l) => l.locId)));
    setSel((s) => new Set([...s].filter((id) => ids.has(id))));
  }, []);

  const load = useCallback(() => {
    api<LayoutData>("/layout")
      .then(apply)
      .catch((e: Error) => toast.show("ERROR", "โหลด LAYOUT ไม่สำเร็จ\n" + e.message, "error"));
  }, [apply, toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["layout"], load);

  const types = useMemo(() => data?.types ?? [], [data]);
  const can = data?.can ?? { add: false, edit: false, delete: false };
  const k = key.trim().toUpperCase();
  const shown = useMemo(
    () =>
      types
        .map((t) => ({ ...t, locations: !k || t.typeName.includes(k) ? t.locations : t.locations.filter((l) => l.locName.includes(k) || l.label.includes(k)) }))
        .filter((t) => !k || t.typeName.includes(k) || t.locations.length > 0),
    [types, k],
  );
  const allLocs = useMemo(() => types.flatMap((t) => t.locations.map((l) => ({ ...l, typeName: t.typeName }))), [types]);
  const selected = allLocs.filter((l) => sel.has(l.locId));
  const total = allLocs.length;

  // ---------------------------------------------------------------- เพิ่ม (บันทึกทันที)
  async function add() {
    const t = up(type.trim());
    const list = upList(names).trim();
    if (!t) return toast.show("WARNING", "กรุณาพิมพ์ประเภท เช่น RACK1", "warn");
    if (!list) {
      namesRef.current?.focus();
      return toast.show("WARNING", "กรุณาพิมพ์ชื่อตำแหน่ง เช่น 3A 3B 3C", "warn");
    }
    setBusy(true);
    try {
      let id = types.find((x) => x.typeName === t)?.typeId;
      if (!id) {
        const r = await api<{ typeId: number; data: LayoutData }>("/layout/types", { method: "POST", body: { name: t } });
        id = r.typeId;
      }
      const r = await api<{ added: string[]; skipped: string[]; data: LayoutData }>(`/layout/types/${id}/locations`, { method: "POST", body: { text: list } });
      apply(r.data);
      setNames("");
      toast.show(
        "SAVED",
        (r.added.length ? `เพิ่ม ${t} : ${r.added.join(", ")} แล้ว` : "ไม่มีตำแหน่งใหม่") + (r.skipped.length ? `\nมีอยู่แล้ว (ข้าม): ${r.skipped.join(", ")}` : ""),
        r.added.length ? "ok" : "warn",
      );
      namesRef.current?.focus();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function saveFormat() {
    if (!fmt) return;
    setBusy(true);
    try {
      const r = await api<LayoutData>("/layout/settings", { method: "POST", body: fmt });
      setData(r);
      if (r.settings) setFmt({ fields: r.settings.fields, sep: r.settings.sep });
      toast.show("SAVED", "บันทึกรูปแบบ QR แล้ว · QR ที่พิมพ์ด้วยรูปแบบเดิมยังสแกนได้ (จับคู่ประเภท + ชื่อ)", "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!editing) return;
    const v = up(editing.value.trim());
    const cur = editing.kind === "type" ? types.find((t) => t.typeId === editing.id)?.typeName : allLocs.find((l) => l.locId === editing.id)?.locName;
    if (!v || v === cur) return setEditing(null);
    setBusy(true);
    try {
      const r = await api<LayoutData>(editing.kind === "type" ? `/layout/types/${editing.id}` : `/layout/locations/${editing.id}`, { method: "PUT", body: { name: v } });
      apply(r);
      setEditing(null);
      toast.show("SAVED", `เปลี่ยนชื่อเป็น ${v} แล้ว · QR ที่พิมพ์ไปแล้วต้องพิมพ์ใหม่`, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ลบ: กดครั้งแรก = ถามยืนยันที่ปุ่ม (ไม่ใช้หน้าต่าง confirm ของ Browser)
  const [arm, setArm] = useState<string | null>(null);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(null), 3500);
    return () => clearTimeout(t);
  }, [arm]);

  async function delType(t: LType) {
    if (arm !== `t${t.typeId}`) return setArm(`t${t.typeId}`);
    setArm(null);
    setBusy(true);
    try {
      apply(await api<LayoutData>(`/layout/types/${t.typeId}`, { method: "DELETE" }));
      toast.show("DELETED", `ลบประเภท ${t.typeName} (${t.locations.length} ตำแหน่ง) แล้ว`, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function delSelected() {
    if (selected.length === 0) return;
    if (arm !== "sel") return setArm("sel");
    setArm(null);
    setBusy(true);
    try {
      apply(await api<LayoutData>("/layout/locations/delete", { method: "POST", body: { ids: selected.map((l) => l.locId) } }));
      toast.show("DELETED", `ลบ ${selected.length} ตำแหน่งแล้ว`, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (ids: number[], on?: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      const all = ids.every((id) => n.has(id));
      ids.forEach((id) => ((on ?? !all) ? n.add(id) : n.delete(id)));
      return n;
    });

  if (!data) return <Loading />;
  if (!data.ready)
    return (
      <PageBody>
        <Empty>ฐานข้อมูลยังไม่มีตาราง LAYOUT (database/nexus/20_Storage_Layout.sql)</Empty>
      </PageBody>
    );

  const f = fmt ?? { fields: ["TYPE", "NAME"], sep: " " };
  const fmtKey = f.fields.join(",");
  const fmtDirty = !!data.settings && (fmtKey !== data.settings.fields.join(",") || f.sep !== data.settings.sep);
  const sample = allLocs[0] ?? { typeName: "RACK1", locName: "3A" };
  const sampleQr = qrOf(f.fields, f.sep, sample.typeName, sample.locName);
  // NAME ONLY + ชื่อซ้ำกันคนละประเภท = สแกนแล้วระบบไม่รู้ว่าประเภทไหน
  const dupNames = fmtKey === "NAME" ? [...new Set(allLocs.map((l) => l.locName).filter((n, i, a) => a.indexOf(n) !== i))] : [];

  return (
    <PageBody>
      <PageHeader
        icon="/icons/StoreWarehouse.png"
        title="LAYOUT SETUP"
        subtitle="ตำแหน่งจัดเก็บ · QR ตำแหน่ง · Multi-Scanner สแกนตำแหน่งก่อน แล้วสแกนป้ายลูกค้า"
        actions={
          <>
            <span className="lo-count">
              {types.length} TYPE · {total} LOCATION
            </span>
            <button className="cta-btn is-purple" disabled={selected.length === 0} onClick={() => setExporting(selected)}>
              ▣ EXPORT QR {selected.length ? `(${selected.length})` : ""}
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {/* ➕ เพิ่มตำแหน่ง */}
          <Card title="➕ ADD LOCATION" bodyClass="p-4">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px_minmax(0,1fr)] xl:grid-cols-[130px_minmax(0,1fr)]">
                <label className="grid gap-1">
                  <span className="lo-lbl">1 • TYPE (ประเภท)</span>
                  <input className="field font-mono font-bold" list="lo-types" placeholder="RACK1" maxLength={50} value={type} disabled={!can.add} onChange={(e) => setType(up(e.target.value))} />
                  <datalist id="lo-types">
                    {types.map((t) => (
                      <option key={t.typeId} value={t.typeName} />
                    ))}
                  </datalist>
                </label>
                <label className="grid gap-1">
                  <span className="lo-lbl">2 • NAME (ตำแหน่ง · พิมพ์หลายตัวคั่นด้วยเว้นวรรค)</span>
                  <input ref={namesRef} className="field font-mono font-bold" placeholder="3A 3B 3C" value={names} disabled={!can.add} onChange={(e) => setNames(upList(e.target.value))} />
                </label>
              </div>
              {types.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <button key={t.typeId} type="button" className={`lo-pick ${type === t.typeName ? "is-on" : ""}`} onClick={() => (setType(t.typeName), namesRef.current?.focus())}>
                      {t.typeName}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-[11.5px] font-semibold text-ink-soft">
                  {type && names.trim() ? (
                    <>
                      จะเพิ่ม: <b className="font-mono text-primary">{upList(names).trim().split(/[\s,;]+/).filter(Boolean).map((n) => `${type} : ${n}`).join(" · ")}</b>
                    </>
                  ) : (
                    "กด ADD / Enter = บันทึกทันที (ประเภทใหม่สร้างให้เอง)"
                  )}
                </span>
                <button className="cta-btn is-green" disabled={!can.add || busy}>
                  ＋ ADD
                </button>
              </div>
              {!can.add && <p className="text-xs font-bold text-warning">ต้องมีสิทธิ์ ADD ของ Layout Setup</p>}
            </form>
          </Card>

          {/* ▣ รูปแบบ QR */}
          <Card title="▣ QR FORMAT (ข้อมูลที่สแกนแล้วได้)" bodyClass="p-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div className="grid content-start gap-3">
                <div>
                  <div className="lo-lbl mb-1.5">ช่องใน QR</div>
                  <div className="grid gap-1.5">
                    {FORMATS.map((x) => (
                      <button key={x.key} type="button" disabled={!can.edit} className={`lo-opt ${fmtKey === x.key ? "is-on" : ""}`} onClick={() => setFmt({ ...f, fields: x.key.split(",") })}>
                        <b>{x.title}</b>
                        <span>{x.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {f.fields.length > 1 && (
                  <div>
                    <div className="lo-lbl mb-1.5">ตัวคั่น (SEPARATOR)</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {SEPS.map((s) => (
                        <button key={s.label} type="button" disabled={!can.edit} className={`lo-pick ${f.sep === s.value ? "is-on" : ""}`} onClick={() => setFmt({ ...f, sep: s.value })}>
                          {s.label}
                        </button>
                      ))}
                      <input
                        className="field !h-8 !w-24 font-mono text-sm"
                        maxLength={5}
                        placeholder="กำหนดเอง"
                        disabled={!can.edit}
                        value={SEPS.some((s) => s.value === f.sep) ? "" : f.sep}
                        onChange={(e) => setFmt({ ...f, sep: e.target.value.replace(/[\r\n]/g, "") || " " })}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="lo-sample">
                <QrImage text={sampleQr} size={120} />
                <b>
                  {sample.typeName} : {sample.locName}
                </b>
                <small>
                  สแกนแล้วได้ <code>{sampleQr.replace(/ /g, "␣")}</code>
                </small>
              </div>
            </div>
            {dupNames.length > 0 && (
              <p className="mt-3 text-xs font-bold text-danger">⚠ NAME ONLY: ชื่อซ้ำกันคนละประเภท ({dupNames.slice(0, 8).join(", ")}) - สแกนแล้วแยกประเภทไม่ได้ แนะนำ TYPE + NAME</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-ink-soft">
                {data.settings?.updatedBy ? `แก้ล่าสุด ${data.settings.updatedBy}` : ""} · ใต้ QR พิมพ์ &quot;TYPE : NAME&quot; เสมอ
              </span>
              {can.edit && (
                <button className="cta-btn is-purple is-sm" disabled={!fmtDirty || busy} onClick={saveFormat}>
                  SAVE FORMAT
                </button>
              )}
            </div>
          </Card>
        </div>

        {/* 📍 รายการตำแหน่ง */}
        <Card
          clip={false}
          title={`📍 LOCATIONS (${total})`}
          actions={
            <>
              <SearchBox value={key} onChange={setKey} placeholder="ค้นหาประเภท / ตำแหน่ง" className="w-[220px] max-w-full" />
              <button className="fill-btn is-xs" disabled={allLocs.length === 0} onClick={() => toggle(shown.flatMap((t) => t.locations.map((l) => l.locId)))}>
                {shown.length && shown.every((t) => t.locations.every((l) => sel.has(l.locId))) ? "☐ UNSELECT" : "☑ SELECT ALL"}
              </button>
              {can.delete && (
                <button className={`fill-btn is-xs ${arm === "sel" ? "is-danger-on" : ""}`} disabled={selected.length === 0 || busy} onClick={delSelected}>
                  {arm === "sel" ? `ยืนยันลบ ${selected.length} ?` : `🗑 DELETE (${selected.length})`}
                </button>
              )}
            </>
          }
          bodyClass="p-3 md:p-4"
        >
          {shown.length === 0 ? (
            <Empty>{types.length === 0 ? "ยังไม่มีตำแหน่ง - เริ่มที่ช่อง ADD LOCATION (เช่น RACK1 + 3A 3B 3C)" : "ไม่พบตำแหน่งที่ค้นหา"}</Empty>
          ) : (
            <div className="grid gap-3">
              {shown.map((t) => {
                const ids = t.locations.map((l) => l.locId);
                const on = ids.filter((id) => sel.has(id)).length;
                const editType = editing?.kind === "type" && editing.id === t.typeId;
                return (
                  <section key={t.typeId} className="lo-type">
                    <header>
                      <button type="button" className={`lo-check ${on && on === ids.length ? "is-on" : on ? "is-some" : ""}`} aria-label={`เลือกทั้งหมดของ ${t.typeName}`} onClick={() => toggle(ids)} disabled={!ids.length}>
                        {on && on === ids.length ? "✓" : on ? "–" : ""}
                      </button>
                      {editType ? (
                        <input
                          autoFocus
                          className="field !h-8 !w-40 font-mono font-bold"
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: up(e.target.value) })}
                          onKeyDown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" ? setEditing(null) : null)}
                          onBlur={rename}
                        />
                      ) : (
                        <b className="lo-tname">{t.typeName}</b>
                      )}
                      <span className="lo-tcount">
                        {on ? `${on} / ` : ""}
                        {t.locations.length}
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        {can.add && (
                          <button type="button" className="lo-ibtn" title="เพิ่มตำแหน่งในประเภทนี้" onClick={() => (setType(t.typeName), namesRef.current?.focus())}>
                            ＋
                          </button>
                        )}
                        {can.edit && (
                          <button type="button" className="lo-ibtn" title="เปลี่ยนชื่อประเภท" onClick={() => setEditing({ kind: "type", id: t.typeId, value: t.typeName })}>
                            ✎
                          </button>
                        )}
                        {can.delete && (
                          <button type="button" className={`lo-ibtn is-del ${arm === `t${t.typeId}` ? "is-armed" : ""}`} title="ลบประเภท (รวมตำแหน่งทั้งหมด)" onClick={() => delType(t)}>
                            {arm === `t${t.typeId}` ? "ยืนยันลบ?" : "🗑"}
                          </button>
                        )}
                      </span>
                    </header>
                    {t.locations.length === 0 ? (
                      <p className="px-1 py-2 text-xs font-bold text-ink-soft">ยังไม่มีตำแหน่ง</p>
                    ) : (
                      <div className="lo-chips">
                        {t.locations.map((l) =>
                          editing?.kind === "loc" && editing.id === l.locId ? (
                            <input
                              key={l.locId}
                              autoFocus
                              className="field !h-9 !w-28 font-mono font-bold"
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: up(e.target.value) })}
                              onKeyDown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" ? setEditing(null) : null)}
                              onBlur={rename}
                            />
                          ) : (
                            <button
                              key={l.locId}
                              type="button"
                              className={`lo-chip ${sel.has(l.locId) ? "is-on" : ""}`}
                              title={`${l.label}  •  QR: ${l.qr}${can.edit ? "  •  ดับเบิลคลิก = เปลี่ยนชื่อ" : ""}`}
                              onClick={() => toggle([l.locId])}
                              onDoubleClick={() => can.edit && setEditing({ kind: "loc", id: l.locId, value: l.locName })}
                            >
                              <span className="lo-chip-box">{sel.has(l.locId) ? "✓" : ""}</span>
                              {l.locName}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <LayoutExport items={exporting} onClose={() => setExporting(null)} />
    </PageBody>
  );
}
