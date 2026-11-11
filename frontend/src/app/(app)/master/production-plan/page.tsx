import { Suspense } from "react";
import MachineStd from "./MachineStd";

// 📈 MASTER DATA › PRODUCTION PLAN › MACHINE STD (?dept=PRESS1 …)
export default function Page() {
  return (
    <Suspense>
      <MachineStd />
    </Suspense>
  );
}
