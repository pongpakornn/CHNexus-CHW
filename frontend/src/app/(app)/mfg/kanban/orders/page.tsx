import { Suspense } from "react";
import { Loading } from "@/components/layout/Page";
import KanbanOrders from "../KanbanOrders";

// 🏭 KANBAN CONTROL › สั่งผลิต (?receipt=<id> from สะสม / รับยอด)
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <KanbanOrders />
    </Suspense>
  );
}
