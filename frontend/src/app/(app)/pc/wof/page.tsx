import { Suspense } from "react";
import WofList from "./WofList";

// 🗂 PC › WORK ORDER FOLLOW (?month=yyyy-MM)
export default function Page() {
  return (
    <Suspense>
      <WofList />
    </Suspense>
  );
}
