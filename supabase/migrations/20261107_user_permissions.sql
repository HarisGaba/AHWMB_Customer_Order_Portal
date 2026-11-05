-- ═══════════════════════════════════════════════════════════════════════════
-- Role-based users & page permissions
-- ═══════════════════════════════════════════════════════════════════════════
-- * ahwmb1965@gmail.com stays the main admin (is_ahwmb_admin): full access + Users page.
-- * Every other login is a row in app_users with a list of page permissions.
-- * Every table policy and RPC checks has_perm(<page>), so hiding menu items is not the
--   only protection: a user can only read/write data for pages they were given.
-- * Also closes the old "Allow public full access" policies on orders/order_items,
--   which let anyone with the public key read and change every order.
--
-- Permission keys (must match src/lib/access.ts):
--   orders, daily_report, customer_report, add_customer, stock_report, stock_transfer,
--   purchase_report, products, pos_billing, pos_items, pos_summary
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ---------- Users ----------
create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  permissions text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, public;
grant select on public.app_users to authenticated;   -- writes go through the manage-users function
drop policy if exists "Users read own row; admin reads all" on public.app_users;
create policy "Users read own row; admin reads all" on public.app_users for select to authenticated
  using (user_id = auth.uid() or public.is_ahwmb_admin());

-- True for the main admin, or an active user who was given this page.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_ahwmb_admin() or exists (
    select 1 from public.app_users u
    where u.user_id = auth.uid() and u.active and p = any(u.permissions)
  );
$$;
revoke execute on function public.has_perm(text) from public, anon;
grant execute on function public.has_perm(text) to authenticated;

-- What the signed-in user may open (used by the app to build menus and guard routes).
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_ahwmb_admin() then jsonb_build_object('admin', true, 'active', true, 'name', 'Admin', 'permissions', '[]'::jsonb)
    else coalesce((
      select jsonb_build_object('admin', false, 'active', u.active, 'name', u.name,
                                'permissions', case when u.active then to_jsonb(u.permissions) else '[]'::jsonb end)
      from public.app_users u where u.user_id = auth.uid()
    ), jsonb_build_object('admin', false, 'active', false, 'name', '', 'permissions', '[]'::jsonb))
  end;
$$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- Ahmed keeps exactly what he had: the POS.
insert into public.app_users (user_id, email, name, permissions)
select id, email, 'Ahmed (POS)', array['pos_billing', 'pos_items', 'pos_summary']
from auth.users where lower(email) = 'ahmedyounus1978@gmail.com'
on conflict (user_id) do nothing;

-- Kept for compatibility; now means "has any POS page".
create or replace function public.is_ahwmb_pos_user() returns boolean
language sql stable security definer set search_path = public
as $$ select public.has_perm('pos_billing') or public.has_perm('pos_items') or public.has_perm('pos_summary'); $$;

-- ---------- Orders: close public access ----------
drop policy if exists "Allow public full access orders" on public.orders;
drop policy if exists "Allow public insert to orders" on public.orders;
drop policy if exists "Allow public select on orders" on public.orders;
drop policy if exists "Allow update on orders" on public.orders;
drop policy if exists "Shopkeeper can update orders" on public.orders;
drop policy if exists "Shopkeeper can view orders" on public.orders;
drop policy if exists "Shopkeepers can view orders" on public.orders;
drop policy if exists "Shopkeepers can update orders" on public.orders;
drop policy if exists "Shopkeepers can delete orders" on public.orders;
create policy "Staff view orders" on public.orders for select to authenticated using (public.has_perm('orders'));
create policy "Staff update orders" on public.orders for update to authenticated using (public.has_perm('orders')) with check (public.has_perm('orders'));
create policy "Staff delete orders" on public.orders for delete to authenticated using (public.has_perm('orders'));
-- "Customers can submit orders" (insert) is kept; customers place orders through submit_order().

drop policy if exists "Allow public full access order_items" on public.order_items;
drop policy if exists "Allow public insert to order_items" on public.order_items;
drop policy if exists "Allow public select on order_items" on public.order_items;
drop policy if exists "Allow update on order_items" on public.order_items;
drop policy if exists "Shopkeepers can view order items" on public.order_items;
drop policy if exists "Shopkeepers can update order items" on public.order_items;
drop policy if exists "Shopkeepers can delete order items" on public.order_items;
create policy "Staff view order items" on public.order_items for select to authenticated using (public.has_perm('orders'));
create policy "Staff update order items" on public.order_items for update to authenticated using (public.has_perm('orders')) with check (public.has_perm('orders'));
create policy "Staff delete order items" on public.order_items for delete to authenticated using (public.has_perm('orders'));

-- Customer "repeat last order": returns only that phone's latest completed order
-- (replaces reading the whole orders table with the public key).
create or replace function public.previous_order(p_phone text) returns jsonb
language sql stable security definer set search_path = public
as $$
  select to_jsonb(o) from (
    select id, order_ref, created_at, items, customer_name, customer_phone, customer_address, grand_total, status
    from public.orders
    where customer_phone = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') and status = 'completed'
    order by created_at desc limit 1
  ) o;
$$;
grant execute on function public.previous_order(text) to anon, authenticated;

-- Staff placing an order for a customer skip the phone/rate-limit checks (was admin only).
create or replace function public.submit_order(p_order_ref text, p_customer_name text, p_customer_phone text, p_customer_address text, p_location_link text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_order_id uuid;
  v_staff boolean := coalesce(public.has_perm('orders'), false);
begin
  p_customer_phone := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  if left(p_customer_phone, 1) = '0' then
    p_customer_phone := '92' || substring(p_customer_phone from 2);
  end if;
  if not v_staff and p_customer_phone !~ '^923[0-9]{9}$' then
    raise exception 'Please enter a valid phone number';
  end if;
  if not v_staff and not public.check_order_rate_limit(p_customer_phone) then
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
    sr integer, name text, quantity text, quantity_value numeric, unit_type text, unit_price numeric, total numeric
  );

  return new_order_id;
end;
$function$;

-- ---------- Customers & ledger ----------
drop policy if exists "Admins can view customers" on public.customers;
drop policy if exists "Admins can add customers" on public.customers;
drop policy if exists "Admins can update customers" on public.customers;
drop policy if exists "Admins can delete customers" on public.customers;
create policy "Staff view customers" on public.customers for select to authenticated
  using (public.has_perm('orders') or public.has_perm('customer_report') or public.has_perm('add_customer'));
create policy "Staff add customers" on public.customers for insert to authenticated
  with check (public.has_perm('customer_report') or public.has_perm('add_customer'));
create policy "Staff update customers" on public.customers for update to authenticated
  using (public.has_perm('customer_report') or public.has_perm('add_customer'))
  with check (public.has_perm('customer_report') or public.has_perm('add_customer'));
create policy "Staff delete customers" on public.customers for delete to authenticated
  using (public.has_perm('customer_report') or public.has_perm('add_customer'));

drop policy if exists "Admins manage customer ledger" on public.customer_ledger;
create policy "Staff manage customer ledger" on public.customer_ledger for all to authenticated
  using (public.has_perm('customer_report')) with check (public.has_perm('customer_report'));

-- ---------- Daily report (expenses) ----------
drop policy if exists "Shopkeepers can manage expenses" on public.daily_expenses;
create policy "Staff manage expenses" on public.daily_expenses for all to authenticated
  using (public.has_perm('daily_report')) with check (public.has_perm('daily_report'));
create or replace function public.prune_old_expenses() returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('daily_report') then return; end if;
  delete from public.daily_expenses where expense_date < (current_date - interval '60 days');
end;
$$;
revoke execute on function public.prune_old_expenses() from public, anon;
grant execute on function public.prune_old_expenses() to authenticated;

-- ---------- Products ----------
drop policy if exists "Admins can view products" on public.products;
drop policy if exists "Admins can add products" on public.products;
create policy "Staff add products" on public.products for insert to authenticated with check (public.has_perm('products'));
-- "Anyone can view products" (catalog) is kept.

-- ---------- Push notifications (new-order alerts go to whoever handles orders) ----------
drop policy if exists "Admins manage push subscriptions" on public.push_subscriptions;
create policy "Staff manage push subscriptions" on public.push_subscriptions for all to authenticated
  using (public.has_perm('orders')) with check (public.has_perm('orders'));

-- ---------- Stock ----------
drop policy if exists "Admins manage stock items" on public.stock_items;
create policy "Staff view stock" on public.stock_items for select to authenticated
  using (public.has_perm('stock_report') or public.has_perm('stock_transfer'));
create policy "Staff edit stock" on public.stock_items for insert to authenticated with check (public.has_perm('stock_report'));
create policy "Staff update stock" on public.stock_items for update to authenticated
  using (public.has_perm('stock_report')) with check (public.has_perm('stock_report'));
create policy "Staff delete stock" on public.stock_items for delete to authenticated using (public.has_perm('stock_report'));

drop policy if exists "Admins manage stock transfers" on public.stock_transfers;
create policy "Staff view transfers" on public.stock_transfers for select to authenticated
  using (public.has_perm('stock_report') or public.has_perm('stock_transfer'));
create policy "Staff delete transfers" on public.stock_transfers for delete to authenticated using (public.has_perm('stock_report'));
-- Transfers are created only through transfer_stock().

-- transfer_stock: now checks the stock_transfer permission and runs with owner rights
-- (so a transfer-only user can move stock without general edit rights).
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
  if p_from = 'Shop' or p_to = 'Shop' then raise exception 'The Shop is not part of stock transfers; transfers are only between godowns'; end if;
  if p_from = p_to then raise exception 'Source and destination must be different godowns'; end if;
  if not (p_from in ('Site Area Godown', 'Jodia Bazaar Godown') and p_to in ('Site Area Godown', 'Jodia Bazaar Godown')) then
    raise exception 'Stock can only be transferred between Site Area Godown and Jodia Bazaar Godown';
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

-- ---------- POS ----------
drop policy if exists "pos user items" on public.items;
create policy "POS view items" on public.items for select to authenticated using (public.is_ahwmb_pos_user());
create policy "POS manage items" on public.items for insert to authenticated with check (public.has_perm('pos_items'));
create policy "POS update items" on public.items for update to authenticated using (public.has_perm('pos_items')) with check (public.has_perm('pos_items'));
create policy "POS delete items" on public.items for delete to authenticated using (public.has_perm('pos_items'));

drop policy if exists "pos user sales" on public.sales;
create policy "POS view sales" on public.sales for select to authenticated
  using (public.has_perm('pos_billing') or public.has_perm('pos_summary'));
create policy "POS delete sales" on public.sales for delete to authenticated using (public.has_perm('pos_summary'));
-- Sales are created only through record_sale().

create or replace function public.record_sale(p_day date, p_lines jsonb, p_payment text, p_customer_name text default null)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no   integer;
  v_sale public.sales;
begin
  if not public.has_perm('pos_billing') then raise exception 'You do not have permission to make sales'; end if;
  perform pg_advisory_xact_lock(hashtext('sale-' || p_day::text));
  select coalesce(max(customer_no), 0) + 1 into v_no from public.sales where day = p_day;
  insert into public.sales (day, customer_no, lines, total, payment, customer_name)
  values (
    p_day, v_no, p_lines,
    (select coalesce(sum((l->>'qty')::numeric * (l->>'rate')::numeric), 0) from jsonb_array_elements(p_lines) l),
    p_payment, nullif(trim(p_customer_name), '')
  )
  returning * into v_sale;
  return v_sale;
end;
$$;
revoke execute on function public.record_sale(date, jsonb, text, text) from public, anon;
grant execute on function public.record_sale(date, jsonb, text, text) to authenticated;

create or replace function public.purge_old_sales(p_keep_days integer default 60) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_ahwmb_pos_user() then return 0; end if;
  with d as (delete from public.sales where day < current_date - p_keep_days returning 1)
  select count(*)::integer into v_count from d;
  return v_count;
end;
$$;
revoke execute on function public.purge_old_sales(integer) from public, anon;
grant execute on function public.purge_old_sales(integer) to authenticated;

-- ---------- Live permission changes ----------
do $$
begin
  begin alter publication supabase_realtime add table public.app_users; exception when duplicate_object then null; end;
end $$;

commit;
