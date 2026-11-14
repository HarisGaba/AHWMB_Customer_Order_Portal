-- WIPE THE 4 POS SECTIONS: Point of Sale, Rate Changing, Item Addition, Total Summary.
-- Run ONLY when you want them to start empty (they are hidden in the app for now).
--
--   * public.sales  -> Point of Sale bills + Total Summary (Summary is calculated from sales)
--   * public.items  -> Rate Changing + Item Addition (POS items and their rates)
--
-- SAFETY: every row is first COPIED, complete, into public.pos_wipe_backup (one row each,
-- stored whole as JSON, so it works whatever columns the tables have). Only rows that are
-- safely in the backup are deleted. If any step fails, nothing at all is deleted.
-- NOT touched: Customer Order Portal orders & invoices, products/catalog, customers,
-- Daily Report, Stock Report, stock transfers, Customer Report, Purchase Report, users,
-- and any existing archive tables.
begin;

create table if not exists public.pos_wipe_backup (
  source_table text not null,
  row_id text not null,
  data jsonb not null,
  archived_at timestamptz not null default now(),
  primary key (source_table, row_id)
);
alter table public.pos_wipe_backup enable row level security;  -- no policies: hidden from the app

-- Point of Sale + Total Summary
insert into public.pos_wipe_backup (source_table, row_id, data)
select 'sales', s.id::text, to_jsonb(s) from public.sales s
on conflict (source_table, row_id) do nothing;
delete from public.sales s
where exists (select 1 from public.pos_wipe_backup b where b.source_table = 'sales' and b.row_id = s.id::text);

-- Rate Changing + Item Addition
insert into public.pos_wipe_backup (source_table, row_id, data)
select 'items', i.id::text, to_jsonb(i) from public.items i
on conflict (source_table, row_id) do nothing;
delete from public.items i
where exists (select 1 from public.pos_wipe_backup b where b.source_table = 'items' and b.row_id = i.id::text);

commit;

-- Check the backup:   select source_table, count(*) from public.pos_wipe_backup group by 1;
-- Restore later:
--   insert into public.items select (jsonb_populate_record(null::public.items, data)).*
--     from public.pos_wipe_backup where source_table = 'items' on conflict do nothing;
--   insert into public.sales select (jsonb_populate_record(null::public.sales, data)).*
--     from public.pos_wipe_backup where source_table = 'sales' on conflict do nothing;
