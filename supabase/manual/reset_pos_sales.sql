-- RESET POS SALES (run ONLY when you want the POS to start fresh).
-- Clears the POS sales history; Today's Sales and Total Summary are calculated from it,
-- so they start again from zero. Customer numbers restart at 1.
--
-- SAFETY: every sale is first COPIED into public.sales_archive, so nothing is lost and
-- it can be restored. Not touched: POS items & rates, Stock Report, stock transfers,
-- customers, orders, invoices, daily expenses, users.
begin;

create table if not exists public.sales_archive (like public.sales including defaults);
alter table public.sales_archive add column if not exists archived_at timestamptz not null default now();
alter table public.sales_archive enable row level security;  -- no policies: hidden from the app

insert into public.sales_archive
select s.*, now() from public.sales s
where not exists (select 1 from public.sales_archive a where a.id = s.id);

-- Only delete rows that are safely in the archive
delete from public.sales s
where exists (select 1 from public.sales_archive a where a.id = s.id);

commit;

-- To restore later:
-- insert into public.sales select id, day, customer_no, lines, total, payment, created_at, customer_name
--   from public.sales_archive on conflict do nothing;
