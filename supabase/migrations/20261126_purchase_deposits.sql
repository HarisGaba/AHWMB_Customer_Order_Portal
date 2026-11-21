-- Purchase Report: purchases in the database, date-wise deposits, remaining balance, settled delete.
-- Standalone (does not need 20261115_reliability.sql). Additive only and safe to run more than once:
--   * creates public.purchases if it does not exist yet (existing rows are never touched)
--   * new table public.purchase_deposits: one row per payment, with its date
--   * "Delete" on a settled bill only sets archived_at (hidden from the list); nothing is erased
begin;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  party text not null check (length(trim(party)) > 0),
  area text not null default '', item text not null default '',
  amount numeric(18,2) not null check (amount >= 0),
  date date not null, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.purchases add column if not exists archived_at timestamptz;
alter table public.purchases enable row level security;
revoke all on public.purchases from public, anon, authenticated;
grant select on public.purchases to authenticated;
drop policy if exists "Staff view purchases" on public.purchases;
create policy "Staff view purchases" on public.purchases for select to authenticated using (public.has_perm('purchase_report'));

create table if not exists public.purchase_deposits (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  date date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists purchase_deposits_purchase_idx on public.purchase_deposits (purchase_id);
alter table public.purchase_deposits enable row level security;
revoke all on public.purchase_deposits from public, anon, authenticated;
grant select on public.purchase_deposits to authenticated;
drop policy if exists "Staff view purchase deposits" on public.purchase_deposits;
create policy "Staff view purchase deposits" on public.purchase_deposits for select to authenticated using (public.has_perm('purchase_report'));

-- Add or edit a purchase (same behaviour the app already uses).
create or replace function public.save_purchase(p_row jsonb, p_version integer default null) returns public.purchases
language plpgsql security definer set search_path = public as $$
declare v public.purchases; v_paid numeric;
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  if nullif(trim(coalesce(p_row->>'party', '')), '') is null then raise exception 'Enter the supplier name'; end if;
  if (p_row->>'amount')::numeric < 0 or (p_row->>'amount')::numeric > 100000000000 or (p_row->>'amount')::numeric::text = 'NaN' then raise exception 'Invalid purchase amount'; end if;
  if p_version is null then
    perform pg_advisory_xact_lock(hashtextextended(p_row->>'id', 0));
    select * into v from public.purchases where id = (p_row->>'id')::uuid;
    if found then
      if v.party = trim(p_row->>'party') and v.area = coalesce(p_row->>'area', '') and v.item = coalesce(p_row->>'item', '') and v.amount = (p_row->>'amount')::numeric and v.date = (p_row->>'date')::date then return v; end if;
      raise exception 'This purchase already exists with different details. No records were overwritten.';
    end if;
    insert into public.purchases (id, party, area, item, amount, date)
      values ((p_row->>'id')::uuid, trim(p_row->>'party'), coalesce(p_row->>'area', ''), coalesce(p_row->>'item', ''), (p_row->>'amount')::numeric, (p_row->>'date')::date)
      returning * into v;
  else
    select coalesce(sum(amount), 0) into v_paid from public.purchase_deposits where purchase_id = (p_row->>'id')::uuid and archived_at is null;
    if (p_row->>'amount')::numeric < v_paid then raise exception 'The amount cannot be less than the deposits already recorded (Rs. %)', v_paid; end if;
    update public.purchases set party = trim(p_row->>'party'), area = coalesce(p_row->>'area', ''), item = coalesce(p_row->>'item', ''),
      amount = (p_row->>'amount')::numeric, date = (p_row->>'date')::date, version = version + 1, updated_at = now()
      where id = (p_row->>'id')::uuid and version = p_version and archived_at is null returning * into v;
    if not found then raise exception 'This purchase changed in another tab. Reload before saving; your entry has not been overwritten.'; end if;
  end if;
  return v;
end $$;
revoke all on function public.save_purchase(jsonb, integer) from public, anon;
grant execute on function public.save_purchase(jsonb, integer) to authenticated;

-- Record a deposit (payment) on a date. It may not take the remaining balance below 0.
create or replace function public.add_purchase_deposit(p_purchase uuid, p_amount numeric, p_date date, p_note text default '')
returns public.purchase_deposits
language plpgsql security definer set search_path = public as $$
declare p public.purchases; v_paid numeric; d public.purchase_deposits;
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  if p_amount is null or p_amount <= 0 or p_amount::text = 'NaN' or p_date is null then raise exception 'Enter a deposit amount above 0 and a date'; end if;
  select * into p from public.purchases where id = p_purchase and archived_at is null for update;
  if not found then raise exception 'Purchase not found. Refresh and try again.'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.purchase_deposits where purchase_id = p_purchase and archived_at is null;
  if v_paid + p_amount > p.amount then raise exception 'This deposit is more than the remaining balance (Rs. %)', p.amount - v_paid; end if;
  insert into public.purchase_deposits (purchase_id, amount, date, note) values (p_purchase, p_amount, p_date, left(coalesce(p_note, ''), 500))
    returning * into d;
  return d;
end $$;
revoke all on function public.add_purchase_deposit(uuid, numeric, date, text) from public, anon;
grant execute on function public.add_purchase_deposit(uuid, numeric, date, text) to authenticated;

-- Undo a wrongly entered deposit (kept in the table, hidden).
create or replace function public.remove_purchase_deposit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  update public.purchase_deposits set archived_at = now() where id = p_id and archived_at is null;
  if not found then raise exception 'Deposit not found or already removed'; end if;
end $$;
revoke all on function public.remove_purchase_deposit(uuid) from public, anon;
grant execute on function public.remove_purchase_deposit(uuid) to authenticated;

-- "Delete" a settled bill: allowed only when remaining balance is 0. Hidden, never erased.
create or replace function public.archive_settled_purchase(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchases; v_paid numeric;
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  select * into p from public.purchases where id = p_id and archived_at is null for update;
  if not found then raise exception 'Purchase not found or already deleted'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.purchase_deposits where purchase_id = p_id and archived_at is null;
  if v_paid < p.amount then raise exception 'Rs. % is still remaining. Only settled bills (remaining 0) can be deleted.', p.amount - v_paid; end if;
  update public.purchases set archived_at = now() where id = p_id;
end $$;
revoke all on function public.archive_settled_purchase(uuid) from public, anon;
grant execute on function public.archive_settled_purchase(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
