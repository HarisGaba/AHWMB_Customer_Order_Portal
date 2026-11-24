-- Purchase Report -> Accounts, automatically (in the database, so it always happens):
--   * a purchase saved/edited in Purchase Report becomes (or updates) a bill line on the account whose
--     name matches the supplier; deleting the purchase hides that line
--   * a deposit saved/removed in Purchase Report does the same on the account's deposits
-- Uses the SAME id for the copy, so it is never duplicated. Nothing is deleted. Bill cycles already
-- cleared with "Clear Bills" stay cleared. Purchases from before this update are not copied.
-- Safe to run more than once.
begin;

create or replace function public.sync_purchase_to_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_qty text := coalesce(to_jsonb(new)->>'quantity', ''); v_num boolean;
begin
  begin
    select id into v_acc from public.purchase_accounts
     where archived_at is null and lower(trim(name)) = lower(trim(new.party)) limit 1;
    if v_acc is null then return new; end if;
    if new.archived_at is not null then
      update public.purchase_lines set archived_at = now() where id = new.id and archived_at is null;
      return new;
    end if;
    v_num := v_qty ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';
    insert into public.purchase_lines (id, account_id, date, item, quantity, rate, amount, note)
    values (new.id, v_acc, new.date, coalesce(new.item, ''),
            case when v_num then v_qty::numeric end,
            case when v_num and v_qty::numeric > 0 then round(new.amount / v_qty::numeric, 2) end,
            new.amount,
            case when v_qty <> '' and not v_num then 'Quantity: ' || v_qty else '' end)
    on conflict (id) do update set account_id = excluded.account_id, date = excluded.date, item = excluded.item,
      quantity = excluded.quantity, rate = excluded.rate, amount = excluded.amount, note = excluded.note, archived_at = null;
  exception when others then
    null; -- the purchase itself must always save
  end;
  return new;
end $$;
revoke all on function public.sync_purchase_to_account() from public, anon, authenticated;
drop trigger if exists purchases_to_account on public.purchases;
create trigger purchases_to_account after insert or update on public.purchases
  for each row execute function public.sync_purchase_to_account();

create or replace function public.sync_deposit_to_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_acc uuid;
begin
  begin
    select a.id into v_acc from public.purchases p
      join public.purchase_accounts a on a.archived_at is null and lower(trim(a.name)) = lower(trim(p.party))
     where p.id = new.purchase_id limit 1;
    if v_acc is null then return new; end if;
    insert into public.purchase_account_deposits (id, account_id, date, amount, method, archived_at)
    values (new.id, v_acc, new.date, new.amount, coalesce(to_jsonb(new)->>'method', 'Cash'), new.archived_at)
    on conflict (id) do update set account_id = excluded.account_id, date = excluded.date, amount = excluded.amount,
      method = excluded.method, archived_at = excluded.archived_at;
  exception when others then
    null; -- the deposit itself must always save
  end;
  return new;
end $$;
revoke all on function public.sync_deposit_to_account() from public, anon, authenticated;
drop trigger if exists purchase_deposits_to_account on public.purchase_deposits;
create trigger purchase_deposits_to_account after insert or update on public.purchase_deposits
  for each row execute function public.sync_deposit_to_account();

notify pgrst, 'reload schema';
commit;
