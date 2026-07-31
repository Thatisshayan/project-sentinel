import { cn } from "@/lib/utils";

interface PagePanelProps {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

// One shared bordered-panel wrapper standardizing the header/padding/border
// every page hand-rolled independently (security-view, sprint-view,
// agents-view's leaderboard all had their own copy of this shell).
export function PagePanel({ title, action, children, className, bodyClassName }: PagePanelProps) {
  return (
    <div className={cn("border border-s-border rounded-lg overflow-hidden", className)}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-s-border bg-white/[0.01]">
          <span className="text-[10px] font-bold uppercase tracking-widest text-s-dim">{title}</span>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
