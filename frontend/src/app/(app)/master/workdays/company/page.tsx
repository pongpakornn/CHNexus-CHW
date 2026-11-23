"use client";

import { useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/layout/Page";
import { WorkdayBoard, COMPANY_CODE } from "@/components/workdays/WorkdayBoard";
import { BreakTimes } from "@/components/workdays/BreakTimes";
import { api } from "@/lib/api";

// 📅 MASTER DATA › WORKDAYS: วันทำงานของบริษัท (CH RADIATORS) · ⏸ BREAK TIMES (เวลาหยุดนับชั่วคราว)
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
      <div className="flex flex-col gap-4">
        <Card bodyClass="p-4 md:p-5">
          <WorkdayBoard canEdit={canEdit} fixed={COMPANY_CODE} />
        </Card>
        <BreakTimes />
      </div>
    </PageBody>
  );
}
