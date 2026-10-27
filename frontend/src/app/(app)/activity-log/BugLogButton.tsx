"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { Empty, Loading, SearchBox } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/useDebounced";

type Bug = {
  id: number;
  source: "API" | "WEB" | "WPF";
  severity: "ERROR" | "WARN";
  message: string;
  detail: string | null;
  path: string | null;
  method: string | null;
  status: number | null;
  userId: string | null;
  client: string | null;
  hits: number;
  firstAt: string;
  lastAt: string;
  isRead: boolean;
};

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

// 🐞 ปุ่มกลม BUG LOG (หน้า ACTIVITY LOG - เฉพาะ Admin Level 1): ตัวเลข = ยังไม่ได้อ่าน · เช็กทุก 30 วินาที
export function BugLogButton() {
  const { me } = useAuth();
  const admin = me?.userLevel === 1;
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(true);
  const [open, setOpen] = useState(false);

  const poll = useCallback(() => {
    if (document.hidden) return;
    api<{ ready: boolean; unread: number }>("/buglog/count")
      .then((r) => (setUnread(r.unread), setReady(r.ready)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!admin) return;
    const t0 = setTimeout(poll, 0);
    const t = setInterval(poll, 30_000);
    return () => (clearTimeout(t0), clearInterval(t));
  }, [admin, poll]);

  if (!admin) return null;
  return (
    <>
      <button type="button" className={`bug-fab ${unread > 0 ? "has-new" : ""}`} onClick={() => setOpen(true)} aria-label={`BUG LOG${unread ? ` (${unread} ใหม่)` : ""}`} title="BUG LOG • ข้อผิดพลาดของระบบ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 6.5a4 4 0 0 1 8 0" />
          <rect x="6.5" y="7.5" width="11" height="12" rx="5.5" />
          <path d="M12 11v8M3.5 13h3M17.5 13h3M4.5 8.5l2.4 1.6M19.5 8.5l-2.4 1.6M4.5 18.5l2.4-1.8M19.5 18.5l-2.4-1.8" />
        </svg>
        {unread > 0 && <span className="bug-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && <BugLogModal ready={ready} onClose={() => (setOpen(false), poll())} />}
    </>
  );
}

function BugLogModal({ ready, onClose }: { ready: boolean; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Bug[] | null>(null);
  const [key, setKey] = useState("");
  const [source, setSource] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(ready);
  const k = useDebounced(key, 300);

  const load = useCallback(async () => {
    try {
      const r = await api<{ ready: boolean; rows: Bug[] }>("/buglog", { query: { key: k, source, unread: onlyNew || undefined } });
      setRows(r.rows);
      setIsReady(r.ready);
    } catch (e) {
      toast.show("ERROR", "โหลด BUG LOG ไม่สำเร็จ\n" + (e as Error).message, "error");
      setRows([]);
    }
  }, [k, source, onlyNew, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function markRead(ids: number[]) {
    try {
      await api("/buglog/read", { method: "POST", body: { ids } });
      setRows((rs) => rs?.map((r) => (ids.length === 0 || ids.includes(r.id) ? { ...r, isRead: true } : r)) ?? rs);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  const unread = rows?.filter((r) => !r.isRead).length ?? 0;
  return (
    <Modal
      open
      size="xl"
      title={`🐞 BUG LOG${unread ? ` • ${unread} NEW` : ""}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs font-bold text-ink-soft">เก็บ 90 วัน • ข้อผิดพลาดเดิมซ้ำ = นับ HITS ในแถวเดิม</span>
          <button className="fill-btn" onClick={() => load()}>
            ↻ REFRESH
          </button>
          <button className="cta-btn is-purple" disabled={unread === 0} onClick={() => markRead([])}>
            ✓ MARK ALL READ
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox className="min-w-[220px] flex-1" value={key} onChange={setKey} placeholder="ค้นหา ข้อความ / URL / ผู้ใช้ / เครื่อง" />
          <MenuSelect
            compact
            tone="blue"
            className="w-[170px]"
            label="SOURCE"
            value={source}
            options={[
              { value: "", label: "ALL" },
              { value: "API", label: "API (SERVER)" },
              { value: "WEB", label: "WEB (BROWSER)" },
              { value: "WPF", label: "WPF (PROGRAM)" },
            ]}
            onChange={setSource}
          />
          <label className={`sw ${onlyNew ? "is-on" : ""}`}>
            <input type="checkbox" className="sr-only" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            <span className="sw-track" />
            NEW ONLY
          </label>
        </div>
        {!isReady && <div className="rounded-xl bg-[#fff7e6] px-3 py-2 text-sm font-bold text-warning">⚠ ยังไม่ได้รัน database/nexus/10_BugLog.sql บนฐาน CHR-Nexus - ยังไม่มีการบันทึก BUG LOG</div>}
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>🎉 ไม่มีข้อผิดพลาด</Empty>
        ) : (
          <div className="grid gap-2">
            {rows.map((r, i) => (
              <div key={r.id} className={`bug-row ${r.isRead ? "" : "is-new"} ${r.severity === "WARN" ? "is-warn" : ""}`} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <button type="button" className="bug-row-main" onClick={() => (setOpenId(openId === r.id ? null : r.id), !r.isRead && markRead([r.id]))} aria-expanded={openId === r.id}>
                  <span className={`bug-src is-${r.source.toLowerCase()}`}>{r.source}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <b className="line-clamp-2 block break-words text-[13px] font-extrabold text-primary">{r.message}</b>
                    <span className="block truncate text-[11px] font-semibold text-ink-soft">
                      {r.method ? `${r.method} ` : ""}
                      {r.path ?? "-"}
                      {r.status ? ` • ${r.status}` : ""} • {r.userId ?? "-"} • {r.client ?? "-"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] font-bold text-ink-soft">
                    <span className="block">{when(r.lastAt)}</span>
                    {r.hits > 1 && <span className="bug-hits">×{r.hits.toLocaleString()}</span>}
                  </span>
                </button>
                {openId === r.id && (
                  <div className="bug-detail">
                    <div className="mb-1 text-[11px] font-extrabold text-ink-soft">
                      FIRST {when(r.firstAt)} • LAST {when(r.lastAt)} • {r.severity}
                    </div>
                    <pre>{r.detail || "(no detail)"}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
