"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComboBox } from "@/components/dropdowns/ComboBox";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { ContactModal } from "../users/ContactModal";
import { PermissionModal } from "../users/PermissionModal";
import type { Can, User } from "../users/types";

// 🔑 ACCESS CONTROL: เลือกผู้ใช้ (พิมพ์ค้นหาได้) แล้วแก้สิทธิ์ด้วย PermissionModal เดิม · สิทธิ์ที่ใช้ = can.perms เหมือนปุ่ม PERMISSION ในหน้า USER ACCOUNTS
export default function AccessPage() {
  const toast = useToast();
  const [data, setData] = useState<{ can: Can; users: User[] } | null>(null);
  const [userId, setUserId] = useState("");
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<((saved: boolean) => void) | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<{ can: Can; users: User[] }>("/users"));
    } catch (e) {
      toast.show("ERROR", "โหลดรายชื่อผู้ใช้งานไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const options = useMemo(() => (data?.users ?? []).map((u) => ({ value: u.userId, label: `${u.userId} · ${u.name}`, sub: `${u.levelText} · ${u.subText}` })), [data]);
  const closeModal = useCallback(() => setOpen(false), []);

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
                onChange={(v) => {
                  setUserId(v);
                  setOpen(true);
                }}
              />
              {user && (
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-ink-soft">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-primary">{user.levelText}</span>
                  <span>{user.permCount} SYSTEMS</span>
                  <button className="cta-btn is-purple is-sm ml-auto" onClick={() => setOpen(true)}>
                    🔑 PERMISSION
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      {open && userId && (
        <PermissionModal
          userId={userId}
          readOnly={false}
          canContact={data.can.contact}
          onClose={closeModal}
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
