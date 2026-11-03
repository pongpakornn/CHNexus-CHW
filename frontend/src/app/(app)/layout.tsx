import { AppGate } from "@/components/layout/AppGate";

// หน้าในระบบ: ต้อง Login ก่อน (AppGate)
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
