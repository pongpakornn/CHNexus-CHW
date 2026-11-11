import { Suspense } from "react";
import PpDashboard from "./PpDashboard";

// 📈 PRODUCTION PLAN › DASHBOARD (?dept=PRESS1 …)
export default function Page() {
  return (
    <Suspense>
      <PpDashboard />
    </Suspense>
  );
}
