import { cn } from "@/lib/utils";

interface ColorBadgeProps {
  color: string;
  children: React.ReactNode;
  size?: "2xs" | "xs" | "sm";
  bordered?: boolean;
  uppercase?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<string, string> = {
  "2xs": "text-[8px] px-[5px] py-[1px]",
  xs: "text-[9px] px-1.5 py-0.5",
  sm: "text-[10px] px-1.5 py-0.5",
};

// One shared color-coded pill. Replaces the security-view SeverityBadge /
// CvssBadge, repo-row's PRIORITY map, and sprint-view's inline priority
// pill — all previously separate, near-identical implementations.
export function ColorBadge({
  color,
  children,
  size = "xs",
  bordered = false,
  uppercase = false,
  className,
}: ColorBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded font-mono font-bold flex-shrink-0",
        SIZE_CLASSES[size],
        uppercase && "uppercase",
        className
      )}
      style={{
        color,
        background: `${color}20`,
        border: bordered ? `1px solid ${color}30` : undefined,
      }}
    >
      {children}
    </span>
  );
}
