-- Run this once in the Supabase SQL editor for the existing production database.
alter table public.order_items drop constraint if exists order_items_unit_type_check;
alter table public.order_items add constraint order_items_unit_type_check
  check (unit_type in ('KG', 'GRAMS', 'LITRE', 'PCS', 'NONE'));