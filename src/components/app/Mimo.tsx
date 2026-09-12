import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Tip } from "@/components/app/Tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { X, Check, Undo2, Pencil, Send } from "lucide-react";

/** MIMO: the Mad Monkey assistant. A clean slide-over; the model proposes, the person confirms, the app applies. */

export interface MimoChange {
  id: string; product_id: string; product_title: string; field: string; label: string; confidence: "exact" | "likely" | "unsure";
  alternatives: { product_id: string; title: string }[]; note: string | null; strong: string | null; reden: boolean;
  old: string; new: string; patch: Record<string, unknown>; undo: Record<string, unknown>; used_name?: string;
  state?: "pending" | "sure" | "applied" | "undone" | "cancelled" | "failed"; learned?: string | null;
}
interface Turn { role: "user" | "assistant"; content: string; kind?: string; changes?: MimoChange[]; log_id?: number | null; editing?: string | null }

const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void; toggle: () => void }>({ open: false, setOpen: () => {}, toggle: () => {} });
export const useMimo = () => useContext(Ctx);

export function MimoProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  return <Ctx.Provider value={{ open, setOpen, toggle: () => setOpen((o) => !o) }}>{children}</Ctx.Provider>;
}

/** Sidebar entry. Collapsed rail shows the head alone with a tooltip. */
export function MimoNavButton({ collapsed }: { collapsed: boolean }) {
  const { open, toggle } = useMimo();
  const btn = (
    <button onClick={toggle} className={cn("w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors", collapsed && "justify-center", open ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/60")}>
      <img src="/mm-head.png" alt="" className="h-5 w-5 shrink-0" />
      {!collapsed && <span>MIMO</span>}
      {!collapsed && <span className="ml-auto text-[10px] text-muted-foreground/70">⌘K</span>}
    </button>
  );
  return collapsed ? <Tip side="right" label="MIMO: tell it what to change at your hostel, in plain words. It checks with you before anything changes.">{btn}</Tip> : btn;
}

const PAGES: [RegExp, string][] = [[/^\/experiences/, "Experiences list"], [/^\/week/, "My week"], [/^\/transport/, "Transport"], [/^\/activity/, "Activity"], [/^\/quotes/, "Quotes"], [/^\/global-events/, "Global events"], [/^\/approvals/, "Approvals"], [/^\/settings/, "Settings"]];
const CHIPS = ["Change a price", "Move a time", "Pause something"];
const FILL: Record<string, string> = { "Change a price": "Change the price of ", "Move a time": "Move ", "Pause something": "Pause " };

export function MimoPanel() {
  const { open, setOpen } = useMimo();
  const auth = useAuth();
  const qc = useQueryClient();
  const loc = auth.currentLocation;
  const { pathname } = useLocation();
  const pageCtx = useMemo(() => {   // where the GM is, so "this one" and a bare "price 12" land on the product in front of them
    const m = pathname.match(/^\/experiences\/([0-9a-f-]{36})$/i);
    if (m) return { page: "product", product_id: m[1] };
    const name = PAGES.find(([r]) => r.test(pathname))?.[1] ?? "app";
    return { page: name };
  }, [pathname]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const rawFirst = (auth.fullName || "").trim().split(/\s+/)[0] || "";
  const first = /^(gm|admin|test|user)$/i.test(rawFirst) || (auth.session?.user.email ?? "").endsWith("@madmonkey.test") ? "" : rawFirst;
  const [met, setMet] = useState<boolean | null>(null);   // null = not loaded yet
  const [step, setStep] = useState(0);
  useEffect(() => { (async () => {
    const { data: me } = await supabase.auth.getUser(); if (!me.user) return;
    const { data } = await supabase.from("profiles").select("mimo_met_at").eq("id", me.user.id).maybeSingle();
    setMet(!!data?.mimo_met_at);
  })(); }, []);
  const finishMeet = async () => {
    setMet(true);
    const { data: me } = await supabase.auth.getUser();
    if (me.user) await supabase.from("profiles").update({ mimo_met_at: new Date().toISOString() }).eq("id", me.user.id);
  };
  /** MIMO learns a nickname from a confirmed action: the words the GM used, tied to the product they confirmed. */
  const learn = async (c: MimoChange) => {
    const used = (c.used_name ?? "").trim();
    if (!loc || used.length < 3 || used.toLowerCase() === c.product_title.trim().toLowerCase()) return null;
    const { error } = await supabase.rpc("learn_alias", { p_location: loc.id, p_product: c.product_id, p_alias: used });
    return error ? null : used;
  };

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, busy]);
  useEffect(() => { setTurns([]); }, [loc?.id]);   // a different hostel is a different conversation

  const send = async (content: string) => {
    const msg = content.trim(); if (!msg || busy || !loc) return;
    const history: Turn[] = [...turns, { role: "user", content: msg }];
    setTurns(history); setText(""); setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mimo", {
        body: { location_id: loc.id, context: pageCtx, messages: history.slice(-12).map((t) => ({ role: t.role, content: t.role === "assistant" ? assistantMemory(t) : t.content })) },
      });
      if (error) throw new Error(error.message);
      if (data?.error && !data?.reply) throw new Error(data.error);
      setTurns((ts) => [...ts, { role: "assistant", content: data.reply, kind: data.kind, log_id: data.log_id, changes: (data.changes ?? []).map((c: MimoChange) => ({ ...c, state: "pending" })) }]);
    } catch (e) {
      setTurns((ts) => [...ts, { role: "assistant", content: `That didn't work my end, nothing changed. ${(e as Error).message}`, kind: "cannot", changes: [] }]);
    } finally { setBusy(false); }
  };

  const setChange = (turnIdx: number, id: string, patch: Partial<MimoChange>) =>
    setTurns((ts) => ts.map((t, i) => i === turnIdx ? { ...t, changes: t.changes?.map((c) => c.id === id ? { ...c, ...patch } : c) } : t));
  const logOutcome = async (turn: Turn, outcome: string, applied?: unknown) => { if (turn.log_id) await supabase.from("prompt_edits").update({ outcome, applied: applied ?? null }).eq("id", turn.log_id); };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["my-week"] }); qc.invalidateQueries({ queryKey: ["transport"] }); qc.invalidateQueries({ queryKey: ["product"] }); };

  const apply = async (turnIdx: number, c: MimoChange) => {
    if (c.strong && c.state !== "sure") { setChange(turnIdx, c.id, { state: "sure" }); return; }
    const { error } = await supabase.from("products").update(c.patch).eq("id", c.product_id);
    if (error) { setChange(turnIdx, c.id, { state: "failed", note: error.message }); await logOutcome(turns[turnIdx], "failed"); return; }
    const learned = await learn(c);
    setChange(turnIdx, c.id, { state: "applied", learned }); refresh(); await logOutcome(turns[turnIdx], "applied", { product_id: c.product_id, patch: c.patch, learned });
  };
  const undo = async (turnIdx: number, c: MimoChange) => {
    const { error } = await supabase.from("products").update(c.undo).eq("id", c.product_id);
    if (error) { setChange(turnIdx, c.id, { note: error.message }); return; }
    setChange(turnIdx, c.id, { state: "undone" }); refresh(); await logOutcome(turns[turnIdx], "undone");
  };
  const cancel = async (turnIdx: number, c: MimoChange) => { setChange(turnIdx, c.id, { state: "cancelled" }); await logOutcome(turns[turnIdx], "cancelled"); };

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/10 sm:hidden" onClick={() => setOpen(false)} />}
      <aside className={cn("fixed top-0 right-0 z-50 h-full w-full sm:w-[420px] bg-background border-l flex flex-col transition-transform duration-200", open ? "translate-x-0" : "translate-x-full")} aria-hidden={!open}>
        <div className="h-14 shrink-0 border-b flex items-center gap-2.5 px-4">
          <img src="/mm-head.png" alt="" className="h-6 w-6" />
          <span className="font-semibold">MIMO</span>
          {loc && <span className="text-[11px] rounded-full border px-2 py-0.5 text-muted-foreground">{loc.name}</span>}
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-[14px]">
          {turns.length === 0 && met === false && (
            <MeetMimo step={step} setStep={setStep} hostel={loc?.name ?? "your hostel"} first={first}
              onTry={(example) => { finishMeet(); setText(example); inputRef.current?.focus(); }} onDone={finishMeet} />
          )}
          {turns.length === 0 && met !== false && (
            <div className="space-y-3 pt-6">
              <p className="text-[15px]">Hey{first ? ` ${first}` : ""}. What needs changing at {loc?.name ?? "your hostel"}?</p>
              <div className="flex flex-wrap gap-1.5">
                {CHIPS.map((c) => <button key={c} className="rounded-full border px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary" onClick={() => { setText(FILL[c]); inputRef.current?.focus(); }}>{c}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, i) => t.role === "user" ? (
            <div key={i} className="flex justify-end"><span className="max-w-[85%] rounded-2xl bg-secondary px-3 py-1.5 text-[13.5px]">{t.content}</span></div>
          ) : (
            <div key={i} className="flex gap-2.5 animate-mimo-in motion-reduce:animate-none">
              <img src="/mm-head.png" alt="" className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="leading-relaxed">{t.content}</p>
                {t.changes?.map((c) => <ChangeCard key={c.id} c={c} onConfirm={() => apply(i, c)} onCancel={() => cancel(i, c)} onUndo={() => undo(i, c)}
                  onPick={async (alt) => { if (loc && c.used_name && c.used_name.length >= 3) await supabase.rpc("learn_alias", { p_location: loc.id, p_product: alt.product_id, p_alias: c.used_name }); send(`I mean "${alt.title}"`); }} onChange={(v) => send(`Make that ${v} instead`)} busy={busy} />)}
              </div>
            </div>
          ))}
          {busy && <Thinking prompt={[...turns].reverse().find((t) => t.role === "user")?.content ?? ""} hostel={loc?.name ?? "your hostel"} ccy={loc?.currency ?? "local"} />}
          <div ref={endRef} />
        </div>

        <form className="shrink-0 border-t p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <Input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell MIMO what to change" className="h-10" disabled={busy || !loc} maxLength={600} />
          <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </aside>
    </>
  );
}

/** What MIMO says while she works. A pool picked from what was asked, then the general lines; {hostel} and {ccy} fill in. */
const LINES: Record<string, string[]> = {
  price: ["Doing the sums in dollars and {ccy}", "Checking the going rate at {hostel}", "Counting the bananas", "Making sure a backpacker would still pay it"],
  time: ["Working out what day it is at {hostel}", "Moving the clocks", "Checking it doesn't land on top of the pub crawl", "Sorting the start from the finish"],
  pause: ["Finding the off switch", "Nothing gets deleted here, only paused", "Checking what that leaves on this week"],
  ask: ["Reading the board at {hostel}", "Flicking through the tour desk", "Pulling up the week", "Asking the troop"],
  general: ["Having a think", "Swinging through the list", "Reading the fine print so you don't have to", "Sniffing out the right tour", "Getting the monkeys in a row", "Rifling through the tour desk", "Nearly there"],
};
function poolFor(msg: string) {
  const m = msg.toLowerCase();
  if (/[$£€฿₫₱]|price|cost|rate|charge|cheaper|dollar|bucks/.test(m)) return "price";
  if (/\d\s*(am|pm)\b|o'clock|start|finish|\bend|time|earlier|later|\bmove|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b(mon|tue|wed|thu|fri|sat|sun)s?\b|daily|weekly/.test(m)) return "time";
  if (/pause|stop|remove|delete|kill|switch off|turn off|cancel|take .* down|hide/.test(m)) return "pause";
  if (/\?|^what|^which|^when|^who|^how|^show|^list|^tell/.test(m)) return "ask";
  return "general";
}
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

function Thinking({ prompt, hostel, ccy }: { prompt: string; hostel: string; ccy: string }) {
  const lines = useMemo(() => {
    const k = poolFor(prompt);
    return [...shuffle(LINES[k]), ...(k === "general" ? [] : shuffle(LINES.general))].map((l) => l.replace("{hostel}", hostel).replace("{ccy}", ccy));
  }, [prompt, hostel, ccy]);
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2400); return () => clearInterval(t); }, [lines]);
  return (
    <div className="flex gap-2.5 items-center text-muted-foreground text-[13px]" aria-live="polite">
      <img src="/mm-head.png" alt="" className="h-5 w-5 shrink-0 animate-mimo-bob motion-reduce:animate-none" />
      <span key={i} className="flex items-baseline gap-1 animate-mimo-in motion-reduce:animate-none">
        {lines[i]}
        <span className="flex gap-[3px] ml-0.5 translate-y-[-1px]" aria-hidden>
          {[0, 1, 2].map((d) => <i key={d} className="block h-[3px] w-[3px] rounded-full bg-current animate-mimo-dot motion-reduce:animate-none" style={{ animationDelay: `${d * 160}ms` }} />)}
        </span>
      </span>
    </div>
  );
}

/** What MIMO said last time, plus what it proposed, so "make that 12 instead" makes sense next turn. */
function assistantMemory(t: Turn) {
  const props = (t.changes ?? []).map((c) => `${c.product_title}: ${c.label} ${c.old} -> ${c.new}${c.state === "applied" ? " (applied)" : c.state === "cancelled" ? " (cancelled)" : ""}`);
  return t.content + (props.length ? `\n(proposed: ${props.join("; ")})` : "");
}

function ChangeCard({ c, onConfirm, onCancel, onUndo, onPick, onChange, busy }: { c: MimoChange; onConfirm: () => void; onCancel: () => void; onUndo: () => void; onPick: (a: { product_id: string; title: string }) => void; onChange: (v: string) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false); const [v, setV] = useState("");
  if (c.state === "applied") return <div className="text-[13px] flex items-center gap-1.5" style={{ color: "hsl(var(--st-active))" }}><Check className="h-3.5 w-3.5" /> Done: {c.product_title}, {c.label} {c.old} → {c.new}{c.reden ? ". Reden gets a note." : "."}{c.learned ? ` Noted "${c.learned}" for next time.` : ""} <button className="ml-1 inline-flex items-center gap-1 underline underline-offset-2 text-muted-foreground" onClick={onUndo}><Undo2 className="h-3 w-3" /> Undo</button></div>;
  if (c.state === "undone") return <div className="text-[13px] text-muted-foreground">Put back: {c.product_title}, {c.label} {c.old}.</div>;
  if (c.state === "cancelled") return <div className="text-[13px] text-muted-foreground line-through">{c.product_title}, {c.label} {c.old} → {c.new}</div>;
  if (c.state === "failed") return <div className="text-[13px]" style={{ color: "hsl(var(--st-remove))" }}>That didn't save, nothing changed. {c.note}</div>;
  return (
    <div className="rounded-md border p-3 space-y-2 text-[13.5px]">
      <div className="font-medium">{c.product_title}{c.confidence !== "exact" && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{c.confidence === "likely" ? "probably this one" : "not sure which"}</span>}</div>
      <div><span className="text-muted-foreground">{c.label}:</span> <span className="line-through text-muted-foreground">{c.old}</span> <span className="mx-1">→</span> <span className="font-medium">{c.new}</span></div>
      {c.note && <div className="text-[12px] text-muted-foreground">{c.note}</div>}
      {c.alternatives.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{c.alternatives.map((a) => <button key={a.product_id} className="rounded-full border px-2.5 py-0.5 text-[12px] hover:bg-secondary" disabled={busy} onClick={() => onPick(a)}>{a.title}</button>)}</div>
      )}
      {c.state === "sure" && <div className="text-[13px]" style={{ color: "hsl(var(--st-pending))" }}>{c.strong} Sure?</div>}
      {editing ? (
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onChange(v.trim()); setEditing(false); } }}>
          <Input autoFocus className="h-8" placeholder={`new ${c.label}`} value={v} onChange={(e) => setV(e.target.value)} />
          <Button type="submit" size="sm" className="h-8" disabled={busy}>Propose</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Back</Button>
        </form>
      ) : (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-8 gap-1" disabled={busy || c.confidence === "unsure"} onClick={onConfirm}><Check className="h-3.5 w-3.5" /> {c.state === "sure" ? "Yes, I'm sure" : "Confirm"}</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Change</Button>
          <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

/** First time only: three short screens. Stored on the profile, so once per person on any device. */
function MeetMimo({ step, setStep, hostel, first, onTry, onDone }: { step: number; setStep: (n: number) => void; hostel: string; first: string; onTry: (example: string) => void; onDone: () => void }) {
  const screens = [
    { title: `Hey${first ? ` ${first}` : ""}. I'm MIMO.`, body: `I look after the experiences at ${hostel}. Tell me what to change in plain words and I'll sort it, no forms.` },
    { title: "What I can do", body: "Prices, times, days, status, descriptions, meeting points, guest limits and expiry dates. I'll show you exactly what I'm about to change and wait for your OK, and you can undo. I can also answer questions like \"what runs on a Thursday?\"" },
    { title: "What I won't do", body: "Delete anything (nothing here ever gets deleted, I pause instead), change categories, or touch quotes or other hostels. For those, the product page is the place." },
  ];
  const last = step >= screens.length;
  const example = "Change the price of the pub crawl to $12";
  return (
    <div className="pt-6 space-y-4">
      <div className="flex gap-2.5">
        <img src="/mm-head.png" alt="" className="h-6 w-6 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="text-[15px] font-medium">{last ? "Try one" : screens[step].title}</p>
          <p className="text-muted-foreground leading-relaxed">{last ? "Here's an example. Send it, and I'll show you what I'd change before anything happens." : screens[step].body}</p>
          {last && <button className="text-left rounded-md border px-3 py-2 text-[13.5px] hover:bg-secondary" onClick={() => onTry(example)}>{example}</button>}
        </div>
      </div>
      <div className="flex items-center gap-3 pl-9">
        <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i === Math.min(step, 3) ? "bg-foreground" : "bg-muted-foreground/30")} />)}</div>
        {last ? <button className="text-[13px] text-muted-foreground underline underline-offset-2" onClick={onDone}>I'll write my own</button>
              : <Button size="sm" className="h-8 ml-auto" onClick={() => setStep(step + 1)}>Next</Button>}
      </div>
    </div>
  );
}
