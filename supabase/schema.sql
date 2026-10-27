create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  address text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists customers_name_unique on public.customers (name);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'EXTRA ITEMS',
  created_at timestamptz not null default now()
);
create unique index if not exists products_name_unique on public.products (lower(name));
alter table public.products enable row level security;

alter table public.customers enable row level security;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_address text not null,
  location_link text,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  grand_total numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.orders add column if not exists location_link text;
alter table public.orders add column if not exists total_amount numeric not null default 0;
alter table public.orders add column if not exists balance numeric not null default 0;
alter table public.orders add column if not exists total_balance numeric not null default 0;
alter table public.orders add column if not exists deposit numeric not null default 0;
alter table public.orders add column if not exists remaining_balance numeric not null default 0;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sr integer not null,
  name text not null,
  quantity text not null default '',
  quantity_value numeric not null default 0,
  unit_type text not null default 'KG' check (unit_type in ('KG', 'GRAMS', 'LITRE', 'PCS', 'PACKETS', 'NONE')),
  unit_price numeric not null default 0,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create or replace function public.is_ahwmb_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('ahmedyounus1978@gmail.com', 'ahwmb1965@gmail.com');
$$;

drop policy if exists "Admins can view customers" on public.customers;
create policy "Admins can view customers" on public.customers for select to authenticated using (public.is_ahwmb_admin());
drop policy if exists "Admins can add customers" on public.customers;
create policy "Admins can add customers" on public.customers for insert to authenticated with check (public.is_ahwmb_admin());
drop policy if exists "Admins can update customers" on public.customers;
create policy "Admins can update customers" on public.customers for update to authenticated using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());
drop policy if exists "Admins can delete customers" on public.customers;
create policy "Admins can delete customers" on public.customers for delete to authenticated using (public.is_ahwmb_admin());
grant select, insert, update, delete on public.customers to authenticated;
drop policy if exists "Admins can view products" on public.products;
create policy "Admins can view products" on public.products for select to authenticated using (public.is_ahwmb_admin());
drop policy if exists "Admins can add products" on public.products;
create policy "Admins can add products" on public.products for insert to authenticated with check (public.is_ahwmb_admin());
grant select, insert on public.products to authenticated;
grant select on public.products to anon;
drop policy if exists "Anyone can view products" on public.products;
create policy "Anyone can view products" on public.products for select to anon, authenticated using (true);

-- Customer submission is intentionally atomic and does not expose order rows to anon users.
create or replace function public.submit_order(
  p_order_ref text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_location_link text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id uuid;
begin
  if nullif(trim(p_order_ref), '') is null then
    raise exception 'Order reference is missing';
  end if;

  insert into public.orders (
    order_ref, customer_name, customer_phone, customer_address, location_link, items, status, grand_total
  ) values (
    trim(p_order_ref), trim(coalesce(p_customer_name, '')), trim(coalesce(p_customer_phone, '')), trim(coalesce(p_customer_address, '')),
    nullif(trim(coalesce(p_location_link, '')), ''), coalesce(p_items, '[]'::jsonb), 'pending', 0
  ) returning id into new_order_id;

  insert into public.order_items (order_id, sr, name, quantity, quantity_value, unit_type, unit_price, total)
  select new_order_id, item.sr, item.name, item.quantity, item.quantity_value, item.unit_type, item.unit_price, item.total
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    sr integer,
    name text,
    quantity text,
    quantity_value numeric,
    unit_type text,
    unit_price numeric,
    total numeric
  );

  return new_order_id;
end;
$$;

revoke all on function public.submit_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_order(text, text, text, text, text, jsonb) to anon, authenticated;

drop policy if exists "Customers can submit orders" on public.orders;
create policy "Customers can submit orders" on public.orders for insert to anon, authenticated with check (true);
drop policy if exists "Shopkeepers can view orders" on public.orders;
create policy "Shopkeepers can view orders" on public.orders for select to authenticated using (public.is_ahwmb_admin());
drop policy if exists "Shopkeepers can update orders" on public.orders;
create policy "Shopkeepers can update orders" on public.orders for update to authenticated using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());
drop policy if exists "Shopkeepers can delete orders" on public.orders;
create policy "Shopkeepers can delete orders" on public.orders for delete to authenticated using (public.is_ahwmb_admin());

drop policy if exists "Customers can submit order items" on public.order_items;
create policy "Customers can submit order items" on public.order_items for insert to anon, authenticated with check (true);
drop policy if exists "Shopkeepers can view order items" on public.order_items;
create policy "Shopkeepers can view order items" on public.order_items for select to authenticated using (public.is_ahwmb_admin());
drop policy if exists "Shopkeepers can update order items" on public.order_items;
create policy "Shopkeepers can update order items" on public.order_items for update to authenticated using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());
drop policy if exists "Shopkeepers can delete order items" on public.order_items;
create policy "Shopkeepers can delete order items" on public.order_items for delete to authenticated using (public.is_ahwmb_admin());

grant usage on schema public to anon, authenticated;
grant insert on public.orders to anon, authenticated;
grant select, update, delete on public.orders to authenticated;
grant insert on public.order_items to anon, authenticated;
grant select, update, delete on public.order_items to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;


alter table public.order_items drop constraint if exists order_items_unit_type_check;
alter table public.order_items add constraint order_items_unit_type_check check (unit_type in ('KG', 'GRAMS', 'LITRE', 'PCS', 'PACKETS', 'NONE'));
NOTIFY pgrst, 'reload schema';
