"use client";

import { useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/layout/Page";
import { WorkdayBoard } from "@/components/workdays/WorkdayBoard";
import { api } from "@/lib/api";

// 📅 MASTER DATA › WORKDAYS: วันทำงานของลูกค้า (ใช้หาค่าเฉลี่ยต่อวันใน Max-Min Calculator)
export default function Page() {
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    api<{ canEdit: boolean }>("/maxmin/stocks")
      .then((r) => setCanEdit(r.canEdit))
      .catch(() => setCanEdit(false));
  }, []);
  return (
    <PageBody className="md-gray">
      <PageHeader icon="/icons/CalculatorMxMn.png" title="CUSTOMER WORKDAYS" subtitle="MASTER DATA · ปฏิทินวันทำงานของลูกค้าแต่ละราย · กดวัน = วันทำงาน" />
      <Card bodyClass="p-4 md:p-5">
        <WorkdayBoard canEdit={canEdit} />
      </Card>
    </PageBody>
  );
}
