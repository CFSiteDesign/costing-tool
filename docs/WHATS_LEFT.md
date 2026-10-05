# What's left: Experience Database + Costing Tool (checked 5 Oct 2026)

Checked against the repos, git logs, the live Supabase project (read-only queries), Claude's memory notes, Charlie's brain and the session transcripts. Source tags in brackets. "DB 5 Oct" means I confirmed it in the live database today.

---

The MM AI Assistant's list lives in CFSiteDesign/MM-AI-ASSISTANT docs/WHATS_LEFT.md.

### Needs someone else

- **Charlie: get the live flow chart to Claude** so the final sheet sync can run. Kyle asked for it on 29 Sep and you told him on 1 Oct you'd let him know when it's done. The script is built and tested, but it has never run on the live sheet: 0 sheet proposals and no import runs since 1 Oct. Two options: File > Download > Excel into Downloads, or say yes and Claude downloads it through your Chrome work profile. [Kyle chat 29 Sep, Memory 2 Oct, DB 5 Oct]
- **Charlie: a login for Reden.** There is no head-office user, so only the shared admin account can approve anything. Claude needs Reden's email (it isn't on record) and your go-ahead, because creating auth users is blocked for Claude without it. [Memory 9 Sep + 2 Oct, DB 5 Oct]
- **Charlie: own logins for other head-office people (optional).** On 3 Oct, 205 edits were made through the shared Admin account, so the change log can't say who made them. [DB 5 Oct]
- **Reden (or head office): work the Approvals queue.** 317 time proposals have been pending since 9 Sep. The final sync replaces them with a fresh list plus every sheet change. Once that's approved, Kyle deletes the sheet, as planned in the Kyle/Reden chat. [Client msg 9 Sep, Kyle chat 29 Sep, DB 5 Oct]
- **Charlie: put the Resend key on the Supabase project.** RESEND_API_KEY and RESEND_FROM are both missing, because secrets added through Lovable never reached it (health check 5 Oct). This blocks the Reden digest, the global-event emails to GMs and any sync alerts. How to do it is listed under decisions. [Memory 4 Oct, Charlie 5 Oct]
- **Dhany: Resend domain.** On 24 Aug Dhany was asked to add DNS records for experience.madmonkeyhostels.com. It's unclear whether he did, or whether the domain is verified in Resend: check. There's also a possible mismatch: the 4 Oct Lovable prompt sets the sender to experiences@madmonkeyhostels.com, which is not the subdomain those records were for. [Memory 24 Aug + 4 Oct]
- **Charlie / Reden: notification settings.** Add Reden's address under Settings > Reden notifications (no recipients are set yet). Also ask him whether he wants each change emailed straight away or one daily digest. The brief said to ask him and nobody has; it is currently a daily digest at 5pm local. [Kyle brief 17 Aug, DB 5 Oct]
- **Charlie: say yes to archiving 346 stale notification events** from August setup and September testing. Otherwise they flood Reden's first emails. [Memory 4 Oct, DB 5 Oct]
- **Charlie: Siquijor GM email.** Siquijor still logs in as the gm.siquijor@madmonkey.test placeholder. The other 22 GMs use real addresses. [Memory 10 Sep, DB 5 Oct]
- **Hayley: Cambodia breakfast and Kampot rates.** All five Cambodia hostels still use the $8.00 placeholder breakfast. Kampot has no accommodation rates, so beds there can't be quoted. [Memory 24 Aug, DB 5 Oct]
- **Hayley: itinerary standard blocks (D2).** Do 2pm check in, 7pm Meet Up and 11am check out hold at every hostel, or are some different? These defaults are already built into the itinerary writer. [Hayley 10 Sep, Code check]
- **Charlie / Kyle: GM rollout.** Only one GM login has been used since 10 Sep, probably Claude's test sign-ins. Send the logins and the GM brief (23 Sep) when you're ready to roll out. Unclear whether this is meant to happen yet: check. [DB 5 Oct, GM brief 23 Sep]
- **Danny: Google Docs export.** Waiting on Workspace permissions and template ownership since August. The web agreement link already meets the brief, so this is optional. [Kyle brief 17 Aug, open item 5]
- **Charlie + Dhany: Rezdy connection for product photos** (phase 2). Scoping not started. The photo slots in itineraries are filled by hand for now. [Hayley 10 Sep, Itinerary plan]

### Claude can build next

- **Run the final sheet sync** as soon as the live xlsx arrives. It takes minutes, queues everything for Reden and keeps a private copy of the sheet. [Kyle chat 29 Sep]
- **Itinerary D4: one client pack.** Link the agreement page and the itinerary page to each other. This was recommended and isn't built. [Hayley 10 Sep, Code check]
- **Head-office view of what GMs asked the Assistant.** prompt_edits already holds 53 requests, but there's no screen for them. The GM brief promises GMs that every request is kept. [Charlie notes 13 Sep, MIMO plan]
- **Create a product by prompt.** The Assistant would open the Add product form prefilled, which was agreed as phase 2. Not built: today it only points GMs to the button. [MIMO plan 13 Sep, Code check]
- **30-sentence Assistant test set** (planned as tools/data/prompt_eval.json). Not built; only the 6-scenario eval exists. Low priority. [MIMO plan 13 Sep]
- **Refresh HOW_TO_USE.pdf.** It dates from 26 Aug and predates My week, currency, auto-trip, Transport, Approvals, the Assistant, itineraries and the weekly story. The GM brief covers GMs but not head office or sales. [Memory]
- **Fix the "Sync now" button in Settings.** It's still disabled, with an out-of-date tooltip saying the rate sheet isn't connected. In fact rates sync every night, most recently on 4 Oct. Either wire the button up (needs an Apps Script re-paste) or point it at the sheet's "Mad Monkey Sync > Push rates now" menu. [Kyle brief 17 Aug, Code check]
- **Sync failure and 36-hour staleness alerts to Charlie and Hayley.** The builder shows a stale-rates banner, but I found no alert email anywhere. Unclear, check: the deployed rate-sync source isn't in the repo. These alerts also need the Resend key. [Kyle brief 17 Aug]
- **Lock down anon access to server functions.** A separate task already exists for this. As of today, the public key can still run itinerary_facts, learn_alias, respond_global_event and decide_time_proposal(s). get_agreement and get_itinerary are meant to be public. [Task 2 Oct, DB 5 Oct]
- **Season auto-pick in the manual quote builder** from each day's date. Auto-trip already does this through season_calendar. [Memory 24 Aug, Code check]
- **Em dash sweep.** About 90 em dashes are left in on-screen copy, mostly tooltips from August, including the Experiences table headers and the Sync now tooltip. [Charlie rule]
- **Repo housekeeping.** The repo is missing the create-table SQL for global_events, global_event_responses, product_assets, season_calendar, fx_rates, quote_itineraries and sync_config, and migration 008. It also lacks the source for fx-refresh and asset-callback, and rate-sync is only a stub. Pull them all from the live project. Also update IMPLEMENTATION_PLAN.md, which still calls the itinerary "planned". [Code check]
- **Website-only filter for Reden** (optional nice-to-have). [Memory 24 Aug]

### Decisions needed

- **How the Resend key reaches Supabase.** The Lovable form has failed. Options: Claude sets it with the Supabase CLI while you paste the key in your own terminal (never in chat), or someone with Supabase access adds it once. [Charlie 5 Oct]
- **Supabase Pro (about $25 a month) or stay on free.** mm-experience-db sits in your personal org on the free plan and can auto-pause. It now also holds the AI Assistant's brain. Also decide who pays. [Plan 23 Aug, DB 5 Oct]
- **Kyle's sign-offs.** None were ever recorded:
  - photo minimum applies to new and edited products only
  - keep or archive past one-time events
  - Cebu City: closed or missing
  - 23 hostels, or the brief's "24+"
  - Rezdy: fed directly or stays manual
  - customer record fields: built as proposed (company, contact, email, phone, country, source)

  [Kyle brief 17 Aug, Memory 24 Aug]
- **Kyle: is the Phase 3 hand-off still wanted?** The brief asks for the final approved document to go to the internal teams who make the bookings. Not built: all 29 quotes are still "draft" and nothing marks one sent or accepted. [Kyle brief 17 Aug, DB 5 Oct]
- **Kyle: image space on the client agreement** (in the brief). Not on the agreement page. Itineraries have photo slots, so a D4 pack may cover it: check. [Kyle brief 17 Aug, Code check]
- **Charlie: is story-edit chat or creation?** It is live on Opus 5.5 at low effort (it rewrites the story copy). If it should count as chat, it flips to Sonnet 5.5 in one line.

### Dropped / already done

- **769-item exceptions queue: cleared.** 762 were resolved on 25 Aug by head office. The 105 from the 9 Sep re-pull were resolved or dismissed on 3 Oct. 0 of 883 are open. [DB 5 Oct]
- **_SYNC_BREAKFAST USD column: filled on 24 Aug.** 23 breakfast rows sync nightly from the sheet (latest 4 Oct). Only Cambodia's $8 placeholder is left (Hayley, above). [DB 5 Oct, brain 24 Aug]
- **Real GM emails: loaded 10 Sep** and 22 logins verified. Siquijor is the only one left. [Memory]
- **Detailed itinerary: built.** It has the fact pack, Claude writing the document, an editor, photo upload, rewrite per day and a public /it/ page, and 15 have been generated. D1 and D3 were done as recommended; D2 was built with the defaults. [Code check, DB 5 Oct]
- **Flow-chart freeze at cutover: superseded.** The plan is now to delete the sheet after the final sync is approved. [Kyle chat 9 + 29 Sep]
- **Rate sync: live and healthy,** with nightly successes through 4 Oct. [DB 5 Oct]
- **Built from the brief and client docs:**
  - Phase 3 version history
  - tracking dashboard filtered by country and month
  - customer record
  - season auto-pick in auto-trip
  - delete a day
  - My week key events and the weekly Instagram story (5 Oct)
  - Reden digest preview mode, with the 4 Oct test proving changes queue correctly

  [Code check, git log]
- **Ignored as a duplicate of Project 2:** the Lovable commit "Cleaned kb tables" (2 Oct) is listed under the Assistant.

---
