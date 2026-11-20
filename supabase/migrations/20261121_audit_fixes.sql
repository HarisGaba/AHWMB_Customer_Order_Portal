-- Audit fixes. Safe to run more than once. Additive only: no row is deleted and no stock or sale is changed by running it.
-- 1) Deleting (reversing) a transfer no longer erases it: the row stays in history marked cancelled_at,
--    with what was / was not returned. Reversed transfers cannot be edited.
-- 2) validate_order_lines + direct customer submit_order become self-contained (no longer needs 20261115 first).
-- 3) The 4-argument save_order_invoice checks each line before saving.
begin;

alter table public.stock_transfers add column if not exists cancelled_at timestamptz;
alter table public.stock_transfers add column if not exists cancel_result jsonb;
alter table public.orders add column if not exists notes text not null default '';

-- The live database has an older delete_transfer with a different return type; replace it (function only, no data).
drop function if exists public.delete_transfer(uuid);
create or replace function public.delete_transfer(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t public.stock_transfers; v_line jsonb; v_item text; v_qty numeric;
  v_dest public.stock_items; v_back numeric;
  v_returned jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb; v_result jsonb;
begin
  if not public.has_perm('stock_transfer') then raise exception 'You do not have permission to change transfers'; end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_t.cancelled_at is not null then raise exception 'This transfer was already reversed'; end if;
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
              weight = coalesce(public.stock_items.weight, excluded.weight), updated_at = now();
      v_returned := v_returned || jsonb_build_object('item', v_item, 'quantity', v_back);
    end if;
    if v_back < v_qty then v_missing := v_missing || jsonb_build_object('item', v_item, 'quantity', v_qty - v_back); end if;
  end loop;
  v_result := jsonb_build_object('returned', v_returned, 'not_returned', v_missing, 'from', v_t.from_location, 'to', v_t.to_location);
  -- Keep the record (history), only mark it reversed.
  update public.stock_transfers set cancelled_at = now(), cancel_result = v_result where id = p_id;
  return v_result;
end $$;
revoke execute on function public.delete_transfer(uuid) from public, anon;
grant execute on function public.delete_transfer(uuid) to authenticated;

create or replace function public.guard_cancelled_transfer() returns trigger language plpgsql as $$
begin
  if old.cancelled_at is not null then raise exception 'A reversed transfer cannot be edited'; end if;
  return new;
end $$;
drop trigger if exists stock_transfer_reversal_guard on public.stock_transfers;
create trigger stock_transfer_reversal_guard before update on public.stock_transfers
  for each row execute function public.guard_cancelled_transfer();

create or replace function public.validate_order_lines(p_items jsonb,p_customer boolean) returns void
language plpgsql set search_path=public as $$
declare l jsonb; q numeric; r numeric; t numeric;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Add between 1 and 200 items'; end if;
 for l in select * from jsonb_array_elements(p_items) loop
  q := (l->>'quantity_value')::numeric; r := coalesce((l->>'unit_price')::numeric,0); t := coalesce((l->>'total')::numeric,0);
  if nullif(trim(l->>'name'),'') is null or q is null or q<0 or (q=0 and (p_customer or coalesce(l->>'unit_type','')<>'NONE')) or q>1000000 or r<0 or r>100000000 or t<0 or t>100000000000 or q::text in ('NaN','Infinity','-Infinity') or r::text in ('NaN','Infinity','-Infinity') or t::text in ('NaN','Infinity','-Infinity') then raise exception 'Items need a name, positive quantity and valid nonnegative amounts'; end if;
  if coalesce(l->>'unit_type','') not in ('KG','GRAMS','LITRE','PCS','PACKETS','BAGS','NONE') or (p_customer and l->>'unit_type'='NONE') then raise exception 'Choose a unit for every item'; end if;
  if p_customer and (r<>0 or t<>0) then raise exception 'Customer prices must be confirmed by staff'; end if;
  if not p_customer and t <> round(case when l->>'unit_type'='NONE' then r when l->>'unit_type'='GRAMS' then q*r/1000 else q*r end,2) then raise exception 'Line total does not match quantity and rate'; end if;
 end loop;
end $$;
revoke all on function public.validate_order_lines(jsonb,boolean) from public,anon,authenticated;

create or replace function public.submit_order(p_order_ref text,p_customer_name text,p_customer_phone text,p_customer_address text,p_location_link text,p_items jsonb,p_notes text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_staff boolean := coalesce(public.has_perm('orders'),false); v_total numeric;
begin
 perform public.validate_order_lines(p_items,not v_staff);
 if nullif(trim(p_order_ref),'') is null or nullif(trim(p_customer_name),'') is null then raise exception 'Name and reference are required'; end if;
 p_customer_phone := regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g');
 if left(p_customer_phone,1)='0' then p_customer_phone := '92'||substring(p_customer_phone from 2); end if;
 if not v_staff then
  if p_customer_phone !~ '^923[0-9]{9}$' or nullif(trim(p_customer_address),'') is null then raise exception 'Valid phone and address are required'; end if;
  if not public.check_order_rate_limit(p_customer_phone) then raise exception 'Too many orders. Please try later.'; end if;
 end if;
 select coalesce(sum((x->>'total')::numeric),0) into v_total from jsonb_array_elements(p_items) x;
 insert into public.orders(order_ref,customer_name,customer_phone,customer_address,location_link,items,notes,grand_total,total_amount,total_balance,remaining_balance)
 values(trim(p_order_ref),trim(p_customer_name),p_customer_phone,trim(coalesce(p_customer_address,'')),nullif(trim(p_location_link),''),p_items,left(coalesce(p_notes,''),2000),v_total,v_total,v_total,v_total) returning id into v_id;
 insert into public.order_items(order_id,sr,name,quantity,quantity_value,unit_type,unit_price,total)
 select v_id,ordinality::integer,x->>'name',coalesce(x->>'quantity',''),(x->>'quantity_value')::numeric,x->>'unit_type',coalesce((x->>'unit_price')::numeric,0),coalesce((x->>'total')::numeric,0)
 from jsonb_array_elements(p_items) with ordinality as a(x,ordinality);
 return v_id;
end $$;
revoke all on function public.submit_order(text,text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.submit_order(text,text,text,text,text,jsonb,text) to anon,authenticated,service_role;

create or replace function public.save_order_invoice(p_id uuid, p_items jsonb, p_balance numeric, p_deposit numeric)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders; v_total numeric; l jsonb;
begin
  if not public.has_perm('orders') then raise exception 'Not authorized'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item before saving the invoice'; end if;
  for l in select * from jsonb_array_elements(p_items) loop
    if nullif(trim(coalesce(l->>'name', '')), '') is null then raise exception 'Every invoice line needs an item name'; end if;
    if coalesce(nullif(l->>'total', ''), '0') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'Line total for % is not a valid amount', l->>'name'; end if;
  end loop;
  if p_balance is null or p_deposit is null or p_balance < 0 or p_deposit < 0 or p_balance::text = 'NaN' or p_deposit::text = 'NaN' then raise exception 'Invalid balance or deposit'; end if;
  select round(coalesce(sum(coalesce(nullif(x->>'total', '')::numeric, 0)), 0), 2) into v_total from jsonb_array_elements(p_items) x;
  update public.orders
     set items = p_items, grand_total = v_total + p_balance, total_amount = v_total, balance = p_balance,
         total_balance = v_total + p_balance, deposit = p_deposit, remaining_balance = v_total + p_balance - p_deposit,
         status = 'completed'
   where id = p_id
  returning * into v;
  if not found then raise exception 'Order not found. Refresh the order list and try again.'; end if;
  return v;
end $$;
revoke all on function public.save_order_invoice(uuid, jsonb, numeric, numeric) from public, anon;
grant execute on function public.save_order_invoice(uuid, jsonb, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
