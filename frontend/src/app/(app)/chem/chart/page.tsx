import { Suspense } from "react";
import ChemChart from "./ChemChart";

// 🧪 CHEMICAL CONTROL › CONTROL CHART (?p=<พารามิเตอร์>&month=yyyy-MM)
export default function Page() {
  return (
    <Suspense>
      <ChemChart />
    </Suspense>
  );
}
