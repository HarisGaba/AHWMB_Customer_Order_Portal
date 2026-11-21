-- Short order numbers: 1, 2, 3 … shown instead of the long "#AHWMB-<uuid>" reference.
-- Additive only:
--   * new column orders.order_no; existing orders get numbers by creation date (oldest = 1).
--   * id and order_ref stay exactly as they are (links, notifications, history keep working).
--   * new orders take the next number from a database sequence, so two orders saved at the
--     same moment can never get the same number.
-- Safe to run more than once (rows that already have a number keep it).
begin;

alter table public.orders add column if not exists order_no bigint;
create sequence if not exists public.orders_order_no_seq;

-- Number orders that have none yet, after the highest existing number, oldest first.
with numbered as (
  select id, row_number() over (order by created_at, id) + coalesce((select max(order_no) from public.orders), 0) as n
    from public.orders where order_no is null
)
update public.orders o set order_no = numbered.n from numbered where o.id = numbered.id;

-- Continue the sequence after the highest number.
select setval('public.orders_order_no_seq', greatest(coalesce((select max(order_no) from public.orders), 0), 1),
              (select max(order_no) is not null from public.orders));
alter sequence public.orders_order_no_seq owned by public.orders.order_no;
alter table public.orders alter column order_no set default nextval('public.orders_order_no_seq');
create unique index if not exists orders_order_no_key on public.orders (order_no);
grant usage on sequence public.orders_order_no_seq to anon, authenticated, service_role;

-- The customer's confirmation screen shows "Order #N". Only someone who has the order's private
-- reference (generated in their own browser) can look its number up; nothing else is returned.
create or replace function public.order_number(p_ref text) returns bigint
language sql stable security definer set search_path = public as $$
  select order_no from public.orders where order_ref = trim(p_ref);
$$;
revoke all on function public.order_number(text) from public;
grant execute on function public.order_number(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
