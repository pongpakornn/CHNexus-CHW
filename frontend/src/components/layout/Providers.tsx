"use client";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/notifications/Toasts";
import { DialogProvider } from "@/components/modals/Dialogs";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
