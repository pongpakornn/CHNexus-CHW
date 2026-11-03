"use client";

import { RowAction } from "@/components/button-action/RowAction";
import { ActionMenu } from "@/components/menus/ActionMenu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/notifications/Toasts";
import { useDialogs } from "@/components/modals/Dialogs";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/layout/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { ContactModal } from "./ContactModal";
import { PermissionModal } from "./PermissionModal";
import { SetupModal } from "./SetupModal";
import type { Can, User } from "./types";
import { UserEditModal } from "./UserEditModal";
import { useLive } from "@/lib/live";

const LEVEL_TONE: Record<number, string> = { 1: "var(--danger)", 2: "var(--accent)", 3: "var(--info)" };

// 👥 USER MANAGEMENT (UserManagementView): การ์ดผู้ใช้ - ดู / เพิ่ม / แก้ไข / ลบ / กำหนดสิทธิ์ / Import / ALERT CONTACT / ⚙ SETUP
export default function UsersPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [users, setUsers] = useState<User[] | null>(null);
  const [can, setCan] = useState<Can | null>(null);
  const [me, setMe] = useState("");
  const [key, setKey] = useState("");
  const k = useDebounced(key, 200);
  const [edit, setEdit] = useState<{ user: User | null } | null>(null);
  const [perm, setPerm] = useState<{ userId: string; readOnly: boolean } | null>(null);
  const [contact, setContact] = useState<((saved: boolean) => void) | null>(null);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef("");

  const load = useCallback(
    async (live = false) => {
      try {
        const r = await api<{ can: Can; me: string; users: User[] }>("/users");
        setUsers(r.users);
        setCan(r.can);
        setMe(r.me);
      } catch (e) {
        if (!live) toast.show("ERROR", "โหลดรายชื่อผู้ใช้งานไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // ⚡ เรียลไทม์ 3 วินาที (คงคำค้นไว้)
  useLive(
    ["data"],
    async () => {
      const r = await api<{ token: string }>("/users/token");
      if (tokenRef.current && r.token !== tokenRef.current) load(true);
      tokenRef.current = r.token;
    },
    10000,
  );

  // ตรงที่สุดขึ้นก่อน: USER ID ตรงเป๊ะ > ขึ้นต้นด้วยคำค้น > มีคำค้นอยู่ข้างใน
  const list = useMemo(() => {
    const all = users ?? [];
    const q = k.trim().toLowerCase();
    if (!q) return all;
    const rank = (u: User) => (u.userId.toLowerCase() === q ? 0 : u.userId.toLowerCase().startsWith(q) || (u.name ?? "").toLowerCase().startsWith(q) ? 1 : 2);
    return all
      .filter((u) => [u.userId, u.name, u.position, u.department, u.section, u.division, u.levelText, u.statusText].some((v) => v && v.toLowerCase().includes(q)))
      .sort((a, b) => rank(a) - rank(b));
  }, [users, k]);

  const editContacts = () => new Promise<boolean>((resolve) => setContact(() => resolve));

  async function remove(u: User) {
    if (u.userId.toLowerCase() === me.toLowerCase()) return toast.show("WARNING", "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้", "warn");
    if (u.isMasterAdmin) return toast.show("WARNING", `${u.userId} เป็นผู้ดูแลระบบหลัก (Master Admin) ลบไม่ได้`, "warn");
    if (!(await dlg.confirm({ title: "DELETE USER", message: `ลบผู้ใช้ ${u.userId}\n${u.name}\n\nสิทธิ์ทั้งหมดของผู้ใช้นี้จะถูกลบด้วย ยืนยันหรือไม่?`, ok: "DELETE", danger: true }))) return;
    try {
      const r = await api<{ message: string }>(`/users/${encodeURIComponent(u.userId)}`, { method: "DELETE" });
      toast.show("Deleted", r.message, "ok");
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  async function template() {
    if (
      !(await dlg.confirm({
        title: "TEMPLATE EXCEL",
        ok: "YES",
        message:
          "ต้องการสร้างไฟล์ Template สำหรับนำเข้าผู้ใช้และสิทธิ์ใช่หรือไม่?\n\n• ไฟล์มีชีท USERS และ PERMISSIONS พร้อมชีทวิธีกรอก และรายการรหัสระบบ / รหัสคลัง\n• กรอกข้อมูลแล้วนำเข้าด้วยปุ่ม IMPORT USER / PERMISSION",
      }))
    )
      return;
    download("/users/template")
      .then((f) => toast.show("Template", `สร้างไฟล์ Template แล้ว\n${f}`, "ok"))
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/users/import", file);
      if (!(await dlg.confirm({ title: "IMPORT USER / PERMISSION", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/users/import/apply", { method: "POST", body: pv.id });
      await dlg.alert({ title: "IMPORT", message: r.message, tone: "ok" });
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!users || !can) return <Loading />;
  const online = users.filter((u) => u.isOnline && !u.isLocked).length;
  const locked = users.filter((u) => u.isLocked).length;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/management.png"
        title="USER MANAGEMENT"
        subtitle="View, add, edit and delete users and set the permissions of every system"
        actions={
          <>
            <ActionMenu
              caption={["USERS", "ALERT · SETUP · ADD"]}
              fab={
                <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5a6.5 6.5 0 0 1 3 5.5" />
                </svg>
              }
              fabColor="linear-gradient(145deg, #8b6fd6, #6750a4)"
              label="เมนูผู้ใช้"
              actions={[
                ...(can.contact
                  ? [{ key: "alert", title: "ALERT CONTACT", detail: "ผู้ติดต่อ Admin ที่แสดงให้ผู้ใช้ที่ยังไม่ได้กำหนดคลังสแกน / ไม่มีสิทธิ์ เห็นว่าต้องติดต่อใคร", color: "#dc2626", icon: "alert" as const, onClick: () => editContacts() }]
                  : []),
                ...(can.setup ? [{ key: "setup", title: "SETUP", detail: "ตั้งค่าระบบ (Admin): PR SETTINGS / EXCEL SETUP / DEPARTMENTS", color: "#6750a4", icon: "setup" as const, onClick: () => setSetup(true) }] : []),
                ...(can.add ? [{ key: "add", title: "ADD USER", detail: "เพิ่มผู้ใช้ใหม่ กำหนดระดับ (Level) และสิทธิ์การใช้งานแต่ละหน้า", color: "#16a34a", icon: "user" as const, onClick: () => setEdit({ user: null }) }] : []),
              ]}
            />
            {can.import && (
              <>
                <ActionMenu
                  caption={["EXCEL", "TEMPLATE · IMPORT"]}
                  label="เมนู Excel ผู้ใช้"
                  actions={[
                    { key: "template", title: "TEMPLATE EXCEL", detail: "ไฟล์ต้นแบบสำหรับนำเข้าผู้ใช้และสิทธิ์ (User / Permission)", color: "#7c3aed", icon: "template", onClick: template },
                    { key: "import", title: busy ? "IMPORTING..." : "IMPORT USER / PERMISSION", detail: "นำเข้าผู้ใช้และสิทธิ์จากไฟล์ Excel (.xlsx) ตามรูปแบบ Template", color: "#0284c7", icon: "import", busy, onClick: () => fileRef.current?.click() },
                  ]}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) doImport(f);
                  }}
                />
              </>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={key} onChange={setKey} placeholder="Search User ID, name, position, department or level..." className="min-w-[240px] flex-1" />
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-extrabold text-white">{users.length.toLocaleString()} USERS</span>
        <span className="rounded-full bg-success px-3 py-1 text-xs font-extrabold text-white">{online.toLocaleString()} ONLINE</span>
        <span className="rounded-full bg-danger px-3 py-1 text-xs font-extrabold text-white">{locked.toLocaleString()} LOCKED</span>
      </div>

      {list.length === 0 ? (
        <Empty>NO USER</Empty>
      ) : (
        <>
        {/* 🖥 Desktop: ตารางผู้ใช้ · 📱 Mobile: การ์ด (แบบเดิม) */}
        <Card className="hidden lg:block">
          <div className="max-h-[calc(100dvh-230px)] overflow-auto">
            <table className="data-table t-center um-table w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>USER</th>
                  <th>LEVEL</th>
                  <th>STATUS</th>
                  <th className="max-[1440px]:hidden">POSITION / UNIT</th>
                  <th>SYSTEMS</th>
                  <th>SCAN STOCK</th>
                  <th className="max-[1180px]:hidden">LAST LOGIN</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u, i) => {
                  const tone = LEVEL_TONE[u.level] ?? "var(--primary)";
                  return (
                    <tr key={u.userId} className={`um-row ${u.isLocked ? "is-locked" : ""}`} style={{ animationDelay: `${Math.min(i, 15) * 25}ms` }}>
                      <td className="um-user">
                        <div className="flex items-center gap-3">
                          <span className="relative shrink-0">
                            <span className="grid size-10 place-items-center rounded-full text-sm font-extrabold text-white" style={{ background: tone }}>
                              {u.initials}
                            </span>
                            <span className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface ${u.isLocked ? "bg-danger" : u.isOnline ? "bg-success" : "bg-[#bdbdbd]"}`} />
                          </span>
                          <span className="min-w-0">
                            <b className="block max-w-[220px] truncate text-[#1f2350]">{u.name}</b>
                            <span className="text-[11px] font-bold text-ink-soft">ID : {u.userId}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-extrabold text-white" style={{ background: tone }}>
                          {u.levelText}
                        </span>
                      </td>
                      <td>
                        <span className={`um-status ${u.isLocked ? "is-locked" : u.isOnline ? "is-on" : ""}`}>{u.statusText}</span>
                      </td>
                      <td className="text-xs font-semibold text-ink-soft max-[1440px]:hidden">
                        <div className="mx-auto max-w-[260px] truncate" title={u.subText}>
                          {u.subText}
                        </div>
                        <div className="mx-auto max-w-[260px] truncate" title={u.subText2}>
                          {u.subText2}
                        </div>
                      </td>
                      <td>
                        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-extrabold text-primary">{u.permCount}</span>
                      </td>
                      <td className="text-xs">
                        {u.showScanChip && (
                          <div className={`mx-auto max-w-[180px] truncate font-extrabold ${u.scanNotSet ? "text-danger" : "text-success"}`} title={u.scanChipText}>
                            {u.scanChipText}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs font-semibold text-ink-soft max-[1180px]:hidden">{u.lastLoginText.replace(/^Last login\s*/i, "")}</td>
                      <td>
                        <div className="inline-flex items-center gap-1.5">
                          <RowAction kind="view" title="VIEW PERMISSION" onClick={() => setPerm({ userId: u.userId, readOnly: true })} />
                          {can.edit && <RowAction kind="edit" title="EDIT USER" onClick={() => setEdit({ user: u })} />}
                          {can.perms && (
                            <button className="cta-btn is-purple is-sm" onClick={() => setPerm({ userId: u.userId, readOnly: false })}>
                              🔑 PERMISSION
                            </button>
                          )}
                          {can.delete && <RowAction kind="delete" title="DELETE USER" onClick={() => remove(u)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
          {list.map((u) => (
            <div key={u.userId} className={`flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-sm transition hover:shadow-md ${u.isLocked ? "border-danger/50 opacity-80" : "border-line/60"}`}>
              <div className="h-1.5" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }} />
              <div className="flex gap-3 p-4">
                <div className="relative">
                  <div className="grid h-12 w-12 place-items-center rounded-full text-base font-extrabold text-white" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }}>
                    {u.initials}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface ${u.isLocked ? "bg-danger" : u.isOnline ? "bg-success" : "bg-[#bdbdbd]"}`}
                    title={u.statusText}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-extrabold text-primary">{u.name}</div>
                  <div className="text-xs font-bold text-ink-soft">ID : {u.userId}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }}>
                      {u.levelText}
                    </span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${u.isLocked ? "bg-[#ffebee] text-danger" : u.isOnline ? "bg-[#e8f5e9] text-success" : "bg-surface-2 text-ink-soft"}`}>
                      {u.statusText}
                    </span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-extrabold text-primary">{u.permCount} SYSTEMS</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-0.5 px-4 pb-2 text-xs font-semibold text-ink-soft">
                {u.subText && <div className="truncate">{u.subText}</div>}
                {u.subText2 && <div className="truncate">{u.subText2}</div>}
                <div className="truncate">{u.lastLoginText}</div>
                {u.showScanChip && <div className={`truncate font-extrabold ${u.scanNotSet ? "text-danger" : "text-success"}`}>{u.scanChipText}</div>}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line/60 p-2">
                <RowAction kind="view" title="VIEW PERMISSION" onClick={() => setPerm({ userId: u.userId, readOnly: true })} />
                {can.edit && <RowAction kind="edit" title="EDIT USER" onClick={() => setEdit({ user: u })} />}
                {can.perms && (
                  <button className="cta-btn is-purple is-sm" onClick={() => setPerm({ userId: u.userId, readOnly: false })}>
                    🔑 PERMISSION
                  </button>
                )}
                {can.delete && (
                  <span className="ml-auto">
                    <RowAction kind="delete" title="DELETE USER" onClick={() => remove(u)} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {edit && (
        <UserEditModal
          user={edit.user}
          isSelf={!!edit.user && edit.user.userId.toLowerCase() === me.toLowerCase()}
          onClose={() => setEdit(null)}
          onSaved={(m) => {
            setEdit(null);
            toast.show(edit.user ? "Saved" : "User added", m, "ok");
            load();
          }}
        />
      )}
      {perm && (
        <PermissionModal
          userId={perm.userId}
          readOnly={perm.readOnly}
          canContact={can.contact}
          onClose={() => setPerm(null)}
          onEditContacts={editContacts}
          onSaved={(m) => {
            setPerm(null);
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
      {setup && <SetupModal onClose={() => setSetup(false)} />}
    </PageBody>
  );
}
