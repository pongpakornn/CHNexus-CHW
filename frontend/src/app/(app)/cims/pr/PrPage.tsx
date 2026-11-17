"use client";

import { RowAction } from "@/components/button-action/RowAction";
import { ActionMenu } from "@/components/menus/ActionMenu";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { api, download } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { ApprovedModal } from "./ApprovedModal";
import { PrDock, type PrMode } from "./PrDock";
import { STATUS_COLOR, type Pr } from "./types";
import { useLive } from "@/lib/live";


type Meta = {
  can: { submit: boolean; edit: boolean; delete: boolean; approve: boolean; deleteAll: boolean };
  hasPrStock: boolean;
  stocks: { stkId: number; code: string; name: string; countCoil: boolean }[];
  selected: number | null;
  userName: string;
  myDept?: string | null;
  today: string;
  noStockText: string | null;
};
type PartOpt = { partId: number; code: string; name: string; inStock: boolean };


// 🧾 PURCHASE REQUEST (PRView + PRViewModel)
export default function PrPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stk, setStk] = useState<number | null>(null);
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Pr[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [part, setPart] = useState<PartOpt | null>(null);
  const [opts, setOpts] = useState<PartOpt[]>([]);
  const [qtyText, setQtyText] = useState("");
  const [f, setF] = useState({ requester: "", dept: "", remark: "", target: "" });
  const [look, setLook] = useState<Record<string, string[]>>({});
  const [viewing, setViewing] = useState<Pr | null>(null);
  const [mode, setMode] = useState<PrMode>("");
  const [pick, setPick] = useState<string[]>([]);
  const [approve, setApprove] = useState<Pr[] | null>(null);
  const [approvedOpen, setApprovedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 400);
  const codeK = useDebounced(code, 250);
  const sigRef = useRef("");
  const lightRef = useRef<string | null>(null); // /pr/signature value of the last full load (cheap poll)
  const sigApi = useRef(true);

  useEffect(() => {
    api<Meta>("/pr/meta")
      .then((m) => {
        setMeta(m);
        setStk(m.selected);
        setF((x) => ({ ...x, requester: m.userName, dept: x.dept || m.myDept || "" }));
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast]);

  const load = useCallback(
    async (onlyIfChanged = false) => {
      if (!meta) return;
      try {
        const query = { key: k, stkId: stk ?? undefined };
        // เช็คลายเซ็นก่อน (เบา) - เปลี่ยนจริงค่อยโหลดรายการ · endpoint ยังไม่มี (404) = โหลดทั้งรายการเหมือนเดิม
        let light: string | null = null;
        if (sigApi.current) {
          try {
            light = (await api<{ sig: string }>("/pr/signature", { query })).sig;
            if (onlyIfChanged && light === lightRef.current) return;
          } catch (e) {
            if ((e as { status?: number }).status === 404) sigApi.current = false;
          }
        }
        lightRef.current = light;
        const r = await api<{ signature: string; rows: Pr[] }>("/pr", { query });
        if (onlyIfChanged && r.signature === sigRef.current) return;
        sigRef.current = r.signature;
        setRows(r.rows);
        setSel((s) => s.filter((n) => r.rows.some((x) => x.prNumber === n)));
        setPick((s) => s.filter((n) => r.rows.some((x) => x.prNumber === n && x.status === "Waiting")));
      } catch (e) {
        if (!onlyIfChanged) toast.show("ERROR", "โหลดข้อมูล PR ไม่สำเร็จ: " + (e as Error).message, "error");
      }
    },
    [meta, k, stk, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  // ⚡ อัพเดททันทีเมื่อมีการบันทึก + เช็คเองทุก 15 วินาที
  useLive(["data"], () => load(true), 15000);

  useEffect(() => {
    if (!codeK.trim() || part) {
      queueMicrotask(() => setOpts([]));
      return;
    }
    let alive = true;
    api<PartOpt[]>("/pr/parts", { query: { key: codeK, stkId: stk ?? undefined } })
      .then((r) => {
        if (!alive) return;
        setOpts(r);
        const exact = r.filter((o) => o.code.toLowerCase() === codeK.trim().toLowerCase());
        if (exact.length === 1) setPart(exact[0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [codeK, stk, part]);

  const lookup = async (field: string, text: string) => {
    try {
      const r = await api<string[]>("/pr/lookups", { query: { field, text } });
      setLook((l) => ({ ...l, [field]: r }));
    } catch {
      /* ไม่มีรายการแนะนำก็พิมพ์เองได้ */
    }
  };

  if (!meta) return <Loading />;
  const can = meta.can;
  const stock = meta.stocks.find((s) => s.stkId === stk) ?? null;

  function clear() {
    setViewing(null);
    setPart(null);
    setCode("");
    setQtyText("");
    setF({ requester: meta!.userName, dept: meta!.myDept ?? "", remark: "", target: "" });
  }

  async function submit() {
    if (meta!.hasPrStock && !stock) return toast.show("WARNING", "กรุณาเลือกคลัง (STOCK) ก่อนครับ", "warn");
    if (!part) return toast.show("WARNING", "กรุณาเลือก Product Code ที่มีในระบบ (พิมพ์รหัสแล้วเลือกจากรายการ)", "warn");
    const q = Number(qtyText);
    if (!Number.isInteger(q) || q <= 0) return toast.show("WARNING", "กรุณาใส่ QTY เป็นตัวเลขมากกว่า 0", "warn");
    if (!f.requester.trim() || !f.dept.trim() || !f.target.trim()) return toast.show("WARNING", "กรุณากรอก Requester, Department และ Target Dept ให้ครบถ้วน", "warn");
    setBusy(true);
    try {
      const r = await api<{ prNo: string; message: string }>("/pr", { method: "POST", body: { stkId: stk, partId: part.partId, partCode: part.code, qty: q, ...f } });
      toast.show("PR", `${r.message} • ${r.prNo}`, "ok");
      clear();
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function rejectPicked() {
    const nos = pick;
    if (nos.length === 0) return toast.show("WARNING", "กรุณาติ๊กเลือก PR ที่ต้องการ Reject ก่อนครับ", "warn");
    if (!(await dlg.confirm({ title: "ยืนยัน", danger: true, ok: "REJECT", message: `คุณต้องการ Reject ${nos.length.toLocaleString()} รายการ ใช่หรือไม่?\n${nos.join(", ")}` }))) return;
    try {
      const r = await api<{ ok: number; message: string }>("/pr/reject-batch", { method: "POST", body: { prNos: nos } });
      toast.show("Rejected", r.message, r.ok === nos.length ? "ok" : "warn");
      setPick([]);
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function deleteAll() {
    const list = (rows ?? []).map((r) => r.prNumber);
    if (list.length === 0) return toast.show("WARNING", "ไม่มี PR ในตารางให้ลบ", "warn");
    const by = Object.entries((rows ?? []).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}))
      .map(([s, n]) => `${s} ${n}`)
      .join("  •  ");
    if (!(await dlg.confirm({ title: "DELETE ALL PR", danger: true, message: `ลบ PR ทั้งหมดที่แสดงในตาราง ${list.length} รายการ${key ? `\n(เฉพาะที่ค้นหา "${key}")` : ""}\n${by}\n\nลบแล้วกู้คืนไม่ได้ ยืนยันหรือไม่?` }))) return;
    if (!(await dlg.confirm({ title: "DELETE ALL PR", danger: true, message: `ยืนยันอีกครั้ง: ลบ PR ${list.length} รายการ` }))) return;
    try {
      const r = await api<{ message: string }>("/pr/delete-all", { method: "POST", body: { prNos: list, key } });
      toast.show("Deleted", r.message, "ok");
      clear();
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function exportSelected() {
    if (sel.length === 0) return toast.show("WARNING", "เลือกรายการก่อนครับ", "warn");
    try {
      await download("/pr/export", undefined, { mode: "FILE", prNos: sel, stkId: stk });
      toast.show("Export", "ส่งออกเรียบร้อย", "ok");
      setSel([]);
      load();
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  const lookInput = (label: string, field: string, k: keyof typeof f) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      <input
        className="field"
        list={`dl-${field}`}
        value={f[k]}
        onFocus={() => lookup(field, "")}
        onChange={(e) => {
          setF({ ...f, [k]: e.target.value });
          lookup(field, e.target.value);
        }}
        readOnly={!!viewing}
      />
      <datalist id={`dl-${field}`}>{(look[field] ?? []).map((v) => <option key={v} value={v} />)}</datalist>
    </label>
  );

  const all = rows ?? [];
  const waiting = all.filter((r) => r.status === "Waiting");
  const allSel = all.length > 0 && all.every((r) => sel.includes(r.prNumber));
  const coil = !!stock?.countCoil;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/PR.png"
        title="PURCHASE REQUISITION"
        subtitle={stock ? `STOCK : ${stock.code} • ${stock.name}` : "PR"}
        actions={
          <>
            {meta.hasPrStock && meta.stocks.length > 0 && (
              <MenuSelect
                className="w-[190px]"
                label="STOCK"
                value={stk == null ? "" : String(stk)}
                options={meta.stocks.map((s) => ({ value: String(s.stkId), label: s.code }))}
                onChange={(x) => {
                  const v = Number(x);
                  setStk(v);
                  clear();
                  api("/pr/stock", { method: "POST", body: v }).catch(() => {});
                }}
              />
            )}
            <ActionMenu
              caption={["PR", can.deleteAll ? "APPROVE · EXPORT · DELETE" : "APPROVE · EXPORT"]}
              fab={
                <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M8 4h8l3 3v13H5V4zM9 12.5l2 2 4-4.5" />
                </svg>
              }
              label="เมนู PR"
              actions={[
                {
                  key: "approved",
                  title: "APPROVED LIST",
                  detail: "รายการ PR ที่อนุมัติแล้ว ดูย้อนหลัง / ค้นหา / ส่งออก",
                  color: "#16a34a",
                  icon: "approve" as const,
                  onClick: () => setApprovedOpen(true),
                },
                ...(can.approve
                  ? [
                      {
                        key: "export",
                        title: `EXPORT${sel.length > 0 ? ` (${sel.length})` : ""}`,
                        detail: "ส่งออก PR ที่ติ๊กเลือกไว้ในรายการเป็นไฟล์ Excel",
                        color: "#0284c7",
                        icon: "export" as const,
                        onClick: exportSelected,
                      },
                    ]
                  : []),
                ...(can.deleteAll
                  ? [
                      {
                        key: "delete",
                        title: "DELETE ALL",
                        detail: "ลบ PR ทั้งหมดของคลังนี้ (เฉพาะ Admin) มีหน้าต่างยืนยันก่อนลบ",
                        color: "#dc2626",
                        icon: "delete" as const,
                        onClick: deleteAll,
                      },
                    ]
                  : []),
              ]}
            />
          </>
        }
      />
      {meta.noStockText && <div className="rounded-xl bg-[#fff3e0] p-3 text-sm font-bold text-warning">{meta.noStockText}</div>}

      <div className="flex flex-col gap-4">
        {/* ฟอร์ม PR อยู่ด้านบนแบบ WPF: แถว 1 = DATE · REQUESTER · PRODUCT CODE · PRODUCT NAME · QTY / แถว 2 = DEPARTMENT · REMARK · TARGET DEPT · ปุ่ม */}
        <Card
          title={viewing ? `👁 ${viewing.prNumber}` : "＋ NEW PR"}
          bodyClass="grid grid-cols-1 gap-3 p-4 min-[480px]:grid-cols-2 md:grid-cols-3 md:p-5 xl:grid-cols-5"
          clip={false}
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">PR DATE</span>
            <input className="field bg-surface-2" readOnly value={viewing?.date ?? meta.today} />
          </label>
          {lookInput("REQUESTER", "REQUESTER", "requester")}
          <div className="relative">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">PRODUCT CODE</span>
            <input
              className="field"
              value={viewing ? viewing.partCode : code}
              readOnly={!!viewing}
              onChange={(e) => {
                setCode(e.target.value);
                if (part && part.code.toLowerCase() !== e.target.value.trim().toLowerCase()) setPart(null);
              }}
              placeholder="พิมพ์รหัสแล้วเลือกจากรายการ"
            />
            {!viewing && !part && opts.length > 0 && (
              <div className="absolute z-30 mt-1 max-h-64 w-[min(360px,80vw)] overflow-auto rounded-xl border border-line bg-surface shadow-xl">
                {opts.map((o) => (
                  <button
                    key={o.partId}
                    type="button"
                    className="block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-surface-2"
                    onClick={() => {
                      setPart(o);
                      setCode(o.code);
                      setOpts([]);
                    }}
                  >
                    <div className="text-sm font-extrabold text-primary">
                      {o.code} {o.inStock && <Badge color="var(--success)">IN STOCK</Badge>}
                    </div>
                    <div className="truncate text-xs">{o.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">PRODUCT NAME</span>
            <input className="field bg-surface-2" readOnly value={viewing ? viewing.partName : part?.name ?? ""} title={viewing ? viewing.partName : part?.name ?? ""} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">QTY</span>
            <input className="field" inputMode="numeric" readOnly={!!viewing} value={viewing ? String(viewing.qty) : qtyText} onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ""))} />
          </label>
          {lookInput("DEPARTMENT", "DEPT", "dept")}
          <div className="md:col-span-1 xl:col-span-2">{lookInput("REMARK", "REMARK", "remark")}</div>
          {lookInput("TARGET DEPT", "TARGET", "target")}
          <div className="flex items-end gap-2 min-[480px]:col-span-2 md:col-span-3 xl:col-span-1">
            {can.submit && !viewing && (
              <button className="cta-btn is-green flex-1" disabled={busy || (meta.hasPrStock && !stock)} onClick={submit}>
                SUBMIT PR
              </button>
            )}
          </div>
        </Card>

        <Card
          title={`PR LIST • ${all.length.toLocaleString()}`}
        >
          {mode && (
            <div className={`mng-bar ${mode === "APPROVE" ? "is-add" : "is-adj"}`} style={mode === "REJECT" ? ({ "--c": "#dc2626" } as React.CSSProperties) : undefined} role="status">
              <span className="mng-bar-ic" aria-hidden>
                {mode === "APPROVE" ? "✔" : "✕"}
              </span>
              <div className="min-w-0 flex-1">
                <b>{mode} PR • เลือกแล้ว {pick.length.toLocaleString()} รายการ</b>
                <span>ติ๊กเลือก PR สถานะ Waiting ที่ต้องการ แล้วกดปุ่ม {mode} ด้านขวา</span>
              </div>
              <button
                type="button"
                className={`cta-btn is-sm ${mode === "APPROVE" ? "is-green" : "is-red"}`}
                disabled={pick.length === 0}
                onClick={() => (mode === "APPROVE" ? setApprove(all.filter((r) => pick.includes(r.prNumber))) : rejectPicked())}
              >
                {mode} ({pick.length})
              </button>
              <button type="button" className="fill-btn is-xs" onClick={() => (setMode(""), setPick([]))}>
                ✕ EXIT
              </button>
            </div>
          )}
          <div className="border-b border-line/60 p-3">
            <SearchBox value={key} onChange={setKey} placeholder="ค้นหา PR NO / รหัส / ชื่อสินค้า / ผู้ขอ" />
          </div>
          <div className="max-h-[calc(100dvh-280px)] min-h-[360px] overflow-auto">
            {!rows ? (
              <Loading />
            ) : all.length === 0 ? (
              <Empty />
            ) : (
              <table className="data-table t-center w-full">
                <thead className="sticky top-0">
                  <tr>
                    {mode && (
                      <th>
                        <input type="checkbox" aria-label="SELECT ALL WAITING" checked={waiting.length > 0 && waiting.every((r) => pick.includes(r.prNumber))} onChange={(e) => setPick(e.target.checked ? waiting.map((r) => r.prNumber) : [])} />
                      </th>
                    )}
                    <th>
                      <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? all.map((r) => r.prNumber) : [])} />
                    </th>
                    <th>PR NO</th>
                    <th>DATE</th>
                    <th>PRODUCT</th>
                    {coil && <th>MASTER COIL</th>}
                    {coil && <th>NUMBER COIL</th>}
                    <th className="text-right">QTY</th>
                    <th>STATUS</th>
                    <th>REQUESTER</th>
                    <th>DEPARTMENT</th>
                    <th className="text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((p) => (
                    <tr key={p.prNumber} className={viewing?.prNumber === p.prNumber ? "bg-accent-soft/40" : ""}>
                      {mode && (
                        <td>
                          {p.status === "Waiting" && <input type="checkbox" aria-label={`SELECT ${p.prNumber}`} checked={pick.includes(p.prNumber)} onChange={(e) => setPick((s) => (e.target.checked ? [...s, p.prNumber] : s.filter((x) => x !== p.prNumber)))} />}
                        </td>
                      )}
                      <td>
                        <input type="checkbox" checked={sel.includes(p.prNumber)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.prNumber] : s.filter((x) => x !== p.prNumber)))} />
                      </td>
                      <td className="whitespace-nowrap font-extrabold text-primary">{p.prNumber}</td>
                      <td className="whitespace-nowrap text-xs">{p.date}</td>
                      <td>
                        <div>{p.partCode}</div>
                        <div className="text-[11px] font-medium text-ink-soft">{p.partName}</div>
                      </td>
                      {coil && <td className="text-xs">{p.motherCoil}</td>}
                      {coil && <td className="text-xs">{p.coilNo}</td>}
                      <td className="whitespace-nowrap text-right">
                        {p.qty.toLocaleString()} <span className="text-[11px] text-ink-soft">{p.unit}</span>
                      </td>
                      <td>
                        <Badge color={STATUS_COLOR[p.status] ?? "var(--primary)"}>{p.status}</Badge>
                      </td>
                      <td className="whitespace-nowrap">{p.requester}</td>
                      <td className="max-w-[200px] truncate text-xs" title={p.department}>
                        {p.department}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <RowAction kind="view" active={viewing?.prNumber === p.prNumber} onClick={() => (viewing?.prNumber === p.prNumber ? clear() : (setViewing(p), setF({ requester: p.requester, dept: p.department, remark: p.remark, target: p.targetDept })))} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {can.approve && (
        <PrDock
          stockCode={stock?.code ?? "PR"}
          mode={mode}
          onPick={(m) => {
            setPick([]);
            setMode((cur) => (cur === m ? "" : m));
          }}
        />
      )}
      {approve && (
        <ApproveModal
          prs={approve}
          onClose={() => setApprove(null)}
          onDone={(msg, allOk) => {
            setApprove(null);
            setPick([]);
            toast.show("Approved", msg, allOk ? "ok" : "warn");
            load();
          }}
        />
      )}
      {approvedOpen && (
        <ApprovedModal
          stock={stock}
          can={can}
          onClose={(changed) => {
            setApprovedOpen(false);
            if (changed) load();
          }}
        />
      )}
    </PageBody>
  );
}

// ✔ APPROVE many (PRApproveWindow): each row = full qty by default, edit the qty to approve less · remainder = new PR (Waiting) or not kept
function ApproveModal({ prs, onClose, onDone }: { prs: Pr[]; onClose: () => void; onDone: (msg: string, allOk: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [qs, setQs] = useState<Record<string, string>>(() => Object.fromEntries(prs.map((p) => [p.prNumber, String(p.qty)])));
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const qtyOf = (p: Pr) => Number(qs[p.prNumber]);
  const valid = (p: Pr) => Number.isInteger(qtyOf(p)) && qtyOf(p) > 0 && qtyOf(p) <= p.qty;
  const partial = prs.filter((p) => valid(p) && qtyOf(p) < p.qty);

  async function confirm() {
    const bad = prs.find((p) => !valid(p));
    if (bad) return toast.show("WARNING", `${bad.prNumber}: กรุณากรอกยอดที่อนุมัติ 1 - ${bad.qty.toLocaleString()}`, "warn");
    const msg = `อนุมัติ ${prs.length.toLocaleString()} รายการ` + (partial.length ? `\n${partial.length} รายการอนุมัติไม่เต็มยอด · ยอดที่เหลือ${keep ? "จะสร้างเป็น PR ใหม่ (Waiting)" : "ไม่เก็บไว้"}` : "") + "\n\nยืนยันการอนุมัติหรือไม่?";
    if (!(await dlg.confirm({ title: "CONFIRM APPROVE", message: msg, ok: "APPROVE" }))) return;
    setBusy(true);
    try {
      const r = await api<{ failed: number; message: string }>("/pr/approve-batch", { method: "POST", body: { items: prs.map((p) => ({ prNo: p.prNumber, qty: qtyOf(p), keepRemainder: keep })) } });
      onDone(r.message, r.failed === 0);
    } catch (e) {
      toast.show("ERROR", "อนุมัติไม่สำเร็จ: " + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`✔ APPROVE • ${prs.length.toLocaleString()} PR`}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" disabled={busy} onClick={confirm}>
            ✔ CONFIRM
          </button>
        </>
      }
    >
      <div className="max-h-[50vh] overflow-auto">
        <table className="data-table t-center w-full">
          <thead>
            <tr>
              <th>PR NO</th>
              <th>PRODUCT</th>
              <th className="text-right">REQUESTED</th>
              <th>APPROVE QTY</th>
            </tr>
          </thead>
          <tbody>
            {prs.map((p) => (
              <tr key={p.prNumber}>
                <td className="whitespace-nowrap font-extrabold text-primary">{p.prNumber}</td>
                <td>
                  <div>{p.partCode}</div>
                  <div className="text-[11px] font-medium text-ink-soft">{p.partName}</div>
                </td>
                <td className="whitespace-nowrap text-right">
                  {p.qty.toLocaleString()} <span className="text-[11px] text-ink-soft">{p.unit}</span>
                </td>
                <td>
                  <input
                    className={`field w-28 ${valid(p) ? "" : "border-danger"}`}
                    inputMode="numeric"
                    aria-label={`APPROVE QTY ${p.prNumber}`}
                    value={qs[p.prNumber]}
                    onChange={(e) => setQs((s) => ({ ...s, [p.prNumber]: e.target.value.replace(/\D/g, "") }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {partial.length > 0 && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          <div className="mb-2 font-extrabold">REMAINING : {partial.length.toLocaleString()} รายการอนุมัติไม่เต็มยอด</div>
          <label className="mb-1 flex items-center gap-2 font-bold">
            <input type="radio" checked={keep} onChange={() => setKeep(true)} /> KEEP AS NEW PR (Waiting)
          </label>
          <label className="flex items-center gap-2 font-bold">
            <input type="radio" checked={!keep} onChange={() => setKeep(false)} /> DON&apos;T KEEP
          </label>
        </div>
      )}
    </Modal>
  );
}
