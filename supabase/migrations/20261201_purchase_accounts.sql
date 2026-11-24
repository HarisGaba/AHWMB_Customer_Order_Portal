-- Purchase Report as supplier ACCOUNTS: each party has one ledger sheet with bill lines and deposits.
-- Additive only and safe to run more than once:
--   * new tables purchase_accounts, purchase_lines, purchase_account_deposits
--   * accounts start empty; the existing purchases / purchase_deposits tables are not changed
--   * nothing is ever deleted: removing a line/deposit sets archived_at; "Clear Bills" sets cleared_at
begin;

create table if not exists public.purchase_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  area text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists purchase_accounts_active_name_key on public.purchase_accounts (lower(trim(name))) where archived_at is null;

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

-- Accounts start empty: the user adds their own (no pre-made accounts, no copied bills).

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
