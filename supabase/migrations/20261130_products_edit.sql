-- Products: Edit (fix spelling / category) and Delete with confirmation.
-- Additive only and safe to run more than once. Nothing is erased:
--   * Delete only sets archived_at (hidden from menus). Adding the same name again brings it back.
--   * Built-in products (part of the app) are edited/deleted by saving a row that records the
--     original name ("original_name"); the app then shows the saved version instead of the built-in one.
begin;

alter table public.products add column if not exists archived_at timestamptz;
alter table public.products add column if not exists original_name text;

-- Add or edit a product. p_id = existing database product to edit; p_original = built-in product being edited.
create or replace function public.save_product(p_id uuid, p_name text, p_category text, p_original text default null)
returns public.products
language plpgsql security definer set search_path = public as $$
declare v public.products; v_name text := trim(coalesce(p_name, '')); v_cat text := coalesce(nullif(trim(p_category), ''), 'EXTRA ITEMS');
begin
  if not public.has_perm('products') then raise exception 'Not authorized'; end if;
  if v_name = '' then raise exception 'Enter a product name'; end if;
  -- Another visible product already uses this name?
  if exists (select 1 from public.products where lower(name) = lower(v_name) and archived_at is null and id is distinct from p_id) then
    raise exception 'A product named "%" already exists', v_name;
  end if;
  if p_id is not null then
    -- A hidden row may still hold this name: free it by giving the hidden row a unique name.
    update public.products set name = name || ' (deleted ' || left(id::text, 8) || ')' where lower(name) = lower(v_name) and archived_at is not null and id <> p_id;
    update public.products set name = v_name, category = v_cat where id = p_id returning * into v;
    if not found then raise exception 'Product not found. Refresh and try again.'; end if;
    return v;
  end if;
  -- New name (or bring back a deleted one with the same name).
  update public.products set archived_at = null, category = v_cat, original_name = coalesce(nullif(trim(p_original), ''), original_name), name = v_name
    where lower(name) = lower(v_name) returning * into v;
  if found then return v; end if;
  insert into public.products (name, category, original_name) values (v_name, v_cat, nullif(trim(p_original), '')) returning * into v;
  return v;
end $$;
revoke all on function public.save_product(uuid, text, text, text) from public, anon;
grant execute on function public.save_product(uuid, text, text, text) to authenticated;

-- Delete (hide) a product. p_id for a database product; otherwise p_name hides a built-in product.
create or replace function public.delete_product(p_id uuid, p_name text, p_category text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('products') then raise exception 'Not authorized'; end if;
  if p_id is not null then
    update public.products set archived_at = now() where id = p_id and archived_at is null;
    if not found then raise exception 'Product not found or already deleted'; end if;
    return;
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Product name missing'; end if;
  update public.products set archived_at = now(), original_name = coalesce(original_name, trim(p_name)) where lower(name) = lower(trim(p_name));
  if not found then
    insert into public.products (name, category, original_name, archived_at)
      values (trim(p_name), coalesce(nullif(trim(p_category), ''), 'EXTRA ITEMS'), trim(p_name), now());
  end if;
end $$;
revoke all on function public.delete_product(uuid, text, text) from public, anon;
grant execute on function public.delete_product(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
