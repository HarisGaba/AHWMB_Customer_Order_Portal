alter table public.order_items drop constraint if exists order_items_unit_type_check;
alter table public.order_items add constraint order_items_unit_type_check
  check (unit_type in ('KG', 'GRAMS', 'LITRE', 'PCS', 'PACKETS', 'BAGS', 'NONE'));
