"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { Select } from "@/components/dropdowns/Select";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { PC_PERM, SETUP_GROUPS } from "@/lib/menu";
import { StockEditor } from "../../cims/store/StockEditor";
import { FormatsModal } from "../../cims/store/FormatsModal";
import { FormulaModal } from "../../cims/max-min/FormulaModal";
import type { Stock as MmStock } from "../../cims/max-min/types";
import { AdminModal } from "../../master/product/AdminModal";
import { LayoutPanel } from "../users/LayoutPanel";
import "./setup-center.css";

// 🧩 SETUP CENTER: every system's setup in one place (User Management)
//   - modal setups open right here (same components as inside each system = one source of truth)
//   - full-page setups (big tables) open their own page
//   - each card shows only with its usual permission; the server checks again as before (nothing moved or removed)
type Open = "stock" | "formats" | "formula" | "pcadmin" | "layout";
type Item = { key: string; title: string; detail: string; group: string; show: boolean; icon: string; href?: string; open?: Open; sys?: boolean };

const GROUPS: [key: string, title: string, th: string, color: string, icon: string][] = [
  ["CIMS", "CIMS · INVENTORY", "คลังสินค้า · บาร์โค้ด · MAX-MIN · PR", "#6750a4", "/icons/StoreMaxMin.png"],
  ["MASTER", "MASTER DATA", "ข้อมูลกลาง · Product Control · Production Plan", "#2563eb", "/icons/ProductControl.png"],
  ["EDP", "EDP PLANNING", "แผนผลิต EDP · การแจ้งเตือน", "#7c3aed", "/icons/ForecastOrder.png"],
  ["CHEM", "CHEMICAL CONTROL", "พารามิเตอร์น้ำยา · ลำดับผู้ลงนาม", "#0d9488", "/icons/DashboardChart.png"],
  ["PC", "PC DIGITAL WORKSPACE", "Work Order Follow · ผู้อนุมัติ", "#4f46e5", "/icons/ForecastOrder.png"],
  ["USER", "USER MANAGEMENT", "โครงสร้างองค์กร", "#475569", "/icons/management.png"],
];
// SYSTEM CONFIGURATION pages: short Thai detail (fallback = group name)
const SYS_DETAIL: Record<string, string> = {
  "pr-settings": "คลังที่เก็บ PR และ Export Path",
  excel: "รูปแบบไฟล์ Excel ของใบ PR",
  departments: "รายชื่อแผนกที่ใช้ใน PR",
  "min-report": "คลังที่ติดตาม MIN และผู้รับแจ้งเตือน",
  "min-reasons": "กลุ่มเหตุผลเมื่อยอดถึง MIN",
  "sign-flow-min": "ลำดับผู้ลงนามรายงาน MIN",
  "sign-flow-chem": "ลำดับผู้ลงนามผลตรวจน้ำยา",
  "edp-alert": "เวลาแจ้งเตือนการ์ดที่เลยเวลา",
  organization: "ตำแหน่ง · ฝ่าย · แผนก · หน่วยงาน",
};
// SYSTEM CONFIGURATION group -> Setup Center group
const SYS_GROUP: Record<string, string> = { pr: "CIMS", cims: "CIMS", chem: "CHEM", edp: "EDP", user: "USER" };

export default function SetupCenter() {
  const { me, loading } = useAuth();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [addNew, setAddNew] = useState(false);

  const items = useMemo<Item[]>(() => {
    if (!me) return [];
    const c = me.can,
      admin = me.userLevel === 1;
    return [
      { key: "stock-add", icon: "/icons/StoreWarehouse.png", title: "ADD STOCK", detail: "เพิ่มคลังใหม่ (ตั้งค่าคอลัมน์ / หน่วย / MAX-MIN / ช่องทางสแกน)", group: "CIMS", show: !!c.storeAdd, open: "stock" as const },
      { key: "stock-edit", icon: "/icons/StoreMaxMin.png", title: "STOCK SETTINGS", detail: "เลือกคลังแล้วแก้การตั้งค่าคลัง", group: "CIMS", show: !!c.storeEdit, open: "stock" as const },
      { key: "formats", icon: "/icons/MultiScanner.png", title: "BARCODE FORMATS", detail: "รูปแบบบาร์โค้ด Supplier / ลูกค้า ที่ใช้สแกน", group: "CIMS", show: !!(c.storeEdit || c.storeAdd), open: "formats" as const },
      { key: "formula", icon: "/icons/CalculatorMxMn.png", title: "MAX-MIN FORMULA", detail: "สูตรคำนวณ MAX / MIN ของแต่ละคลัง", group: "CIMS", show: !!c.maxMinCalc, open: "formula" as const },
      { key: "pcadmin", icon: "/icons/ProductControl.png", title: "PRODUCT CONTROL ADMIN", detail: "คอลัมน์ตาราง / รูปแบบ QR CODE / ลบสินค้าตามคลัง", group: "MASTER", show: admin, open: "pcadmin" as const },
      { key: "layout", icon: "/icons/registration.png", title: "LAYOUT SETUP", detail: "ตำแหน่งจัดเก็บ (Rack · Incoming · S1–S9) และ Export QR ตำแหน่ง", group: "MASTER", show: !!c.layout, open: "layout" as const },
      { key: "forecast", icon: "/icons/ForecastOrder.png", title: "FORECAST / ORDER IMPORT", detail: "นำเข้าไฟล์ Forecast / Order / Delivery", group: "MASTER", show: !!c.forecastImport, href: "/master/forecast/file" },
      { key: "pp-std", icon: "/icons/64engine_motorFF.png", title: "MACHINE STD", detail: "เครื่องจักร + Target Eff + Plan SPH", group: "MASTER", show: !!c.ppSetup, href: "/master/production-plan" },
      { key: "pp-prod", icon: "/icons/InventoryRegistration.png", title: "MACHINE PRODUCTS", detail: "Product ของเครื่อง (PART A / PART B / Process)", group: "MASTER", show: !!c.ppSetup, href: "/master/production-plan/products" },
      { key: "edp-setting", icon: "/icons/ProductControl.png", title: "PLAN SETTING", detail: "แผนผลิต / แม่แบบของ EDP", group: "EDP", show: !!c.edpSetting, href: "/edp/plan-setting" },
      { key: "chem-setup", icon: "/icons/DashboardChart.png", title: "PARAMETER SETUP", detail: "รายการตรวจวัด ค่ามาตรฐาน ขีดจำกัด เวลา", group: "CHEM", show: !!c.chemSetup, href: "/chem/setup" },
      { key: "wof-flow", icon: "/icons/management.png", title: "SETUP FLOW", detail: "ขั้นตอนและผู้อนุมัติของ Work Order Follow", group: "PC", show: !!c[PC_PERM], href: "/pc/setup-flow" },
      // SYSTEM CONFIGURATION pages (Admin Level 1, as before)
      ...SETUP_GROUPS.flatMap((g) => g.items.map(([slug, label]) => ({ key: slug, icon: "/icons/management.png", title: label, detail: SYS_DETAIL[slug] ?? g.name, group: SYS_GROUP[g.key] ?? "USER", show: admin, href: `/admin/setup/${slug}`, sys: true }))),
    ].filter((i) => i.show);
  }, [me]);

  if (loading || !me) return <Loading />;
  const k = q.trim().toLowerCase();
  const list = items.filter((i) => !k || `${i.title} ${i.detail}`.toLowerCase().includes(k));
  const pick = (i: Item) => {
    setAddNew(i.key === "stock-add");
    setOpen(i.open ?? null);
  };

  return (
    <PageBody>
      <PageHeader icon="/icons/management.png" title="SETUP CENTER" subtitle="ตั้งค่าทุกระบบในที่เดียว · เห็นเฉพาะรายการที่มีสิทธิ์ · ปุ่มตั้งค่าในแต่ละระบบยังใช้ได้เหมือนเดิม" actions={<SearchBox value={q} onChange={setQ} placeholder="ค้นหา SETUP" className="w-[260px] max-w-full" />} />
      {list.length === 0 ? (
        <Card>
          <Empty>{items.length === 0 ? "คุณยังไม่มีสิทธิ์ตั้งค่าระบบใด (ติดต่อ Admin)" : "ไม่พบรายการ"}</Empty>
        </Card>
      ) : (
        GROUPS.map(([g, title, th, color, icon]) => {
          const rows = list.filter((i) => i.group === g);
          if (rows.length === 0) return null;
          return (
            <section key={g} className="stc-group" style={{ "--c": color } as React.CSSProperties} aria-label={title}>
              <header className="stc-head">
                <span className="stc-ico is-lg" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={icon} alt="" />
                </span>
                <span className="min-w-0">
                  <b>{title}</b>
                  <small>{th}</small>
                </span>
                <span className="stc-count">{rows.length}</span>
              </header>
              <div className="stc-tiles">
                {rows.map((i, n) => {
                  const body = (
                    <>
                      <span className="stc-ico" aria-hidden>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={i.icon} alt="" />
                      </span>
                      <span className="stc-tx">
                        <b>{i.title}</b>
                        <small>{i.detail}</small>
                      </span>
                      <span className="stc-foot">
                        {i.sys && <span className="stc-tag">SYSTEM CONFIG</span>}
                        <span className="stc-go">{i.href ? "เปิดหน้า ↗" : "ตั้งค่า ⚙"}</span>
                      </span>
                    </>
                  );
                  const style = { "--i": n } as React.CSSProperties;
                  return i.href ? (
                    <Link key={i.key} href={i.href} className="stc-tile" style={style}>
                      {body}
                    </Link>
                  ) : (
                    <button key={i.key} type="button" className="stc-tile" style={style} onClick={() => pick(i)}>
                      {body}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
      {open && <Dialogs open={open} addNew={addNew} canFormats={!!(me.can.storeEdit || me.can.storeAdd)} canFormula={!!me.can.maxMinCalcEdit} onClose={() => setOpen(null)} />}
    </PageBody>
  );
}

// the setup opened from a tile: stock-based setups ask for the stock first (the same lists the system pages use = same permissions)
function Dialogs({ open, addNew, canFormats, canFormula, onClose }: { open: Open; addNew: boolean; canFormats: boolean; canFormula: boolean; onClose: () => void }) {
  const [stocks, setStocks] = useState<{ value: string; label: string; mm?: MmStock }[] | null>(null);
  const [stk, setStk] = useState("");
  const [go, setGo] = useState(false);
  const needStock = (open === "stock" && !addNew) || open === "formula";

  useEffect(() => {
    if (!needStock) return;
    let off = false;
    (open === "formula"
      ? api<{ stocks: MmStock[] }>("/maxmin/stocks").then((r) => r.stocks.map((s) => ({ value: String(s.stkId), label: `${s.code} - ${s.name}`, mm: s })))
      : api<{ stocks: { stkId: number; code: string; name: string }[] }>("/store/stocks").then((r) => r.stocks.map((s) => ({ value: String(s.stkId), label: `${s.code} - ${s.name}` })))
    )
      .then((l) => !off && setStocks(l))
      .catch(() => !off && setStocks([]));
    return () => {
      off = true;
    };
  }, [open, needStock]);

  if (open === "formats") return <FormatsModal onClose={onClose} />;
  if (open === "pcadmin") return <AdminModal ticked={[]} onClose={onClose} />;
  if (open === "layout")
    return (
      <Modal open size="xl" title="📍 LAYOUT SETUP" onClose={onClose}>
        <LayoutPanel />
      </Modal>
    );
  if (open === "stock" && addNew) return <StockEditor stkId={null} canFormats={canFormats} onClose={onClose} onSaved={onClose} />;
  if (go && stk && open === "stock") return <StockEditor stkId={Number(stk)} canFormats={canFormats} onClose={onClose} onSaved={onClose} />;
  if (go && stk && open === "formula")
    return <FormulaModal open stock={stocks?.find((s) => s.value === stk)?.mm ?? null} canEdit={canFormula} onClose={onClose} onChanged={() => {}} />;
  return (
    <Modal
      open
      title={open === "formula" ? "MAX-MIN FORMULA • เลือกคลัง" : "STOCK SETTINGS • เลือกคลัง"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className="cta-btn is-purple" disabled={!stk} onClick={() => setGo(true)}>
            NEXT
          </button>
        </>
      }
    >
      {!stocks ? <Loading compact /> : stocks.length === 0 ? <Empty>ไม่มีคลังที่คุณมีสิทธิ์</Empty> : <Select ariaLabel="STOCK" value={stk} onChange={setStk} options={[{ value: "", label: "— เลือกคลัง —" }, ...stocks]} />}
    </Modal>
  );
}
