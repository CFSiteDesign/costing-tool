/**
 * Plain-English messages for AI-service failures, so a GM or sales rep never sees raw API JSON.
 * Used by the itinerary writer, the Assistant and the weekly story's quick changes (all call Claude via Edge Functions).
 */
export function friendlyAiError(raw: string | undefined | null): string | null {
  const t = raw ?? "";
  if (/credit balance is too low|billing|purchase credits/i.test(t))
    return "The AI is out of credit, so nothing was written and nothing changed. Head office needs to top up the Anthropic account. Try again once that's done.";
  if (/rate[_ ]limit|\b429\b|too many requests/i.test(t)) return "The AI is busy right now. Try again in a minute.";
  if (/overloaded|\b529\b/i.test(t)) return "The AI service is overloaded right now. Try again in a minute.";
  if (/authentication_error|invalid x-api-key|\b401\b/i.test(t)) return "The AI key isn't working. Head office needs to check it.";
  if (/api key not set/i.test(t)) return "The AI isn't set up yet. Head office needs to add the key.";
  return null;
}

/** supabase.functions.invoke puts a non-2xx body on error.context: pull the real message out of it. */
export async function invokeErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  try {
    const ctx = error.context as Response | undefined;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.clone().json();
      return String(j?.error ?? j?.reply ?? error.message);
    }
  } catch { /* fall through */ }
  return error.message;
}
