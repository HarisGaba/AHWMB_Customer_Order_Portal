-- Soft-delete for items: archived items are hidden from the POS but can be restored.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
alter table public.items add column if not exists archived_at timestamptz;
