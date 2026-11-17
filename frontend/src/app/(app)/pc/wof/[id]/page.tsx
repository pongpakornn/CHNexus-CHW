import { Suspense } from "react";
import WofPlan from "../WofPlan";

// 🗂 PC › WORK ORDER FOLLOW › plan (/pc/wof/<planId>?month=yyyy-MM)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = /^\d{1,9}$/.test(id) ? Number(id) : 0;
  return (
    <Suspense>
      <WofPlan key={n} id={n} />
    </Suspense>
  );
}
