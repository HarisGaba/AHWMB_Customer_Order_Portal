-- Purchase Report: Quantity field, and Delete on any purchase.
-- Additive only, safe to run more than once:
--   * new column purchases.quantity (text, e.g. "50 bags" / "1200 kg"); existing purchases get '' (blank)
--   * save_purchase stores quantity
--   * archive_purchase: "Delete" hides a purchase from the list (settled or not); it stays in the database
begin;

alter table public.purchases add column if not exists quantity text not null default '';

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
      if v.party = trim(p_row->>'party') and v.area = coalesce(p_row->>'area', '') and v.item = coalesce(p_row->>'item', '') and v.quantity = coalesce(p_row->>'quantity', '') and v.amount = (p_row->>'amount')::numeric and v.date = (p_row->>'date')::date then return v; end if;
      raise exception 'This purchase already exists with different details. No records were overwritten.';
    end if;
    insert into public.purchases (id, party, area, item, quantity, amount, date)
      values ((p_row->>'id')::uuid, trim(p_row->>'party'), coalesce(p_row->>'area', ''), coalesce(p_row->>'item', ''), coalesce(p_row->>'quantity', ''), (p_row->>'amount')::numeric, (p_row->>'date')::date)
      returning * into v;
  else
    select coalesce(sum(amount), 0) into v_paid from public.purchase_deposits where purchase_id = (p_row->>'id')::uuid and archived_at is null;
    if (p_row->>'amount')::numeric < v_paid then raise exception 'The amount cannot be less than the deposits already recorded (Rs. %)', v_paid; end if;
    update public.purchases set party = trim(p_row->>'party'), area = coalesce(p_row->>'area', ''), item = coalesce(p_row->>'item', ''), quantity = coalesce(p_row->>'quantity', ''),
      amount = (p_row->>'amount')::numeric, date = (p_row->>'date')::date, version = version + 1, updated_at = now()
      where id = (p_row->>'id')::uuid and version = p_version and archived_at is null returning * into v;
    if not found then raise exception 'This purchase changed in another tab. Reload before saving; your entry has not been overwritten.'; end if;
  end if;
  return v;
end $$;
revoke all on function public.save_purchase(jsonb, integer) from public, anon;
grant execute on function public.save_purchase(jsonb, integer) to authenticated;

create or replace function public.archive_purchase(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('purchase_report') then raise exception 'Not authorized'; end if;
  update public.purchases set archived_at = now() where id = p_id and archived_at is null;
  if not found then raise exception 'Purchase not found or already deleted'; end if;
end $$;
revoke all on function public.archive_purchase(uuid) from public, anon;
grant execute on function public.archive_purchase(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
