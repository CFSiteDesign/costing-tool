-- Website updates to-do for Reden (25 Oct 2026). Every change to a website-bookable product is already queued in
-- notification_events and emailed to him (dispatched_at = emailed). He also wants them in the dashboard, under
-- Approvals, so he can tick each one off once the website and Rezdy match: website_done_at is that tick.
-- GM changes still go live straight away; this only tracks Reden's copy to the website.
alter table public.notification_events
  add column if not exists website_done_at timestamptz,
  add column if not exists website_done_by uuid;

-- The setup-era changes (before GMs had logins on 5 Oct) were never a to-do for Reden; they were skipped for email too.
update public.notification_events set website_done_at = now() where changed_at < '2026-10-05' and website_done_at is null;

create index if not exists notification_events_website_todo on public.notification_events (location_id, changed_at)
  where website_done_at is null;

create or replace function public.mark_website_done(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office')) then
    raise exception 'Only head office can tick off website updates';
  end if;
  update notification_events set website_done_at = now(), website_done_by = auth.uid()
   where id = any(p_ids) and website_done_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mark_website_done(bigint[]) from public, anon;
grant execute on function public.mark_website_done(bigint[]) to authenticated;
