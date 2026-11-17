"use client";

import { RowAction } from "@/components/button-action/RowAction";
import { DrawIcon } from "@/components/icons/DrawIcon";
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
  const [approve, setApprove] = useState<Pr | null>(null);
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

  async function reject(p: Pr) {
    if (!(await dlg.confirm({ title: "ยืนยัน", danger: true, ok: "REJECT", message: `คุณต้องการ Reject รายการ ${p.prNumber} ใช่หรือไม่?` }))) return;
    try {
      await api(`/pr/${encodeURIComponent(p.prNumber)}/reject`, { method: "POST" });
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
            <button className="cta-btn flex-1" onClick={() => setApprovedOpen(true)}>
              APPROVED LIST
            </button>
          </div>
        </Card>

        <Card
          title={`PR LIST • ${all.length.toLocaleString()}`}
        >
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
                          {can.approve && p.status === "Waiting" && (
                            <>
                              <button className="cta-btn is-green is-sm act-draw" onClick={() => setApprove(p)}>
                                <DrawIcon kind="approve" /> APPROVE
                              </button>
                              <button className="cta-btn is-red is-sm act-draw" onClick={() => reject(p)}>
                                <DrawIcon kind="reject" /> REJECT
                              </button>
                            </>
                          )}
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

      {approve && (
        <ApproveModal
          pr={approve}
          onClose={() => setApprove(null)}
          onDone={(msg) => {
            setApprove(null);
            toast.show("Approved", msg, "ok");
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

// ✔ APPROVE (PRApproveWindow): อนุมัติทั้งหมด / กำหนดยอด - ยอดที่เหลือสร้าง PR ใหม่ (Waiting) หรือไม่เก็บ
function ApproveModal({ pr, onClose, onDone }: { pr: Pr; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [mode, setMode] = useState<"ALL" | "SET">("ALL");
  const [q, setQ] = useState(String(pr.qty));
  const [keep, setKeep] = useState(true);
  const n = mode === "ALL" ? pr.qty : Number(q);
  const partial = Number.isInteger(n) && n > 0 && n < pr.qty;

  async function confirm() {
    if (!Number.isInteger(n) || n <= 0 || n > pr.qty) return toast.show("WARNING", `กรุณากรอกยอดที่อนุมัติ 1 - ${pr.qty.toLocaleString()}`, "warn");
    const msg =
      `อนุมัติ ${pr.prNumber}\n${pr.partName}\n\nยอดที่อนุมัติ ${n.toLocaleString()} จาก ${pr.qty.toLocaleString()} ${pr.unit}` +
      (partial ? (keep ? `\nยอดที่เหลือ ${(pr.qty - n).toLocaleString()} จะสร้างเป็น PR ใหม่ (Waiting)` : `\nยอดที่เหลือ ${(pr.qty - n).toLocaleString()} ไม่เก็บไว้`) : "") +
      "\n\nยืนยันการอนุมัติหรือไม่?";
    if (!(await dlg.confirm({ title: "CONFIRM APPROVE", message: msg, ok: "APPROVE" }))) return;
    try {
      const r = await api<{ message: string }>(`/pr/${encodeURIComponent(pr.prNumber)}/approve`, { method: "POST", body: { qty: n, keepRemainder: partial && keep } });
      onDone(r.message);
    } catch (e) {
      toast.show("ERROR", "อนุมัติไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  return (
    <Modal
      open
      title={`✔ APPROVE • ${pr.prNumber}`}
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" onClick={confirm}>
            ✔ CONFIRM
          </button>
        </>
      }
    >
      <div className="mb-1 font-bold">{pr.partName}</div>
      <div className="mb-4 text-sm text-ink-soft">
        REQUESTED : {pr.qty.toLocaleString()} {pr.unit}
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm font-bold">
        <input type="radio" checked={mode === "ALL"} onChange={() => setMode("ALL")} /> APPROVE ALL ({pr.qty.toLocaleString()})
      </label>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="radio" checked={mode === "SET"} onChange={() => setMode("SET")} /> SET QTY
        <input className="field ml-2 w-28" inputMode="numeric" disabled={mode !== "SET"} value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ""))} />
        <span className="text-ink-soft">{pr.unit}</span>
      </label>
      {partial && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          <div className="mb-2 font-extrabold">
            REMAINING : {(pr.qty - n).toLocaleString()} {pr.unit} (approve {n.toLocaleString()} of {pr.qty.toLocaleString()})
          </div>
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
