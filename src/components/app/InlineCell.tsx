import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Click-to-edit cell: Enter/blur commits, Esc cancels. The "faster than the sheet" promise. */
export function InlineText({
  value, onCommit, className, numeric, placeholder, confirmLargeChange,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  numeric?: boolean;
  placeholder?: string;
  /** for rates: warn when the change is > 40% */
  confirmLargeChange?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft === value) return;
    if (confirmLargeChange && numeric) {
      const oldN = parseFloat(value), newN = parseFloat(draft);
      if (isFinite(oldN) && isFinite(newN) && oldN > 0) {
        const pct = Math.abs(newN - oldN) / oldN;
        if (pct > 0.4 && !window.confirm(
          `$${oldN} → $${newN} is a ${Math.round(pct * 100)}% change. Save?`)) {
          setDraft(value);
          return;
        }
      }
    }
    onCommit(draft);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        className={cn("w-full bg-background border border-ring rounded px-1.5 py-0.5 text-sm outline-none", numeric && "text-right tabular-nums", className)}
        value={draft}
        inputMode={numeric ? "decimal" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "w-full text-left px-1.5 py-0.5 rounded text-sm hover:bg-secondary cursor-text min-h-[26px]",
        numeric && "text-right tabular-nums",
        !value && "text-muted-foreground italic",
        className,
      )}
    >
      {value || placeholder || "—"}
    </button>
  );
}
