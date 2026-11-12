-- Allows Jodia Bazaar Godown -> Shop transfers (in addition to the two godown directions).
-- Only the route rule changes: no rows are modified or deleted.
begin;

alter table public.stock_transfers drop constraint if exists stock_transfers_route_check;
alter table public.stock_transfers add constraint stock_transfers_route_check check (
  (from_location, to_location) in (('Site Area Godown', 'Jodia Bazaar Godown'), ('Jodia Bazaar Godown', 'Site Area Godown'), ('Jodia Bazaar Godown', 'Shop'))
) not valid;  -- existing history rows are kept as they are

create or replace function public.transfer_stock(p_from text, p_to text, p_lines jsonb)
returns public.stock_transfers
language plpgsql
security definer
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
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to transfer stock'; end if;
  if p_from = p_to then raise exception 'Source and destination must be different'; end if;
  if (p_from, p_to) not in (('Site Area Godown', 'Jodia Bazaar Godown'), ('Jodia Bazaar Godown', 'Site Area Godown'), ('Jodia Bazaar Godown', 'Shop')) then
    raise exception 'Allowed transfers: Site Area -> Jodia Bazaar, Jodia Bazaar -> Site Area, Jodia Bazaar -> Shop';
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
revoke execute on function public.transfer_stock(text, text, jsonb) from public, anon;
grant execute on function public.transfer_stock(text, text, jsonb) to authenticated;


commit;
