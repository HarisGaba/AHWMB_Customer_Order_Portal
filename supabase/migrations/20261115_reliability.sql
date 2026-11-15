-- Additive rollout: no existing business rows are deleted or reset.
begin;
alter table public.orders add column if not exists notes text not null default '';
alter table public.orders add column if not exists version integer not null default 1;
alter table public.stock_transfers add column if not exists cancelled_at timestamptz;
alter table public.sales add column if not exists request_id uuid;
alter table public.sales add column if not exists reversed_at timestamptz;
alter table public.sales add column if not exists reversal_kind text check (reversal_kind in ('void','refund'));
alter table public.sales add column if not exists reversal_reason text;
create unique index if not exists sales_request_id_unique on public.sales(request_id) where request_id is not null;

-- Phone possession must be verified before a customer can retrieve private history.
revoke execute on function public.previous_order(text) from public, anon, authenticated;
grant execute on function public.previous_order(text) to service_role;

create table if not exists public.activity_log (
 id bigint generated always as identity primary key,
 entity text not null, record_id text not null, action text not null,
 actor_id uuid, actor_email text, before_data jsonb, after_data jsonb,
 created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public, anon, authenticated;
grant select on public.activity_log to authenticated;
grant select on public.activity_log to service_role;
create policy "Staff read relevant activity" on public.activity_log for select to authenticated using (
 public.is_ahwmb_admin() or
 (entity = 'orders' and public.has_perm('orders')) or
 (entity in ('items','sales') and public.has_perm('pos_summary')) or
 (entity = 'purchases' and public.has_perm('purchase_report')) or
 (entity = 'stock_transfers' and public.has_perm('stock_report')) or
 (entity = 'customer_ledger' and public.has_perm('customer_report'))
);
create index if not exists activity_log_entity_time on public.activity_log(entity,created_at desc);
create or replace function public.audit_business_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.activity_log(entity,record_id,action,actor_id,actor_email,before_data,after_data)
 values (tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id'),tg_op,auth.uid(),auth.jwt()->>'email',
 case when tg_op <> 'INSERT' then to_jsonb(old) end,case when tg_op <> 'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function public.audit_business_change() from public,anon,authenticated;

create table if not exists public.purchases (
 id uuid primary key default gen_random_uuid(), party text not null check(length(trim(party))>0),
 area text not null default '', item text not null default '', amount numeric(18,2) not null check(amount>=0),
 date date not null, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.purchases enable row level security;
revoke all on public.purchases from public,anon,authenticated;
grant select on public.purchases to authenticated;
grant select on public.purchases,public.orders to service_role;
create policy "Staff view purchases" on public.purchases for select to authenticated using(public.has_perm('purchase_report'));
create or replace function public.save_purchase(p_row jsonb,p_version integer default null) returns public.purchases
language plpgsql security definer set search_path=public as $$
declare v public.purchases;
begin
 if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
 if (p_row->>'amount')::numeric < 0 or (p_row->>'amount')::numeric > 100000000000 or (p_row->>'amount')::numeric::text = 'NaN' then raise exception 'Invalid purchase amount'; end if;
 if p_version is null then
  perform pg_advisory_xact_lock(hashtextextended(p_row->>'id',0));
  select * into v from public.purchases where id=(p_row->>'id')::uuid;
  if found then
   if v.party=trim(p_row->>'party') and v.area=coalesce(p_row->>'area','') and v.item=coalesce(p_row->>'item','') and v.amount=(p_row->>'amount')::numeric and v.date=(p_row->>'date')::date then return v; end if;
   raise exception 'This purchase already exists with different details. No records were overwritten.';
  end if;
  insert into public.purchases(id,party,area,item,amount,date) values((p_row->>'id')::uuid,trim(p_row->>'party'),coalesce(p_row->>'area',''),coalesce(p_row->>'item',''),(p_row->>'amount')::numeric,(p_row->>'date')::date) returning * into v;
 else
  update public.purchases set party=trim(p_row->>'party'),area=coalesce(p_row->>'area',''),item=coalesce(p_row->>'item',''),amount=(p_row->>'amount')::numeric,date=(p_row->>'date')::date,version=version+1,updated_at=now()
   where id=(p_row->>'id')::uuid and version=p_version returning * into v;
  if not found then raise exception 'This purchase changed in another tab. Reload before editing.'; end if;
 end if;
 return v;
end $$;
revoke all on function public.save_purchase(jsonb,integer) from public,anon;
grant execute on function public.save_purchase(jsonb,integer) to authenticated;

-- One trigger keeps normalized lines consistent for every order writer, including older clients.
create or replace function public.sync_order_lines() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op = 'UPDATE' then
  delete from public.order_items where order_id=new.id;
  insert into public.order_items(order_id,sr,name,quantity,quantity_value,unit_type,unit_price,total)
  select new.id,ordinality::integer,x->>'name',coalesce(x->>'quantity',''),(x->>'quantity_value')::numeric,x->>'unit_type',coalesce((x->>'unit_price')::numeric,0),coalesce((x->>'total')::numeric,0)
  from jsonb_array_elements(new.items) with ordinality as a(x,ordinality);
 end if;
 return new;
end $$;
revoke all on function public.sync_order_lines() from public,anon,authenticated;
create trigger orders_sync_lines after update of items on public.orders for each row execute function public.sync_order_lines();
create or replace function public.bump_order_version() returns trigger language plpgsql as $$
begin new.version := old.version+1; return new; end $$;
create trigger orders_version before update on public.orders for each row execute function public.bump_order_version();

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

-- Replace public submission with a service-verified endpoint; authenticated staff retain access.
drop function public.submit_order(text,text,text,text,text,jsonb);
create function public.submit_order(p_order_ref text,p_customer_name text,p_customer_phone text,p_customer_address text,p_location_link text,p_items jsonb,p_notes text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_staff boolean := coalesce(public.has_perm('orders'),false); v_total numeric;
begin
 if not v_staff and coalesce(auth.role(),'')<>'service_role' then raise exception 'Submit through the verified order endpoint'; end if;
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
grant execute on function public.submit_order(text,text,text,text,text,jsonb,text) to authenticated,service_role;
-- Close any historical direct-insert bypass.
revoke insert on public.orders,public.order_items from anon,authenticated;
-- Older clients cannot bypass atomic invoice saves by writing financial columns.
revoke update on public.orders,public.order_items from authenticated;
grant update(customer_name,customer_phone,customer_address) on public.orders to authenticated;

create or replace function public.save_order_invoice(p_id uuid,p_version integer,p_items jsonb,p_balance numeric,p_deposit numeric) returns public.orders
language plpgsql security definer set search_path=public as $$
declare v public.orders; v_total numeric;
begin
 if not public.has_perm('orders') then raise exception 'Not authorized'; end if;
 perform public.validate_order_lines(p_items,false);
 if p_balance is null or p_deposit is null or p_balance<0 or p_deposit<0 or p_balance>100000000000 or p_deposit>100000000000 or p_balance::text='NaN' or p_deposit::text='NaN' then raise exception 'Invalid balance or deposit'; end if;
 select round(sum((x->>'total')::numeric),2) into v_total from jsonb_array_elements(p_items) x;
 update public.orders set items=p_items,grand_total=v_total+p_balance,total_amount=v_total,balance=p_balance,total_balance=v_total+p_balance,deposit=p_deposit,remaining_balance=v_total+p_balance-p_deposit,status='completed'
 where id=p_id and version=p_version returning * into v;
 if not found then raise exception 'This order changed in another tab. Reload it before saving; your edits have not been overwritten.'; end if;
 return v;
end $$;
revoke all on function public.save_order_invoice(uuid,integer,jsonb,numeric,numeric) from public,anon;
grant execute on function public.save_order_invoice(uuid,integer,jsonb,numeric,numeric) to authenticated;

create or replace function public.record_sale_v2(p_day date,p_lines jsonb,p_payment text,p_customer_name text,p_request_id uuid) returns public.sales
language plpgsql security definer set search_path=public as $$
declare v public.sales; l jsonb; q numeric; r numeric; n integer;
begin
 if not public.has_perm('pos_billing') then raise exception 'Not authorized'; end if;
 if p_request_id is null then raise exception 'Sale request ID is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into v from public.sales where request_id=p_request_id;
 if found then
  if v.lines<>p_lines or v.payment<>p_payment or coalesce(v.customer_name,'')<>coalesce(nullif(trim(p_customer_name),''),'') then raise exception 'This checkout was already saved with different details. Start a new bill.'; end if;
  return v;
 end if;
 if p_day is null or p_payment not in ('Cash','Balance') or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'Invalid sale'; end if;
 for l in select * from jsonb_array_elements(p_lines) loop
  q:=(l->>'qty')::numeric; r:=(l->>'rate')::numeric;
  if q is null or r is null or q<=0 or q>1000000 or r<0 or r>100000000 or q::text='NaN' or r::text='NaN' or nullif(trim(l->>'name'),'') is null then raise exception 'Invalid sale line'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtext('sale-'||p_day::text));
 select coalesce(max(customer_no),0)+1 into n from public.sales where day=p_day;
 insert into public.sales(day,customer_no,lines,total,payment,customer_name,request_id)
 values(p_day,n,p_lines,(select round(sum((x->>'qty')::numeric*(x->>'rate')::numeric),2) from jsonb_array_elements(p_lines) x),p_payment,nullif(trim(p_customer_name),''),p_request_id) returning * into v;
 return v;
end $$;
revoke all on function public.record_sale_v2(date,jsonb,text,text,uuid) from public,anon;
grant execute on function public.record_sale_v2(date,jsonb,text,text,uuid) to authenticated;
revoke execute on function public.record_sale(date,jsonb,text,text) from authenticated;
revoke insert,update on public.sales from authenticated;
create or replace function public.reverse_sale(p_id uuid,p_kind text,p_reason text) returns public.sales
language plpgsql security definer set search_path=public as $$
declare v public.sales;
begin
 if not public.has_perm('pos_summary') then raise exception 'Not authorized'; end if;
 if p_kind not in ('void','refund') or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Choose void/refund and provide a reason'; end if;
 update public.sales set reversed_at=now(),reversal_kind=p_kind,reversal_reason=trim(p_reason) where id=p_id and reversed_at is null returning * into v;
 if not found then raise exception 'Sale already reversed or not found'; end if;
 return v;
end $$;
revoke all on function public.reverse_sale(uuid,text,text) from public,anon;
grant execute on function public.reverse_sale(uuid,text,text) to authenticated;
create policy "Preserve sale history" on public.sales as restrictive for delete to authenticated using(false);
create or replace function public.purge_old_sales(p_keep_days integer default 60) returns integer language sql as $$ select 0; $$;
revoke execute on function public.purge_old_sales(integer) from public,anon,authenticated;

-- Reversal must succeed completely. Keep the original transfer for audit.
create or replace function public.delete_transfer(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v public.stock_transfers; l jsonb; returned jsonb := '[]';
begin
 if not public.has_perm('stock_transfer') then raise exception 'Not authorized'; end if;
 select * into v from public.stock_transfers where id=p_id for update;
 if not found or v.cancelled_at is not null then raise exception 'Transfer missing or already reversed'; end if;
 for l in select * from jsonb_array_elements(v.lines) loop
  perform public._stock_move(v.to_location,v.from_location,l->>'item',(l->>'quantity')::numeric);
  returned := returned || l;
 end loop;
 update public.stock_transfers set cancelled_at=now() where id=p_id;
 return jsonb_build_object('returned',returned,'not_returned','[]'::jsonb);
end $$;
create policy "Preserve transfer history" on public.stock_transfers as restrictive for delete to authenticated using(false);
create or replace function public.guard_cancelled_transfer() returns trigger language plpgsql as $$
begin
 if old.cancelled_at is not null then raise exception 'A reversed transfer cannot be edited'; end if;
 return new;
end $$;
create trigger stock_transfer_reversal_guard before update on public.stock_transfers for each row execute function public.guard_cancelled_transfer();

do $$ declare t text; begin
 foreach t in array array['orders','items','sales','purchases','stock_transfers','customer_ledger'] loop
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_business_change()',t||'_audit',t);
 end loop;
end $$;
create or replace function public.search_orders(p_search text default '',p_status text default 'all',p_from date default null,p_to date default null,p_page integer default 0)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if not public.has_perm('orders') then raise exception 'Not authorized'; end if;
 with matches as (
 select * from public.orders o where (p_search='' or strpos(lower(o.customer_name||' '||o.customer_phone||' '||o.order_ref),lower(p_search))>0)
 and (p_from is null or o.created_at >= p_from::timestamp at time zone 'Asia/Karachi')
 and (p_to is null or o.created_at < (p_to+1)::timestamp at time zone 'Asia/Karachi')
 ), filtered as (
 select * from matches where p_status='all' or status=p_status or (p_status='urgent' and status='pending' and created_at < now()-interval '24 hours')
 ), page as (select * from filtered order by created_at desc,id limit 25 offset greatest(p_page,0)*25)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from filtered),
 'counts',jsonb_build_object('all',(select count(*) from matches),'pending',(select count(*) from matches where status='pending'),'urgent',(select count(*) from matches where status='pending' and created_at<now()-interval '24 hours'),'completed',(select count(*) from matches where status='completed'))) into result;
 return result;
end $$;
revoke all on function public.search_orders(text,text,date,date,integer) from public,anon;
grant execute on function public.search_orders(text,text,date,date,integer) to authenticated;
commit;
