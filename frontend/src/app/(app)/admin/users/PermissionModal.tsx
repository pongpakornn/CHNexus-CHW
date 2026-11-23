"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { Loading } from "@/components/layout/Page";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { api } from "@/lib/api";
import type { PermData, PermRow, ScanStock } from "./types";

const FLAGS = ["view", "add", "edit", "delete", "approve"] as const;
type PTab = "PERM" | "SCAN" | "CONTACT" | "PROFILE";
const SIDE_KEY = "inv-admin-side"; // ใช้ค่าพับเมนูเดียวกับหน้าต่าง ADMIN
const HEAD: Record<(typeof FLAGS)[number], string> = { view: "VIEW", add: "ADD", edit: "EDIT", delete: "DEL", approve: "APPROVE" };

// 🗂 กลุ่มตามระบบ (หน้าเลือกระบบ): CIMS · คลังของ CIMS · MASTER DATA · EDP PLANNING · USER MANAGEMENT
//   ระบบใหม่ = เพิ่มกลุ่มที่นี่ (SystemID ที่ไม่อยู่ในกลุ่มไหน = กลุ่ม OTHER ท้ายสุด)
type Grp = { key: string; title: string; sub: string; color: string; icon: string; ids?: string[] };
export const GROUPS: Grp[] = [
  { key: "CIMS", title: "CIMS", sub: "CHR Inventory Management · Dashboard · Store · Scanner · Pick List · Max-Min · Forecast · PR", color: "#6750a4", icon: "/icons/StoreMaxMin.png", ids: ["DASHBOARD", "StoreMaxMin", "MultiScanner", "PackingCard", "MAXMINCALC", "ForecastOrder", "PR"] },
  { key: "STOCK", title: "CIMS • STOCKS", sub: "สิทธิ์รายคลัง (ดู / Import / แก้ Max-Min)", color: "#0ea5e9", icon: "/icons/StoreWarehouse.png" },
  { key: "MASTER", title: "MASTER DATA", sub: "Customer · Supplier · Product Control", color: "#2563eb", icon: "/icons/ProductControl.png", ids: ["MasterData", "ProductControl"] },
  { key: "EDP", title: "EDP PLANNING", sub: "Dashboard · Plan Submission · EDP Planning · Plan Setting", color: "#7c3aed", icon: "/icons/ForecastOrder.png", ids: ["EdpGraph", "EdpSubmission", "EdpPlanning", "EdpPlanSetting"] },
  { key: "PP", title: "PRODUCTION PLAN", sub: "Dashboard · Capacity (M/C Actual) · Master Data › Production Plan STD", color: "#0d9488", icon: "/icons/DashboardChart.png", ids: ["PpDashboard", "PpCapacity", "PpSetup"] },
  { key: "CHEM", title: "CHEMICAL CONTROL", sub: "Inspection Record · Control Chart · Parameter Setup (ลงลายเซ็นตาม SIGN FLOW)", color: "#2563eb", icon: "/icons/DashboardChart.png", ids: ["ChemRecord", "ChemSetup"] },
  { key: "PC", title: "PC DIGITAL WORKSPACE", sub: "Work Order Follow · Dashboard · Setup Flow (อนุมัติ)", color: "#4f46e5", icon: "/icons/ForecastOrder.png", ids: ["PC_WOF"] },
  { key: "MFG", title: "MANUFACTURING", sub: "Kanban Control · Dashboard · Set Kanban · สะสม / รับยอด · สั่งผลิต", color: "#2563eb", icon: "/icons/PickList.png", ids: ["MFG_KANBAN"] },
  { key: "ADMIN", title: "USER MANAGEMENT", sub: "ผู้ใช้ · สิทธิ์ · Activity Log", color: "#4f46e5", icon: "/icons/management.png", ids: ["UserManagement", "ActivityLog"] },
  { key: "OTHER", title: "OTHER", sub: "ระบบอื่น ๆ", color: "#71717a", icon: "/icons/Systems.png" },
];
const groupOf = (r: PermRow) => (r.group === "STOCK" ? "STOCK" : (GROUPS.find((g) => g.ids?.some((id) => id.toLowerCase() === r.sysId.toLowerCase()))?.key ?? "OTHER"));
// ชื่อในกลุ่มไม่ต้องซ้ำชื่อระบบ (EDP › Plan Setting -> Plan Setting)
const shortTitle = (t: string) => t.replace(/^(EDP|Master Data|Production Plan|Chemical Control)\s*›\s*/i, "");
const GKEY = "perm-groups-closed";

// 🔑 PERMISSION / 👤 USER PROFILE (UserPermissionWindow) - สิทธิ์ทุกระบบ + ทุกคลัง
//   แถว Multi-Scanner กดขยาย = คลังที่สแกนได้ + ★ OUT FIRST + DEDUCTED + EMP ID / DEPT + DISPLAY
export function PermissionModal({
  userId,
  readOnly,
  canContact,
  onClose,
  onSaved,
  onEditContacts,
  inline = false,
}: {
  userId: string;
  readOnly: boolean;
  canContact: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onEditContacts: () => Promise<boolean>;
  /** Access Control page: render in the page (no popup window) */
  inline?: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<PermData | null>(null);
  const [rows, setRows] = useState<PermRow[]>([]);
  const [stocks, setStocks] = useState<ScanStock[]>([]);
  const [tab, setTab] = useState<PTab>(readOnly ? "PROFILE" : "PERM");
  const [drawer, setDrawer] = useState(false);
  const [mini, setMini] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDE_KEY) === "1") queueMicrotask(() => setMini(true));
    } catch {
      /* ไม่มี storage */
    }
  }, []);
  const toggleMini = () =>
    setMini((m) => {
      try {
        localStorage.setItem(SIDE_KEY, m ? "0" : "1");
      } catch {
        /* ไม่จำก็ได้ */
      }
      return !m;
    });
  const [busy, setBusy] = useState(false);
  // กลุ่มที่พับไว้ (จำในเครื่อง)
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(GKEY) ?? "[]") as string[];
      if (v.length) queueMicrotask(() => setClosed(new Set(v)));
    } catch {
      /* ไม่มี storage */
    }
  }, []);
  const fold = (k: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      try {
        localStorage.setItem(GKEY, JSON.stringify([...n]));
      } catch {
        /* ไม่จำก็ได้ */
      }
      return n;
    });

  // ⚠ โหลดสิทธิ์ครั้งเดียวต่อผู้ใช้ (ผูกกับ userId เท่านั้น) - เดิมผูกกับ onClose ที่หน้ารายชื่อสร้างใหม่ทุกครั้งที่รายชื่ออัพเดทแบบเรียลไทม์
  //    -> โหลดสิทธิ์จาก Server ทับค่าที่กำลังติ๊กอยู่ (สิทธิ์หายระหว่างกำหนด) · ตอนนี้เก็บ onClose ไว้ใน ref ไม่ทำให้โหลดซ้ำ
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const load = useCallback(async () => {
    try {
      const d = await api<PermData>(`/users/${encodeURIComponent(userId)}/permissions`);
      setData(d);
      setRows(d.rows);
      setStocks(d.scanner?.stocks ?? []);
    } catch (e) {
      toast.show("ERROR", "โหลดสิทธิ์ไม่สำเร็จ\n" + (e as Error).message, "error");
      closeRef.current();
    }
  }, [userId, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const setFlag = (sysId: string, k: (typeof FLAGS)[number], v: boolean) => setRows((rs) => rs.map((r) => (r.sysId === sysId ? { ...r, [k]: v } : r)));
  const setAll = (fn: (r: PermRow) => PermRow) => setRows((rs) => rs.map(fn));

  const setStock = (id: number, patch: Partial<ScanStock>) =>
    setStocks((ss) =>
      ss.map((s) => {
        if (s.stkId !== id) return s;
        const n = { ...s, ...patch };
        if (patch.on === false) Object.assign(n, { priority: false, deduct: false, askEmployee: false, askDepartment: false, askLayout: false });
        // เลือกคลังกลุ่มตัดข้ามคลัง = เปิด DEDUCTED ให้ก่อน (ปิดเองได้)
        if (patch.on === true && s.deductEligible && !s.deduct) n.deduct = true;
        return n;
      }),
    );
  const togglePriority = (id: number) =>
    setStocks((ss) => {
      const cur = ss.find((s) => s.stkId === id);
      const on = !cur?.priority;
      return ss.map((s) => ({ ...s, priority: s.stkId === id ? on && s.on : false }));
    });

  const on = stocks.filter((s) => s.on);
  const summary =
    on.length === 0
      ? "⛔ NOT SET - this user cannot scan (the scan page asks them to contact the Admin)"
      : "STOCKS : " +
        on.map((i) => i.code + (i.priority ? " ★" : "") + (i.deduct ? " (DEDUCTED)" : "") + (i.askEmployee ? " (EMP ID)" : "") + (i.askDepartment ? " (DEPT)" : "") + (i.askLayout ? " (LAYOUT)" : "") + (i.qrDateFmt || i.qrRefField || i.qrRunStart ? " (QR+)" : "")).join(",  ") +
        (on.length > 1 ? "   (scan together)" : "");

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/users/${encodeURIComponent(userId)}/permissions`, {
        method: "POST",
        body: { rows, scanner: data?.scanner ? stocks : null },
      });
      onSaved(r.message);
      await load(); // หน้าต่างเปิดค้างไว้ · ค่าตรงกับที่บันทึกจริง
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const u = data?.user;
  const colOn = (k: (typeof FLAGS)[number]) => rows.length > 0 && rows.every((r) => r[k]);
  const rowOn = (r: PermRow) => FLAGS.every((k) => r[k]);
  const setRow = (sysId: string, v: boolean) => setRows((rs) => rs.map((r) => (r.sysId === sysId ? { ...r, view: v, add: v, edit: v, delete: v, approve: v } : r)));
  const granted = rows.reduce((a, r) => a + FLAGS.filter((k) => r[k]).length, 0);
  const sections = GROUPS.map((g) => ({ g, rows: rows.filter((r) => groupOf(r) === g.key) })).filter((x) => x.rows.length > 0);
  const countOf = (list: PermRow[]) => list.reduce((a, r) => a + FLAGS.filter((k) => r[k]).length, 0);
  const groupOn = (list: PermRow[]) => list.every(rowOn);
  const setGroup = (list: PermRow[], v: boolean) => {
    const ids = new Set(list.map((r) => r.sysId));
    setRows((rs) => rs.map((r) => (ids.has(r.sysId) ? { ...r, view: v, add: v, edit: v, delete: v, approve: v } : r)));
  };
  // หัวกลุ่ม: ไอคอน + ชื่อระบบ + จำนวนสิทธิ์ที่เปิด + สวิตช์ทั้งกลุ่ม + พับ / กาง
  const groupHead = (g: Grp, list: PermRow[]) => {
    const n = countOf(list);
    const open = !closed.has(g.key);
    return (
      <div className="pm-ghead" style={{ "--g": g.color } as React.CSSProperties}>
        <button type="button" className="pm-gfold" aria-expanded={open} onClick={() => fold(g.key)} title={open ? "พับกลุ่ม" : "กางกลุ่ม"}>
          <span className="pm-gic">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.icon} alt="" draggable={false} />
          </span>
          <span className="min-w-0 text-left">
            <b>{g.title}</b>
            <small>{g.sub}</small>
          </span>
          <span className="pm-gcount">
            {n} / {list.length * FLAGS.length}
          </span>
          <svg viewBox="0 0 24 24" className={`pm-gchev ${open ? "is-open" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {!readOnly && (
          <label className={`sw sw-mini ${groupOn(list) ? "is-on" : ""}`} title={`ทุกสิทธิ์ของ ${g.title}`}>
            <input type="checkbox" className="sr-only" checked={groupOn(list)} onChange={(e) => setGroup(list, e.target.checked)} />
            <span className="sw-track" />
          </label>
        )}
      </div>
    );
  };

  // ปุ่มสิทธิ์ 1 ช่อง: ติ๊ก = สีของสิทธิ์นั้น + เครื่องหมายถูกวาดขึ้น (label = แบบการ์ดบนมือถือ)
  const flag = (r: PermRow, k: (typeof FLAGS)[number], label?: boolean) => (
    <button
      key={k}
      type="button"
      disabled={readOnly}
      aria-pressed={r[k]}
      aria-label={`${r.title} ${HEAD[k]}`}
      title={`${HEAD[k]}`}
      className={`pf pf-${k} ${r[k] ? "is-on" : ""} ${label ? "has-label" : ""}`}
      onClick={() => setFlag(r.sysId, k, !r[k])}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m6 12.5 4 4 8-9" />
      </svg>
      {label && <span>{HEAD[k]}</span>}
    </button>
  );

  // RUNNING: ตัวอักษรนำหน้า 0-2 ตัว (A-Z) + เลข 1-8 หลัก เช่น 0001 / A0001 / AB0001
  const runText = (v: string) => {
    const t = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const pre = /^[A-Z]*/.exec(t)![0];
    return pre.slice(0, 2) + t.slice(pre.length).replace(/\D/g, "").slice(0, 8);
  };

  // 📷 ต่อท้าย QR ที่บันทึกตอนสแกนรับเข้า: DATE (เปลี่ยนตามวันจริง) + REF (ค่าของสินค้าที่สแกน) + RUNNING (วันใหม่เริ่มใหม่)
  //    คั่นด้วยตัวคั่นของ QR คลังนั้น เช่น 5T072-4943-1  20 -> 5T072-4943-1  20 2610 KUBOTA 0001
  const qrRow = (s: ScanStock) => {
    const sc = data?.scanner;
    const dis = readOnly || !s.on;
    const sep = s.qrSep ?? "|";
    const date = sc?.qrDateFormats?.find((f) => f.key === s.qrDateFmt)?.sample;
    const refs = [...(sc?.qrRefFields ?? []), ...(s.qrRefCustom ?? []).map((f) => ({ key: f.key, label: `➕ ${f.label}` }))];
    const ref = refs.find((f) => f.key === s.qrRefField)?.label.replace("➕ ", "");
    const tail = [date, ref && `<${ref}>`, s.qrRunStart].filter(Boolean);
    return (
      <div className="flex w-full flex-wrap items-center gap-2 border-t border-dashed border-line pt-2">
        <span className="text-[10px] font-extrabold tracking-wide text-ink-soft">QR + </span>
        <label className="flex items-center gap-1.5 text-[10px] font-extrabold text-ink-soft">
          DATE
          <MenuSelect
            compact
            className="w-[150px]"
            disabled={dis}
            value={s.qrDateFmt ?? ""}
            options={[{ value: "", label: "— NONE —" }, ...(sc?.qrDateFormats ?? []).map((f) => ({ value: f.key, label: `${f.key} (${f.sample})` }))]}
            onChange={(v) => setStock(s.stkId, { qrDateFmt: v || null })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-extrabold text-ink-soft">
          REF
          <MenuSelect
            compact
            className="w-[170px]"
            disabled={dis}
            value={s.qrRefField ?? ""}
            options={[{ value: "", label: "— NONE —" }, ...refs.map((f) => ({ value: f.key, label: f.label }))]}
            onChange={(v) => setStock(s.stkId, { qrRefField: v || null })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-extrabold text-ink-soft">
          RUNNING
          <input
            className="field !h-8 !w-[100px] text-center font-mono text-xs"
            placeholder="A0001"
            title="ตัวอักษรนำหน้า 0-2 ตัว + เลขเริ่ม เช่น 0001 / A0001 / AB0001 (จำนวนหลักตามที่กรอก)"
            maxLength={10}
            disabled={dis}
            value={s.qrRunStart ?? ""}
            onChange={(e) => setStock(s.stkId, { qrRunStart: runText(e.target.value) || null })}
          />
        </label>
        <span className="ml-auto truncate font-mono text-[11px] font-bold text-accent" title="ตัวอย่าง QR ที่บันทึกตอนสแกนรับเข้า (RUNNING เริ่มใหม่ทุกวัน)">
          {tail.length ? `QR${sep}${tail.join(sep)}` : "ไม่ต่อท้าย QR"}
        </span>
      </div>
    );
  };

  // คลังที่สแกนได้ของ Multi-Scanner (แถวขยาย / การ์ดบนมือถือใช้ร่วมกัน)
  const scanBox = (
    <div className="grid gap-2">
      {stocks.length === 0 && <div className="text-xs font-bold text-ink-soft">ยังไม่มีคลังที่เปิดช่องทางสแกน</div>}
      {stocks.map((s) => (
        <div key={s.stkId} className={`pm-stock ${s.on ? "is-on" : ""}`}>
          <label className={`sw ${s.on ? "is-on" : ""} min-w-[190px] !border-0 !bg-transparent !p-0 !shadow-none`}>
            <input type="checkbox" className="sr-only" disabled={readOnly} checked={s.on} onChange={(e) => setStock(s.stkId, { on: e.target.checked })} />
            <span className="sw-track" />
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-[#1f2350]">{s.code}</span>
              <span className="block truncate text-[10.5px] font-semibold text-ink-soft">{s.name}</span>
            </span>
          </label>
          <button className={`fill-btn is-xs ${s.priority ? "is-on is-star" : ""}`} disabled={readOnly || !(s.on && s.canOut)} onClick={() => togglePriority(s.stkId)}>
            {s.priority ? "★ OUT FIRST" : "☆ OUT FIRST"}
          </button>
          {s.deductEligible && (
            <button className={`fill-btn is-xs ${s.deduct ? "is-on" : ""}`} disabled={readOnly || !s.on} onClick={() => setStock(s.stkId, { deduct: !s.deduct })}>
              DEDUCTED
            </button>
          )}
          {data?.scanner?.hasWho && (
            <>
              <button className={`fill-btn is-xs ${s.askEmployee ? "is-on" : ""}`} disabled={readOnly || !s.on} onClick={() => setStock(s.stkId, { askEmployee: !s.askEmployee })}>
                EMP ID
              </button>
              <button className={`fill-btn is-xs ${s.askDepartment ? "is-on" : ""}`} disabled={readOnly || !s.on} onClick={() => setStock(s.stkId, { askDepartment: !s.askDepartment })}>
                DEPT
              </button>
            </>
          )}
          {data?.scanner?.hasLayout && (
            <button
              className={`fill-btn is-xs ${s.askLayout ? "is-on" : ""}`}
              disabled={readOnly || !s.on}
              title="สแกน QR ตำแหน่งจัดเก็บ (Sidebar > Layout Setup) ก่อนสแกนป้ายลูกค้า · ตำแหน่งบันทึกกับประวัติการสแกน"
              onClick={() => setStock(s.stkId, { askLayout: !s.askLayout })}
            >
              📍 LAYOUT
            </button>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-[10px] font-extrabold text-ink-soft">
            DISPLAY
            <MenuSelect
              compact
              className="w-[240px] max-w-[60vw]"
              disabled={readOnly || !s.on}
              value={s.display}
              options={s.options.map((o) => ({ value: o.key, label: o.label }))}
              onChange={(v) => setStock(s.stkId, { display: v })}
            />
          </label>
          {data?.scanner?.hasQrSuffix && qrRow(s)}
        </div>
      ))}
    </div>
  );

  const scanToggle = (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button className="fill-btn is-xs" onClick={() => setTab("SCAN")}>
        ▸ SCAN STOCKS + DISPLAY
      </button>
      <span className={`text-[11px] font-extrabold ${on.length ? "text-success" : "text-danger"}`}>{summary}</span>
    </div>
  );

  // แท็บ (เมนูซ้าย): PERMISSIONS / SCAN STOCKS / ALERT CONTACT / PROFILE
  const tabs: [PTab, string, string, React.ReactNode][] = [
    ...(readOnly ? [] : [["PERM", "PERMISSIONS", "สิทธิ์ของแต่ละระบบ", <path key="p" d="M12 3.5 4.5 6.5v5.2c0 4.4 3.1 7.8 7.5 8.8 4.4-1 7.5-4.4 7.5-8.8V6.5zM9 12l2.2 2.2L15.5 10" />] as [PTab, string, string, React.ReactNode]]),
    ...(data?.scanner ? [["SCAN", "SCAN STOCKS", "คลังที่สแกนได้ + DISPLAY", <path key="s" d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12" />] as [PTab, string, string, React.ReactNode]] : []),
    ...(data && data.contacts !== null && !readOnly ? [["CONTACT", "ALERT CONTACT", "ผู้ติดต่อ Admin", <path key="c" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />] as [PTab, string, string, React.ReactNode]] : []),
    ["PROFILE", "USER PROFILE", "ข้อมูลผู้ใช้", <path key="u" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0" />],
    ...(readOnly ? [["PERM", "PERMISSIONS", "สิทธิ์ของแต่ละระบบ", <path key="p" d="M12 3.5 4.5 6.5v5.2c0 4.4 3.1 7.8 7.5 8.8 4.4-1 7.5-4.4 7.5-8.8V6.5zM9 12l2.2 2.2L15.5 10" />] as [PTab, string, string, React.ReactNode]] : []),
  ];
  // ACCESS CONTROL page: permissions + scan stocks only (contacts / profile live on USER ACCOUNTS)
  if (inline) tabs.splice(0, tabs.length, ...tabs.filter((x) => x[0] === "PERM" || x[0] === "SCAN"));
  const tabName = tabs.find((x) => x[0] === tab)?.[1] ?? "";
  const pick = (t: PTab) => {
    setTab(t);
    setDrawer(false);
  };
  const burger = (onClick: () => void, label: string) => (
    <button type="button" className="adm-burger" onClick={onClick} aria-label={label} title={label}>
      <span />
      <span />
      <span />
    </button>
  );

  return (
    <Wrap inline={inline} title={`${readOnly ? "👤" : "🔑"} ${tabName}`} onClose={onClose}>
      {/* Sidebar ติดขอบซ้ายแบบเมนูหลัก (เหมือนหน้าต่าง ADMIN) · พับเหลือไอคอนได้ · มือถือ = เมนูเลื่อนออกจากซ้าย */}
      <div className={`adm-shell ${mini ? "is-mini" : ""} ${drawer ? "is-drawer" : ""}`}>
        {!inline && (
        <nav className="adm-nav">
          <div className="adm-nav-head">
            {burger(() => (window.matchMedia("(max-width: 767px)").matches ? setDrawer(false) : toggleMini()), mini ? "กางเมนู" : "พับเมนู")}
            <span className="adm-nav-title">
              {readOnly ? "PROFILE" : "PERMISSION"}
              <small>USER MANAGEMENT</small>
            </span>
          </div>
          {u && (
            <div className="pm-nav-user" title={`${u.userId} • ${u.name}`}>
              <span className="pm-avatar">{u.name.trim().slice(0, 2).toUpperCase() || "?"}</span>
              <span className="adm-item-txt min-w-0">
                <b className="block truncate text-[13px] text-white">{u.name}</b>
                <span className="block truncate text-[10.5px] font-bold text-white/55">ID : {u.userId}</span>
                <span className="pm-level !ml-0 mt-1">{u.levelText}</span>
              </span>
            </div>
          )}
          {tabs.map(([t, txt, hint, path]) => (
            <button key={t} type="button" onClick={() => pick(t)} title={mini ? txt : undefined} className={`adm-item ${tab === t ? "is-on" : ""}`}>
              <svg viewBox="0 0 24 24" className="adm-item-ic" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {path}
              </svg>
              <span className="adm-item-txt">
                <span className="block truncate text-[13.5px] font-extrabold">{txt}</span>
                <span className="adm-item-hint">{hint}</span>
              </span>
            </button>
          ))}
          {!readOnly && (
            <div className="pm-nav-count adm-item-txt" title="จำนวนสิทธิ์ที่เปิด">
              <b key={granted}>{granted}</b>
              <span>/ {rows.length * FLAGS.length} GRANTED</span>
            </div>
          )}
        </nav>
        )}
        {!inline && drawer && <div className="adm-scrim" onClick={() => setDrawer(false)} />}

        <section className="adm-main">
          {inline ? (
            // in-page header: user + tabs (no sidebar)
            <div className="pm-inline-head">
              {u && (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="pm-avatar">{u.name.trim().slice(0, 2).toUpperCase() || "?"}</span>
                  <span className="min-w-0">
                    <b className="block truncate text-sm text-[#1f2350]">{u.name}</b>
                    <span className="block truncate text-[11px] font-bold text-ink-soft">
                      ID : {u.userId} · {u.levelText}
                    </span>
                  </span>
                </span>
              )}
              <span className="flex flex-wrap gap-1.5 sm:ml-auto" role="tablist">
                {tabs.map(([t, txt]) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} className={`fill-btn is-sm ${tab === t ? "is-on" : ""}`} onClick={() => pick(t)}>
                    {t === "SCAN" ? "MULTI-SCANNER" : txt}
                  </button>
                ))}
              </span>
              {!readOnly && (
                <span className="text-xs font-extrabold text-ink-soft" title="จำนวนสิทธิ์ที่เปิด">
                  <b className="text-primary">{granted}</b> / {rows.length * FLAGS.length} GRANTED
                </span>
              )}
            </div>
          ) : (
            <div className="adm-main-head">
              {burger(() => setDrawer(true), "เมนู")}
              <b>{tabName}</b>
            </div>
          )}
          <div className="adm-scroll">
            {!data || !u ? (
              <Loading />
            ) : (
              <div key={tab} className="adm-pane grid content-start gap-4">
                {u.level === 1 && tab === "PERM" && <div className="rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">LEVEL 1 (ADMIN) can see and do everything without these settings.</div>}

                {tab === "PROFILE" && (
                  <>
                    <div className="pm-user">
                      <span className="pm-avatar">{u.name.trim().slice(0, 2).toUpperCase() || "?"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg font-extrabold text-[#1f2350]">{u.name}</div>
                        <div className="text-xs font-bold text-ink-soft">
                          ID : {u.userId} <span className="pm-level">{u.levelText}</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ["USER ID", u.userId],
                  ["NAME", u.name],
                  ["POSITION", u.position],
                  ["UNIT", u.department],
                  ["SECTION", u.section],
                  ["DIVISION", u.division],
                  ["LEVEL", u.levelText],
                  ["STATUS", u.statusText],
                  ["LAST LOGIN", fmtDate(u.lastLogin, "en-GB", { dateStyle: "short", timeStyle: "short" })],
                ] as const
              ).map(([l, v], i) => (
                <div key={l} className="pm-tile" style={{ animationDelay: `${i * 30}ms` }}>
                  <div className="text-[10px] font-bold text-ink-soft">{l}</div>
                  <div className="truncate text-sm font-extrabold">{v?.trim() ? v : "-"}</div>
                </div>
              ))}
            </div>
                  </>
                )}

                {tab === "CONTACT" && data.contacts !== null && (
            <div className="pm-contact">
              <span className="pm-bell" aria-hidden>
                🔔
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-line text-xs font-semibold text-ink-soft">
                <span className="font-extrabold text-primary">ALERT CONTACT : </span>
                {data.contacts}
              </div>
              {canContact && (
                <button
                  className="cta-btn is-red is-sm"
                  onClick={async () => {
                    if (await onEditContacts()) load();
                  }}
                >
                  🔔 SET ALERT CONTACT
                </button>
              )}
            </div>
                )}

                {tab === "SCAN" && data.scanner && (
                  <>
                    <div className={`rounded-xl px-3 py-2 text-xs font-extrabold ${on.length ? "bg-[#e8f5e9] text-success" : "bg-[#ffebee] text-danger"}`}>{summary}</div>
                    {scanBox}
                  </>
                )}

                {tab === "PERM" && (
                  <>
          {/* 🖥 Desktop: ตารางสิทธิ์ (กดหัวคอลัมน์ = ทั้งคอลัมน์ / ALL = ทั้งแถว) */}
          <div className="hidden overflow-auto rounded-2xl border border-line/60 md:block">
            <table className="data-table t-center pm-table w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left">SYSTEM</th>
                  {!readOnly && <th className="w-16 text-center">ALL</th>}
                  {FLAGS.map((k) => (
                    <th key={k} className="w-24 text-center">
                      {readOnly ? (
                        HEAD[k]
                      ) : (
                        <button type="button" className={`pm-col ${colOn(k) ? "is-on" : ""}`} title={`${HEAD[k]} ทุกระบบ`} onClick={() => setAll((r) => ({ ...r, [k]: !colOn(k) }))}>
                          {HEAD[k]}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map(({ g, rows: list }) => (
                  <Fragment key={g.key}>
                    <tr className="pm-group">
                      <td colSpan={readOnly ? 6 : 7}>{groupHead(g, list)}</td>
                    </tr>
                    {!closed.has(g.key) &&
                      list.map((r, i) => {
                        const ms = r.sysId.toLowerCase() === "multiscanner" && data.scanner;
                        return (
                          <tr key={r.sysId} className="pm-row pm-grow" style={{ "--g": g.color, "--i": Math.min(i, 10) } as React.CSSProperties}>
                            <td className="text-left">
                              <div className="font-extrabold text-[#1f2350]">{shortTitle(r.title)}</div>
                              {r.hint && <div className="text-[11px] font-semibold text-ink-soft">{r.hint}</div>}
                              {ms && scanToggle}
                            </td>
                            {!readOnly && (
                              <td className="text-center">
                                <label className={`sw sw-mini ${rowOn(r) ? "is-on" : ""}`} title="ทุกสิทธิ์ของระบบนี้">
                                  <input type="checkbox" className="sr-only" checked={rowOn(r)} onChange={(e) => setRow(r.sysId, e.target.checked)} />
                                  <span className="sw-track" />
                                </label>
                              </td>
                            )}
                            {FLAGS.map((k) => (
                              <td key={k} className="text-center">
                                {flag(r, k)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* 📱 Mobile: การ์ดต่อระบบ */}
          <div className="grid gap-3 md:hidden">
            {sections.map(({ g, rows: list }) => (
              <Fragment key={g.key}>
                {groupHead(g, list)}
                {!closed.has(g.key) &&
                  list.map((r, i) => {
                    const ms = r.sysId.toLowerCase() === "multiscanner" && data.scanner;
                    return (
                      <div key={r.sysId} className="pm-card pm-gcard" style={{ "--g": g.color, animationDelay: `${Math.min(i, 10) * 30}ms` } as React.CSSProperties}>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-extrabold text-[#1f2350]">{shortTitle(r.title)}</div>
                            {r.hint && <div className="text-[11px] font-semibold text-ink-soft">{r.hint}</div>}
                          </div>
                          {!readOnly && (
                            <label className={`sw sw-mini ${rowOn(r) ? "is-on" : ""}`} title="ทุกสิทธิ์">
                              <input type="checkbox" className="sr-only" checked={rowOn(r)} onChange={(e) => setRow(r.sysId, e.target.checked)} />
                              <span className="sw-track" />
                            </label>
                          )}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">{FLAGS.map((k) => flag(r, k, true))}</div>
                        {ms && scanToggle}
                      </div>
                    );
                  })}
              </Fragment>
            ))}
          </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="adm-foot">
            {!readOnly && tab === "PERM" && (
              <>
                <button className="fill-btn is-sm" onClick={() => setAll((r) => ({ ...r, view: true }))}>
                  VIEW ALL
                </button>
                <button className="fill-btn is-sm" onClick={() => setAll((r) => ({ ...r, view: true, add: true, edit: true, delete: true, approve: true }))}>
                  SELECT ALL
                </button>
                <button className="fill-btn is-sm is-danger" onClick={() => setAll((r) => ({ ...r, view: false, add: false, edit: false, delete: false, approve: false }))}>
                  CLEAR
                </button>
              </>
            )}
            <span className="ml-auto" />
            <button className={readOnly ? "cta-btn is-gray" : "fill-btn"} onClick={onClose}>
              {readOnly ? "CLOSE" : "CANCEL"}
            </button>
            {!readOnly && (
              <button className="cta-btn is-green" disabled={busy || !data} onClick={save}>
                💾 SAVE PERMISSION
              </button>
            )}
          </div>
        </section>
      </div>
    </Wrap>
  );
}

// popup (USER ACCOUNTS) or in-page card (ACCESS CONTROL) - same content
function Wrap({ inline, title, onClose, children }: { inline: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (inline) return <div className="pm-inline">{children}</div>;
  return (
    <Modal open size="xl" flush title={title} onClose={onClose}>
      {children}
    </Modal>
  );
}
