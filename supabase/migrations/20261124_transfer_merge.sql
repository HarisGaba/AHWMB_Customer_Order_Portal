-- Godown transfers add into the matching item at the destination instead of creating a duplicate row.
--   * Names match ignoring capitals, extra spaces and punctuation ("B2  Toota-Basmati" = "b2 toota basmati").
--   * A transfer line may name the destination item ("to_item"), e.g. "b2 toota basmati" -> "b2 toota";
--     the transfer form suggests it and the user confirms. Each line remembers its to_item, so editing
--     or reversing the transfer takes the stock back from that same item.
-- Functions only: no stock row, transfer row or history is changed or deleted by running this.
-- Safe to run more than once. Routes unchanged (Jodia -> Site/Shop, Site -> Jodia/Shop).
begin;

-- Lower-case, ASCII punctuation/spaces collapsed. Urdu letters are kept as they are.
create or replace function public._norm_item(p text) returns text
language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p, '')), '[[:space:]\-_.,()/\\:;''"+&]+', ' ', 'g'));
$$;

-- Take stock out of a location: exact name first, then the normalised name.
create or replace function public._stock_take(p_loc text, p_item text, p_qty numeric)
returns public.stock_items
language plpgsql security definer set search_path = public as $$
declare v public.stock_items;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be above 0'; end if;
  select * into v from public.stock_items where location = p_loc and lower(trim(item)) = lower(trim(p_item)) for update;
  if not found then
    select * into v from public.stock_items where location = p_loc and public._norm_item(item) = public._norm_item(p_item)
      order by created_at limit 1 for update;
  end if;
  if not found then raise exception '% is not in % stock', p_item, p_loc; end if;
  if v.quantity < p_qty then
    raise exception 'Not enough % in % (available %, requested %)', v.item, p_loc, v.quantity, p_qty;
  end if;
  update public.stock_items set quantity = quantity - p_qty, updated_at = now() where id = v.id;
  return v;
end $$;
revoke execute on function public._stock_take(text, text, numeric) from public, anon, authenticated;

-- Add stock into a location: into the matching item if one exists, otherwise a new row. Returns the item name used.
create or replace function public._stock_add(p_loc text, p_item text, p_weight numeric, p_qty numeric)
returns text
language plpgsql security definer set search_path = public as $$
declare v public.stock_items;
begin
  select * into v from public.stock_items where location = p_loc and lower(trim(item)) = lower(trim(p_item)) for update;
  if not found then
    select * into v from public.stock_items where location = p_loc and public._norm_item(item) = public._norm_item(p_item)
      order by created_at limit 1 for update;
  end if;
  if found then
    update public.stock_items set quantity = quantity + p_qty, weight = coalesce(weight, p_weight), updated_at = now() where id = v.id;
    return v.item;
  end if;
  insert into public.stock_items (location, item, weight, quantity) values (p_loc, trim(p_item), p_weight, p_qty)
    on conflict (location, lower(trim(item))) do update
      set quantity = public.stock_items.quantity + excluded.quantity,
          weight = coalesce(public.stock_items.weight, excluded.weight), updated_at = now();
  return trim(p_item);
end $$;
revoke execute on function public._stock_add(text, text, numeric, numeric) from public, anon, authenticated;

create or replace function public.transfer_stock(p_from text, p_to text, p_lines jsonb)
returns public.stock_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_line jsonb; v_qty numeric; v_src public.stock_items; v_dest text;
  v_lines jsonb := '[]'::jsonb; v_total numeric := 0; v_transfer public.stock_transfers;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to transfer stock'; end if;
  if p_from = p_to then raise exception 'Source and destination must be different'; end if;
  if (p_from, p_to) not in (('Jodia Bazaar Godown', 'Site Area Godown'), ('Jodia Bazaar Godown', 'Shop'), ('Site Area Godown', 'Jodia Bazaar Godown'), ('Site Area Godown', 'Shop')) then
    raise exception 'Allowed transfers: Jodia Bazaar -> Site Area, Jodia Bazaar -> Shop, Site Area -> Jodia Bazaar, Site Area -> Shop';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    if trim(coalesce(v_line->>'item', '')) = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Every line needs an item and a quantity above 0';
    end if;
    v_src := public._stock_take(p_from, v_line->>'item', v_qty);
    v_dest := public._stock_add(p_to, coalesce(nullif(trim(v_line->>'to_item'), ''), v_src.item), v_src.weight, v_qty);
    v_lines := v_lines || jsonb_build_object('item', v_src.item, 'to_item', v_dest, 'quantity', v_qty, 'weight', v_src.weight,
      'bags', case when v_src.weight > 0 then ceil(v_qty / v_src.weight) else null end);
    v_total := v_total + v_qty;
  end loop;
  insert into public.stock_transfers (from_location, to_location, lines, total_quantity)
    values (p_from, p_to, v_lines, v_total) returning * into v_transfer;
  return v_transfer;
end $$;
revoke execute on function public.transfer_stock(text, text, jsonb) from public, anon;
grant execute on function public.transfer_stock(text, text, jsonb) to authenticated;

create or replace function public.edit_transfer(p_id uuid, p_lines jsonb)
returns public.stock_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_t public.stock_transfers; v_line jsonb; v_src public.stock_items; v_back public.stock_items; v_dest text;
  v_lines jsonb := '[]'::jsonb; v_total numeric := 0; v_qty numeric;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to change transfers'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A transfer needs at least one item (use Reverse to undo it completely)';
  end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if to_jsonb(v_t)->>'cancelled_at' is not null then raise exception 'A reversed transfer cannot be edited'; end if;
  -- 1. Undo the old lines: take back from the item each line went into.
  for v_line in select * from jsonb_array_elements(v_t.lines) loop
    v_back := public._stock_take(v_t.to_location, coalesce(nullif(v_line->>'to_item', ''), v_line->>'item'), (v_line->>'quantity')::numeric);
    perform public._stock_add(v_t.from_location, v_line->>'item', v_back.weight, (v_line->>'quantity')::numeric);
  end loop;
  -- 2. Apply the new lines.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    if trim(coalesce(v_line->>'item', '')) = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Every line needs an item and a quantity above 0';
    end if;
    v_src := public._stock_take(v_t.from_location, v_line->>'item', v_qty);
    v_dest := public._stock_add(v_t.to_location, coalesce(nullif(trim(v_line->>'to_item'), ''), v_src.item), v_src.weight, v_qty);
    v_lines := v_lines || jsonb_build_object('item', v_src.item, 'to_item', v_dest, 'quantity', v_qty, 'weight', v_src.weight,
      'bags', case when v_src.weight > 0 then ceil(v_qty / v_src.weight) else null end);
    v_total := v_total + v_qty;
  end loop;
  update public.stock_transfers set lines = v_lines, total_quantity = v_total, edited_at = now()
    where id = p_id returning * into v_t;
  return v_t;
end $$;
revoke execute on function public.edit_transfer(uuid, jsonb) from public, anon;
grant execute on function public.edit_transfer(uuid, jsonb) to authenticated;

-- Reverse (keeps the record, marks it cancelled). Takes back from the item each line went into;
-- if some of it was already used, only what is left is returned and the rest is recorded.
create or replace function public.delete_transfer(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t public.stock_transfers; v_line jsonb; v_name text; v_qty numeric;
  v_dest public.stock_items; v_back numeric;
  v_returned jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb; v_result jsonb;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to change transfers'; end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_t.cancelled_at is not null then raise exception 'This transfer was already reversed'; end if;
  for v_line in select * from jsonb_array_elements(v_t.lines) loop
    v_name := coalesce(nullif(v_line->>'to_item', ''), v_line->>'item');
    v_qty := coalesce((v_line->>'quantity')::numeric, 0);
    select * into v_dest from public.stock_items where location = v_t.to_location and lower(trim(item)) = lower(trim(v_name)) for update;
    if not found then
      select * into v_dest from public.stock_items where location = v_t.to_location and public._norm_item(item) = public._norm_item(v_name)
        order by created_at limit 1 for update;
    end if;
    v_back := case when found then least(v_qty, greatest(v_dest.quantity, 0)) else 0 end;
    if v_back > 0 then
      update public.stock_items set quantity = quantity - v_back, updated_at = now() where id = v_dest.id;
      perform public._stock_add(v_t.from_location, v_line->>'item', v_dest.weight, v_back);
      v_returned := v_returned || jsonb_build_object('item', v_line->>'item', 'quantity', v_back);
    end if;
    if v_back < v_qty then v_missing := v_missing || jsonb_build_object('item', v_line->>'item', 'quantity', v_qty - v_back); end if;
  end loop;
  v_result := jsonb_build_object('returned', v_returned, 'not_returned', v_missing, 'from', v_t.from_location, 'to', v_t.to_location);
  update public.stock_transfers set cancelled_at = now(), cancel_result = v_result where id = p_id;
  return v_result;
end $$;
revoke execute on function public.delete_transfer(uuid) from public, anon;
grant execute on function public.delete_transfer(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
