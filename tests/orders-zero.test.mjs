import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('staff orders accept zero/blank amounts and hand-typed totals; customer rules unchanged', async t => {
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
 for (const m of ['20261121_audit_fixes','20261123_admin_orders','20261205_orders_allow_zero','20261205_orders_allow_zero']) await db.exec(read(`migrations/${m}.sql`))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const items = [
  { sr: 1, name: 'Chawal', quantity: '10 kg', quantity_value: 10, unit_type: 'KG', unit_price: 0, total: 0 },                 // zero price
  { sr: 2, name: 'Mash Dal', quantity: '5 kg', quantity_value: 5, unit_type: 'KG', unit_price: null, total: null },         // blank
  { sr: 3, name: 'Rickshaw rent', quantity: '1', quantity_value: 0, unit_type: 'NONE', unit_price: 500, total: 500 },     // charge
  { sr: 4, name: 'Aloo Bukhara', quantity: '10 kg', quantity_value: 10, unit_type: 'KG', unit_price: 1300, total: 13250 }, // typed amount
 ]
 const { rows: [o] } = await db.query('select submit_order($1,$2,$3,$4,$5,$6,$7) id',['REF-Z','Kapa Altaf','','','',JSON.stringify(items),''])
 assert.ok(o.id)
 const { rows: [inv] } = await db.query('select * from save_order_invoice($1,$2,$3,$4)',[o.id, JSON.stringify(items.map(i => ({ ...i, total: Number(i.total) || 0 }))), 0, 0])
 assert.equal(Number(inv.total_amount), 13750)
 await db.exec('reset role')
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'anon'})])
 await db.exec('set role anon')
 await assert.rejects(db.query('select submit_order($1,$2,$3,$4,$5,$6,$7)',['REF-C','X','03001234567','Addr','',JSON.stringify([{ name: 'Chawal', quantity_value: 5, unit_type: 'KG', unit_price: 100, total: 500 }]),'']), /login has expired|confirmed by staff/)
 await db.exec('reset role')
})
