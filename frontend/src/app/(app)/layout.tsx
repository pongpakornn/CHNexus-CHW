import { AppGate } from "@/components/AppGate";

// หน้าในระบบ: ต้อง Login ก่อน (AppGate)
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
