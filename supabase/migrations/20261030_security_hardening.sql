begin;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;

drop policy if exists "Anyone can read orders" on public.orders;
drop policy if exists "Public can view orders" on public.orders;
revoke select on public.orders, public.order_items, public.customers from anon, public;
revoke insert on public.orders, public.order_items from anon, public;

drop policy if exists "Anyone can read products" on public.products;
create policy "Anyone can read products" on public.products
  for select to anon, authenticated using (true);
drop policy if exists "Only admins can modify products" on public.products;
create policy "Only admins can modify products" on public.products
  for all to authenticated using (public.is_ahwmb_admin())
  with check (public.is_ahwmb_admin());
-- Restrictive guards prevent another permissive policy bypassing admin checks.
drop policy if exists "Product insert admin guard" on public.products;
create policy "Product insert admin guard" on public.products as restrictive
  for insert to authenticated with check (public.is_ahwmb_admin());
drop policy if exists "Product update admin guard" on public.products;
create policy "Product update admin guard" on public.products as restrictive
  for update to authenticated using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());
drop policy if exists "Product delete admin guard" on public.products;
create policy "Product delete admin guard" on public.products as restrictive
  for delete to authenticated using (public.is_ahwmb_admin());
revoke insert, update, delete on public.products from anon, public;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

alter table public.orders add column if not exists updated_at timestamptz default now();
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create index if not exists idx_orders_customer_phone on public.orders(customer_phone);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_phone_created_at on public.orders(customer_phone, created_at desc);

create table if not exists public.auth_logs (
  id uuid default gen_random_uuid() primary key,
  event_type text not null,
  email text,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);
alter table public.auth_logs enable row level security;
revoke all on public.auth_logs from public, anon, authenticated;
grant select on public.auth_logs to authenticated;
grant insert on public.auth_logs to service_role;
drop policy if exists "Only admins can read auth logs" on public.auth_logs;
create policy "Only admins can read auth logs" on public.auth_logs
  for select to authenticated using (public.is_ahwmb_admin());
drop policy if exists "Auth logs admin guard" on public.auth_logs;
create policy "Auth logs admin guard" on public.auth_logs as restrictive
  for select to authenticated using (public.is_ahwmb_admin());

commit;

-- MANUAL SUPABASE DASHBOARD STEPS:
-- Authentication > Rate Limits: review supported endpoint limits.
-- A "10 attempts then 3600-second account lockout" toggle is not documented;
-- implementing that exact policy requires trusted server-side enforcement.
-- Authentication: enable email confirmation and minimum password length 12.
-- Disable public signups if accounts are provisioned only by the business.
-- API settings: review exposed schemas; do not remove public/customers from
-- REST without replacing the admin client's existing customer CRUD calls.
-- Database > Extensions: enable pg_stat_statements for query monitoring.
-- auth_logs is storage only: this migration does NOT capture failed logins.
-- Use Supabase Auth audit logs or a trusted server-side log ingestion process.
-- Never allow anonymous inserts of claimed IP addresses or login outcomes.
-- Anonymous phone-only order-history queries will be denied intentionally;
-- restoring history requires a verified customer identity and scoped access.
