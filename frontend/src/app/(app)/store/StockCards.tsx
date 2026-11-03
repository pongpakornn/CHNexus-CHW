"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { Badge, Empty, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { COIL_ICON, stockIcon, tileStyle } from "@/lib/stockIcons";
import { Icon } from "@/components/icons";
import { FormatsModal } from "./FormatsModal";
import { StockEditor } from "./StockEditor";
import { useLive } from "@/lib/live";

type Card = {
  stkId: number;
  code: string;
  name: string;
  stockType: string | null;
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
    return () => clearTimeout(t);
  }, [load]);
  // ⚡ ยอดของแต่ละคลังอัพเดททันทีเมื่อมีการบันทึก + เช็คเองทุก 15 วินาที
  useLive(["data", "store"], load, 15000);

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
              <button type="button" className="pill-btn" onClick={() => setFormats(true)}>
                🏷️ BARCODE FORMATS
              </button>
            )}
            {data?.canCreate && (
              <button type="button" className="add-btn" onClick={() => setEditor({ stkId: null })} aria-label="Add stock" title="ADD STOCK">
                <span className="sign">+</span>
                <span className="text">Add Stock</span>
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
            const [ic, col] = stockIcon(c.code, i, c.stockType);
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
                      <span className="min-w-0 truncate max-sm:whitespace-normal">
                        COIL NO {c.coil.totalCount.toLocaleString()}
                        <span className="mx-1.5 opacity-35">|</span>
                        {qty(c.coil.totalKg)} KG
                        <span className="mx-1.5 opacity-35">|</span>
                        {qty(Math.round(c.coil.totalKg / 10) / 100)} TON
                      </span>
                    </div>
                  )}
                  {(data.canEdit || c.canDelete) && (
                    <div className="relative mt-3 flex items-center gap-2 opacity-100 transition duration-300 sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100">
                      {data.canEdit && (
                        <button type="button" className="gear-btn" onClick={(e) => (e.stopPropagation(), setEditor({ stkId: c.stkId }))}>
                          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <g strokeWidth="1.5" strokeLinecap="round" stroke="currentColor">
                              <circle r="2.5" cy="10" cx="10" />
                              <path
                                fillRule="evenodd"
                                clipRule="evenodd"
                                d="m8.39079 2.80235c.53842-1.51424 2.67991-1.51424 3.21831-.00001.3392.95358 1.4284 1.40477 2.3425.97027 1.4514-.68995 2.9657.82427 2.2758 2.27575-.4345.91407.0166 2.00334.9702 2.34248 1.5143.53842 1.5143 2.67996 0 3.21836-.9536.3391-1.4047 1.4284-.9702 2.3425.6899 1.4514-.8244 2.9656-2.2758 2.2757-.9141-.4345-2.0033.0167-2.3425.9703-.5384 1.5142-2.67989 1.5142-3.21831 0-.33914-.9536-1.4284-1.4048-2.34247-.9703-1.45148.6899-2.96571-.8243-2.27575-2.2757.43449-.9141-.01669-2.0034-.97028-2.3425-1.51422-.5384-1.51422-2.67994.00001-3.21836.95358-.33914 1.40476-1.42841.97027-2.34248-.68996-1.45148.82427-2.9657 2.27575-2.27575.91407.4345 2.00333-.01669 2.34247-.97026z"
                              />
                            </g>
                          </svg>
                          Settings
                        </button>
                      )}
                      {c.canDelete && (
                        <button type="button" className="bin-btn" aria-label="Delete stock" title="DELETE" onClick={(e) => (e.stopPropagation(), remove(c))}>
                          <svg viewBox="0 0 69 14" fill="none" className="bin-top" aria-hidden="true">
                            <path d="M20.8232 2.62734L19.9948 4.21304C19.8224 4.54309 19.4808 4.75 19.1085 4.75H4.92857C2.20246 4.75 0 6.87266 0 9.5C0 12.1273 2.20246 14.25 4.92857 14.25H64.0714C66.7975 14.25 69 12.1273 69 9.5C69 6.87266 66.7975 4.75 64.0714 4.75H49.8915C49.5192 4.75 49.1776 4.54309 49.0052 4.21305L48.1768 2.62734C47.3451 1.00938 45.6355 0 43.7719 0H25.2281C23.3645 0 21.6549 1.00938 20.8232 2.62734Z" />
                          </svg>
                          <svg viewBox="0 0 69 57" fill="none" className="bin-bottom" aria-hidden="true">
                            <path d="M64.0023 1.0648C64.0397 0.4882 63.5822 0 63.0044 0H5.99556C5.4178 0 4.96025 0.4882 4.99766 1.0648L8.19375 50.3203C8.44018 54.0758 11.6746 57 15.5712 57H53.4288C57.3254 57 60.5598 54.0758 60.8062 50.3203L64.0023 1.0648Z" />
                          </svg>
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
