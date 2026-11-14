-- WIPE THE 4 POS SECTIONS: Point of Sale, Rate Changing, Item Addition, Total Summary.
-- Run ONLY when you want them to start empty (they are hidden in the app for now).
--
--   * public.sales  -> Point of Sale bills + Total Summary (Summary is calculated from sales)
--   * public.items  -> Rate Changing + Item Addition (POS items and their rates)
--
-- SAFETY: every row is first COPIED into an archive table (sales_archive / items_archive),
-- and only rows that are safely in the archive are deleted, so it can always be restored.
-- NOT touched: Customer Order Portal orders & invoices, products/catalog, customers,
-- Daily Report, Stock Report, stock transfers, Customer Report, Purchase Report, users.
begin;

-- Point of Sale + Total Summary
create table if not exists public.sales_archive (like public.sales including defaults);
alter table public.sales_archive add column if not exists archived_at timestamptz not null default now();
alter table public.sales_archive enable row level security;  -- no policies: hidden from the app
insert into public.sales_archive
select s.*, now() from public.sales s
where not exists (select 1 from public.sales_archive a where a.id = s.id);
delete from public.sales s where exists (select 1 from public.sales_archive a where a.id = s.id);

-- Rate Changing + Item Addition
create table if not exists public.items_archive (like public.items including defaults);
alter table public.items_archive add column if not exists archived_at timestamptz not null default now();
alter table public.items_archive enable row level security;
insert into public.items_archive
select i.*, now() from public.items i
where not exists (select 1 from public.items_archive a where a.id = i.id);
delete from public.items i where exists (select 1 from public.items_archive a where a.id = i.id);

commit;

-- If any step fails, the whole script is cancelled (begin/commit) and nothing is deleted.
-- To restore later: copy rows back from sales_archive / items_archive (minus archived_at);
-- ask and a restore script for your exact columns will be written.
