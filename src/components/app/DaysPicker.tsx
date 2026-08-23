import { DAY_LETTERS } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 7-segment day control: the brief's "Siem Reap on a Monday" test in one click. */
export function DaysPicker({
  value, onChange, size = "md",
}: { value: number[]; onChange: (days: number[]) => void; size?: "sm" | "md" }) {
  const toggle = (d: number) =>
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  return (
    <div className="inline-flex rounded-md border overflow-hidden">
      {DAY_LETTERS.map((l, i) => {
        const d = i + 1;
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={cn(
              "font-medium transition-colors border-r last:border-r-0",
              size === "sm" ? "w-6 h-6 text-[11px]" : "w-8 h-8 text-xs",
              on ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-secondary",
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

/** Single-select variant used as a table filter (null = any day). */
export function DayFilter({
  value, onChange,
}: { value: number | null; onChange: (d: number | null) => void }) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden">
      {DAY_LETTERS.map((l, i) => {
        const d = i + 1;
        const on = value === d;
        return (
          <button
            key={d}
            type="button"
            title={`Runs on ${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][i]}`}
            onClick={() => onChange(on ? null : d)}
            className={cn(
              "w-8 h-9 text-xs font-medium transition-colors border-r last:border-r-0",
              on ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground hover:bg-secondary",
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
