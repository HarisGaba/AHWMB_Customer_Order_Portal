-- Bring every supplier from Purchase Report into Accounts, with their purchases and deposits.
--   * a supplier that already has a visible account (any capitals/spacing) uses that account
--   * an account hidden earlier (20261202) with the same name is shown again instead of duplicating it
--   * any other supplier gets a new account
--   * purchases -> bill lines, deposits -> account deposits, using the SAME ids (never duplicated)
--   * bill cycles already cleared with "Clear Bills" stay cleared; nothing is deleted
-- Safe to run more than once. Purchase Report itself is not changed.
begin;

do $$
begin
  if to_regclass('public.purchases') is null or to_regclass('public.purchase_accounts') is null then return; end if;

  -- 1. Show again hidden accounts whose name is a current supplier (when no visible account has that name).
  update public.purchase_accounts a set archived_at = null
   where a.archived_at is not null
     and exists (select 1 from public.purchases p where p.archived_at is null and lower(trim(p.party)) = lower(trim(a.name)))
     and not exists (select 1 from public.purchase_accounts b where b.archived_at is null and lower(trim(b.name)) = lower(trim(a.name)))
     and a.id = (select c.id from public.purchase_accounts c where lower(trim(c.name)) = lower(trim(a.name)) order by c.created_at limit 1);

  -- 2. New accounts for suppliers that still have none.
  insert into public.purchase_accounts (name, area)
  select distinct on (lower(trim(p.party))) trim(p.party), coalesce(p.area, '')
    from public.purchases p
   where p.archived_at is null and length(trim(p.party)) > 0
     and not exists (select 1 from public.purchase_accounts a where a.archived_at is null and lower(trim(a.name)) = lower(trim(p.party)))
   order by lower(trim(p.party)), p.created_at;

  -- 3. Purchases -> bill lines on the matching account.
  insert into public.purchase_lines (id, account_id, date, item, quantity, rate, amount, note, created_at)
  select p.id, a.id, p.date, coalesce(p.item, ''),
         case when coalesce(to_jsonb(p)->>'quantity', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (to_jsonb(p)->>'quantity')::numeric end,
         case when coalesce(to_jsonb(p)->>'quantity', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' and (to_jsonb(p)->>'quantity')::numeric > 0
              then round(p.amount / (to_jsonb(p)->>'quantity')::numeric, 2) end,
         p.amount,
         case when coalesce(to_jsonb(p)->>'quantity', '') <> '' and coalesce(to_jsonb(p)->>'quantity', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              then 'Quantity: ' || (to_jsonb(p)->>'quantity') else '' end,
         p.created_at
    from public.purchases p
    join public.purchase_accounts a on a.archived_at is null and lower(trim(a.name)) = lower(trim(p.party))
   where p.archived_at is null
  on conflict (id) do update set account_id = excluded.account_id, date = excluded.date, item = excluded.item,
    quantity = excluded.quantity, rate = excluded.rate, amount = excluded.amount, note = excluded.note, archived_at = null;

  -- 4. Deposits -> account deposits.
  if to_regclass('public.purchase_deposits') is not null then
    insert into public.purchase_account_deposits (id, account_id, date, amount, method, created_at)
    select d.id, a.id, d.date, d.amount, coalesce(to_jsonb(d)->>'method', 'Cash'), d.created_at
      from public.purchase_deposits d
      join public.purchases p on p.id = d.purchase_id and p.archived_at is null
      join public.purchase_accounts a on a.archived_at is null and lower(trim(a.name)) = lower(trim(p.party))
     where d.archived_at is null
    on conflict (id) do update set account_id = excluded.account_id, date = excluded.date, amount = excluded.amount,
      method = excluded.method, archived_at = null;
  end if;
end $$;

-- From now on a purchase for a supplier without an account creates that account automatically.
create or replace function public.sync_purchase_to_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_qty text := coalesce(to_jsonb(new)->>'quantity', ''); v_num boolean;
begin
  begin
    select id into v_acc from public.purchase_accounts
     where archived_at is null and lower(trim(name)) = lower(trim(new.party)) limit 1;
    if v_acc is null and new.archived_at is null and length(trim(new.party)) > 0 then
      insert into public.purchase_accounts (name, area) values (trim(new.party), coalesce(new.area, '')) returning id into v_acc;
    end if;
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

notify pgrst, 'reload schema';
commit;
