-- READ-ONLY record count. Changes nothing. Run in the Supabase SQL Editor.
-- "table missing" means that table was never created on this database (not that data was deleted).
select t as "table",
       case when to_regclass('public.' || t) is null then 'table missing'
            else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
       end as rows
from unnest(array[
  'orders', 'order_items', 'customers', 'customer_ledger', 'products',
  'sales', 'items', 'daily_expenses',
  'stock_items', 'stock_transfers',
  'purchases', 'purchase_deposits',
  'activity_log', 'app_users'
]) as t
order by 1;
