"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/layout/Page";
import { STOCK_TYPES } from "@/lib/menu";
import InventoryPage from "./InventoryPage";

// 🏷️ MASTER DATA › PRODUCT CONTROL: /master/product?type=PRODUCT (Part Information) &stk=<คลัง>
//   เปลี่ยนประเภท / คลังจากเมนู = เริ่มหน้าใหม่ (key) · ไม่มี type = ทุกคลังแบบเดิม
function ProductPage() {
  const p = useSearchParams();
  const type = p.get("type")?.toUpperCase() || undefined;
  const stk = Number(p.get("stk")) || undefined;
  const info = STOCK_TYPES.find((t) => t.type === type);
  return <InventoryPage key={`${type}|${stk}`} type={type} stk={stk} title={info ? `PRODUCT CONTROL • ${info.label.toUpperCase()}` : undefined} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ProductPage />
    </Suspense>
  );
}
