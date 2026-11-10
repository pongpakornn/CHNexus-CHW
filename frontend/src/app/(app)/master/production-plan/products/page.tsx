import { Suspense } from "react";
import MachineProducts from "./MachineProducts";

// 📋 MASTER DATA › PRODUCTION PLAN › MACHINE PRODUCTS
export default function Page() {
  return (
    <Suspense>
      <MachineProducts />
    </Suspense>
  );
}
