-- ahmedyounus1978@gmail.com now uses the POS (separate Supabase project) only.
-- Only ahwmb1965@gmail.com remains an order-portal admin.
-- Run in the ORDER PORTAL Supabase project: SQL Editor → New query → paste → Run.
create or replace function public.is_ahwmb_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('ahwmb1965@gmail.com');
$$;
