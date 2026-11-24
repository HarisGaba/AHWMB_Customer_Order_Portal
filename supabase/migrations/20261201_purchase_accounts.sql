-- Purchase Report as supplier ACCOUNTS: each party has one ledger sheet with bill lines and deposits.
-- Additive only and safe to run more than once:
--   * new tables purchase_accounts, purchase_lines, purchase_account_deposits
--   * existing purchases + deposits are COPIED into the matching account (same ids, so re-running
--     never duplicates); the old purchases / purchase_deposits tables are not changed
--   * nothing is ever deleted: removing a line/deposit sets archived_at; "Clear Bills" sets cleared_at
begin;

create table if not exists public.purchase_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  area text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists purchase_accounts_name_key on public.purchase_accounts (lower(trim(name)));

create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.purchase_accounts(id) on delete restrict,
  date date not null,
  item text not null default '',
  quantity numeric(18,3),
  rate numeric(18,2),
  bags numeric(18,2),
  amount numeric(18,2) not null check (amount >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz,   -- line removed by the user (hidden, kept)
  cleared_at timestamptz     -- bill cycle cleared (hidden, kept)
);
create index if not exists purchase_lines_account_idx on public.purchase_lines (account_id);

create table if not exists public.purchase_account_deposits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.purchase_accounts(id) on delete restrict,
  date date not null,
  amount numeric(18,2) not null check (amount > 0),
  method text not null default 'Cash' check (method in ('Cash', 'Cheque', 'Online')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  cleared_at timestamptz
);
create index if not exists purchase_account_deposits_account_idx on public.purchase_account_deposits (account_id);

-- Access: staff with the Purchase Report permission can read and write; nobody can hard-delete.
do $$
declare t text;
begin
  foreach t in array array['purchase_accounts', 'purchase_lines', 'purchase_account_deposits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists "Purchase staff read" on public.%I', t);
    execute format('create policy "Purchase staff read" on public.%I for select to authenticated using (public.has_perm(''purchase_report''))', t);
    execute format('drop policy if exists "Purchase staff add" on public.%I', t);
    execute format('create policy "Purchase staff add" on public.%I for insert to authenticated with check (public.has_perm(''purchase_report''))', t);
    execute format('drop policy if exists "Purchase staff edit" on public.%I', t);
    execute format('create policy "Purchase staff edit" on public.%I for update to authenticated using (public.has_perm(''purchase_report'')) with check (public.has_perm(''purchase_report''))', t);
    -- Activity history, when it is installed.
    if to_regproc('public.audit_business_change') is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_business_change()', t || '_audit', t);
    end if;
  end loop;
end $$;

-- Starting accounts.
insert into public.purchase_accounts (name)
select v.name from (values ('Leela Foods'), ('Shahbaz Dal Mill'), ('Wahab Dal Mill'), ('Farhan Dal Mill'), ('Kinjar Dal Mill'), ('Hamdan Dal Mill')) as v(name)
where not exists (select 1 from public.purchase_accounts a where lower(trim(a.name)) = lower(trim(v.name)));

-- Copy existing purchases into accounts (one account per supplier name).
do $$
begin
  if to_regclass('public.purchases') is null then return; end if;
  insert into public.purchase_accounts (name, area)
  select distinct on (lower(trim(p.party))) trim(p.party), coalesce(p.area, '')
    from public.purchases p
   where p.archived_at is null and length(trim(p.party)) > 0
     and not exists (select 1 from public.purchase_accounts a where lower(trim(a.name)) = lower(trim(p.party)));

  insert into public.purchase_lines (id, account_id, date, item, quantity, rate, bags, amount, note, created_at)
  select p.id, a.id, p.date, coalesce(p.item, ''),
         case when coalesce(to_jsonb(p)->>'quantity', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (to_jsonb(p)->>'quantity')::numeric end,
         null, null, p.amount,
         case when coalesce(to_jsonb(p)->>'quantity', '') <> '' and coalesce(to_jsonb(p)->>'quantity', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              then 'Quantity: ' || (to_jsonb(p)->>'quantity') else '' end,
         p.created_at
    from public.purchases p
    join public.purchase_accounts a on lower(trim(a.name)) = lower(trim(p.party))
   where p.archived_at is null
  on conflict (id) do nothing;

  if to_regclass('public.purchase_deposits') is not null then
    insert into public.purchase_account_deposits (id, account_id, date, amount, method, created_at)
    select d.id, a.id, d.date, d.amount, coalesce(to_jsonb(d)->>'method', 'Cash'), d.created_at
      from public.purchase_deposits d
      join public.purchases p on p.id = d.purchase_id and p.archived_at is null
      join public.purchase_accounts a on lower(trim(a.name)) = lower(trim(p.party))
     where d.archived_at is null
    on conflict (id) do nothing;
  end if;
end $$;

-- "Clear Bills": start a fresh cycle for ONE account. Lines and deposits are marked cleared (kept).
create or replace function public.clear_purchase_account(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_lines int; v_deps int;
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  update public.purchase_lines set cleared_at = now() where account_id = p_account and cleared_at is null and archived_at is null;
  get diagnostics v_lines = row_count;
  update public.purchase_account_deposits set cleared_at = now() where account_id = p_account and cleared_at is null and archived_at is null;
  get diagnostics v_deps = row_count;
  return jsonb_build_object('lines', v_lines, 'deposits', v_deps);
end $$;
revoke all on function public.clear_purchase_account(uuid) from public, anon;
grant execute on function public.clear_purchase_account(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
