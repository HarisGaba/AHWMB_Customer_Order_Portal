begin;
create table if not exists public.customer_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null references public.customers(name) on update cascade on delete restrict,
  date date not null,
  amount numeric(18,2) not null check (amount > 0),
  type text not null check (type in ('cash', 'balance')),
  created_at timestamptz not null default now()
);
create index if not exists customer_ledger_customer_date on public.customer_ledger(customer_name, date);
alter table public.customer_ledger enable row level security;
revoke all on public.customer_ledger from anon, public;
grant select, insert, update, delete on public.customer_ledger to authenticated;
drop policy if exists "Admins manage customer ledger" on public.customer_ledger;
create policy "Admins manage customer ledger" on public.customer_ledger for all to authenticated
using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());
commit;
