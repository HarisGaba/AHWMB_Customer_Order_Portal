-- Stock Report: keep the order items were entered/transferred in, and sync live across devices.
begin;

-- Position of each stock row. Rows created by a transfer get increasing numbers in the
-- same order as the transfer lines, so the list reads exactly like the transfer.
create sequence if not exists public.stock_items_sort_seq;
alter table public.stock_items add column if not exists sort_order bigint;
with ordered as (
  select id, row_number() over (order by created_at, item) as rn from public.stock_items where sort_order is null
)
update public.stock_items s set sort_order = o.rn from ordered o where s.id = o.id;
select setval('public.stock_items_sort_seq', greatest((select coalesce(max(sort_order), 0) from public.stock_items), 1));
alter table public.stock_items alter column sort_order set default nextval('public.stock_items_sort_seq');
alter table public.stock_items alter column sort_order set not null;
create index if not exists stock_items_location_sort on public.stock_items (location, sort_order);
grant usage, select on sequence public.stock_items_sort_seq to authenticated;

-- Live updates: every device receives stock and transfer changes immediately.
do $$
begin
  begin alter publication supabase_realtime add table public.stock_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.stock_transfers; exception when duplicate_object then null; end;
end $$;

commit;
