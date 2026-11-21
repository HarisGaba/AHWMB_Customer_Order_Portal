-- Activity history: records who added / edited / deleted what, and when, with before and after values.
-- Standalone (does not need 20261115_reliability.sql). Additive only and safe to run more than once.
-- Logging can never block real work: if writing the log fails, the business change still saves.
-- Tracked: purchases, purchase deposits, orders, POS sales, POS items, stock items, stock transfers, customer ledger.
begin;

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  entity text not null, record_id text not null, action text not null,
  actor_id uuid, actor_email text, before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_entity_time on public.activity_log (entity, created_at desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public, anon, authenticated;
grant select on public.activity_log to authenticated, service_role;
drop policy if exists "Staff read relevant activity" on public.activity_log;
create policy "Staff read relevant activity" on public.activity_log for select to authenticated using (
  public.is_ahwmb_admin()
  or (entity = 'orders' and public.has_perm('orders'))
  or (entity in ('items', 'sales') and public.has_perm('pos_summary'))
  or (entity in ('purchases', 'purchase_deposits') and public.has_perm('purchase_report'))
  or (entity in ('stock_items', 'stock_transfers') and (public.has_perm('stock_report') or public.has_perm('stock_transfer')))
  or (entity = 'customer_ledger' and public.has_perm('customer_report'))
);

create or replace function public.audit_business_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.activity_log (entity, record_id, action, actor_id, actor_email, before_data, after_data)
    values (tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', ''), tg_op, auth.uid(), auth.jwt()->>'email',
            case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  exception when others then
    null; -- never block the real change because of the log
  end;
  return coalesce(new, old);
end $$;
revoke all on function public.audit_business_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['purchases', 'purchase_deposits', 'orders', 'sales', 'items', 'stock_items', 'stock_transfers', 'customer_ledger'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_business_change()', t || '_audit', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
