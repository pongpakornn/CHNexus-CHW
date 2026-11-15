"use client";

import { useRef, useState } from "react";
import { ActionMenu } from "@/components/menus/ActionMenu";
import { useToast } from "@/components/notifications/Toasts";
import { download, upload } from "@/lib/api";
import { ImportReview } from "./ImportReview";
import type { ImportPreview } from "./types";

// EXCEL button: TEMPLATE (download) + IMPORT (pick .xlsx -> preview -> ImportReview). Hides what the user has no right for.
export function ExcelMenu({ templateUrl, importUrl, applyUrl, canTemplate, canImport, title, warn, onDone }: { templateUrl: string; importUrl: string; applyUrl: string; canTemplate: boolean; canImport: boolean; title: string; warn?: string; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  if (!canTemplate && !canImport) return null;

  async function pick(f: File) {
    if (busy) return;
    setBusy(true);
    try {
      setPv(await upload<ImportPreview>(importUrl, f));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ActionMenu
        caption={["EXCEL", "TEMPLATE · IMPORT"]}
        label={`เมนู Excel ${title}`}
        actions={[
          ...(canTemplate ? [{ key: "template", title: "TEMPLATE", detail: `ไฟล์ต้นแบบสำหรับนำเข้า ${title}`, color: "#7c3aed", icon: "template" as const, onClick: () => download(templateUrl).then((n) => toast.show("Template", `สร้างไฟล์ Template แล้ว\n${n}`, "ok")).catch((e) => toast.show("ERROR", e.message, "error")) }] : []),
          ...(canImport ? [{ key: "import", title: busy ? "กำลังตรวจไฟล์…" : "IMPORT", detail: `นำเข้า ${title} จากไฟล์ Excel (.xlsx) แล้วตรวจก่อนบันทึก`, color: "#0284c7", icon: "import" as const, busy, onClick: () => fileRef.current?.click() }] : []),
        ]}
      />
      {canImport && (
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) pick(f);
          }}
        />
      )}
      {pv && (
        <ImportReview
          preview={pv}
          applyUrl={applyUrl}
          warn={warn}
          onClose={() => setPv(null)}
          onDone={() => {
            setPv(null);
            onDone();
          }}
        />
      )}
    </>
  );
}
