import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "gold" | "success" | "warning" | "danger" | "info" | "muted";

const toneIcon: Record<Tone, string> = {
  gold: "bg-primary/12 text-primary ring-primary/25",
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/12 text-warning ring-warning/25",
  danger: "bg-destructive/12 text-destructive ring-destructive/25",
  info: "bg-info/12 text-info ring-info/25",
  muted: "bg-muted text-muted-foreground ring-border",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "gold",
  delay = 0,
  highlight = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  delay?: number;
  highlight?: boolean;
  onClick?: (() => void) | undefined;
}) {
  const interactive = onClick !== undefined;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-haspopup={interactive ? "dialog" : undefined}
      aria-label={interactive ? `Open ${label.toLowerCase()} view` : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-xl border bg-card p-3.5 shadow-card sm:p-5 card-hover animate-fade-up",
        highlight && "border-primary/35 bg-gold-soft",
        interactive &&
          "cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase leading-tight tracking-wider text-muted-foreground sm:text-xs">{label}</div>
          <div className="mt-1.5 truncate font-display text-xl font-semibold sm:mt-2 sm:text-2xl text-foreground sm:text-[1.7rem]">{value}</div>
          {hint && <div className="mt-1 truncate text-[11px] text-muted-foreground sm:text-xs">{hint}</div>}
        </div>
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 sm:h-10 sm:w-10", toneIcon[tone])}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}
