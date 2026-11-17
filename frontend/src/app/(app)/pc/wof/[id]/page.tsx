import { Suspense } from "react";
import WofSheet from "../WofSheet";

// 🗂 PC › WORK ORDER FOLLOW › ชีท (/pc/wof/<sheetId>)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = /^\d{1,9}$/.test(id) ? Number(id) : 0;
  return (
    <Suspense>
      <WofSheet key={n} id={n} />
    </Suspense>
  );
}
