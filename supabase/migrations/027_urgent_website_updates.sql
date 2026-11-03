-- 3 Nov 2026, Reden's asks: GMs can flag a product Urgent so it floats to the top of Approvals > Website updates.
-- The flag clears itself when Reden ticks the product's last waiting change. Not a watched field, so flagging it
-- sends no alert and does not clear the verified stamp.
alter table public.products add column if not exists urgent boolean not null default false;

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
  update products set urgent = false
   where urgent and id in (select product_id from notification_events where id = any(p_ids))
     and not exists (select 1 from notification_events e where e.product_id = products.id and e.website_done_at is null);
  return n;
end $$;
