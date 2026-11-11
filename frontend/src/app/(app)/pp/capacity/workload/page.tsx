import { Suspense } from "react";
import Workload from "./Workload";

// 👥 PRODUCTION PLAN › CAPACITY › WORKLOAD (สรุปอัตรากำลังคน แผน, ผล · ?month=yyyy-MM) · ต่อจากหน่วยงานสุดท้าย (QC)
export default function Page() {
  return (
    <Suspense>
      <Workload />
    </Suspense>
  );
}
