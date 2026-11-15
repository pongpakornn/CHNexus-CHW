"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useDialogs } from "@/components/modals/Dialogs";

// ⚠ ค่าที่ยังไม่ SAVE: ปิด / รีเฟรชแท็บ = Browser ถามเอง · กดลิงก์ในแอป (Sidebar ฯลฯ) = กล่องยืนยัน
//   shortcut: ปุ่ม Back ของ Browser ไม่ถูกดัก (Next ไม่เปิดช่องให้) · ถ้าต้องดักให้ย้ายไปใช้ navigation API
export function useUnsavedGuard(dirty: boolean, what = "การตั้งค่า") {
  const dlg = useDialogs();
  const router = useRouter();
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === location.pathname + location.search) return;
      e.preventDefault();
      e.stopPropagation(); // capture ที่ document = ก่อน <Link> ของ Next ทำงาน
      dlg.confirm({ title: "UNSAVED CHANGES", message: `มี${what}ที่ยังไม่ได้กด SAVE\nต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?`, ok: "LEAVE" }).then((ok) => ok && router.push(url.pathname + url.search + url.hash));
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, what, dlg, router]);
}
