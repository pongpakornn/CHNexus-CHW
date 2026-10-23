"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, PageBody, PageHeader } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { COIL_ICON, stockIcon, tileStyle } from "@/lib/stockIcons";
import { Icon } from "@/components/icons";
import { FormatsModal } from "./FormatsModal";
import { StockEditor } from "./StockEditor";

type Card = {
  stkId: number;
  code: string;
  name: string;
  isMain: boolean;
  unit: string;
  itemCount: number;
  canDelete: boolean;
  coil: { masterCount: number; masterKg: number; childCount: number; childKg: number; totalCount: number; totalKg: number } | null;
};
type Data = { canCreate: boolean; canFormats: boolean; canEdit: boolean; stocks: Card[] };

// 🏬 การ์ดคลัง (StockCardsView) - คลิกการ์ด = เปิดตารางของคลังนั้น
export function StockCards({ onOpen }: { onOpen: (stkId: number) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [editor, setEditor] = useState<{ stkId: number | null } | null>(null);
  const [formats, setFormats] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/store/stocks"));
    } catch (e) {
      toast.show("ERROR", "ไม่สามารถโหลดรายชื่อคลังได้\n" + (e as Error).message, "error");
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    const live = setInterval(() => !document.hidden && load(), 10_000);
    return () => (clearTimeout(t), clearInterval(live));
  }, [load]);

  async function remove(c: Card) {
    const reason = await dlg.prompt({
      title: "DELETE STOCK",
      danger: true,
      ok: "DELETE",
      multiline: true,
      message: `คลัง ${c.code} (${c.name}) มีสินค้า ${c.itemCount.toLocaleString()} รายการ\nข้อมูลยอดคงเหลือและประวัติแสกนของคลังนี้จะถูกลบทั้งหมด\n\nกรุณาระบุเหตุผลในการลบคลัง`,
      required: "กรุณาระบุเหตุผลในการลบคลัง",
    });
    if (reason === null) return;
    if (!(await dlg.confirm({ title: "CONFIRM DELETE", danger: true, message: `ยืนยันการลบคลัง ${c.code} ใช่หรือไม่?\nไม่สามารถกู้คืนข้อมูลได้\n\nเหตุผล: ${reason}` }))) return;
    try {
      const r = await api<{ message: string }>(`/store/stocks/${c.stkId}/delete`, { method: "POST", body: { reason } });
      toast.show("Stock", r.message, "ok");
      load();
    } catch (e) {
      toast.show("ERROR", "ลบคลังไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  return (
    <PageBody>
      <PageHeader
        icon="/icons/StoreMaxMin.png"
        title="STORE ( MAX - MIN )"
        subtitle={data ? `SELECT A STOCK • ${data.stocks.length} STOCK(S)` : "LOADING..."}
        actions={
          <>
            {data?.canFormats && (
              <button className="btn bg-primary" onClick={() => setFormats(true)}>
                🏷️ BARCODE FORMATS
              </button>
            )}
            {data?.canCreate && (
              <button className="btn bg-accent" onClick={() => setEditor({ stkId: null })}>
                ＋ ADD STOCK
              </button>
            )}
          </>
        }
      />
      {!data ? (
        <Loading />
      ) : data.stocks.length === 0 ? (
        <Empty>ยังไม่มีคลังที่คุณมีสิทธิ์ดู กรุณาติดต่อ Admin</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.stocks.map((c, i) => {
            const [ic, col] = stockIcon(c.code, i);
            return (
              <div
                key={c.stkId}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(c.stkId)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(c.stkId)}
                className="card-in group relative flex min-h-[230px] cursor-pointer flex-col overflow-hidden rounded-[22px] border border-[#e2e4f0] bg-surface p-5 text-left shadow-[0_1px_2px_rgb(20_25_60/0.04),0_12px_30px_-20px_rgb(40_45_110/0.28)] outline-none transition duration-300 hover:-translate-y-1 focus-visible:ring-2"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* แถบสีด้านบน + แสงสีประจำคลังตอนชี้ */}
                <div className="absolute inset-x-0 top-0 h-1 transition-[height] duration-300 group-hover:h-1.5" style={{ background: `linear-gradient(90deg, ${col}, color-mix(in srgb, ${col} 45%, white))` }} />
                <div
                  className="pointer-events-none absolute inset-0 rounded-[22px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ boxShadow: `0 18px 40px -22px ${col}, inset 0 0 0 1px color-mix(in srgb, ${col} 35%, transparent)`, background: `radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, ${col} 9%, transparent), transparent 60%)` }}
                />
                <div className="relative flex items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-[15px] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110" style={tileStyle(col)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ic} alt="" draggable={false} className="size-7 object-contain" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-lg font-extrabold text-[#1f2350]">{c.code}</span>
                      {c.isMain && <Badge>MAIN</Badge>}
                    </div>
                    <div className="truncate text-sm font-semibold text-ink-soft">{c.name}</div>
                  </div>
                  <span className="grid size-8 shrink-0 -translate-x-1 place-items-center rounded-full opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100" style={{ background: `color-mix(in srgb, ${col} 14%, transparent)`, color: col }}>
                    <Icon name="chevron" className="size-4" />
                  </span>
                </div>

                {/* ตัวเลข + หน่วย (ซ้าย) · ภาพไอคอนคลังสีประจำคลัง (ขวา) */}
                <div className="relative mt-4 flex items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-[34px] font-extrabold leading-none tabular-nums text-[#1f2350]">{c.itemCount.toLocaleString()}</span>
                      <span className="rounded-lg px-2.5 py-1 text-xs font-extrabold" style={{ background: `color-mix(in srgb, ${col} 12%, transparent)`, color: col }}>
                        {c.unit}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">ITEMS</div>
                  </div>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none ml-auto size-[84px] shrink-0 opacity-85 transition duration-500 group-hover:-rotate-6 group-hover:scale-110 group-hover:opacity-100"
                    style={{
                      background: `linear-gradient(145deg, color-mix(in srgb, ${col} 55%, white), ${col})`,
                      WebkitMask: `url(${ic}) center / contain no-repeat`,
                      mask: `url(${ic}) center / contain no-repeat`,
                      filter: `drop-shadow(0 8px 10px color-mix(in srgb, ${col} 35%, transparent))`,
                    }}
                  />
                </div>

                <div className="relative mt-auto pt-4">
                  {c.coil && (
                    <div
                      className="flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-xs font-extrabold tabular-nums"
                      style={{ background: `color-mix(in srgb, ${col} 9%, transparent)`, color: col }}
                      title={`MASTER COIL ${c.coil.masterCount} (${qty(c.coil.masterKg)} KG) • COIL NO ${c.coil.childCount} (${qty(c.coil.childKg)} KG)`}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-full" style={tileStyle(col)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={COIL_ICON} alt="" className="size-4 object-contain" />
                      </span>
                      <span className="truncate">
                        COIL NO {c.coil.totalCount.toLocaleString()}
                        <span className="mx-1.5 opacity-35">|</span>
                        {qty(c.coil.totalKg)} KG
                        <span className="mx-1.5 opacity-35">|</span>
                        {qty(Math.round(c.coil.totalKg / 10) / 100)} TON
                      </span>
                    </div>
                  )}
                  {(data.canEdit || c.canDelete) && (
                    <div className="relative mt-3 flex gap-2 opacity-100 transition duration-300 sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100">
                      {data.canEdit && (
                        <button className="btn-ghost px-3 py-1 text-xs" onClick={(e) => (e.stopPropagation(), setEditor({ stkId: c.stkId }))}>
                          ⚙ SETTINGS
                        </button>
                      )}
                      {c.canDelete && (
                        <button className="btn-ghost px-3 py-1 text-xs text-danger" onClick={(e) => (e.stopPropagation(), remove(c))}>
                          🗑 DELETE
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editor && (
        <StockEditor
          stkId={editor.stkId}
          canFormats={!!data?.canFormats}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            load();
          }}
        />
      )}
      {formats && <FormatsModal onClose={() => setFormats(false)} />}
    </PageBody>
  );
}
