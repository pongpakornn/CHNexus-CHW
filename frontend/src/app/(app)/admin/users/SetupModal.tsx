"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useDialogs } from "@/components/modals/Dialogs";
import { MinReportPanel } from "./MinReportPanel";
import { LayoutPanel } from "./LayoutPanel";
import { SignFlowPanel } from "./SignFlowPanel";
import { MinReasonPanel } from "./MinReasonPanel";
import { EdpAlertPanel } from "./EdpAlertPanel";
import { UserOrgPanel } from "./UserOrgPanel";
import { DeptPanel, ExcelPanel, PrPanel } from "../setup/BasicPanels";

type Section = "PR" | "EXCEL" | "DEPT" | "MIN" | "REASON" | "FLOW" | "LAYOUT" | "EDP" | "USERID";
type Dirty = Record<Section, boolean>;
const NAMES: Record<Section, string> = { PR: "PR SETTINGS", EXCEL: "EXCEL SETUP", DEPT: "DEPARTMENTS", MIN: "MIN REPORT", REASON: "MIN REASONS", FLOW: "SIGN FLOW", LAYOUT: "LAYOUT SETUP", EDP: "EDP ALERT", USERID: "ORGANIZATION MASTER" };

const SIDE_KEY = "setup-side";
const TABS: [Section, string, string, React.ReactNode][] = [
  ["PR", "PR SETTINGS", "คลังที่เก็บ PR (KEEP PR)", <path key="p" d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />],
  ["EXCEL", "EXCEL SETUP", "ไฟล์ Excel ของ PR / Export RPA", <path key="e" d="M4 4h16v16H4zM4 9h16M4 14h16M9 9v11M14 9v11" />],
  ["DEPT", "DEPARTMENTS", "แผนกของหน้า Multi-Scanner", <path key="d" d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M8 11h2M14 11h2" />],
  ["MIN", "MIN REPORT", "แจ้งเตือนสินค้าค้างที่ค่า MIN", <path key="m" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0M12 8v3.5" />],
  ["REASON", "MIN REASONS", "ตัวเลือกหมายเหตุ · เพิ่ม / แก้ไข / ลบ", <path key="r" d="M5 4h14v12H9l-4 4zM9 8h6M9 12h4" />],
  ["FLOW", "SIGN FLOW", "SETUP FLOW SIGNATURE · MIN REPORT · CHEMICAL CONTROL", <path key="f" d="M4 18c3-1 4-6 6-6s1 5 3 5 3-4 4-4M15 4l5 5-8 8H7v-5zM13 6l5 5" />],
  ["USERID", "ORGANIZATION MASTER", "ตำแหน่ง · ฝ่าย → แผนก → หน่วยงาน", <path key="u" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2.5 21a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />],
  ["EDP", "EDP ALERT", "แจ้งเตือนการ์ด EDP เลยเวลา", <path key="t" d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M5 3.5 2.5 6M19 3.5 21.5 6" />],
  ["LAYOUT", "LAYOUT SETUP", "ตำแหน่งจัดเก็บ · QR ตำแหน่ง", <path key="l" d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7v5M9.5 9.5h5" />],
];

// ⚙ SETUP (SystemSetupWindow - Admin Level 1): 🧾 PR SETTINGS / 📊 EXCEL SETUP / 🏢 DEPARTMENTS
//   Sidebar ติดขอบซ้ายแบบเมนูหลัก · พับเหลือไอคอนได้ (จำค่า) · มือถือ = เมนูเลื่อนออกจากซ้าย
export function SetupModal({ onClose }: { onClose: () => void }) {
  const dlg = useDialogs();
  const [sec, setSec] = useState<Section>("PR");
  const [dirty, setDirty] = useState<Dirty>({ PR: false, EXCEL: false, DEPT: false, MIN: false, REASON: false, FLOW: false, LAYOUT: false, EDP: false, USERID: false });
  const [mini, setMini] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const mark = useCallback((s: Section, v: boolean) => setDirty((d) => (d[s] === v ? d : { ...d, [s]: v })), []);
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

  async function tryClose() {
    const unsaved = (Object.keys(dirty) as Section[]).filter((s) => dirty[s]).map((s) => NAMES[s]);
    if (unsaved.length && !(await dlg.confirm({ title: "UNSAVED CHANGES", message: `มีการตั้งค่าที่ยังไม่ได้กด SAVE (${unsaved.join(", ")})\nต้องการปิดหน้าต่างโดยไม่บันทึกหรือไม่?`, ok: "CLOSE" })))
      return;
    onClose();
  }

  const burger = (onClick: () => void, label: string) => (
    <button type="button" className="adm-burger" onClick={onClick} aria-label={label} title={label}>
      <span />
      <span />
      <span />
    </button>
  );

  return (
    <Modal open size="xl" flush title={`⚙ SETUP • ${NAMES[sec]}`} onClose={tryClose}>
      <div className={`adm-shell ${mini ? "is-mini" : ""} ${drawer ? "is-drawer" : ""}`}>
        <nav className="adm-nav">
          <div className="adm-nav-head">
            {burger(() => (window.matchMedia("(max-width: 767px)").matches ? setDrawer(false) : toggleMini()), mini ? "กางเมนู" : "พับเมนู")}
            <span className="adm-nav-title">
              SETUP
              <small>ADMIN LEVEL 1</small>
            </span>
          </div>
          {TABS.map(([t, txt, hint, path]) => (
            <button key={t} type="button" onClick={() => (setSec(t), setDrawer(false))} title={mini ? txt : undefined} className={`adm-item ${sec === t ? "is-on" : ""}`}>
              <svg viewBox="0 0 24 24" className="adm-item-ic" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {path}
              </svg>
              <span className="adm-item-txt">
                <span className="block truncate text-[13.5px] font-extrabold">
                  {txt}
                  {dirty[t] && <span className="adm-dirty ml-1.5" title="ยังไม่ได้ SAVE" />}
                </span>
                <span className="adm-item-hint">{hint}</span>
              </span>
            </button>
          ))}
        </nav>
        {drawer && <div className="adm-scrim" onClick={() => setDrawer(false)} />}

        <section className="adm-main">
          <div className="adm-main-head">
            {burger(() => setDrawer(true), "เมนู")}
            <b>{NAMES[sec]}</b>
          </div>
          <div className="adm-scroll">
            {/* ทุกแผงเปิดค้างไว้ (เก็บค่าที่ยังไม่ SAVE) - ซ่อนแผงที่ไม่ได้เลือก · เปลี่ยนแผง = เลื่อนเข้ามาใหม่ */}
            <div hidden={sec !== "PR"} className={sec === "PR" ? "adm-pane" : ""}>
              <PrPanel onDirty={(v) => mark("PR", v)} />
            </div>
            <div hidden={sec !== "EXCEL"} className={sec === "EXCEL" ? "adm-pane" : ""}>
              <ExcelPanel onDirty={(v) => mark("EXCEL", v)} />
            </div>
            <div hidden={sec !== "DEPT"} className={sec === "DEPT" ? "adm-pane" : ""}>
              <DeptPanel onDirty={(v) => mark("DEPT", v)} />
            </div>
            <div hidden={sec !== "MIN"} className={sec === "MIN" ? "adm-pane" : ""}>
              <MinReportPanel onDirty={(v) => mark("MIN", v)} />
            </div>
            <div hidden={sec !== "REASON"} className={sec === "REASON" ? "adm-pane" : ""}>
              <MinReasonPanel onDirty={(v) => mark("REASON", v)} />
            </div>
            <div hidden={sec !== "FLOW"} className={sec === "FLOW" ? "adm-pane" : ""}>
              <SignFlowPanel onDirty={(v) => mark("FLOW", v)} />
            </div>
            <div hidden={sec !== "USERID"} className={sec === "USERID" ? "adm-pane" : ""}>
              <UserOrgPanel onDirty={(v) => mark("USERID", v)} />
            </div>
            <div hidden={sec !== "EDP"} className={sec === "EDP" ? "adm-pane" : ""}>
              <EdpAlertPanel onDirty={(v) => mark("EDP", v)} />
            </div>
            <div hidden={sec !== "LAYOUT"} className={sec === "LAYOUT" ? "adm-pane" : ""}>
              {/* บันทึกทันทีทุกครั้ง (ADD / ลบ / แก้ชื่อ / SAVE FORMAT) - ไม่มีค่าค้าง SAVE */}
              <LayoutPanel />
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
