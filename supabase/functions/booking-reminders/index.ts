import { createClient } from "jsr:@supabase/supabase-js@2";

// Payment reminders (Oct 2026). Runs daily at 01:00 UTC via pg_cron. Every booking request that is not marked paid,
// has not been reminded yet, and whose payment deadline is 7 days away or less (and not already past) gets one email
// to its Mad Monkey contact: booking reference, agent / company, total due and the deadline.
// Without an email key it reports what it would send and marks nothing.

const APP = "https://mm-costing-tool.vercel.app";

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // an Edge Function secret if one is ever set, otherwise the key an admin saved in Settings > Email (Vault)
  const key = Deno.env.get("RESEND_API_KEY") ?? ((await supabase.rpc("email_key")).data as string | null) ?? null;
  const sender = Deno.env.get("RESEND_FROM") ?? "Mad Monkey Experiences <updates@experience.madmonkeyhostels.com>";

  const day = (offset: number) => new Date(Date.now() + offset * 86400e3).toISOString().slice(0, 10);
  const today = day(0), weekOut = day(7);
  const { data: due, error } = await supabase.from("booking_requests").select("*")
    .is("paid_at", null).is("reminder_sent_at", null).not("payment_deadline", "is", null)
    .gte("payment_deadline", today).lte("payment_deadline", weekOut);
  if (error) return json({ error: error.message }, 500);

  const results: Record<string, unknown>[] = [];
  for (const b of due ?? []) {
    if (!b.contact_email) { results.push({ reference: b.reference, skipped: "no Mad Monkey contact email" }); continue; }
    const d = (b.details ?? {}) as Record<string, string>;
    const deadline = new Date(b.payment_deadline + "T00:00:00Z");
    const left = Math.round((deadline.getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400e3);
    const when = deadline.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const total = b.total_usd == null ? "see the booking request" : `$${Number(b.total_usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const agent = d.agent_company || d.agent_contact_name || "the agent";
    const first = (b.contact_name ?? "").trim().split(/\s+/)[0] || "there";
    const link = `${APP}/quotes/${b.quote_id}/booking`;
    const subject = `Payment due ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`}: ${b.reference}, ${agent}`;
    const text = [
      `Hi ${first},`,
      `This booking is still waiting for payment.`,
      `Booking reference: ${b.reference}\nAgent / company: ${agent}\nTotal due: ${total}\nPayment deadline: ${when}`,
      `Once it's paid, mark it as paid on the booking request:\n${link}`,
      `Mad Monkey Experience Database`,
    ].join("\n\n");

    if (!key) { results.push({ reference: b.reference, wouldSend: b.contact_email }); continue; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: [b.contact_email], subject, text }),
    });
    if (!res.ok) { results.push({ reference: b.reference, error: await res.text() }); continue; }
    await supabase.from("booking_requests").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
    results.push({ reference: b.reference, sent: b.contact_email });
  }
  return json({ ok: true, checked: (due ?? []).length, results });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
