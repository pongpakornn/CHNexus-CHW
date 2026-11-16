"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { RowAction } from "@/components/button-action/RowAction";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { ContactModal } from "../users/ContactModal";
import { GROUPS, PermissionModal } from "../users/PermissionModal";
import type { Can, User } from "../users/types";

// 🔑 ACCESS CONTROL: ตารางสิทธิ์จริงของผู้ใช้ทุกคน (แถว = ผู้ใช้ · คอลัมน์ = กลุ่มระบบ) · กด ✎ = กำหนดสิทธิ์ในหน้านี้ (PermissionModal แบบ inline)
//   ?user=<id> = เปิดหน้ากำหนดสิทธิ์ของผู้ใช้นั้นทันที (หลังเพิ่ม User ที่ USER ACCOUNTS)
type Acc = { userId: string; sysId: string; view: boolean; add: boolean; edit: boolean; del: boolean; approve: boolean };
const LEVEL_TONE: Record<number, string> = { 1: "var(--danger)", 2: "var(--accent)", 3: "var(--info)" };
const flags = (a: Acc) => [a.view && "VIEW", a.add && "ADD", a.edit && "EDIT", a.del && "DEL", a.approve && "APPROVE"].filter(Boolean).join(" · ");

export default function AccessPage() {
  const toast = useToast();
  const [data, setData] = useState<{ can: Can; users: User[] } | null>(null);
  const [acc, setAcc] = useState<{ stocks: string[]; rows: Acc[] } | null>(null);
  const [userId, setUserId] = useState("");
  const [key, setKey] = useState("");
  const q = useDebounced(key, 200).trim().toLowerCase();
  const [contact, setContact] = useState<((saved: boolean) => void) | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([api<{ can: Can; users: User[] }>("/users"), api<{ stocks: string[]; rows: Acc[] }>("/users/access")]);
      setData(u);
      setAcc(a);
    } catch (e) {
      toast.show("ERROR", "โหลดตารางสิทธิ์ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(() => {
      load();
      const u = new URLSearchParams(window.location.search).get("user");
      if (u) setUserId(u);
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const back = useCallback(() => {
    setUserId("");
    window.history.replaceState(null, "", "/admin/access");
  }, []);

  // สิทธิ์ของแต่ละคน แยกตามกลุ่มระบบ (สิทธิ์คลัง = SystemID เป็นรหัสคลัง)
  const byUser = useMemo(() => {
    const stocks = new Set((acc?.stocks ?? []).map((s) => s.toLowerCase()));
    const groupOf = (id: string) => (stocks.has(id.toLowerCase()) ? "STOCK" : (GROUPS.find((g) => g.ids?.some((x) => x.toLowerCase() === id.toLowerCase()))?.key ?? "OTHER"));
    const m = new Map<string, Map<string, Acc[]>>();
    for (const r of acc?.rows ?? []) {
      const u = r.userId.toLowerCase();
      if (!m.has(u)) m.set(u, new Map());
      const g = m.get(u)!;
      const k = groupOf(r.sysId);
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return m;
  }, [acc]);
  const cols = useMemo(() => GROUPS.filter((g) => g.key !== "OTHER" || [...byUser.values()].some((x) => x.has("OTHER"))), [byUser]);
  const users = useMemo(
    () => (data?.users ?? []).filter((u) => !q || `${u.userId} ${u.name} ${u.subText} ${u.levelText}`.toLowerCase().includes(q)),
    [data, q],
  );

  if (!data || !acc) return <Loading />;
  const can = data.can.perms;
  const editing = userId && can;
  return (
    <PageBody>
      <PageHeader
        icon="/icons/management.png"
        title="ACCESS CONTROL"
        subtitle={editing ? `กำหนดสิทธิ์ • ${userId}` : `USER MANAGEMENT • ${users.length} USER(S)`}
        actions={
          editing ? (
            <button type="button" className="pill-btn" onClick={back}>
              ← BACK TO TABLE
            </button>
          ) : (
            <SearchBox value={key} onChange={setKey} placeholder="ค้นหา User ID / ชื่อ / แผนก" className="w-[300px] max-w-full" />
          )
        }
      />
      {editing ? (
        <PermissionModal
          key={userId}
          inline
          userId={userId}
          readOnly={false}
          canContact={data.can.contact}
          onClose={back}
          onEditContacts={() => new Promise<boolean>((resolve) => setContact(() => resolve))}
          onSaved={(m) => {
            toast.show("Saved", m, "ok");
            load();
          }}
        />
      ) : (
        <Card>
          {users.length === 0 ? (
            <Empty>ไม่พบผู้ใช้ที่ค้นหา</Empty>
          ) : (
            <div className="overflow-auto">
              <table className="data-table t-center w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="!text-left">USER</th>
                    <th>LEVEL</th>
                    {cols.map((g) => (
                      <th key={g.key} title={g.sub}>
                        {g.title}
                      </th>
                    ))}
                    {can && <th>ACTION</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const mine = byUser.get(u.userId.toLowerCase());
                    const none = !mine || mine.size === 0;
                    return (
                      <tr key={u.userId} className={none ? "bg-[#fff8f8]" : ""}>
                        <td className="!text-left">
                          <div className="font-extrabold">{u.userId}</div>
                          <div className="max-w-[220px] truncate text-xs font-semibold text-ink-soft" title={u.name}>
                            {u.name}
                          </div>
                        </td>
                        <td>
                          <span className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }}>
                            {u.levelText}
                          </span>
                        </td>
                        {cols.map((g) => {
                          const list = mine?.get(g.key) ?? [];
                          return (
                            <td key={g.key}>
                              {list.length === 0 ? (
                                <span className="text-ink-soft/50">—</span>
                              ) : (
                                <span
                                  className="inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-extrabold"
                                  style={{ background: `color-mix(in srgb, ${g.color} 12%, transparent)`, color: g.color }}
                                  title={list.map((a) => `${a.sysId}: ${flags(a)}`).join("\n")}
                                >
                                  ✓ {list.length}
                                  {list.some((a) => a.add || a.edit || a.del || a.approve) ? (
                                    <Fragment> · EDIT</Fragment>
                                  ) : (
                                    <Fragment> · VIEW</Fragment>
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        {can && (
                          <td>
                            <RowAction kind="edit" title={`กำหนดสิทธิ์ ${u.userId}`} onClick={() => setUserId(u.userId)} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {contact && (
        <ContactModal
          onClose={() => {
            contact(false);
            setContact(null);
          }}
          onSaved={(m) => {
            toast.show("Saved", m, "ok");
            contact(true);
            setContact(null);
          }}
        />
      )}
    </PageBody>
  );
}
