-- Stock moves in one direction only:
--   Site Area Godown (bulk) -> Jodia Bazaar Godown -> Shop (final sale point)
begin;

alter table public.stock_items drop constraint if exists stock_items_location_check;
update public.stock_items set location = case location
  when 'Site Area' then 'Site Area Godown' when 'Godown' then 'Jodia Bazaar Godown' else location end;
alter table public.stock_items add constraint stock_items_location_check
  check (location in ('Site Area Godown', 'Jodia Bazaar Godown', 'Shop'));

alter table public.stock_transfers drop constraint if exists stock_transfers_from_location_check;
alter table public.stock_transfers drop constraint if exists stock_transfers_to_location_check;
alter table public.stock_transfers drop constraint if exists stock_transfers_check;
update public.stock_transfers set
  from_location = case from_location when 'Site Area' then 'Site Area Godown' when 'Godown' then 'Jodia Bazaar Godown' else from_location end,
  to_location = case to_location when 'Site Area' then 'Site Area Godown' when 'Godown' then 'Jodia Bazaar Godown' else to_location end;
alter table public.stock_transfers drop constraint if exists stock_transfers_route_check;
alter table public.stock_transfers add constraint stock_transfers_route_check check (
  (from_location, to_location) in (('Site Area Godown', 'Jodia Bazaar Godown'), ('Jodia Bazaar Godown', 'Shop'))
) not valid;  -- older test rows (if any) are kept as history

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
  if not ((p_from, p_to) in (('Site Area Godown', 'Jodia Bazaar Godown'), ('Jodia Bazaar Godown', 'Shop'))) then
    raise exception 'Stock can only move Site Area Godown -> Jodia Bazaar Godown -> Shop';
  end if;
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

commit;
