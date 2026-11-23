"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { MonthField } from "@/components/forms/MonthField";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { api } from "@/lib/api";
import { sameData, useLive } from "@/lib/live";
import { thisMonth } from "@/lib/pp";
import { initials, pctOf, statusTone, type PcMeta, type PcPlan } from "@/lib/pcwof";
import "./wof.css";

// 🗂 PC › WORK ORDER FOLLOW : แผนของเดือน (MY PLANS / ALL) · การ์ดบอกเจ้าของแผน + ความคืบหน้า · + REGISTER PLAN
export default function WofList() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [month, setMonth] = useState(() => params.get("month") || thisMonth());
  const [owner, setOwner] = useState<"me" | "all">(() => (params.get("owner") === "all" ? "all" : "me"));
  const [meta, setMeta] = useState<PcMeta | null>(null);
  const [rows, setRows] = useState<PcPlan[] | null>(null);
  const [q, setQ] = useState("");
  const [reg, setReg] = useState(false);
  const last = useRef("");

  useEffect(() => {
    api<PcMeta>("/pcwof/meta")
      .then(setMeta)
      .catch((e) => toast.show("ERROR", (e as Error).message, "error"));
  }, [toast]);
  const ready = meta?.ready === true;

  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<PcPlan[]>("/pcwof/plans", { query: { month, owner } });
        if (quiet && sameData(last, r)) return;
        setRows(r);
      } catch (e) {
        if (!quiet) toast.show("ERROR", (e as Error).message, "error");
        setRows((p) => p ?? []);
      }
    },
    [month, owner, toast],
  );
  useEffect(() => {
    if (!ready) return;
    last.current = "";
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [ready, load]);
  useLive(["pcwof"], () => (ready ? load(true) : undefined), 60_000);

  function url(m: string, o: string) {
    router.replace(`?month=${m}&owner=${o}`, { scroll: false });
  }
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? []).filter((s) => !k || `${s.customerCode} ${s.customerName} ${s.month.workOrderNo} ${s.owner.name} ${s.owner.userId}`.toLowerCase().includes(k));
  }, [rows, q]);

  return (
    <PageBody>
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title="WORK ORDER FOLLOW"
        subtitle="แผนการผลิตรายชิ้นงานต่อลูกค้า"
        actions={
          <>
            <MonthField value={month} onChange={(m) => (setMonth(m), url(m, owner))} />
            <div className="wof-seg" role="group" aria-label="OWNER">
              {(["me", "all"] as const).map((o) => (
                <button key={o} type="button" className={owner === o ? "is-on" : ""} onClick={() => (setOwner(o), url(month, o))}>
                  {o === "me" ? "MY PLANS" : "ALL"}
                </button>
              ))}
            </div>
            <SearchBox value={q} onChange={setQ} placeholder="ค้นหา ลูกค้า / W/O / เจ้าของ" />
            {meta?.can.add && (
              <button type="button" className="cta-btn is-purple" disabled={!ready} onClick={() => setReg(true)}>
                + REGISTER PLAN
              </button>
            )}
          </>
        }
      />
      {meta && !ready ? (
        <div className="mr-off">รอติดตั้งฐานข้อมูล</div>
      ) : !meta || !rows ? (
        <div className="wof-cards" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="nx-skel h-44 rounded-2xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Empty>{rows.length ? "ไม่พบแผนที่ค้นหา" : owner === "me" ? "คุณยังไม่มีแผน · กด + REGISTER PLAN" : "ยังไม่มีแผน"}</Empty>
      ) : (
        <div className="wof-cards">
          {list.map((s, i) => {
            const tone = statusTone(s.month.status);
            return (
              <Link key={s.planId} href={`/pc/wof/${s.planId}?month=${month}`} className="wof-card" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <div className="wof-owner">
                  <span className="wof-av" aria-hidden>
                    {initials(s.owner.name, s.owner.userId)}
                  </span>
                  <span className="wof-owner-tx">
                    <b>{s.owner.name}</b>
                    <small>{s.owner.userId}</small>
                  </span>
                  <i className={`wof-chip is-${tone}`}>{s.month.status || "DRAFT"}</i>
                </div>
                <div className="wof-card-h">
                  <b>{s.customerName || s.customerCode}</b>
                  <span>{s.customerCode}</span>
                </div>
                <div className="wof-card-wo">
                  W/O <b>{s.month.workOrderNo || "-"}</b> · {s.items} PARTS
                </div>
                <Bar label="PRODUCED" v={pctOf(s.progress.produced, s.progress.order)} a={s.progress.produced} b={s.progress.order} />
                <Bar label="DELIVERED" v={pctOf(s.progress.delivered, s.progress.order)} a={s.progress.delivered} b={s.progress.order} tone="del" />
              </Link>
            );
          })}
        </div>
      )}
      {reg && (
        <Register
          onClose={() => setReg(false)}
          onDone={(id) => {
            setReg(false);
            router.push(`/pc/wof/${id}?month=${month}`);
          }}
        />
      )}
    </PageBody>
  );
}

function Bar({ label, v, a, b, tone }: { label: string; v: number; a: number; b: number; tone?: string }) {
  return (
    <div className="wof-bar" title={`${a.toLocaleString("en-US")} / ${b.toLocaleString("en-US")}`}>
      <span>{label}</span>
      <i>
        <u className={tone ? `is-${tone}` : ""} style={{ width: `${Math.min(100, v)}%` }} />
      </i>
      <b>{v}%</b>
    </div>
  );
}

function Register({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const [cust, setCust] = useState<{ code: string; name: string }[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ code: string; name: string }[]>("/pcwof/customers")
      .then(setCust)
      .catch((e) => (toast.show("ERROR", (e as Error).message, "error"), setCust([])));
  }, [toast]);
  const name = cust?.find((c) => c.code === code)?.name ?? "";
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ planId: number }>("/pcwof/plans", { method: "POST", body: { customerCode: code } });
      toast.show("Saved", "ลงทะเบียนแผนแล้ว", "ok");
      onDone(r.planId);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="+ REGISTER PLAN"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cta-btn is-gray" onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className="cta-btn is-purple" disabled={!code || busy} onClick={save}>
            REGISTER
          </button>
        </>
      }
    >
      <div className="wof-form">
        <div className="wof-fld">
          <span>CUSTOMER CODE</span>
          <ComboBox
            value={code}
            onChange={setCode}
            disabled={!cust}
            ariaLabel="CUSTOMER CODE"
            placeholder={cust ? "พิมพ์ค้นหา / เลือกลูกค้า" : "กำลังโหลด…"}
            options={(cust ?? []).map((c) => ({ value: c.code, label: c.code, sub: c.name }))}
          />
        </div>
        <label className="wof-fld">
          <span>CUSTOMER NAME</span>
          <input value={name} readOnly placeholder="ชื่อลูกค้า (อัตโนมัติ)" />
        </label>
      </div>
    </Modal>
  );
}
