"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

// Written for Tailwind v3 (this project's version). The stock shadcn file used
// Tailwind v4 variants such as `data-checked:`, which v3 ignores, so the
// switch rendered with no track or thumb and the settings toggles were
// invisible. Base UI sets empty `data-checked` / `data-unchecked` attributes,
// matched here with v3's `data-[checked]:` syntax.
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "group/switch relative inline-flex shrink-0 items-center rounded-full border border-s-border2 transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-s-gold/50",
        "data-[checked]:bg-s-gold data-[checked]:border-s-gold data-[unchecked]:bg-s-s2",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        size === "sm" ? "h-[14px] w-[24px]" : "h-[18px] w-[32px]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-s-text shadow transition-transform translate-x-[1px]",
          "data-[checked]:bg-s-bg",
          size === "sm" ? "size-[10px] data-[checked]:translate-x-[11px]" : "size-[14px] data-[checked]:translate-x-[15px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
