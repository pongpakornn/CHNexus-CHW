"use client";

import { ActionMenu } from "@/components/menus/ActionMenu";
import { BugLogButton } from "./BugLogButton";
import { MenuSelect } from "@/components/dropdowns/MenuSelect";
import { Pager } from "@/components/tables/Pager";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { DateRange } from "@/components/forms/DateRange";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { api, download } from "@/lib/api";
import { today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { useLive } from "@/lib/live";

type Row = { date: string; user: string; action: string; detail: string; refCode: string; computer: string };
type Page = { total: number; all: number; page: number; pageSize: number; rows: Row[] };

// สีของประเภทการกระทำ (อ่านเร็วว่าเป็นงานกลุ่มไหน)
function actionColor(a: string) {
  if (/DELETE|REJECT|FAIL|CANCEL/.test(a)) return "var(--danger)";
  if (/LOGIN|LOGOUT|EXIT|OPEN_PAGE/.test(a)) return "#7a7484";
  if (/SCAN|DEDUCT/.test(a)) return "var(--accent)";
  if (/EXPORT|IMPORT|TEMPLATE/.test(a)) return "var(--info)";
  if (/APPROVE|CREATE|ADD|REGISTER/.test(a)) return "var(--success)";
  return "var(--warning)";
}

// 🕘 ACTIVITY LOG (ActivityLogView): ใคร ทำอะไร เมื่อไร เครื่องไหน - Log ใหม่ขึ้นเองเมื่อดูหน้าแรก
//   ทุกระบบ (CIMS · MASTER DATA · EDP PLANNING · USER MANAGEMENT) · ทุกการเพิ่ม / แก้ไข / ลบ / อัพเดท เก็บครบ (AuditMiddleware)
//   embedded = เปิดในหน้าต่างของ USER MANAGEMENT (ปุ่ม ACTIVITY LOG ข้าง ADD USER) - ไม่มีหัวหน้า / ปุ่ม BUG LOG
export default function ActivityLogPage({ embedded = false }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const [key, setKey] = useState("");
  // เปิดหน้า = รายการล่าสุด (ทุกวันที่) · ดูได้ล่าสุด 200 รายการ (2 หน้า) ตามตัวกรอง
  const [from, setFrom] = useState("2000-01-01");
  const [to, setTo] = useState(today());
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [lookups, setLookups] = useState<{ users: { id: string; name: string }[]; actions: string[] }>({ users: [], actions: [] });
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const k = useDebounced(key, 350);
  const tokenRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<typeof lookups>("/activity/lookups")
      .then(setLookups)
      .catch((e) => toast.show("Activity Log", "โหลดตัวกรองไม่สำเร็จ: " + e.message, "error"));
  }, [toast]);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const r = await api<Page>("/activity", { query: { key: k, from, to, user: user || undefined, action: action || undefined, page: p } });
        setData(r);
        setPage(r.page);
        scrollRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        toast.show("Activity Log", "โหลดข้อมูลไม่สำเร็จ: " + (e as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [k, from, to, user, action, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(0), 0);
    return () => clearTimeout(t);
  }, [load]);

  // ⚡ เรียลไทม์ทันที (มีการบันทึกที่ไหนก็ตาม = มี Log ใหม่) + เช็คเองทุก 10 วินาที: เฉพาะตอนอยู่หน้าแรกและอยู่บนสุด (กำลังเลื่อนอ่าน = ไม่ดึงทับ)
  useLive(
    ["data", "log"],
    async () => {
      if (page !== 0 || (scrollRef.current?.scrollTop ?? 0) > 2) return;
      const r = await api<{ token: string }>("/activity/token");
      if (tokenRef.current && r.token !== tokenRef.current) load(0);
      tokenRef.current = r.token;
    },
    10000,
  );

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const excel = (
          <ActionMenu
            caption={["EXCEL", "EXPORT"]}
            label="เมนู Excel Activity Log"
            actions={[
              {
                key: "export",
                title: "EXPORT EXCEL",
                detail: "ส่งออก Activity Log เป็นไฟล์ Excel ตามคำค้นหา / ผู้ใช้ / Action / ช่วงวันที่ที่กรองอยู่",
                color: "#16a34a",
                icon: "export" as const,
                onClick: () =>
                  download("/activity/export", { key: k, from, to, user: user || undefined, action: action || undefined })
                    .then((n) => toast.show("Export complete", n, "ok"))
                    .catch((e) => toast.show("ERROR", "Export ไม่สำเร็จ\n" + e.message, "error")),
              },
            ]}
          />
  );
  const card = (
      <Card
        title={`ACTIVITY • ${(data?.all ?? 0).toLocaleString()}`}
        actions={
          <>
            <MenuSelect
              compact
              tone="blue"
              className="w-[220px]"
              label="USER"
              value={user}
              options={[{ value: "", label: "ALL USERS" }, ...lookups.users.map((u) => ({ value: u.id, label: u.name ? `${u.id} - ${u.name}` : u.id }))]}
              onChange={setUser}
            />
            <MenuSelect compact tone="blue" className="w-[200px]" label="ACTION" value={action} options={[{ value: "", label: "ALL ACTIONS" }, ...lookups.actions.map((a) => ({ value: a, label: a }))]} onChange={setAction} />
            {embedded && excel}
          </>
        }
      >
        {/* ค้นหา + ช่วงวันที่ บรรทัดเดียวกัน (จอแคบ = ขึ้นบรรทัดใหม่เอง) */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line/60 p-3 xl:flex-nowrap">
          <SearchBox className="min-w-[240px] flex-1" fancy value={key} onChange={setKey} placeholder="ค้นหา ประเภท / รายละเอียด / อ้างอิง / ผู้ใช้ / เครื่อง" />
          <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        </div>
        <div ref={scrollRef} className={`${embedded ? "max-h-[calc(92dvh-330px)]" : "max-h-[calc(100dvh-300px)]"} min-h-[360px] overflow-auto`}>
          {!data ? (
            <Loading />
          ) : data.rows.length === 0 ? (
            <Empty />
          ) : (
            <>
            {/* 📱 จอเล็ก / แท็บเล็ตแนวตั้ง (< 1024px): การ์ดทีละรายการ อ่านครบทุกช่องไม่ต้องเลื่อนซ้าย-ขวา */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3 lg:hidden">
              {data.rows.map((r, i) => (
                <article key={`${r.date}-${i}`} className="al-card" style={{ "--c": actionColor(r.action), "--i": Math.min(i, 12) } as React.CSSProperties}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={actionColor(r.action)}>{r.action}</Badge>
                    <span className="ml-auto text-[11px] font-bold tabular-nums text-ink-soft">{r.date}</span>
                  </div>
                  <div className="mt-1.5 break-words text-[13px] font-semibold text-ink">{r.detail || "-"}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-ink-soft">
                    <span>👤 {r.user}</span>
                    {r.refCode && <span className="break-all">🔖 {r.refCode}</span>}
                    {r.computer && <span>🖥 {r.computer}</span>}
                  </div>
                </article>
              ))}
            </div>
            {/* .data-table ตั้ง display เอง -> ซ่อนที่กล่องครอบแทน */}
            <div className="max-lg:hidden">
            <table className="data-table t-center w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>DATE TIME</th>
                  <th>USER</th>
                  <th>ACTION</th>
                  <th>DETAIL</th>
                  <th>REFERENCE</th>
                  <th>COMPUTER</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.date}-${i}`}>
                    <td className="whitespace-nowrap text-xs">{r.date}</td>
                    <td className="whitespace-nowrap">{r.user}</td>
                    <td>
                      <Badge color={actionColor(r.action)}>{r.action}</Badge>
                    </td>
                    <td className="min-w-[240px] break-words text-xs font-medium xl:min-w-[320px]">{r.detail}</td>
                    <td className="max-w-[200px] break-all text-xs">{r.refCode}</td>
                    <td className="whitespace-nowrap text-xs text-ink-soft">{r.computer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}
        </div>
        {data && data.total > 0 && (
          <div className={`border-t border-line/60 pt-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
            <Pager page={page} pages={pages} total={data.total} size={data.pageSize} onPage={(p) => !loading && load(p)} note={data.all > data.total ? `ล่าสุด ${data.total.toLocaleString()} จากทั้งหมด ${data.all.toLocaleString()} รายการ (ทั้งหมด = EXPORT)` : undefined} />
          </div>
        )}
      </Card>
  );
  if (embedded) return card;
  return (
    <PageBody>
      <PageHeader icon="/icons/ActivityLog.png" title="ACTIVITY LOG" subtitle="ใคร ทำอะไร เมื่อไร เครื่องไหน · ทุกระบบ" actions={excel} />
      {card}
      <BugLogButton />
    </PageBody>
  );
}
