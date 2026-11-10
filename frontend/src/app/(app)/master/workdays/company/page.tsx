"use client";

import { useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/layout/Page";
import { WorkdayBoard, COMPANY_CODE } from "@/components/workdays/WorkdayBoard";
import { api } from "@/lib/api";

// 📅 MASTER DATA › WORKDAYS: วันทำงานของบริษัท (CH RADIATORS)
export default function Page() {
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    api<{ canEdit: boolean }>("/maxmin/stocks")
      .then((r) => setCanEdit(r.canEdit))
      .catch(() => setCanEdit(false));
  }, []);
  return (
    <PageBody className="md-gray">
      <PageHeader icon="/icons/CalculatorMxMn.png" title="COMPANY WORKDAYS" subtitle="MASTER DATA · ปฏิทินวันทำงานของบริษัท · กดวัน = วันทำงาน" />
      <Card bodyClass="p-4 md:p-5">
        <WorkdayBoard canEdit={canEdit} fixed={COMPANY_CODE} />
      </Card>
    </PageBody>
  );
}
