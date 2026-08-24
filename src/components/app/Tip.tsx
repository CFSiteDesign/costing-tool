import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Terse hover tooltip. Wrap any element; keeps its behaviour. */
export function Tip({
  label, children, side = "top",
}: { label: string; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-[260px] text-xs leading-relaxed">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Dotted-underline header label that invites hovering. */
export function TipHead({ label, tip }: { label: string; tip: string }) {
  return (
    <Tip label={tip}>
      <span className="cursor-help underline decoration-dotted underline-offset-4 decoration-muted-foreground/50">
        {label}
      </span>
    </Tip>
  );
}
