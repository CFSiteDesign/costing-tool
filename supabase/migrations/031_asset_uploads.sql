-- 10 Nov 2026, Lexie: community managers can't open GM assets because GMs paste links from their own Google Drive
-- (Mad Monkey accounts only). Assets can now be uploaded straight into the dashboard, like photos, so every login can
-- open them. Public-read bucket, files at <location_id>/<product_id>/<name>; only people who can edit that hostel add
-- or remove. Uploaded rows are source 'upload'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-assets', 'product-assets', true, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "product assets: editors add" on storage.objects;
drop policy if exists "product assets: editors remove" on storage.objects;
create policy "product assets: editors add" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-assets'
    and (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office') or has_role(auth.uid(), 'gm'))
    and can_access_location(auth.uid(), ((storage.foldername(name))[1])::uuid));
create policy "product assets: editors remove" on storage.objects for delete to authenticated
  using (bucket_id = 'product-assets'
    and (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'head_office') or has_role(auth.uid(), 'gm'))
    and can_access_location(auth.uid(), ((storage.foldername(name))[1])::uuid));

drop policy if exists "product assets: read" on storage.objects;
create policy "product assets: read" on storage.objects for select to authenticated using (bucket_id = 'product-assets');

alter table public.product_assets drop constraint if exists product_assets_source_check;
alter table public.product_assets add constraint product_assets_source_check check (source in ('studio','manual','global','upload'));
