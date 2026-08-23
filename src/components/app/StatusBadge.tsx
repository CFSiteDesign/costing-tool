import type { ProductStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

const VAR: Record<ProductStatus, string> = {
  active: "--st-active",
  paused: "--st-paused",
  signature: "--st-signature",
  pending_update: "--st-pending",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{
        color: `hsl(var(${VAR[status]}))`,
        backgroundColor: `hsl(var(${VAR[status]}) / 0.12)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `hsl(var(${VAR[status]}))` }} />
      {STATUS_LABELS[status]}
    </span>
  );
}
