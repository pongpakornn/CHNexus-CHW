"use client";

import { MotionConfig } from "framer-motion";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/notifications/Toasts";
import { DialogProvider } from "@/components/modals/Dialogs";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // reducedMotion="user": a device set to "reduce motion" turns every framer-motion movement into a plain fade
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <ToastProvider>
          <DialogProvider>{children}</DialogProvider>
        </ToastProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
