-- Both owner accounts are always full admins, and a staff order is never mistaken for a customer order.
-- Functions only: no table, row or user is changed or deleted. Safe to run more than once.
begin;

-- Owner check also reads the account e-mail from auth.users (not only the login token).
create or replace function public.is_ahwmb_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', (select u.email from auth.users u where u.id = auth.uid()), ''))
         in ('ahwmb1965@gmail.com', 'ahmedyounus1978@gmail.com');
$$;

create or replace function public.submit_order(p_order_ref text,p_customer_name text,p_customer_phone text,p_customer_address text,p_location_link text,p_items jsonb,p_notes text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_staff boolean := coalesce(public.has_perm('orders'),false) or coalesce(public.is_ahwmb_admin(),false); v_total numeric;
begin
 -- Prices sent without an admin login = the admin session expired. Say so (instead of
 -- "Customer prices must be confirmed by staff") and save nothing.
 if not v_staff and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end) x
   where coalesce(nullif(x->>'unit_price',''),'0')::numeric <> 0 or coalesce(nullif(x->>'total',''),'0')::numeric <> 0) then
  raise exception 'Your admin login has expired. Log in again and press Submit; the order was not saved and your form is kept.';
 end if;
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

notify pgrst, 'reload schema';
commit;
