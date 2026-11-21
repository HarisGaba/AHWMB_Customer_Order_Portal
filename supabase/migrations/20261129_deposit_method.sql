-- Purchase deposits: payment method (Cash / Cheque / Online).
-- Additive only, safe to run more than once. Existing deposits are marked 'Cash' (the column default).
begin;

alter table public.purchase_deposits add column if not exists method text not null default 'Cash';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_deposits_method_check') then
    alter table public.purchase_deposits add constraint purchase_deposits_method_check check (method in ('Cash', 'Cheque', 'Online'));
  end if;
end $$;

-- Same as add_purchase_deposit, plus the payment method. The 4-argument version stays for older screens.
create or replace function public.add_purchase_deposit(p_purchase uuid, p_amount numeric, p_date date, p_note text, p_method text)
returns public.purchase_deposits
language plpgsql security definer set search_path = public as $$
declare p public.purchases; v_paid numeric; d public.purchase_deposits;
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  if p_method is null or p_method not in ('Cash', 'Cheque', 'Online') then raise exception 'Choose Cash, Cheque or Online'; end if;
  if p_amount is null or p_amount <= 0 or p_amount::text = 'NaN' or p_date is null then raise exception 'Enter a deposit amount above 0 and a date'; end if;
  select * into p from public.purchases where id = p_purchase and archived_at is null for update;
  if not found then raise exception 'Purchase not found. Refresh and try again.'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.purchase_deposits where purchase_id = p_purchase and archived_at is null;
  if v_paid + p_amount > p.amount then raise exception 'This deposit is more than the remaining balance (Rs. %)', p.amount - v_paid; end if;
  insert into public.purchase_deposits (purchase_id, amount, date, note, method)
    values (p_purchase, p_amount, p_date, left(coalesce(p_note, ''), 500), p_method)
    returning * into d;
  return d;
end $$;
revoke all on function public.add_purchase_deposit(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.add_purchase_deposit(uuid, numeric, date, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
