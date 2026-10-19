import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A free-text note that saves when you click away (Oct 2026 quote feedback: booking, daily and item notes).
 * Grows with its text. Empty means no note, and the client quote shows nothing for it. Typed by people only.
 */
export function NoteArea({ value, onCommit, placeholder, className, label }: {
  value: string | null;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!focused) setDraft(value ?? ""); }, [value, focused]);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [draft]);

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label ?? placeholder}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = draft.trim();
        if (v !== (value ?? "").trim()) onCommit(v);
      }}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent rounded px-1 py-0.5 text-sm leading-snug outline-none",
        "placeholder:text-muted-foreground/60 hover:bg-secondary/60 focus:bg-secondary/60 focus:ring-1 focus:ring-ring",
        className,
      )}
    />
  );
}
