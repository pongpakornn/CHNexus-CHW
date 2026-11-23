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
type Item = { key: string; title: string; detail: string; group: string; show: boolean; href?: string; open?: Open };

const GROUPS: [key: string, title: string, color: string][] = [
  ["CIMS", "CIMS · INVENTORY", "#6750a4"],
  ["MASTER", "MASTER DATA", "#2563eb"],
  ["EDP", "EDP PLANNING", "#7c3aed"],
  ["CHEM", "CHEMICAL CONTROL", "#0d9488"],
  ["PC", "PC DIGITAL WORKSPACE", "#4f46e5"],
  ["USER", "USER MANAGEMENT", "#334155"],
];
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
      { key: "stock-add", title: "ADD STOCK", detail: "เพิ่มคลังใหม่ (ตั้งค่าคอลัมน์ / หน่วย / MAX-MIN / ช่องทางสแกน)", group: "CIMS", show: !!c.storeAdd, open: "stock" as const },
      { key: "stock-edit", title: "STOCK SETTINGS", detail: "เลือกคลังแล้วแก้การตั้งค่าคลัง", group: "CIMS", show: !!c.storeEdit, open: "stock" as const },
      { key: "formats", title: "BARCODE FORMATS", detail: "รูปแบบบาร์โค้ด Supplier / ลูกค้า ที่ใช้สแกน", group: "CIMS", show: !!(c.storeEdit || c.storeAdd), open: "formats" as const },
      { key: "formula", title: "MAX-MIN FORMULA", detail: "สูตรคำนวณ MAX / MIN ของแต่ละคลัง", group: "CIMS", show: !!c.maxMinCalc, open: "formula" as const },
      { key: "pcadmin", title: "PRODUCT CONTROL ADMIN", detail: "คอลัมน์ตาราง / รูปแบบ QR CODE / ลบสินค้าตามคลัง", group: "MASTER", show: admin, open: "pcadmin" as const },
      { key: "layout", title: "LAYOUT SETUP", detail: "ตำแหน่งจัดเก็บ (Rack · Incoming · S1–S9) และ Export QR ตำแหน่ง", group: "MASTER", show: !!c.layout, open: "layout" as const },
      { key: "forecast", title: "FORECAST / ORDER IMPORT", detail: "นำเข้าไฟล์ Forecast / Order / Delivery", group: "MASTER", show: !!c.forecastImport, href: "/master/forecast/file" },
      { key: "pp-std", title: "MACHINE STD", detail: "เครื่องจักร + Target Eff + Plan SPH", group: "MASTER", show: !!c.ppSetup, href: "/master/production-plan" },
      { key: "pp-prod", title: "MACHINE PRODUCTS", detail: "Product ของเครื่อง (PART A / PART B / Process)", group: "MASTER", show: !!c.ppSetup, href: "/master/production-plan/products" },
      { key: "edp-setting", title: "PLAN SETTING", detail: "แผนผลิต / แม่แบบของ EDP", group: "EDP", show: !!c.edpSetting, href: "/edp/plan-setting" },
      { key: "chem-setup", title: "PARAMETER SETUP", detail: "รายการตรวจวัด ค่ามาตรฐาน ขีดจำกัด เวลา", group: "CHEM", show: !!c.chemSetup, href: "/chem/setup" },
      { key: "wof-flow", title: "SETUP FLOW", detail: "ขั้นตอนและผู้อนุมัติของ Work Order Follow", group: "PC", show: !!c[PC_PERM], href: "/pc/setup-flow" },
      // SYSTEM CONFIGURATION pages (Admin Level 1, as before)
      ...SETUP_GROUPS.flatMap((g) => g.items.map(([slug, label]) => ({ key: slug, title: label, detail: `SYSTEM CONFIGURATION • ${g.name}`, group: SYS_GROUP[g.key] ?? "USER", show: admin, href: `/admin/setup/${slug}` }))),
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
        GROUPS.map(([g, title, color]) => {
          const rows = list.filter((i) => i.group === g);
          if (rows.length === 0) return null;
          return (
            <section key={g} className="stc-group" style={{ "--c": color } as React.CSSProperties} aria-label={title}>
              <h3>
                {title} <span>{rows.length}</span>
              </h3>
              <div className="stc-tiles">
                {rows.map((i) =>
                  i.href ? (
                    <Link key={i.key} href={i.href} className="stc-tile">
                      <b>{i.title}</b>
                      <small>{i.detail}</small>
                      <em aria-hidden>↗</em>
                    </Link>
                  ) : (
                    <button key={i.key} type="button" className="stc-tile" onClick={() => pick(i)}>
                      <b>{i.title}</b>
                      <small>{i.detail}</small>
                      <em aria-hidden>⚙</em>
                    </button>
                  ),
                )}
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
