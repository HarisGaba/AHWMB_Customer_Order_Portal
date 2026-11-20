-- READ-ONLY health check. Changes nothing. Run in the Supabase SQL Editor and read the "status" column.
-- Every row should say OK. A MISSING row names the migration file to run.
select item, case when ok then 'OK' else 'MISSING - run ' || fix end as status
from (values
  ('submit_order (orders from the form)',      exists(select 1 from pg_proc where proname = 'submit_order'),                     '20261107_user_permissions.sql'),
  ('save_order_invoice 4-arg (invoice save)',   exists(select 1 from pg_proc where proname = 'save_order_invoice' and pronargs = 4), '20261116_save_order_invoice.sql'),
  ('record_sale (POS checkout)',               exists(select 1 from pg_proc where proname in ('record_sale', 'record_sale_v2')),  '20261102_pos_tables.sql'),
  ('reverse_sale (Total Summary void/refund)', exists(select 1 from pg_proc where proname = 'reverse_sale'),                     '20261122_reverse_sale.sql'),
  ('edit_sale_payment (Total Summary edit)',   exists(select 1 from pg_proc where proname = 'edit_sale_payment'),                '20261120_sale_payment_edit.sql'),
  ('transfer_stock allows Site Area -> Jodia', exists(select 1 from pg_proc where proname = 'transfer_stock' and prosrc like '%(''Site Area Godown'', ''Jodia Bazaar Godown'')%'), '20261119_site_to_jodia_transfer.sql'),
  ('delete_transfer keeps history',            exists(select 1 from pg_proc where proname = 'delete_transfer' and prosrc like '%cancel_result%'), '20261121_audit_fixes.sql'),
  ('orders.notes column (direct orders)',       exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'notes'), '20261121_audit_fixes.sql'),
  ('sales.paid_amount column',                 exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'paid_amount'), '20261120_sale_payment_edit.sql')
) as t(item, ok, fix);
