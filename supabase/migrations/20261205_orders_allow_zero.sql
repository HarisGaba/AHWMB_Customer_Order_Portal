-- Staff orders and invoices: zero or blank prices/amounts are allowed, and a line amount typed by hand
-- (an increased rate, extra charges, rent) is accepted even if it differs from quantity x rate.
-- Customer orders keep their rules (no prices from customers). Function only; no data changes.
-- Safe to run more than once.
begin;

create or replace function public.validate_order_lines(p_items jsonb, p_customer boolean) returns void
language plpgsql set search_path = public as $$
declare l jsonb; q numeric; r numeric; t numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Add between 1 and 200 items'; end if;
  for l in select * from jsonb_array_elements(p_items) loop
    q := coalesce(nullif(l->>'quantity_value', '')::numeric, 0);
    r := coalesce(nullif(l->>'unit_price', '')::numeric, 0);
    t := coalesce(nullif(l->>'total', '')::numeric, 0);
    if nullif(trim(l->>'name'), '') is null then raise exception 'Every item needs a name'; end if;
    if q < 0 or r < 0 or t < 0 or q > 1000000 or r > 100000000 or t > 100000000000 then raise exception 'Quantities and amounts cannot be negative'; end if;
    if p_customer then
      if q <= 0 then raise exception 'Enter a quantity for every item'; end if;
      if coalesce(l->>'unit_type', '') not in ('KG', 'GRAMS', 'LITRE', 'PCS', 'PACKETS', 'BAGS') then raise exception 'Choose a unit for every item'; end if;
      if r <> 0 or t <> 0 then raise exception 'Customer prices must be confirmed by staff'; end if;
    end if;
  end loop;
end $$;
revoke all on function public.validate_order_lines(jsonb, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
