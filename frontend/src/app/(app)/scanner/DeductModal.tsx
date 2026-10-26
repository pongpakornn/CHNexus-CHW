"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { DateRange } from "@/components/ui/DateRange";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, SearchBox } from "@/components/ui/Page";
import { PartPicker, type PartOption } from "@/components/ui/PartPicker";
import { api, download } from "@/lib/api";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { daysAgo, parseNum, qty, today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";

type Row = {
  missId: number;
  date: string;
  coilNo: string;
  motherCoil: string;
  partId: number | null;
  partCode: string;
  partName: string;
  hasProduct: boolean;
  stockId: number;
  stockCode: string;
  sourceCode: string;
  labelQty: number;
  deducted: number;
  reasonText: string;
  status: string;
  statusText: string;
  isPending: boolean;
  userId: string;
  barcode: string;
  motherNow: number | null;
  motherNowText: string;
  sourcePartCode: string;
  sourcePartName: string;
  sourceAfter: number | null;
  how: string;
  motherBefore: number | null;
};

// ⚠ NOT DEDUCTED / ✔ DEDUCTED (DeductMissWindow)
export function DeductModal({ deducted, onClose, onChanged }: { deducted: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(deducted ? today() : daysAgo(60));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [canAct, setCanAct] = useState(false);
  const [stocks, setStocks] = useState<RegStock[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [reg, setReg] = useState<Row | null>(null);
  const k = useDebounced(key, 250);

  const load = useCallback(async () => {
    try {
      const r = await api<{ canAct: boolean; stocks?: RegStock[]; rows: Row[] }>("/scanner/deduct", { query: { deducted, key: k, from, to } });
      setStocks(r.stocks ?? []);
      setRows(r.rows);
      setCanAct(r.canAct);
      setSel((s) => s.filter((id) => r.rows.some((x) => x.missId === id)));
    } catch (e) {
      toast.show(deducted ? "Deducted" : "Not deducted", "โหลดรายการไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }, [deducted, k, from, to, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const status = useMemo(() => {
    const list = rows ?? [];
    return deducted
      ? `${list.length.toLocaleString()} LABELS • CUT FROM SOURCE ${qty(list.reduce((a, r) => a + r.deducted, 0))} KG • BY MASTER COIL ${list.filter((r) => r.how === "MASTER COIL").length} • NOT CUT YET ${list.filter((r) => r.how === "NONE").length}`
      : `${list.length.toLocaleString()} LABELS • WAITING ${list.filter((r) => r.isPending).length} (${qty(list.filter((r) => r.isPending).reduce((a, r) => a + r.labelQty, 0))} KG NOT IN STOCK) • NO PD CODE ${list.filter((r) => !r.hasProduct).length} • MASTER COIL NOW IN SOURCE ${list.filter((r) => r.motherNow !== null).length}`;
  }, [rows, deducted]);

  async function exportRows() {
    try {
      await download("/scanner/deduct/export", undefined, { deducted, key: k, from, to, ids: sel });
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function approve(r: Row) {
    if (!r.hasProduct) return toast.show("WARNING", "ยังไม่มี PD CODE ของป้ายนี้ในระบบ\nกด ＋ PRODUCT เพื่อลงทะเบียนสินค้าก่อน", "warn");
    const what = r.status === "RECEIVED" ? `รายการเดิม: รับเข้า ${r.stockCode} ไปแล้ว\nAPPROVE = ตัด ${r.sourceCode} ตามหลัง` : `รับเข้า ${r.stockCode}  ${r.partCode}  ${qty(r.labelQty)}`;
    const cut = r.motherNow !== null ? `ตัด Master Coil ${r.motherCoil} ใน ${r.sourceCode} (มี ${qty(r.motherNow)} KG)` : `Master Coil ${r.motherCoil} ยังไม่มีใน ${r.sourceCode} • ยังไม่ตัด`;
    if (!(await dlg.confirm({ title: "APPROVE", message: `${what}\nCoil ${r.coilNo}\n\n${cut}\n\nยืนยัน APPROVE หรือไม่?`, ok: "✔ APPROVE" }))) return;
    await act(() => api<{ message: string }>(`/scanner/deduct/${r.missId}/approve`, { method: "POST" }), "Approved");
  }

  async function remove(r: Row) {
    const extra =
      r.status === "RECEIVED"
        ? `\n\nรายการเดิมนี้รับเข้า ${r.stockCode} ไปแล้ว ${qty(r.labelQty)}\nลบ = ยกเลิกรายการสแกนนั้น ยอด ${r.stockCode} ลดลงตามป้าย`
        : "\n\nป้ายนี้ยังไม่ได้เข้าคลัง - ลบแล้วไม่มีการบันทึกเข้าคลังใดๆ";
    if (
      !(await dlg.confirm({
        title: "DELETE",
        danger: true,
        ok: "🗑 DELETE",
        message: `ต้องการลบรายการนี้จริงๆ ใช่หรือไม่?\n\n${r.partCode}  ${r.partName}\nCoil ${r.coilNo}  •  Master ${r.motherCoil}  •  ${qty(r.labelQty)}${extra}\n\nลบแล้วกู้คืนไม่ได้`,
      }))
    )
      return;
    await act(() => api<{ message: string }>(`/scanner/deduct/${r.missId}`, { method: "DELETE" }), "Deleted");
  }

  async function act(fn: () => Promise<{ message: string }>, title: string) {
    setBusy(true);
    try {
      const r = await fn();
      toast.show(title, r.message, "ok");
      onChanged();
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const all = rows ?? [];
  const allSel = all.length > 0 && sel.length === all.length;

  return (
    <>
      <Modal
        open
        size="xl"
        title={deducted ? "✔ DEDUCTED" : "⚠ NOT DEDUCTED"}
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-xs font-bold text-ink-soft">
              {status} • {sel.length} SELECTED{!deducted && !canAct ? " • ACTION = APPROVE of Multi-Scanner" : ""}
            </span>
            <button className="btn bg-success" onClick={exportRows} disabled={all.length === 0}>
              📤 EXPORT {sel.length > 0 ? `(${sel.length})` : ""}
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm font-semibold text-ink-soft">
          {deducted
            ? "What came in (PD CODE / coil) and what was cut from the source stock (source product / master coil before / source balance)"
            : "ป้ายที่ยังไม่รับเข้าคลัง (รอดำเนินการ) — APPROVE รับเข้า / ＋ PRODUCT ลงทะเบียนแล้วรับเข้า / DEL ลบ"}
        </p>
        <div className="relative z-20 mb-3 flex flex-wrap items-center gap-3">
          <SearchBox className="min-w-[240px] flex-1" fancy value={key} onChange={setKey} placeholder="ค้นหา Coil / Master Coil / PD CODE / ผู้สแกน" />
          <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        </div>
        {!rows ? (
          <Loading />
        ) : (
          <div className="overflow-auto rounded-2xl border border-[#e7e4ef]">
            <table className="data-table hist-table w-full">
              <thead className="sticky top-0 z-[1]">
                <tr>
                  <th>
                    <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? all.map((r) => r.missId) : [])} />
                  </th>
                  <th>DATE</th>
                  <th>STOCK</th>
                  <th>PD CODE</th>
                  <th>COIL NO</th>
                  <th>MASTER COIL</th>
                  <th className="text-right">QTY</th>
                  {deducted ? (
                    <>
                      <th className="text-right">CUT</th>
                      <th>SOURCE PRODUCT</th>
                      <th className="text-right">MASTER BEFORE</th>
                      <th className="text-right">SOURCE AFTER</th>
                    </>
                  ) : (
                    <>
                      <th>STATUS</th>
                      <th>MASTER COIL NOW</th>
                    </>
                  )}
                  <th>USER</th>
                  {canAct && <th>ACTION</th>}
                </tr>
              </thead>
              <tbody>
                {all.map((r, i) => (
                  <tr key={r.missId} className={`sc-row ${sel.includes(r.missId) ? "!bg-[#f3eefd]" : ""}`} style={{ animationDelay: `${Math.min(i, 20) * 14}ms` }}>
                    <td>
                      <input type="checkbox" checked={sel.includes(r.missId)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.missId] : s.filter((x) => x !== r.missId)))} />
                    </td>
                    <td className="h-date whitespace-nowrap text-xs font-bold text-ink-soft">{r.date}</td>
                    <td>
                      <span className="sc-tag whitespace-nowrap">{r.stockCode}</span> <span className="whitespace-nowrap text-xs font-bold text-ink-soft">← {r.sourceCode}</span>
                    </td>
                    <td className="min-w-[150px]">
                      <div className={`whitespace-nowrap font-extrabold ${r.hasProduct ? "text-primary" : "text-danger"}`}>{r.partCode}</div>
                      <div className="text-[11px] font-medium text-ink-soft">{r.partName}</div>
                    </td>
                    <td className="whitespace-nowrap">{r.coilNo}</td>
                    <td className="whitespace-nowrap">{r.motherCoil}</td>
                    <td className="font-extrabold tabular-nums">{qty(r.labelQty)}</td>
                    {deducted ? (
                      <>
                        <td className="font-extrabold tabular-nums text-danger">{qty(r.deducted)}</td>
                        <td className="min-w-[160px]">
                          <div>{r.sourcePartCode || (r.how === "NONE" ? <Badge color="var(--warning)">NOT CUT YET</Badge> : "-")}</div>
                          <div className="text-[11px] font-medium text-ink-soft">{r.sourcePartName}</div>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{r.motherBefore !== null ? `${qty(r.motherBefore)} KG` : "-"}</td>
                        <td className="tabular-nums">{qty(r.sourceAfter)}</td>
                      </>
                    ) : (
                      <>
                        <td className="min-w-[150px]">
                          <div className="text-xs font-bold">{r.statusText}</div>
                          <div className="text-[11px] font-medium text-danger">{r.reasonText}</div>
                        </td>
                        <td className="whitespace-nowrap">
                          <Badge color={r.motherNow !== null ? "var(--success)" : "var(--ink-soft)"}>{r.motherNowText}</Badge>
                        </td>
                      </>
                    )}
                    <td>{r.userId}</td>
                    {canAct && (
                      <td className="whitespace-nowrap">
                        {/* ปุ่มเรียงตั้ง: คอลัมน์แคบ ตารางพอดีจอ Mac / iPad */}
                        <div className="flex flex-col items-stretch gap-1">
                          <button className="btn bg-success px-2 py-1 text-xs" disabled={busy} onClick={() => approve(r)}>
                            ✔ APPROVE
                          </button>
                          {r.status !== "RECEIVED" && (
                            <button className="btn bg-info px-2 py-1 text-xs" disabled={busy} onClick={() => setReg(r)}>
                              ＋ PRODUCT
                            </button>
                          )}
                          <button className="btn bg-danger px-2 py-1 text-xs" disabled={busy} onClick={() => remove(r)}>
                            🗑 DEL
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {all.length === 0 && <Empty>{deducted ? "NO DEDUCTION IN THIS RANGE" : "NO LABEL WAITING"}</Empty>}
          </div>
        )}
      </Modal>
      {reg && (
        <RegisterModal
          row={reg}
          stocks={stocks}
          onClose={() => setReg(null)}
          onDone={async (msg) => {
            setReg(null);
            await dlg.alert({ title: "REGISTER & RECEIVE", message: msg });
            onChanged();
            await load();
          }}
        />
      )}
    </>
  );
}

type RegStock = { stkId: number; code: string; name: string; countCoil: boolean };

// ＋ PRODUCT: เลือกคลังที่รับเข้า + สินค้า (เลือกจากรายการ หรือกรอก PRODUCT CODE + NAME) แล้วรับเข้าตามป้าย - MAX / MIN / STOCK ไม่บังคับ
//   กรอก CODE ที่มีอยู่แล้ว = ใช้สินค้านั้น (ชื่อต่าง = แก้ชื่อให้) · ยังไม่มี = ลงทะเบียนใหม่ให้เลย (แบบหน้า Inventory Registration)
function RegisterModal({ row, stocks, onClose, onDone }: { row: Row; stocks: RegStock[]; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [part, setPart] = useState<PartOption | null>(null);
  const [stk, setStk] = useState(row.stockId);
  const [mode, setMode] = useState<"PICK" | "CODE">("PICK");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pack, setPack] = useState("");
  const stockCode = stocks.find((s) => s.stkId === stk)?.code ?? row.stockCode;
  const [master, setMaster] = useState(row.motherCoil ?? "");
  const [coil, setCoil] = useState(row.coilNo ?? "");
  const [f, setF] = useState({ max: "", min: "", coilCount: "", qty: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (mode === "PICK" && !part) return toast.show("WARNING", "กรุณาเลือกสินค้า (ค้นหา PD CODE / ชื่อสินค้า)", "warn");
    if (mode === "CODE" && !code.trim()) return toast.show("WARNING", "กรุณากรอก PRODUCT CODE", "warn");
    if (mode === "CODE" && pack.trim() && !/^\d+$/.test(pack.trim())) return toast.show("WARNING", "PACKSIZE ต้องเป็นตัวเลข", "warn");
    const pcode = mode === "PICK" ? part!.partCode : code.trim();
    const v = { max: parseNum(f.max), min: parseNum(f.min), coilCount: parseNum(f.coilCount), qty: parseNum(f.qty) };
    if (Object.values(v).some((x) => x !== null && (Number.isNaN(x) || x < 0))) return toast.show("WARNING", "MAX / MIN / STOCK ต้องเป็นตัวเลข (เว้นว่างได้)", "warn");
    const q = v.qty ?? row.labelQty;
    const cut = row.motherNow !== null ? `ตัด Master Coil ${master} ใน ${row.sourceCode} (มี ${qty(row.motherNow)} KG)` : `Master Coil ${master} ยังไม่มีใน ${row.sourceCode} (รับเข้าอย่างเดียว)`;
    const ok = await dlg.confirm({
      title: "REGISTER & RECEIVE",
      message:
        `รับเข้า ${stockCode}\n${pcode}${mode === "CODE" && name.trim() ? ` • ${name.trim()}` : ""}\nจำนวน ${qty(q)}` +
        (v.coilCount !== null ? `  •  ${v.coilCount} Coil` : "") +
        (v.max !== null || v.min !== null ? `\nMAX ${qty(v.max)} / MIN ${qty(v.min)}` : "") +
        `\n\n${cut}\n\nยืนยันหรือไม่?`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/scanner/deduct/${row.missId}/register`, {
        method: "POST",
        body: { partId: mode === "PICK" ? part!.partId : 0, partCode: mode === "CODE" ? code.trim() : null, partName: mode === "CODE" ? name.trim() : null, packSize: mode === "CODE" ? pack.trim() : null, stkId: stk, masterCoil: master, coilNo: coil, ...v },
      });
      onDone(`${pcode}\n${r.message}`);
    } catch (e) {
      toast.show("ERROR", "บันทึกไม่สำเร็จ\n" + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, k: keyof typeof f) => (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">{label}</span>
      <input className="field" inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );

  return (
    <Modal
      open
      title="＋ PRODUCT • REGISTER & RECEIVE"
      onClose={onClose}
      footer={
        <>
          <button className="fill-btn" onClick={onClose}>
            CANCEL
          </button>
          <button className="cta-btn is-green" onClick={save} disabled={busy}>
            {busy ? "⏳ SAVING..." : "REGISTER & RECEIVE"}
          </button>
        </>
      }
    >
      <div className="mb-3 rounded-2xl border border-[#ebe7f4] bg-[linear-gradient(145deg,#faf9fd,#f3f0fa)] p-3 text-xs font-semibold">
        <div>
          {row.date} • {row.userId} • {row.reasonText}
        </div>
        <div className="mt-1 break-all font-mono">{row.barcode}</div>
        <div className="mt-2 font-extrabold text-primary">
          RECEIVE INTO {stockCode} • CUT {row.sourceCode}
        </div>
        <div>{row.motherNow !== null ? `Master coil ${row.motherCoil} now in ${row.sourceCode}: ${qty(row.motherNow)} KG` : `Master coil ${row.motherCoil} is not in ${row.sourceCode} yet`}</div>
      </div>
      {/* คลังที่รับเข้า */}
      <div className="mb-4 grid gap-1">
        <span className="text-xs font-extrabold uppercase text-ink-soft">RECEIVE INTO STOCK</span>
        <MenuSelect compact value={String(stk)} options={(stocks.length ? stocks : [{ stkId: row.stockId, code: row.stockCode, name: "", countCoil: true }]).map((s) => ({ value: String(s.stkId), label: s.code, title: s.name }))} onChange={(v) => (setStk(Number(v)), setPart(null))} />
      </div>
      {/* สินค้า: เลือกจากรายการ / กรอก PRODUCT CODE + NAME */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-extrabold uppercase text-ink-soft">PRODUCT</span>
        <span className="ml-auto" />
        <button type="button" className={`fill-btn is-xs ${mode === "PICK" ? "is-on" : ""}`} onClick={() => setMode("PICK")}>
          เลือกจากรายการ
        </button>
        <button type="button" className={`fill-btn is-xs ${mode === "CODE" ? "is-on" : ""}`} onClick={() => setMode("CODE")}>
          กรอก CODE + NAME
        </button>
      </div>
      {mode === "PICK" ? (
        <>
          <PartPicker key={stk} value={part} onChange={setPart} stkId={stk} />
          <p className="mt-1 text-xs text-ink-soft">ไม่มีในรายการ: กด &quot;กรอก CODE + NAME&quot; เพื่อลงทะเบียนสินค้าใหม่ได้เลย</p>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr_110px]">
            <label className="block">
              <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">PRODUCT CODE *</span>
              <input className="field" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">PRODUCT NAME</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">PACKSIZE</span>
              <input className="field" inputMode="numeric" value={pack} onChange={(e) => setPack(e.target.value.replace(/\D/g, ""))} />
            </label>
          </div>
          <p className="mt-1 text-xs text-ink-soft">PRODUCT CODE มีในระบบแล้ว = ใช้สินค้านั้น (กรอกชื่อใหม่ = แก้ชื่อให้) · ยังไม่มี = ลงทะเบียนใหม่ (ต้องกรอก PRODUCT NAME) แล้วเพิ่มเข้าคลัง {stockCode}</p>
        </>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">MASTER COIL</span>
          <input className="field" value={master} onChange={(e) => setMaster(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">COIL NO</span>
          <input className="field" value={coil} onChange={(e) => setCoil(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 text-xs font-extrabold uppercase text-primary">{stockCode} • MAX / MIN / STOCK (optional)</div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {field("MAX", "max")}
        {field("MIN", "min")}
        {field("STOCK COIL", "coilCount")}
        {field("STOCK (QTY)", "qty")}
      </div>
      <p className="mt-2 text-xs text-ink-soft">Blank = as the label: {qty(row.labelQty)} / 1 coil. The amount received is cut from master coil in {row.sourceCode} when it is there.</p>
    </Modal>
  );
}
