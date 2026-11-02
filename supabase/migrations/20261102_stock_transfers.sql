-- Stock Report: per-location stock balances + transfers between locations.
-- Locations: 'Godown', 'Site Area', 'Shop'. Shop is the final sale point:
-- nothing can be transferred out of it.
begin;

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  location text not null check (location in ('Godown', 'Site Area', 'Shop')),
  item text not null check (length(trim(item)) > 0),
  weight numeric(12,2) check (weight is null or weight > 0),   -- kg per bag
  quantity numeric(14,2) not null default 0 check (quantity >= 0), -- kg in stock
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists stock_items_location_item on public.stock_items (location, lower(trim(item)));

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  from_location text not null check (from_location in ('Godown', 'Site Area')),
  to_location text not null check (to_location in ('Godown', 'Site Area', 'Shop')),
  lines jsonb not null,               -- [{item, quantity, weight, bags}]
  total_quantity numeric(14,2) not null,
  created_at timestamptz not null default now(),
  check (from_location <> to_location)
);
create index if not exists stock_transfers_created_at on public.stock_transfers (created_at desc);

alter table public.stock_items enable row level security;
alter table public.stock_transfers enable row level security;
revoke all on public.stock_items, public.stock_transfers from anon, public;
grant select, insert, update, delete on public.stock_items, public.stock_transfers to authenticated;

drop policy if exists "Admins manage stock items" on public.stock_items;
create policy "Admins manage stock items" on public.stock_items for all to authenticated
using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());
drop policy if exists "Admins manage stock transfers" on public.stock_transfers;
create policy "Admins manage stock transfers" on public.stock_transfers for all to authenticated
using (public.is_ahwmb_admin()) with check (public.is_ahwmb_admin());

-- Move stock atomically: every line is checked and deducted from the source and added
-- to the destination, and the transfer is recorded. Any error rolls back everything.
create or replace function public.transfer_stock(p_from text, p_to text, p_lines jsonb)
returns public.stock_transfers
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line jsonb;
  v_item text;
  v_qty numeric;
  v_src public.stock_items;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_transfer public.stock_transfers;
begin
  if not public.is_ahwmb_admin() then raise exception 'Not authorized'; end if;
  if p_from = 'Shop' then raise exception 'Items in the Shop cannot be shifted anywhere else'; end if;
  if p_from = p_to then raise exception 'Choose two different locations'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := trim(v_line->>'item');
    v_qty := (v_line->>'quantity')::numeric;
    if v_item is null or v_item = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Every line needs an item and a quantity above 0';
    end if;

    select * into v_src from public.stock_items
      where location = p_from and lower(trim(item)) = lower(v_item) for update;
    if not found then raise exception '% is not in % stock', v_item, p_from; end if;
    if v_src.quantity < v_qty then
      raise exception 'Not enough % in % (available %, requested %)', v_item, p_from, v_src.quantity, v_qty;
    end if;

    update public.stock_items set quantity = quantity - v_qty, updated_at = now() where id = v_src.id;

    insert into public.stock_items (location, item, weight, quantity)
      values (p_to, v_src.item, v_src.weight, v_qty)
      on conflict (location, lower(trim(item))) do update
        set quantity = public.stock_items.quantity + excluded.quantity,
            weight = coalesce(public.stock_items.weight, excluded.weight),
            updated_at = now();

    v_lines := v_lines || jsonb_build_object(
      'item', v_src.item, 'quantity', v_qty, 'weight', v_src.weight,
      'bags', case when v_src.weight > 0 then ceil(v_qty / v_src.weight) else null end);
    v_total := v_total + v_qty;
  end loop;

  insert into public.stock_transfers (from_location, to_location, lines, total_quantity)
    values (p_from, p_to, v_lines, v_total)
    returning * into v_transfer;
  return v_transfer;
end;
$$;
revoke execute on function public.transfer_stock(text, text, jsonb) from public, anon;
grant execute on function public.transfer_stock(text, text, jsonb) to authenticated;

commit;
