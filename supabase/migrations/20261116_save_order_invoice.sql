-- Fixes "PGRST202: Could not find the function public.save_order_invoice(p_balance, p_deposit, p_id, p_items)".
-- Adds the 4-argument save_order_invoice the app calls when an order has no version number
-- (databases where 20261115_reliability.sql was not applied). Safe to run more than once.
-- Function + grant only: no table is altered and no record is deleted.
begin;

create or replace function public.save_order_invoice(p_id uuid, p_items jsonb, p_balance numeric, p_deposit numeric)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders; v_total numeric;
begin
  if not public.has_perm('orders') then raise exception 'Not authorized'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item before saving the invoice'; end if;
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

commit;

-- Make the API see the new function immediately (clears the PGRST202 schema-cache error).
notify pgrst, 'reload schema';
