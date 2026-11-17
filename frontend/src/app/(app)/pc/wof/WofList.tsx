"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { MonthField } from "@/components/forms/MonthField";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { thisMonth } from "@/lib/pp";
import { ROLES, signChip, signOf, type PcMeta, type PcSheet } from "@/lib/pcwof";
import "./wof.css";

// 🗂 PC › WORK ORDER FOLLOW : รายการชีทของเดือน (การ์ดบนมือถือ · ตารางบนจอใหญ่) · ค้นหา · + ADD SHEET
export default function WofList() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [meta, setMeta] = useState<PcMeta | null>(null);
  const [rows, setRows] = useState<PcSheet[] | null>(null);
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const last = useRef("");

  useEffect(() => {
    api<PcMeta>("/pcwof/meta").then(setMeta).catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  const ready = meta?.ready === true;

  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<PcSheet[]>("/pcwof/sheets", { query: { month } });
        if (quiet && sameData(last, r)) return;
        setRows(r);
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
        setRows((p) => p ?? []);
      }
    },
    [month, toast],
  );
  useEffect(() => {
    if (!ready) return;
    last.current = "";
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [ready, load]);
  useLive(["pcwof"], () => (ready ? load(true) : undefined), 60_000);

  function changeMonth(m: string) {
    setMonth(m);
    router.replace(`?month=${m}`, { scroll: false });
  }
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? []).filter((s) => !k || `${s.customerCode} ${s.customerName} ${s.workOrderNo} ${s.owner.name}`.toLowerCase().includes(k));
  }, [rows, q]);

  return (
    <PageBody>
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title="WORK ORDER FOLLOW"
        subtitle="ตาราง Work Order รายเดือนต่อลูกค้า"
        actions={
          <>
            <MonthField value={month} onChange={changeMonth} />
            <SearchBox value={q} onChange={setQ} placeholder="ค้นหา ลูกค้า / W/O / เจ้าของ" />
            {meta?.can.add && (
              <button type="button" className="cta-btn is-purple" disabled={!ready} onClick={() => setAdd(true)}>
                + ADD SHEET
              </button>
            )}
          </>
        }
      />
      {meta && !ready ? (
        <div className="mr-off">รอติดตั้งฐานข้อมูล</div>
      ) : !meta || !rows ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>{rows.length ? "ไม่พบชีทที่ค้นหา" : "เดือนนี้ยังไม่มีชีท"}</Empty>
      ) : (
        <div className="wof-cards">
          {list.map((s, i) => (
            <Link key={s.sheetId} href={`/pc/wof/${s.sheetId}`} className="wof-card" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
              <div className="wof-card-h">
                <b>{s.customerName || s.customerCode}</b>
                <span>{s.customerCode}</span>
              </div>
              <div className="wof-card-wo">
                W/O <b>{s.workOrderNo || "-"}</b> · {s.items} ITEMS
              </div>
              <div className="wof-card-m">
                <span>OWNER</span> {s.owner.name}
              </div>
              <div className="wof-card-m">
                <span>EDITORS</span> {s.editors.length ? s.editors.map((e) => e.name).join(", ") : "-"}
              </div>
              <div className="wof-chips">
                {ROLES.map((r) => {
                  const c = signChip(signOf(s.signs, r));
                  return (
                    <i key={r} className={`wof-chip is-${c.tone}`} title={c.text}>
                      {r} · {c.text}
                    </i>
                  );
                })}
              </div>
            </Link>
          ))}
        </div>
      )}
      {add && (
        <AddSheet
          month={month}
          onClose={() => setAdd(false)}
          onDone={(id) => {
            setAdd(false);
            router.push(`/pc/wof/${id}`);
          }}
        />
      )}
    </PageBody>
  );
}

function AddSheet({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ customerCode: "", customerName: "", workOrderNo: "" });
  const [busy, setBusy] = useState(false);
  const ok = f.customerCode.trim() && f.customerName.trim();
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ sheetId: number }>("/pcwof/sheets", { method: "POST", body: { month, ...f } });
      toast.show("Saved", "สร้างชีทแล้ว", "ok");
      onDone(r.sheetId);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      setBusy(false);
    }
  }
  const field = (k: keyof typeof f, label: string, ph: string) => (
    <label className="wof-fld">
      <span>{label}</span>
      <input value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <Modal
      open
      title={`+ ADD SHEET · ${month}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cta-btn is-gray" onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className="cta-btn is-purple" disabled={!ok || busy} onClick={save}>
            CREATE
          </button>
        </>
      }
    >
      <div className="wof-form">
        {field("customerCode", "CUSTOMER CODE", "เช่น HMC")}
        {field("customerName", "CUSTOMER NAME", "ชื่อลูกค้า")}
        {field("workOrderNo", "WORK ORDER NO.", "เลขที่ Work Order")}
      </div>
    </Modal>
  );
}
