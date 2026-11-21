import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('purchase quantity is saved and Delete hides (never erases) any purchase', async t => {
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
 for (const m of ['20261126_purchase_deposits','20261127_activity_log','20261128_purchase_quantity','20261128_purchase_quantity','20261129_deposit_method','20261129_deposit_method']) await db.exec(read(`migrations/${m}.sql`))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const id = '11111111-2222-3333-4444-666666666666'
 const row = { id, party: 'leela foods', area: 'nooriyabad', item: 'chana dal', quantity: '50 bags', amount: 382200, date: '2026-06-21' }
 const { rows: [p] } = await db.query('select * from save_purchase($1,null)',[JSON.stringify(row)])
 assert.equal(p.quantity, '50 bags')
 const { rows: [e] } = await db.query('select * from save_purchase($1,$2)',[JSON.stringify({ ...row, quantity: '60 bags' }), p.version])
 assert.equal(e.quantity, '60 bags')
 // Old rows without quantity still import (blank quantity).
 const { rows: [o] } = await db.query('select * from save_purchase($1,null)',[JSON.stringify({ id: '11111111-2222-3333-4444-777777777777', party: 'journal impex', area: '', item: '', amount: 241000, date: '2026-11-16' })])
 assert.equal(o.quantity, '')
 await db.query('select * from add_purchase_deposit($1,$2,$3)',[id, 1000, '2026-11-21']) // old screens still work (Cash)
 const { rows: [chq] } = await db.query('select * from add_purchase_deposit($1,$2,$3,$4,$5)',[id, 2000, '2026-11-22', '', 'Cheque'])
 assert.equal(chq.method, 'Cheque')
 await assert.rejects(db.query('select * from add_purchase_deposit($1,$2,$3,$4,$5)',[id, 10, '2026-11-22', '', 'Card']), /Cash, Cheque or Online/)
 assert.deepEqual((await db.query('select method from purchase_deposits order by date')).rows.map(r => r.method), ['Cash', 'Cheque'])
 await db.query('select archive_purchase($1)',[id]) // unsettled delete allowed (hidden)
 await db.exec('reset role')
 assert.ok((await db.query('select archived_at from purchases where id=$1',[id])).rows[0].archived_at)
 assert.equal((await db.query('select count(*)::int n from purchase_deposits where purchase_id=$1',[id])).rows[0].n, 2)
})
