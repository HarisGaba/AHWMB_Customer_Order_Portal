-- Total Summary "Void / refund sale". Standalone: does not need 20261115_reliability.sql.
-- Additive only. A reversed sale is NOT deleted: the bill stays in the table with when/why it was reversed;
-- it is only left out of the active sales totals. Safe to run more than once.
begin;

alter table public.sales add column if not exists reversed_at timestamptz;
alter table public.sales add column if not exists reversal_kind text;
alter table public.sales add column if not exists reversal_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_reversal_kind_check') then
    alter table public.sales add constraint sales_reversal_kind_check check (reversal_kind is null or reversal_kind in ('void', 'refund')) not valid;
  end if;
end $$;

create or replace function public.reverse_sale(p_id uuid, p_kind text, p_reason text) returns public.sales
language plpgsql security definer set search_path = public as $$
declare v public.sales;
begin
  if not public.has_perm('pos_summary') then raise exception 'Not authorized'; end if;
  if p_kind not in ('void', 'refund') or length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Choose void/refund and provide a reason';
  end if;
  update public.sales set reversed_at = now(), reversal_kind = p_kind, reversal_reason = trim(p_reason)
   where id = p_id and reversed_at is null
  returning * into v;
  if not found then raise exception 'Sale already reversed or not found'; end if;
  return v;
end $$;
revoke all on function public.reverse_sale(uuid, text, text) from public, anon;
grant execute on function public.reverse_sale(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
