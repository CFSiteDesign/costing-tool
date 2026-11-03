-- 3 Nov 2026: (1) GMs can delete a product (in addition to pausing it), (2) drag-and-drop photos per product.
--
-- delete_product(): editor roles only, scoped to the caller's hostel. The product and everything hanging off it is
-- copied into archived_products (invisible, no policies, restorable by hand), then removed. Quote lines that used it
-- keep their text and price (their source_product_id just goes null). Reden is told through notification_events
-- (field 'product_removed'), so it shows in his email and under Approvals > Website updates like any other change.

create or replace function public.delete_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p products%rowtype; v_who text;
begin
  select * into p from products where id = p_id;
  if not found then raise exception 'That product no longer exists'; end if;
  if not (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office') or has_role(auth.uid(), 'gm')) then
    raise exception 'Only GMs and head office can delete a product';
  end if;
  if not can_access_location(auth.uid(), p.location_id) then raise exception 'That product is not at your hostel'; end if;
  select coalesce(full_name, email) into v_who from profiles where id = auth.uid();

  insert into archived_products (product_id, location_id, title, category, reason, archived_by, product, related)
  values (p.id, p.location_id, p.title, p.category::text, 'deleted in the Experience Dashboard', coalesce(v_who, auth.uid()::text), to_jsonb(p),
    jsonb_build_object(
      'transport_details', coalesce((select jsonb_agg(to_jsonb(t)) from transport_details t where t.product_id = p.id), '[]'::jsonb),
      'product_date_rules', coalesce((select jsonb_agg(to_jsonb(r)) from product_date_rules r where r.product_id = p.id), '[]'::jsonb),
      'product_photos', coalesce((select jsonb_agg(to_jsonb(ph)) from product_photos ph where ph.product_id = p.id), '[]'::jsonb),
      'product_key_days', coalesce((select jsonb_agg(to_jsonb(k)) from product_key_days k where k.product_id = p.id), '[]'::jsonb),
      'product_aliases', coalesce((select jsonb_agg(to_jsonb(a)) from product_aliases a where a.product_id = p.id), '[]'::jsonb)))
  on conflict (product_id) do update set product = excluded.product, related = excluded.related, archived_at = now(), archived_by = excluded.archived_by;

  -- Reden hears about every deletion; the note says whether it was on the website so he knows if there is anything to take down
  insert into notification_events (product_id, product_title, location_id, field, old_value, new_value, changed_by)
  values (p.id, p.title, p.location_id, 'product_removed',
    case when p.bookable_on_website then 'on the website' else 'not on the website' end, 'deleted', auth.uid());

  delete from products where id = p.id;
end $$;

revoke all on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;

-- Photos: public-read bucket, files at <location_id>/<product_id>/<name>. Only people who can edit that hostel can add or remove.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "product photos: editors add" on storage.objects;
drop policy if exists "product photos: editors remove" on storage.objects;
create policy "product photos: editors add" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos'
    and (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office') or has_role(auth.uid(), 'gm'))
    and can_access_location(auth.uid(), ((storage.foldername(name))[1])::uuid));
create policy "product photos: editors remove" on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos'
    and (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office') or has_role(auth.uid(), 'gm'))
    and can_access_location(auth.uid(), ((storage.foldername(name))[1])::uuid));

-- storage needs to be able to see a file before it can delete it (the bucket is public anyway)
drop policy if exists "product photos: read" on storage.objects;
create policy "product photos: read" on storage.objects for select to authenticated using (bucket_id = 'product-photos');
