create or replace function public.filter_clients(
  p_house uuid,
  p_search text default null,
  p_gender text default null,
  p_genre text default null,
  p_sort text default 'name',
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  id uuid, house_id uuid, full_name text, birth_date date, cpf text, phone text,
  photo_url text, whatsapp_optin boolean, status text, created_at timestamptz,
  created_by uuid, notes text, updated_at timestamptz, source text, email text,
  fingerprint_id text, gender text, birthday_wish_sent_at timestamptz,
  full_name_ci text, referral_source text,
  visits bigint, total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with vc as (
    select ci.client_id, count(*)::bigint as visits
    from checkins ci
    where ci.house_id = p_house
      and ci.client_id is not null
      and (
        p_genre is null
        or ci.event_id in (select e.id from events e where e.house_id = p_house and e.genre = p_genre)
      )
    group by ci.client_id
  ),
  base as (
    select c.*, coalesce(vc.visits, 0)::bigint as visits
    from clients c
    left join vc on vc.client_id = c.id
    where c.house_id = p_house
      and (p_gender is null or c.gender = p_gender)
      and (
        p_search is null or p_search = ''
        or c.full_name ilike '%' || p_search || '%'
        or c.cpf ilike '%' || p_search || '%'
        or c.phone ilike '%' || p_search || '%'
      )
      and (p_genre is null or coalesce(vc.visits, 0) > 0)
  )
  select b.id, b.house_id, b.full_name, b.birth_date, b.cpf, b.phone, b.photo_url,
    b.whatsapp_optin, b.status, b.created_at, b.created_by, b.notes, b.updated_at,
    b.source, b.email, b.fingerprint_id, b.gender, b.birthday_wish_sent_at,
    b.full_name_ci, b.referral_source, b.visits,
    (count(*) over())::bigint as total_count
  from base b
  order by
    (case when p_sort = 'visits' then b.visits end) desc nulls last,
    b.full_name_ci asc
  limit p_limit offset p_offset;
$$;

grant execute on function public.filter_clients(uuid, text, text, text, text, int, int) to anon, authenticated;
