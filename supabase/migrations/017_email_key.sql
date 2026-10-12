-- Email key in the database (Oct 2026). Lovable's secret store is not linked to this Supabase project, so secrets
-- added there never reach the Edge Functions. An admin pastes the Resend key into Settings > Email instead; it is
-- stored encrypted in Supabase Vault. The email functions read it with the service role (RESEND_API_KEY env, if
-- ever set, still wins). Nobody can read the key back through the app: the page only learns whether one is set.

create or replace function public.set_email_key(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_key text := btrim(coalesce(p_key, ''));
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only admins can change the email key.'; end if;
  if v_key !~ '^re_[A-Za-z0-9_]{10,}$' then raise exception 'That does not look like a Resend API key. They start with re_'; end if;
  select id into v_id from vault.secrets where name = 'resend_api_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'resend_api_key', 'Resend API key for Experience Database emails (set in Settings > Email)');
  else
    perform vault.update_secret(v_id, v_key);
  end if;
  return public.email_key_status();
end $$;
revoke all on function public.set_email_key(text) from public, anon;
grant execute on function public.set_email_key(text) to authenticated;

-- what the Settings page shows: set or not, and when. Never the key itself.
create or replace function public.email_key_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('key_set', s.id is not null, 'updated_at', s.updated_at)
  from (select 1) one left join vault.secrets s on s.name = 'resend_api_key'
$$;
revoke all on function public.email_key_status() from public, anon;
grant execute on function public.email_key_status() to authenticated;

-- the key itself, for the email Edge Functions only (service role)
create or replace function public.email_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1
$$;
revoke all on function public.email_key() from public, anon, authenticated;
grant execute on function public.email_key() to service_role;
