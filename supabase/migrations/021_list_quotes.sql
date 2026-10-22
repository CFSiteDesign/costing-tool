-- The Quotes list, as one RPC (POST) instead of a long GET (22 Oct 2026).
-- Hayley's browser sent the CORS pre-check for the list GET and then never sent the GET itself, every day since at
-- least 20 Oct, while every other request from that browser worked: an extension blocking that one URL. The RPC's URL
-- is just /rest/v1/rpc/list_quotes with no query string. security invoker: RLS on quotes, customers and quote_versions
-- still decides what each person sees, exactly as the GET did. Same shape as the old PostgREST embed.
create or replace function public.list_quotes()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
  from (
    select q.id, q.reference, q.title, q.status, q.pax_count, q.created_at,
      (select jsonb_build_object('contact_name', c.contact_name, 'company_name', c.company_name, 'country', c.country)
         from customers c where c.id = q.customer_id) as customers,
      coalesce((select jsonb_agg(jsonb_build_object('version_no', v.version_no, 'total_usd', v.total_usd))
         from quote_versions v where v.quote_id = q.id), '[]'::jsonb) as quote_versions
    from quotes q
  ) t
$$;

revoke all on function public.list_quotes() from public, anon;
grant execute on function public.list_quotes() to authenticated;
