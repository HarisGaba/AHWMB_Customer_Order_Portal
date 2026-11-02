-- POS: Urdu item names, weight per unit (for Total Weight on the bill), customer name on sales.
begin;

alter table public.items add column if not exists name_ur text;
-- kg in one unit of quantity. 1 = item is sold by the kg, so quantity is the weight.
alter table public.items add column if not exists unit_weight numeric(10,3) not null default 1;
alter table public.items drop constraint if exists items_unit_weight_check;
alter table public.items add constraint items_unit_weight_check check (unit_weight > 0);

alter table public.sales add column if not exists customer_name text;

-- Same as before plus an optional customer name. Lines keep their own copy of
-- name, Urdu name and unit weight so old bills never change.
drop function if exists public.record_sale(date, jsonb, text);
create or replace function public.record_sale(p_day date, p_lines jsonb, p_payment text, p_customer_name text default null)
returns public.sales
language plpgsql
security invoker
as $$
declare
  v_no   integer;
  v_sale public.sales;
begin
  -- Serialise sales for the same day so two counters never get the same number.
  perform pg_advisory_xact_lock(hashtext('sale-' || p_day::text));

  select coalesce(max(customer_no), 0) + 1 into v_no from public.sales where day = p_day;

  insert into public.sales (day, customer_no, lines, total, payment, customer_name)
  values (
    p_day,
    v_no,
    p_lines,
    (select coalesce(sum((l->>'qty')::numeric * (l->>'rate')::numeric), 0) from jsonb_array_elements(p_lines) l),
    p_payment,
    nullif(trim(p_customer_name), '')
  )
  returning * into v_sale;

  return v_sale;
end;
$$;
revoke execute on function public.record_sale(date, jsonb, text, text) from public, anon;
grant execute on function public.record_sale(date, jsonb, text, text) to authenticated;

commit;
