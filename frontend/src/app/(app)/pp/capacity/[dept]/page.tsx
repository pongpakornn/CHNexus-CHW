import { Suspense } from "react";
import Capacity from "./Capacity";

// 🏭 PRODUCTION PLAN › CAPACITY › <หน่วยงาน> (เช่น /pp/capacity/press1)
export default async function Page({ params }: { params: Promise<{ dept: string }> }) {
  const { dept } = await params;
  const d = /^[a-z0-9_-]{1,20}$/i.test(dept) ? dept : "press1";
  return (
    <Suspense>
      <Capacity key={d} dept={d} />
    </Suspense>
  );
}
