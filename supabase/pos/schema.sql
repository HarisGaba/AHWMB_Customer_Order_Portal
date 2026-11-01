-- AHWMB POS database schema.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

-- ---------- Tables ----------
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  rate        numeric(12, 2) not null check (rate >= 0),
  created_at  timestamptz not null default now(),
  archived_at timestamptz                      -- set = hidden from POS, restorable
);
create unique index if not exists items_name_unique on public.items (lower(name));

create table if not exists public.sales (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,                  -- shop's local calendar day
  customer_no  integer not null,               -- 1, 2, 3… restarting each day
  lines        jsonb not null,                 -- [{itemId, name, qty, rate}]
  total        numeric(12, 2) not null,
  payment      text not null check (payment in ('Cash', 'Balance')),
  created_at   timestamptz not null default now(),
  unique (day, customer_no)
);
create index if not exists sales_day_idx on public.sales (day);

-- ---------- Security: only signed-in users can read/write ----------
alter table public.items enable row level security;
alter table public.sales enable row level security;

drop policy if exists "auth all items" on public.items;
create policy "auth all items" on public.items
  for all to authenticated using (true) with check (true);

drop policy if exists "auth all sales" on public.sales;
create policy "auth all sales" on public.sales
  for all to authenticated using (true) with check (true);

-- ---------- Record a sale with an atomic per-day customer number ----------
create or replace function public.record_sale(p_day date, p_lines jsonb, p_payment text)
returns public.sales
language plpgsql
security invoker
as $$
declare
  v_no   integer;
  v_sale public.sales;
begin
  -- Serialise sales for the same day so two counters never get the same number.
  perform pg_advisory_xact_lock(hashtext('sale-' || p_day::text));

  select coalesce(max(customer_no), 0) + 1 into v_no from public.sales where day = p_day;

  insert into public.sales (day, customer_no, lines, total, payment)
  values (
    p_day,
    v_no,
    p_lines,
    (select coalesce(sum((l->>'qty')::numeric * (l->>'rate')::numeric), 0) from jsonb_array_elements(p_lines) l),
    p_payment
  )
  returning * into v_sale;

  return v_sale;
end;
$$;

-- ---------- Rolling retention: delete days older than N days ----------
create or replace function public.purge_old_sales(p_keep_days integer default 60)
returns integer
language sql
security invoker
as $$
  with d as (delete from public.sales where day < current_date - p_keep_days returning 1)
  select count(*)::integer from d;
$$;

-- Newer projects don't always expose new tables to the API automatically.
grant select, insert, update, delete on public.items, public.sales to authenticated;
revoke execute on function public.record_sale(date, jsonb, text) from public, anon;
revoke execute on function public.purge_old_sales(integer) from public, anon;
grant execute on function public.record_sale(date, jsonb, text) to authenticated;
grant execute on function public.purge_old_sales(integer) to authenticated;

-- ---------- Live sync between devices ----------
do $$
begin
  begin alter publication supabase_realtime add table public.items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.sales; exception when duplicate_object then null; end;
end $$;
