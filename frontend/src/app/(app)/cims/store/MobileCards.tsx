"use client";

import { memo, useState, useSyncExternalStore } from "react";
import { Loading } from "@/components/layout/Page";
import { StatusLamp } from "./StatusLamp";
import { CoilRemark, masterOf, type CoilRow, type CoilState, type Field, type RowActions, type RowCfg } from "./TableRows";
import { STATUS_COLOR, cardTone, type Product } from "./types";
import { AddCoilButton, CoilActions, HideButton } from "./CoilManageButtons";

// 📱 จอมือถือ (กว้าง < 768): แสดงสินค้าเป็นการ์ดแทนตาราง (ไม่ต้องเลื่อนซ้าย-ขวาเพื่อดูยอด)
const MQ = "(max-width: 767px)";
export function useMobile() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(MQ);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(MQ).matches,
    () => false,
  );
}

export type CardLabels = { max: string; min: string; qty: string; box: string; basis: "qty" | "stockBox" | "stockPcs" | null; basisLabel: string };

const num = (v: string) => Number((v ?? "").replace(/,/g, "")) || 0;

// ช่องตัวเลขบนการ์ด: แตะ = แก้ (Enter / แตะที่อื่น = บันทึก, Esc = ยกเลิก) · ไม่มีสิทธิ์ = แสดงเฉย ๆ (แตะค้าง 2 ครั้ง = แจ้งเหตุผล)
function Tile({ label, value, color, strong, wide, disabled, onSave, onEditing, onDenied }: { label: string; value: string; color?: string; strong?: boolean; wide?: boolean; disabled?: boolean; onSave: (v: string) => void; onEditing: (v: boolean) => void; onDenied: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const done = (commit: boolean) => {
    if (edit !== null && commit) onSave(edit.trim());
    setEdit(null);
    onEditing(false);
  };
  if (edit !== null)
    return (
      <div className={`mc-tile is-edit ${wide ? "col-span-full" : ""}`}>
        <span className="mc-tile-cap">{label}</span>
        <input
          autoFocus
          className="mc-input"
          inputMode={wide ? "text" : "decimal"}
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(true);
            if (e.key === "Escape") done(false);
          }}
        />
      </div>
    );
  return (
    <button
      type="button"
      className={`mc-tile ${wide ? "col-span-full is-wide" : ""} ${disabled ? "is-ro" : ""}`}
      style={{ "--c": color } as React.CSSProperties}
      onClick={() => (disabled ? null : (onEditing(true), setEdit(value ?? "")))}
      onDoubleClick={() => disabled && onDenied()}
    >
      <span className="mc-tile-cap">{label}</span>
      <span className={`mc-tile-val ${strong ? "is-strong" : ""} ${wide ? "is-text" : ""}`}>{value || "-"}</span>
      {!disabled && (
        <svg viewBox="0 0 24 24" className="mc-pen" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      )}
    </button>
  );
}

// 📊 แผงยอดคงเหลือ: ตัวเลขใหญ่สีตามสถานะ + แถบเทียบ MAX (ขีด = MIN) ดูปราดเดียวรู้ว่าของพอไหม
function Level({ p, labels, color }: { p: Product; labels: CardLabels; color: string }) {
  const max = num(p.max);
  const k = labels.basis;
  if (!k || max <= 0) return null;
  const cur = num(p[k] as string);
  const min = num(p.min);
  const pct = Math.min(100, (cur / max) * 100);
  return (
    <div className="mc-level" style={{ "--c": color } as React.CSSProperties}>
      <div className="flex items-end justify-between gap-2">
        <span className="mc-tile-cap">{labels.basisLabel}</span>
        <span className="mc-level-val">
          {(p[k] as string) || "0"}
          <small> / {p.max}</small>
        </span>
      </div>
      <div className="mc-bar">
        <i style={{ width: `${Math.max(pct, cur > 0 ? 3 : 0)}%` }} />
        {min > 0 && min < max && <b style={{ left: `${(min / max) * 100}%` }} />}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] font-bold text-[#8a8490]">
        <span>{Math.round((cur / max) * 100)}% OF MAX</span>
        <span>
          MIN {p.min || "0"} · MAX {p.max}
        </span>
      </div>
    </div>
  );
}

const META: [string, keyof Product, string][] = [
  ["CUSTOMER", "customer", "CUSTOMER"],
  ["PARTA", "partA", "PART A"],
  ["PARTB", "partB", "PART B"],
  ["PARTNO", "partNo", "PART NO"],
  ["MODEL", "model", "MODEL"],
  ["SUPPLIER", "supplier", "SUPPLIER"],
  ["CATEGORY", "category", "CATEGORY"],
  ["PACKSIZE", "packSize", "PACK SIZE"],
  ["BIN", "bin", "BIN"],
];

// 📦 การ์ดสินค้า 1 ใบ (memo เหมือนแถวตาราง: วาดใหม่เฉพาะเมื่อสินค้านี้ / Coil ของสินค้านี้เปลี่ยน)
export const ProductCard = memo(function ProductCard({ p, no, cfg, labels, coil, closing, anim, act }: { p: Product; no: number; cfg: RowCfg; labels: CardLabels; coil?: CoilState; closing: boolean; anim: boolean; act: RowActions }) {
  const has = (c: string) => cfg.cols.includes(c);
  const tone = cardTone(p.stockStatus);
  const color = STATUS_COLOR(p.stockStatus);
  const off = p.stockStatus === "NO_CONFIG";
  const editable = (f: Field) => (f === "remark" ? !cfg.isLiveView : f === "max" || f === "min" ? cfg.canEdit : cfg.canEditQty);
  const tile = (f: Field, label: string, extra: { strong?: boolean; color?: string; wide?: boolean } = {}) => (
    <Tile key={f} label={label} value={p[f] as string} {...extra} disabled={!editable(f)} onSave={(v) => act.save(p, f, v)} onEditing={act.editing} onDenied={() => act.denied(f)} />
  );
  const open = !!coil && !closing;
  const meta = META.filter(([c, k]) => has(c) && p[k]);
  // หัวการ์ด = PD CODE (ว่าง -> PART NO) · ตัวที่ขึ้นเป็นหัวแล้วไม่ซ้ำในป้ายด้านล่าง
  const val = (v: string) => (v && v.trim() !== "-" ? v : "");
  const title = (has("CODE") && val(p.partCode)) || val(p.partNo) || p.partCode;
  const metaShown = meta.filter(([, k]) => p[k] !== title && val(p[k] as string));
  // ช่องตัวเลข: 4 ช่อง = 2x2 · อื่น ๆ = 3 คอลัมน์ (ไม่มีช่องเดี่ยวค้างแถวท้าย)
  const nTiles = (has("MAXMIN") ? 2 : 0) + ["BOX", "QTY", "PCS"].filter(has).length;

  return (
    <article data-pid={p.partId} className={`mc-card ${off ? "is-off" : ""}`} style={{ "--tone": tone.line } as React.CSSProperties}>
      <div className="flex items-start gap-3">
        {has("IMAGE") && (
          <span className="mc-img">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            ) : (
              <span className="text-line">▣</span>
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {has("NO") && <span className="mc-no">#{no}</span>}
            {cfg.cols.includes("STATUS") && (
              <span className="mc-status" style={{ background: tone.line }}>
                {tone.label}
              </span>
            )}
          </div>
          <div className="mt-1 break-all text-[17px] font-black leading-tight text-[#1e2a5a]">{title || "-"}</div>
          {has("NAME") && <div className="mt-0.5 text-[13px] font-semibold leading-snug text-ink-soft">{p.partName}</div>}
        </div>
        {cfg.manage === "ADD" && <AddCoilButton onClick={() => act.addCoil(p)} />}
        {cfg.manage === "HIDE" && <HideButton busy={cfg.hideBusy === p.partId} picked={cfg.picked.has(p.partId)} onPick={() => act.pick(p)} onClick={() => act.hide(p)} />}
        {cfg.cols.includes("STATUS") && <StatusLamp status={p.stockStatus} size={24} className="shrink-0" />}
      </div>

      {metaShown.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {metaShown.map(([c, k, l]) => (
            <span key={c} className="mc-meta">
              <b>{l}</b> {p[k] as string}
            </span>
          ))}
        </div>
      )}

      {!off && <Level p={p} labels={labels} color={color} />}

      <div className={`mt-2.5 grid gap-2 ${nTiles === 4 || nTiles === 2 ? "grid-cols-2" : nTiles === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
        {has("MAXMIN") && tile("max", labels.max, { color: "#0552aa" })}
        {has("MAXMIN") && tile("min", labels.min, { color: "#10785c" })}
        {has("BOX") && tile("stockBox", labels.box, { color: "#6d4fd1" })}
        {has("QTY") && tile("qty", labels.qty, { strong: true, color: off ? undefined : color })}
        {has("PCS") && tile("stockPcs", "STOCK (PCS)")}
        {has("REMARK") && tile("remark", "REMARK", { wide: true })}
      </div>

      {cfg.coilsOn && (
        <button type="button" className={`mc-coil-btn ${open ? "is-open" : ""}`} onClick={() => act.toggle(p)}>
          <span>🧲 COIL</span>
          {Array.isArray(coil) && <span className="mc-coil-n">{coil.filter((r) => !r.isMother).length}</span>}
          <svg viewBox="0 0 16 16" className="ml-auto size-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3.5L10.5 8 6 12.5" />
          </svg>
        </button>
      )}
      {coil && (
        <div
          className={`coil-slide ${anim ? "is-anim" : ""} ${closing ? "is-closing" : ""}`}
          onAnimationEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.animationName === "coil-close") act.closed(p.partId);
            else if (e.animationName === "coil-open") act.opened(p.partId);
          }}
        >
          <div>
            <MobileCoils list={coil} cfg={cfg} act={act} />
          </div>
        </div>
      )}
    </article>
  );
});

const COIL_LABEL: Record<string, string> = { COILNO: "NUMBER COIL", MOTHER: "MASTER COIL", WEIGHT: "WEIGHT", COIL: "STOCK (COIL)", TON: "TON", RECEIVED: "RECEIVED" };
const coilVal = (k: string, r: CoilRow) => ({ COILNO: r.coilNo, MOTHER: masterOf(r), WEIGHT: r.weight, COIL: "1", TON: r.ton, RECEIVED: r.received })[k] ?? "";

// 🧲 Coil บนมือถือ: แถบ MASTER COIL -> Coil ลูกเป็นการ์ดเล็ก (เลข Coil ใหญ่ + ค่าอื่นเป็นคู่ ชื่อ : ค่า)
function MobileCoils({ list, cfg, act }: { list: CoilState; cfg: RowCfg; act: RowActions }) {
  if (list === "loading") return <Loading compact label="กำลังโหลด Coil…" />;
  if (!list.some((r) => !r.isMother)) return <div className="py-3 text-center text-xs font-bold text-ink-soft">ยังไม่มี Coil ในคลังของสินค้านี้</div>;
  const keys = cfg.coilKeys.filter((k) => k !== "NO" && k !== "COILNO" && k !== "REMARK");
  return (
    <div className="mt-2 flex flex-col gap-2 pb-1">
      {list.map((r) =>
        r.isMother ? (
          <div key={"m" + r.motherCoil} className="mc-master">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/store/master-coil.webp" alt="" className="size-6 shrink-0" draggable={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-extrabold text-accent">
                MASTER COIL <span className="text-[#2d2a32]">{r.motherCoil || "-"}</span>
              </div>
              <div className="text-[11px] font-bold text-ink-soft">
                {r.weight} {cfg.unit} · {r.ton} TON
              </div>
            </div>
            <span className="mc-coil-n">{r.coilNo}</span>
          </div>
        ) : (
          <div key={r.coilId} className="mc-coil">
            <div className="flex items-center gap-2">
              <span className="mc-no">#{r.no}</span>
              <span className="min-w-0 break-all text-[14px] font-black text-[#1e2a5a]">{r.coilNo}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
              {keys.map((k) => (
                <div key={k} className="min-w-0 text-[11.5px]">
                  <span className="font-bold text-ink-soft">{k === "WEIGHT" ? `WEIGHT (${cfg.unit})` : COIL_LABEL[k]}</span>
                  <div className="truncate font-extrabold text-ink">{coilVal(k, r) || "-"}</div>
                </div>
              ))}
            </div>
            {cfg.manage === "ADJUST" && (
              <div className="mt-2 flex justify-end border-t border-[#f1eef7] pt-2">
                <CoilActions open={cfg.coilOpen?.coilId === r.coilId ? cfg.coilOpen.kind : null} onAct={(a) => act.coilAct(a, r)} />
              </div>
            )}
            {cfg.coilKeys.includes("REMARK") && (
              <div className="mt-1.5 border-t border-[#f1eef7] pt-1.5 text-[12px]">
                <CoilRemark value={r.remark ?? ""} disabled={cfg.isLiveView} onEditing={act.editing} onSave={(v) => act.saveCoilRemark(r, v)} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
