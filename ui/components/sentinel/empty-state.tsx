import { cn } from "@/lib/utils";

// Shared "couldn't reach the API" banner — replaces the ad hoc version each
// page (agents, repos, security, sprint) used to reimplement. Preserves the
// app's existing "no mock-data fallback" convention: this is an honest
// error state, never a place to show fabricated data.
export function ApiErrorBanner({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        "px-4 py-3 rounded-lg border border-s-red/40 bg-s-red/10 text-[11px] text-s-red font-mono",
        className
      )}
    >
      ⚠ Could not reach the {label} API — showing no data rather than guessing. Check the backend connection and refresh.
    </div>
  );
}

export function EmptyNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 py-6 text-center text-[11px] text-s-dim", className)}>
      {children}
    </div>
  );
}
