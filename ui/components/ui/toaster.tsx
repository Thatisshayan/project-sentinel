"use client";

import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toastManager } from "@/lib/toast";

function ToastList() {
  const { toasts } = Toast.useToastManager();

  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className={cn(
        "rounded-lg border px-3.5 py-3 shadow-lg backdrop-blur-sm",
        "transition-all data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0",
        "data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0",
        t.type === "error"
          ? "border-s-red/40 bg-[#1a0f0f]/95 text-s-red"
          : t.type === "success"
          ? "border-s-green/40 bg-[#0f1a12]/95 text-s-green"
          : "border-s-border bg-s-surface/95 text-s-text",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <Toast.Title className="text-xs font-semibold" />
          <Toast.Description className="text-[11px] text-s-muted mt-0.5" />
        </div>
        <Toast.Close
          className="flex-shrink-0 text-s-dim hover:text-s-text transition-colors"
          aria-label="Dismiss"
        >
          <X size={13} />
        </Toast.Close>
      </div>
    </Toast.Root>
  ));
}

export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
