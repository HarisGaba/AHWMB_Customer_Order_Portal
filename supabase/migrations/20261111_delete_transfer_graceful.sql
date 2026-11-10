-- Deleting a transfer never gets stuck any more.
-- For each line it moves back as much as the destination still holds (up to the
-- transferred amount). Items that were since deleted or used up are skipped. The
-- record is always removed, and the result says what was returned and what was not.
begin;

drop function if exists public.delete_transfer(uuid);

create or replace function public.delete_transfer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.stock_transfers;
  v_line jsonb;
  v_item text;
  v_qty numeric;
  v_dest public.stock_items;
  v_back numeric;
  v_returned jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to change transfers'; end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;

  for v_line in select * from jsonb_array_elements(v_t.lines) loop
    v_item := v_line->>'item';
    v_qty := coalesce((v_line->>'quantity')::numeric, 0);
    select * into v_dest from public.stock_items
      where location = v_t.to_location and lower(trim(item)) = lower(trim(v_item)) for update;
    v_back := case when found then least(v_qty, greatest(v_dest.quantity, 0)) else 0 end;

    if v_back > 0 then
      update public.stock_items set quantity = quantity - v_back, updated_at = now() where id = v_dest.id;
      insert into public.stock_items (location, item, weight, quantity)
        values (v_t.from_location, v_dest.item, v_dest.weight, v_back)
        on conflict (location, lower(trim(item))) do update
          set quantity = public.stock_items.quantity + excluded.quantity,
              weight = coalesce(public.stock_items.weight, excluded.weight),
              updated_at = now();
      v_returned := v_returned || jsonb_build_object('item', v_item, 'quantity', v_back);
    end if;
    if v_back < v_qty then
      v_missing := v_missing || jsonb_build_object('item', v_item, 'quantity', v_qty - v_back);
    end if;
  end loop;

  delete from public.stock_transfers where id = p_id;
  return jsonb_build_object('returned', v_returned, 'not_returned', v_missing,
                            'from', v_t.from_location, 'to', v_t.to_location);
end;
$$;
revoke execute on function public.delete_transfer(uuid) from public, anon;
grant execute on function public.delete_transfer(uuid) to authenticated;

commit;
