create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'EXTRA ITEMS',
  created_at timestamptz not null default now()
);

create unique index if not exists products_name_unique on public.products (lower(name));
alter table public.products enable row level security;

drop policy if exists "Anyone can view products" on public.products;
create policy "Anyone can view products"
  on public.products for select to anon, authenticated using (true);

drop policy if exists "Admins can add products" on public.products;
create policy "Admins can add products"
  on public.products for insert to authenticated
  with check (public.is_ahwmb_admin());

grant select on public.products to anon, authenticated;
grant insert on public.products to authenticated;
