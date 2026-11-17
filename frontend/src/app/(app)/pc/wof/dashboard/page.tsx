import { Suspense } from "react";
import WofDashboard from "./WofDashboard";

export default function Page() {
  return (
    <Suspense>
      <WofDashboard />
    </Suspense>
  );
}
