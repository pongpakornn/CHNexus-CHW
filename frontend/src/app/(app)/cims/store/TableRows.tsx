"use client";

import { Fragment, memo, useState } from "react";
import { Loading } from "@/components/layout/Page";
import { StatusLamp } from "./StatusLamp";
import { STATUS_COLOR, type Product } from "./types";
import { AddCoilButton, CoilActions, HideButton, type CoilAct, type ManageMode } from "./CoilManageButtons";

export type CoilRow = { coilId: number; partId: number; isMother: boolean; no: string; coilNo: string; motherCoil: string; weight: string; ton: string; received: string; remark?: string | null };
export type Field = "max" | "min" | "qty" | "stockBox" | "stockPcs" | "remark";
export type CoilState = CoilRow[] | "loading";

// ค่าคงที่ของตารางต่อคลัง (เปลี่ยนเฉพาะตอนตั้งค่าคลังเปลี่ยน) - ส่งเป็นอ็อบเจกต์เดียว แถวจะได้ไม่วาดใหม่โดยไม่จำเป็น
export type RowCfg = {
  cols: string[];
  width: number;
  coilKeys: string[];
  coilsOn: boolean;
  rowToggle: boolean;
  unit: string;
  canEdit: boolean;
  isLiveView: boolean;
  /** 🧲 MANAGE STOCK: ADD = ปุ่ม ＋ ที่ PD CODE · ADJUST = ปุ่ม ACTION ที่แถว Coil ลูก */
  manage: ManageMode;
  /** Coil row whose EDIT / ADJUST modal is open (its button shows the red X) */
  coilOpen: { coilId: number; kind: CoilAct } | null;
  /** HIDE mode: PartID being saved (its eye button is disabled) */
  hideBusy: number | null;
};

// คำสั่งจากแถว -> หน้าตาราง (อ็อบเจกต์คงที่ ไม่ทำให้แถววาดใหม่)
export type RowActions = {
  toggle: (p: Product) => void;
  save: (p: Product, f: Field, v: string) => void;
  denied: (f: Field) => void;
  editing: (v: boolean) => void;
  closed: (partId: number) => void;
  opened: (partId: number) => void;
  saveCoilRemark: (r: CoilRow, v: string) => void;
  addCoil: (p: Product) => void;
  coilAct: (a: CoilAct, r: CoilRow) => void;
  hide: (p: Product) => void;
};

const COIL_HEAD: Record<string, string> = { NO: "NO.", COILNO: "NUMBER COIL", MOTHER: "MASTER COIL", COIL: "STOCK (COIL)", TON: "WEIGHT (TON)", RECEIVED: "RECEIVED", REMARK: "REMARK" };
// Master ทั้งม้วน (กรอกแค่ MASTER COIL ไม่มี NUMBER COIL) = ไม่มี Master อ้างถึง -> ช่อง MASTER COIL แสดงเลขของม้วนนั้นเอง
export const masterOf = (r: CoilRow) => (r.motherCoil && r.motherCoil.trim() !== "-" ? r.motherCoil : r.coilNo);
const coilCell = (key: string, r: CoilRow) => ({ NO: r.no, COILNO: r.coilNo, MOTHER: masterOf(r), WEIGHT: r.weight, COIL: "1", TON: r.ton, RECEIVED: r.received })[key] ?? "";

// 📋 แถวสินค้า 1 แถว + แถว Coil ใต้แถว (memo: วาดใหม่เฉพาะเมื่อสินค้านี้ / Coil ของสินค้านี้เปลี่ยน)
export const ProductRow = memo(function ProductRow({
  p,
  no,
  cfg,
  coil,
  closing,
  anim,
  act,
}: {
  p: Product;
  no: number;
  cfg: RowCfg;
  coil?: CoilState;
  closing: boolean;
  anim: boolean;
  act: RowActions;
}) {
  const open = !!coil && !closing;
  const editable = (f: Field) => (f === "remark" ? !cfg.isLiveView : cfg.canEdit);
  const edit = (f: Field, extra: { align?: "right"; strong?: boolean; wide?: boolean; color?: string } = {}) => (
    <Edit
      key={f}
      value={p[f]}
      align={extra.align}
      strong={extra.strong}
      wide={extra.wide}
      color={extra.color}
      disabled={!editable(f)}
      onDenied={() => act.denied(f)}
      onEditing={act.editing}
      onSave={(v) => act.save(p, f, v)}
    />
  );

  const cell = (col: string) => {
    switch (col) {
      case "NO":
        return (
          <td key={col} className="text-center font-bold text-ink-soft">
            {cfg.rowToggle ? (
              <span className="inline-flex items-center gap-2">
                <span className={`row-chev ${open ? "is-open" : ""}`} aria-hidden>
                  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3.5L10.5 8 6 12.5" />
                  </svg>
                </span>
                {no}
              </span>
            ) : (
              no
            )}
          </td>
        );
      case "IMAGE":
        return (
          <td key={col} className="col-img w-20">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" decoding="async" className="h-14 w-14 rounded-lg bg-white object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-line">▣</div>
            )}
          </td>
        );
      case "CODE":
        return (
          <td key={col} className="whitespace-nowrap">
            <button
              className={`flex items-center gap-1.5 font-extrabold ${cfg.coilsOn ? "text-accent hover:underline" : "cursor-default text-primary"} ${p.stockStatus === "NO_CONFIG" ? "!text-[#adb5bd]" : ""}`}
              onClick={() => act.toggle(p)}
              title={cfg.coilsOn ? "กดเพื่อดู Master Coil / Coil ลูก" : undefined}
            >
              {p.partCode}
              {cfg.coilsOn && !cfg.rowToggle && <span className="text-[10px]">{coil ? "▲" : "▼"}</span>}
            </button>
            {cfg.manage === "ADD" && (
              <span className="ml-2 inline-block align-middle">
                <AddCoilButton onClick={() => act.addCoil(p)} />
              </span>
            )}
          </td>
        );
      case "CUSTOMER":
        return <td key={col} className="whitespace-nowrap font-bold">{p.customer}</td>;
      case "PARTA":
        return <td key={col} className="whitespace-nowrap font-bold">{p.partA}</td>;
      case "PARTB":
        return <td key={col} className="whitespace-nowrap font-bold">{p.partB}</td>;
      case "PARTNO":
        return <td key={col} className="whitespace-nowrap font-bold">{p.partNo}</td>;
      case "MODEL":
        return <td key={col} className="whitespace-nowrap font-bold">{p.model}</td>;
      case "NAME":
        return <td key={col} className="col-name min-w-[200px] font-bold">{p.partName}</td>;
      case "SUPPLIER":
        return <td key={col} className="whitespace-nowrap font-bold">{p.supplier}</td>;
      case "CATEGORY":
        return <td key={col} className="whitespace-nowrap font-bold">{p.category}</td>;
      case "PACKSIZE":
        return <td key={col} className="whitespace-nowrap text-right font-bold tabular-nums">{p.packSize}</td>;
      case "BIN":
        return <td key={col} className="whitespace-nowrap font-bold">{p.bin}</td>;
      case "MAXMIN":
        return (
          <Fragment key={col}>
            {edit("max", { align: "right" })}
            {edit("min", { align: "right" })}
          </Fragment>
        );
      case "QTY":
        return edit("qty", { align: "right", strong: true, color: p.stockStatus === "NO_CONFIG" ? undefined : STATUS_COLOR(p.stockStatus) });
      case "BOX":
        return edit("stockBox", { align: "right" });
      case "PCS":
        return edit("stockPcs", { align: "right" });
      case "REMARK":
        return edit("remark", { wide: true });
      case "STATUS":
        return (
          <td key={col} className="w-[90px] text-center align-middle">
            <StatusLamp status={p.stockStatus} size={28} className="align-middle" />
          </td>
        );
      default:
        // ➕ ช่องกรอกเพิ่มเองของคลัง (แก้ค่าได้ที่ Inventory Registration)
        return col.startsWith("CF") ? (
          <td key={col} className="max-w-[220px] break-words font-semibold">
            {p.cf?.[col] || "-"}
          </td>
        ) : (
          <td key={col} />
        );
    }
  };

  return (
    <>
      <tr
        data-pid={p.partId}
        className={`${p.isHidden ? "opacity-45 grayscale" : ""} ${p.stockStatus === "NO_CONFIG" ? "bg-[#f2f4f5] text-[#adb5bd] [&_img]:opacity-25" : ""} ${cfg.rowToggle ? "mat-row cursor-pointer" : ""} ${cfg.rowToggle && open ? "is-open" : ""}`}
        onClick={cfg.rowToggle ? (e) => !(e.target as HTMLElement).closest("input, button, [data-edit]") && act.toggle(p) : undefined}
      >
        {cfg.cols.map(cell)}
        {cfg.manage === "HIDE" && (
          <td className="text-center">
            <HideButton hidden={!!p.isHidden} busy={cfg.hideBusy === p.partId} onClick={() => act.hide(p)} />
          </td>
        )}
      </tr>
      {coil && <CoilPanel partId={p.partId} list={coil} cfg={cfg} closing={closing} anim={anim} act={act} />}
    </>
  );
});

// 🧲 แถว Coil ใต้สินค้า (CoilRowsView): ต่อ Master Coil 1 กลุ่ม = แถบ MASTER COIL (น้ำหนัก + TON + จำนวน) -> หัวคอลัมน์ -> Coil ลูกแถวละ 1 ม้วน
//    กดเปิดเอง = เลื่อนกางลง (anim) · SHOW COILS / เปิดพร้อมกันหลายแถว = แสดงทันที (ไม่เล่นอนิเมชันพร้อมกันหลายร้อยแถว)
//    พับ = เลื่อนพับขึ้น แล้วค่อยเอาแถวออก · กล่องที่อยู่นอกจอไม่ถูกวาด (content-visibility)
function CoilPanel({ partId, list, cfg, closing, anim, act }: { partId: number; list: CoilState; cfg: RowCfg; closing: boolean; anim: boolean; act: RowActions }) {
  const adj = cfg.manage === "ADJUST";
  const span = cfg.coilKeys.length + (adj ? 1 : 0);
  const head = (k: string) => (
    <tr key={"h" + k}>
      {cfg.coilKeys.map((kk) => (
        <td key={kk} className={`h-9 !border-b !border-[#ece8f6] bg-[#faf9fd] !px-1 !py-0 text-center !text-[11.5px] font-extrabold tracking-wide text-[#7a7492] ${kk === "NO" ? "w-[6%]" : ""} ${kk === "REMARK" ? "w-[16%]" : ""}`}>
          {kk === "WEIGHT" ? `WEIGHT (${cfg.unit}.)` : COIL_HEAD[kk] ?? ""}
        </td>
      ))}
      {adj && <td className="h-9 w-[132px] !border-b !border-[#ece8f6] bg-[#faf9fd] !px-1 !py-0 text-center !text-[11.5px] font-extrabold tracking-wide text-[#7a7492]">ACTION</td>}
    </tr>
  );
  return (
    <tr className="hover:!bg-transparent">
      <td colSpan={cfg.width} className="!border-0 !p-0">
        <div
          className={`coil-slide ${anim ? "is-anim" : ""} ${closing ? "is-closing" : ""}`}
          onAnimationEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.animationName === "coil-close") act.closed(partId);
            else if (e.animationName === "coil-open") act.opened(partId);
          }}
        >
          <div>
            <div className="coil-box px-3 pb-3 pt-1">
              <div className="overflow-hidden rounded-2xl border border-[#e4def3] bg-white shadow-[0_10px_26px_-20px_rgb(60_40_130/0.5)]">
                {list === "loading" ? (
                  <Loading compact label="กำลังโหลด Coil…" />
                ) : !list.some((r) => !r.isMother) ? (
                  <div className="py-3.5 text-center text-[13px] font-bold text-ink-soft">ยังไม่มี Coil ในคลังของสินค้านี้ (สแกนรับเข้า หรือ Import COIL LIST)</div>
                ) : (
                  <table className="w-full table-fixed text-[13px]">
                    <tbody>
                      {!list[0]?.isMother && head("top")}
                      {list.map((r, i) =>
                        r.isMother ? (
                          <Fragment key={"m" + r.motherCoil}>
                            <tr>
                              <td colSpan={span} className={`!border-0 !p-0 ${i > 0 ? "border-t border-[#ebe5f7]" : ""}`}>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-[linear-gradient(90deg,#f1ecfc,#faf8fe_70%)] px-4 py-2">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src="/images/store/master-coil.webp" alt="" className="size-7 shrink-0" draggable={false} />
                                  <span className="text-[13px] font-extrabold text-accent">
                                    MASTER COIL <span className="text-[#2d2a32]">{r.motherCoil || "-"}</span>
                                  </span>
                                  <span className="text-[13px] font-bold text-ink-soft">
                                    {r.weight} {cfg.unit} <span className="mx-1.5 text-[#cfc8de]">|</span> {r.ton} TON
                                  </span>
                                  <span className="ml-auto rounded-full bg-[#ece6fb] px-3 py-0.5 text-[11px] font-extrabold text-accent">{r.coilNo}</span>
                                </div>
                              </td>
                            </tr>
                            {head(r.motherCoil)}
                          </Fragment>
                        ) : (
                          <tr key={r.coilId} className="h-11 transition-colors hover:bg-[#faf8ff]">
                            {cfg.coilKeys.map((kk) => (
                              <td key={kk} className="break-words !border-[#f1eef7] !px-1 !py-0 text-center !text-[13px] font-semibold text-[#3d3a4a]">
                                {kk === "REMARK" ? <CoilRemark value={r.remark ?? ""} disabled={cfg.isLiveView} onEditing={act.editing} onSave={(v) => act.saveCoilRemark(r, v)} /> : coilCell(kk, r)}
                              </td>
                            ))}
                            {adj && (
                              <td className="!border-[#f1eef7] !px-1 !py-0 text-center">
                                <CoilActions open={cfg.coilOpen?.coilId === r.coilId ? cfg.coilOpen.kind : null} onAct={(a) => act.coilAct(a, r)} />
                              </td>
                            )}
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// 💬 REMARK ของ Coil ลูก: คลิก -> พิมพ์ -> Enter / ออกจากช่อง = บันทึก, Esc = ยกเลิก · ดูอย่างเดียว = แสดงเฉย ๆ
export function CoilRemark({ value, disabled, onSave, onEditing }: { value: string; disabled?: boolean; onSave: (v: string) => void; onEditing: (v: boolean) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const done = (commit: boolean) => {
    if (edit !== null && commit) onSave(edit.trim());
    setEdit(null);
    onEditing(false);
  };
  if (edit !== null)
    return (
      <input
        autoFocus
        maxLength={500}
        className="field !py-1 text-center !text-[13px] font-semibold"
        value={edit}
        placeholder="REMARK"
        onChange={(e) => setEdit(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") done(true);
          if (e.key === "Escape") done(false);
        }}
      />
    );
  if (disabled) return <span title={value}>{value || "-"}</span>;
  return (
    <button
      type="button"
      className="coil-remark w-full truncate rounded-lg px-2 py-1 text-center"
      title={value ? `${value}\n(คลิกเพื่อแก้ไข)` : "คลิกเพื่อเพิ่ม REMARK"}
      onClick={() => {
        onEditing(true);
        setEdit(value);
      }}
    >
      {value || <span className="text-[11px] font-bold text-[#c2bcd2]">+ REMARK</span>}
    </button>
  );
}

// ✏️ ช่องที่แก้ในตาราง: คลิก -> พิมพ์ -> Enter / ออกจากช่อง = บันทึก, Esc = ยกเลิก
function Edit({
  value,
  onSave,
  onEditing,
  onDenied,
  disabled,
  align,
  strong,
  color,
  wide,
}: {
  value: string;
  onSave: (v: string) => void;
  onEditing: (v: boolean) => void;
  onDenied?: () => void;
  disabled?: boolean;
  align?: "right";
  strong?: boolean;
  color?: string;
  wide?: boolean;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const done = (commit: boolean) => {
    if (edit !== null && commit) onSave(edit.trim());
    setEdit(null);
    onEditing(false);
  };
  if (edit !== null)
    return (
      <td className="p-1">
        <input
          autoFocus
          className={`field py-1 font-black ${align === "right" ? "text-right" : ""} ${wide ? "min-w-[180px]" : "w-24"}`}
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(true);
            if (e.key === "Escape") done(false);
          }}
        />
      </td>
    );
  return (
    <td
      className={`font-bold ${align === "right" ? "text-right" : ""} ${disabled ? "" : "cursor-text hover:bg-accent-soft/40"} ${strong ? "text-base font-extrabold" : ""} ${wide ? "col-wide min-w-[130px]" : "whitespace-nowrap"}`}
      style={color ? { color } : undefined}
      title={disabled ? undefined : "คลิกเพื่อแก้ไข"}
      data-edit={disabled ? undefined : ""}
      onDoubleClick={() => disabled && onDenied?.()}
      onClick={() => {
        if (disabled) return;
        onEditing(true);
        setEdit(value ?? "");
      }}
    >
      {value || "-"}
    </td>
  );
}
