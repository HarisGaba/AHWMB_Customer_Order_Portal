-- Accounts start EMPTY: hide the accounts and entries that 20261201 created automatically
-- (the six starting suppliers and the copies of existing purchases/deposits).
-- Nothing is deleted: rows only get archived_at (hidden). Accounts the user added themselves are kept,
-- and so is every row in the original purchases / purchase_deposits tables (the main Purchase Report).
-- A hidden account no longer blocks adding a new account with the same name.
-- Safe to run more than once.
begin;

-- Copies of the old purchase list -> hidden (the originals stay in the main Purchase Report).
update public.purchase_lines set archived_at = now()
 where archived_at is null and to_regclass('public.purchases') is not null
   and id in (select id from public.purchases);
update public.purchase_account_deposits set archived_at = now()
 where archived_at is null and to_regclass('public.purchase_deposits') is not null
   and id in (select id from public.purchase_deposits);

-- Automatically created accounts with nothing of the user's own in them -> hidden.
update public.purchase_accounts a set archived_at = now()
 where a.archived_at is null
   and (lower(trim(a.name)) in ('leela foods', 'shahbaz dal mill', 'wahab dal mill', 'farhan dal mill', 'kinjar dal mill', 'hamdan dal mill')
        or (to_regclass('public.purchases') is not null and exists (select 1 from public.purchases p where lower(trim(p.party)) = lower(trim(a.name)))))
   and not exists (select 1 from public.purchase_lines l where l.account_id = a.id and l.archived_at is null)
   and not exists (select 1 from public.purchase_account_deposits d where d.account_id = a.id and d.archived_at is null);

-- Names must be unique only among visible accounts.
drop index if exists public.purchase_accounts_name_key;
create unique index if not exists purchase_accounts_active_name_key on public.purchase_accounts (lower(trim(name))) where archived_at is null;

notify pgrst, 'reload schema';
commit;
