-- ahmedyounus1978@gmail.com runs the Customer Order Portal (incl. Users) and can jump to the POS,
-- so he gets the same main-admin rights as ahwmb1965@gmail.com.
-- Only this permission function changes: no table, row or user is modified or deleted.
create or replace function public.is_ahwmb_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('ahwmb1965@gmail.com', 'ahmedyounus1978@gmail.com');
$$;
