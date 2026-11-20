-- Edit payment on a completed POS sale (Total Summary -> Edit).
-- Additive only: two new nullable columns, no existing row is changed by this script.
--   paid_amount       cash received; null on old sales (Cash = fully paid, Balance = nothing paid)
--   payment_edit_log  every edit keeps the previous payment/paid values, who changed it and when
begin;

alter table public.sales add column if not exists paid_amount numeric(12, 2);
alter table public.sales add column if not exists payment_edit_log jsonb not null default '[]'::jsonb;

create or replace function public.edit_sale_payment(p_id uuid, p_payment text, p_paid numeric)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare v public.sales;
begin
  if not public.has_perm('pos_summary') then raise exception 'Not authorized'; end if;
  if p_payment not in ('Cash', 'Balance') then raise exception 'Payment must be Cash or Balance'; end if;
  select * into v from public.sales where id = p_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if to_jsonb(v)->>'reversed_at' is not null then raise exception 'This sale was voided/refunded and cannot be edited'; end if;
  if p_paid is null or p_paid < 0 or p_paid > v.total then
    raise exception 'Paid amount must be between 0 and %', v.total;
  end if;
  update public.sales set
    payment = p_payment,
    paid_amount = p_paid,
    payment_edit_log = coalesce(payment_edit_log, '[]'::jsonb) || jsonb_build_object(
      'at', now(), 'by', coalesce(auth.jwt()->>'email', ''),
      'old_payment', v.payment, 'old_paid', v.paid_amount,
      'new_payment', p_payment, 'new_paid', p_paid)
  where id = p_id
  returning * into v;
  return v;
end $$;
revoke all on function public.edit_sale_payment(uuid, text, numeric) from public, anon;
grant execute on function public.edit_sale_payment(uuid, text, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
