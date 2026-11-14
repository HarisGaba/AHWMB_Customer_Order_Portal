-- Disabled: broad resets cannot distinguish test sales from production records.
-- Rate Changing and Item Addition use the LIVE public.items catalog, not logs.
-- Total Summary is calculated from public.sales; there is no summary table to wipe.
-- Preserve every existing row. Any future cleanup needs an explicitly reviewed
-- list of test sale UUIDs and a verified backup, never a whole-table reset.
do $$
begin
  raise exception 'POS reset disabled: no confirmed test sale IDs. No data was changed.';
end;
$$;
