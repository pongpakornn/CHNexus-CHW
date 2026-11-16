"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { ContactModal } from "../users/ContactModal";
import { PermissionModal } from "../users/PermissionModal";
import type { Can, User } from "../users/types";

// 🔑 ACCESS CONTROL: เลือกผู้ใช้ (พิมพ์ค้นหาได้) แล้วกำหนดสิทธิ์ในหน้านี้เลย (PermissionModal แบบ inline) · ?user=<id> = เปิดผู้ใช้นั้นทันที (หลังเพิ่ม User)
export default function AccessPage() {
  const toast = useToast();
  const [data, setData] = useState<{ can: Can; users: User[] } | null>(null);
  const [userId, setUserId] = useState("");
  const [contact, setContact] = useState<((saved: boolean) => void) | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<{ can: Can; users: User[] }>("/users"));
    } catch (e) {
      toast.show("ERROR", "โหลดรายชื่อผู้ใช้งานไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(() => {
      load();
      const q = new URLSearchParams(window.location.search).get("user");
      if (q) setUserId(q);
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const options = useMemo(() => (data?.users ?? []).map((u) => ({ value: u.userId, label: `${u.userId} · ${u.name}`, sub: `${u.levelText} · ${u.subText}` })), [data]);
  const clear = useCallback(() => {
    setUserId("");
    window.history.replaceState(null, "", "/admin/access");
  }, []);

  if (!data) return <Loading />;
  const user = data.users.find((u) => u.userId === userId);
  return (
    <PageBody>
      <PageHeader icon="/icons/management.png" title="ACCESS CONTROL" subtitle="USER MANAGEMENT" />
      <Card clip={false}>
        <div className="grid max-w-xl gap-3 p-4">
          {!data.can.perms ? (
            <p className="text-center text-sm font-bold text-danger">NO PERMISSION · you cannot edit permissions</p>
          ) : (
            <>
              <span className="text-[11px] font-extrabold uppercase text-ink-soft">USER</span>
              <ComboBox
                value={userId}
                options={options}
                placeholder="Search User ID or name..."
                ariaLabel="User"
                onChange={setUserId}
              />
              {user && (
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-ink-soft">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-primary">{user.levelText}</span>
                  <span>{user.permCount} SYSTEMS</span>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      {data.can.perms && userId && (
        <PermissionModal
          key={userId}
          inline
          userId={userId}
          readOnly={false}
          canContact={data.can.contact}
          onClose={clear}
          onEditContacts={() => new Promise<boolean>((resolve) => setContact(() => resolve))}
          onSaved={(m) => {
            toast.show("Saved", m, "ok");
            load();
          }}
        />
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
