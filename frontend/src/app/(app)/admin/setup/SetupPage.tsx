"use client";

import { useState } from "react";
import { Card, Loading, PageBody, PageHeader } from "@/components/layout/Page";
import { useAuth } from "@/lib/auth";
import { SETUP_GROUPS } from "@/lib/menu";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { EdpAlertPanel } from "../users/EdpAlertPanel";
import { LayoutPanel } from "../users/LayoutPanel";
import { MinReasonPanel } from "../users/MinReasonPanel";
import { MinReportPanel } from "../users/MinReportPanel";
import { SignFlowPanel } from "../users/SignFlowPanel";
import { UserOrgPanel } from "../users/UserOrgPanel";
import { DeptPanel, ExcelPanel, PrPanel } from "./BasicPanels";

type D = (v: boolean) => void;
const PANELS: Record<string, (onDirty: D) => React.ReactNode> = {
  "pr-settings": (d) => <PrPanel onDirty={d} />,
  excel: (d) => <ExcelPanel onDirty={d} />,
  departments: (d) => <DeptPanel onDirty={d} />,
  "min-report": (d) => <MinReportPanel onDirty={d} />,
  "min-reasons": (d) => <MinReasonPanel onDirty={d} />,
  "sign-flow-min": (d) => <SignFlowPanel onDirty={d} only="min" />,
  "sign-flow-chem": (d) => <SignFlowPanel onDirty={d} only="chem" />,
  layout: () => <LayoutPanel />, // บันทึกทันทีทุกครั้ง ไม่มีค่าค้าง SAVE
  "edp-alert": (d) => <EdpAlertPanel onDirty={d} />,
  organization: (d) => <UserOrgPanel onDirty={d} />,
};

// ⚙ SYSTEM CONFIGURATION: หน้าละ 1 แผง (เดิมอยู่ใน SetupModal) · Admin Level 1 เท่านั้น (Server ตรวจซ้ำที่ SetupController)
export default function SetupPage({ slug }: { slug: string }) {
  const { me, loading } = useAuth();
  if (loading || !me) return <Loading />;
  if (me.userLevel !== 1)
    return (
      <PageBody>
        <Card>
          <p className="p-6 text-center text-sm font-bold text-danger">NO PERMISSION · SYSTEM CONFIGURATION is for Admin Level 1 only</p>
        </Card>
      </PageBody>
    );
  return <Panel slug={slug} />;
}

function Panel({ slug }: { slug: string }) {
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const group = SETUP_GROUPS.find((g) => g.items.some(([s]) => s === slug));
  const label = group?.items.find(([s]) => s === slug)?.[1];
  if (!group || !label || !PANELS[slug])
    return (
      <PageBody>
        <Card>
          <p className="p-6 text-center text-sm font-bold text-ink-soft">UNKNOWN SETUP PAGE</p>
        </Card>
      </PageBody>
    );
  return (
    <PageBody>
      <PageHeader icon="/icons/management.png" title={label} subtitle={group.name} />
      <Card clip={false}>
        <div className="p-3 md:p-4">{PANELS[slug](setDirty)}</div>
      </Card>
    </PageBody>
  );
}
