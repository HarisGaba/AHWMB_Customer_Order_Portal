revoke insert on public.orders from anon;
revoke insert on public.order_items from anon;

create or replace function public.check_order_rate_limit(p_phone text)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  -- Serialize concurrent submissions for this phone until transaction completion.
  perform pg_advisory_xact_lock(hashtextextended(p_phone, 0));
  return (select count(*) < 10 from public.orders
    where customer_phone = p_phone and created_at > now() - interval '1 hour');
end;
$$;
revoke all on function public.check_order_rate_limit(text) from public, anon, authenticated;

create or replace function public.submit_order(
  p_order_ref text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_location_link text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id uuid;
begin
  p_customer_phone := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  if left(p_customer_phone, 1) = '0' then
    p_customer_phone := '92' || substring(p_customer_phone from 2);
  end if;
  if not coalesce(public.is_ahwmb_admin(), false) and p_customer_phone !~ '^923[0-9]{9}$' then
    raise exception 'Please enter a valid phone number';
  end if;
  if not coalesce(public.is_ahwmb_admin(), false) and not public.check_order_rate_limit(p_customer_phone) then
    raise exception 'rate_limit_exceeded' using hint = 'Too many orders from this number';
  end if;
  if nullif(trim(p_order_ref), '') is null then
    raise exception 'Order reference is missing';
  end if;

  insert into public.orders (
    order_ref, customer_name, customer_phone, customer_address, location_link, items, status, grand_total
  ) values (
    trim(p_order_ref), trim(coalesce(p_customer_name, '')), trim(coalesce(p_customer_phone, '')), trim(coalesce(p_customer_address, '')),
    nullif(trim(coalesce(p_location_link, '')), ''), coalesce(p_items, '[]'::jsonb), 'pending', 0
  ) returning id into new_order_id;

  insert into public.order_items (order_id, sr, name, quantity, quantity_value, unit_type, unit_price, total)
  select new_order_id, item.sr, item.name, item.quantity, item.quantity_value, item.unit_type, item.unit_price, item.total
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    sr integer,
    name text,
    quantity text,
    quantity_value numeric,
    unit_type text,
    unit_price numeric,
    total numeric
  );

  return new_order_id;
end;
$$;

revoke all on function public.submit_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_order(text, text, text, text, text, jsonb) to anon, authenticated;
