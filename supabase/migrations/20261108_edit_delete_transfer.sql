-- Edit or delete a single stock transfer, keeping stock balances correct.
--   delete_transfer: moves every line back (destination -> source) and removes the record.
--   edit_transfer:   reverses the old lines, applies the new ones, and updates the record.
-- Each runs as one transaction: if any line cannot be reversed or applied (e.g. the
-- destination no longer has that much stock), nothing changes.
begin;

alter table public.stock_transfers add column if not exists edited_at timestamptz;

-- Move qty of item from p_from to p_to (internal helper, not callable by users).
create or replace function public._stock_move(p_from text, p_to text, p_item text, p_qty numeric)
returns public.stock_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.stock_items;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be above 0'; end if;
  select * into v_src from public.stock_items
    where location = p_from and lower(trim(item)) = lower(trim(p_item)) for update;
  if not found then raise exception '% is not in % stock', p_item, p_from; end if;
  if v_src.quantity < p_qty then
    raise exception 'Not enough % in % (available %, needed %)', v_src.item, p_from, v_src.quantity, p_qty;
  end if;
  update public.stock_items set quantity = quantity - p_qty, updated_at = now() where id = v_src.id;
  insert into public.stock_items (location, item, weight, quantity)
    values (p_to, v_src.item, v_src.weight, p_qty)
    on conflict (location, lower(trim(item))) do update
      set quantity = public.stock_items.quantity + excluded.quantity,
          weight = coalesce(public.stock_items.weight, excluded.weight),
          updated_at = now();
  return v_src;
end;
$$;
revoke execute on function public._stock_move(text, text, text, numeric) from public, anon, authenticated;

create or replace function public.delete_transfer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.stock_transfers;
  v_line jsonb;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to change transfers'; end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  -- Put everything back where it came from.
  for v_line in select * from jsonb_array_elements(v_t.lines) loop
    perform public._stock_move(v_t.to_location, v_t.from_location, v_line->>'item', (v_line->>'quantity')::numeric);
  end loop;
  delete from public.stock_transfers where id = p_id;
end;
$$;
revoke execute on function public.delete_transfer(uuid) from public, anon;
grant execute on function public.delete_transfer(uuid) to authenticated;

create or replace function public.edit_transfer(p_id uuid, p_lines jsonb)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.stock_transfers;
  v_line jsonb;
  v_src public.stock_items;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_qty numeric;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to change transfers'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A transfer needs at least one item (use Delete to remove it completely)';
  end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;

  -- 1. Undo the old lines.
  for v_line in select * from jsonb_array_elements(v_t.lines) loop
    perform public._stock_move(v_t.to_location, v_t.from_location, v_line->>'item', (v_line->>'quantity')::numeric);
  end loop;
  -- 2. Apply the new lines, in the order given.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    if trim(coalesce(v_line->>'item', '')) = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Every line needs an item and a quantity above 0';
    end if;
    v_src := public._stock_move(v_t.from_location, v_t.to_location, v_line->>'item', v_qty);
    v_lines := v_lines || jsonb_build_object(
      'item', v_src.item, 'quantity', v_qty, 'weight', v_src.weight,
      'bags', case when v_src.weight > 0 then ceil(v_qty / v_src.weight) else null end);
    v_total := v_total + v_qty;
  end loop;

  update public.stock_transfers set lines = v_lines, total_quantity = v_total, edited_at = now()
    where id = p_id returning * into v_t;
  return v_t;
end;
$$;
revoke execute on function public.edit_transfer(uuid, jsonb) from public, anon;
grant execute on function public.edit_transfer(uuid, jsonb) to authenticated;

commit;
