-- Approvals > Completed (25 Oct 2026): Reden wanted ticked-off website updates kept as an audit trail, so they move
-- to a Completed tab instead of disappearing. This lets head office move one back to the to-do list after a mis-tick.
create or replace function public.unmark_website_done(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office')) then
    raise exception 'Only head office can change website updates';
  end if;
  update notification_events set website_done_at = null, website_done_by = null
   where id = any(p_ids) and website_done_by is not null;   -- never reopens the setup-era changes nobody ticked
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.unmark_website_done(bigint[]) from public, anon;
grant execute on function public.unmark_website_done(bigint[]) to authenticated;

create index if not exists notification_events_website_done on public.notification_events (website_done_at desc)
  where website_done_by is not null;
