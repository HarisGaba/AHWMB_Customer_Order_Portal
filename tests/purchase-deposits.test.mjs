import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('purchase deposits: date-wise payments, remaining balance, settled delete keeps the record', async t => {
 const db = new PGlite()
 t.after(() => db.close())
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text);
 create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
 create function auth.role() returns text language sql as $$ select auth.jwt()->>'role' $$;
 create publication supabase_realtime;
 create table public.daily_expenses(id uuid primary key default gen_random_uuid(),expense_date date,amount numeric);
 alter table public.daily_expenses enable row level security;`)
 const read = name => readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8').replace(/create extension if not exists pgcrypto;/gi,'')
 await db.exec(read('schema.sql'))
 for (const name of readdirSync(new URL('../supabase/migrations',import.meta.url)).sort()) {
  if (name >= '20261115') break
  try { await db.exec(read('migrations/'+name)) } catch(e) { throw new Error(`${name}: ${e.message}`) }
 }
 await db.exec(read('migrations/20261126_purchase_deposits.sql')); await db.exec(read('migrations/20261126_purchase_deposits.sql'))
 await db.exec(read('migrations/20261127_activity_log.sql')); await db.exec(read('migrations/20261127_activity_log.sql'))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const id = '11111111-2222-3333-4444-555555555555'
 const { rows: [p] } = await db.query('select * from save_purchase($1,null)',[JSON.stringify({ id, party: 'Haji Traders', area: 'Jodia', item: 'Rice', amount: 241000, date: '2026-11-01' })])
 const dep = (amt, date) => db.query('select * from add_purchase_deposit($1,$2,$3)',[id, amt, date])
 await dep(100000, '2026-11-05'); await dep(41000, '2026-11-10')
 const paid = async () => Number((await db.query('select coalesce(sum(amount),0) s from purchase_deposits where purchase_id=$1 and archived_at is null',[id])).rows[0].s)
 assert.equal(241000 - await paid(), 100000)
 await assert.rejects(dep(100001, '2026-11-12'), /more than the remaining/)
 await assert.rejects(db.query('select archive_settled_purchase($1)',[id]), /still remaining/)
 await assert.rejects(db.query('select * from save_purchase($1,$2)',[JSON.stringify({ id, party: 'Haji Traders', area: '', item: '', amount: 100000, date: '2026-11-01' }), p.version]), /less than the deposits/)
 await dep(100000, '2026-11-20')
 assert.equal(241000 - await paid(), 0)
 await db.query('select archive_settled_purchase($1)',[id])
 await db.exec('reset role')
 const kept = (await db.query('select archived_at from purchases where id=$1',[id])).rows[0]
 assert.ok(kept?.archived_at, 'settled purchase hidden but kept')
 assert.equal((await db.query('select count(*)::int n from purchase_deposits')).rows[0].n, 3)
 const log = (await db.query("select entity, action, actor_email from activity_log order by id")).rows
 assert.ok(log.some(l => l.entity === "purchases" && l.action === "INSERT" && l.actor_email === "ahwmb1965@gmail.com"), "purchase add logged")
 assert.equal(log.filter(l => l.entity === "purchase_deposits" && l.action === "INSERT").length, 3)
 assert.ok(log.some(l => l.entity === "purchases" && l.action === "UPDATE"), "settled delete logged")
 // A broken log never blocks the real change.
 await db.exec("alter table activity_log add constraint block_all check (false) not valid")
 await db.query("select * from save_purchase($1,null)",[JSON.stringify({ id: "99999999-2222-3333-4444-555555555555", party: "Test", area: "", item: "", amount: 5, date: "2026-11-21" })])
 assert.equal((await db.query("select count(*)::int n from purchases where party = 'Test'")).rows[0].n, 1)
})
