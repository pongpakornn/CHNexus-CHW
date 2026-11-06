"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { Loading } from "@/components/layout/Page";
import { StockCards } from "./StockCards";
import { StockTable } from "./StockTable";

// 🏬 Store (Max-Min): /store = การ์ดคลัง / /store?stk=<id> = ตารางของคลังนั้น
function StorePage() {
  const params = useSearchParams();
  const router = useRouter();
  const stk = Number(params.get("stk")) || null;
  const back = useCallback(() => router.push("/cims/store"), [router]);
  return stk ? <StockTable key={stk} stkId={stk} onBack={back} initialFilter={params.get("f") ?? ""} openMinReport={params.get("mr") === "pending"} /> : <StockCards onOpen={(id) => router.push(`/cims/store?stk=${id}`)} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <StorePage />
    </Suspense>
  );
}
