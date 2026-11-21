import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('order numbers: existing orders numbered by date, new orders continue, ids untouched', async t => {
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
 for (const m of ['20261121_audit_fixes','20261123_admin_orders']) await db.exec(read(`migrations/${m}.sql`))
 await db.exec(`insert into public.orders(order_ref,customer_name,customer_phone,customer_address,items,created_at) values
   ('#AHWMB-b','B','','','[]','2026-11-02'),('#AHWMB-a','A','','','[]','2026-11-01'),('#AHWMB-c','C','','','[]','2026-11-03')`)
 const before = (await db.query('select id,order_ref,customer_name,items from orders order by order_ref')).rows
 await db.exec(read('migrations/20261125_order_numbers.sql')); await db.exec(read('migrations/20261125_order_numbers.sql'))
 const rows = (await db.query('select order_ref,order_no::int n from orders order by order_ref')).rows
 assert.deepEqual(rows.map(r => r.n), [1, 2, 3]) // a (oldest) = 1, b = 2, c = 3
 assert.deepEqual((await db.query('select id,order_ref,customer_name,items from orders order by order_ref')).rows, before)
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const items = [{sr:1,name:'Chawal',quantity:'1 kg',quantity_value:1,unit_type:'KG',unit_price:100,total:100}]
 await db.query('select submit_order($1,$2,$3,$4,$5,$6,$7)',['#AHWMB-new','Kapa','','','',JSON.stringify(items),''])
 await db.query('select submit_order($1,$2,$3,$4,$5,$6,$7)',['#AHWMB-new2','Kapa','','','',JSON.stringify(items),''])
 await db.exec('reset role')
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'anon'})])
 await db.exec('set role anon')
 assert.equal(Number((await db.query("select order_number('#AHWMB-new') n")).rows[0].n), 4)
 assert.equal(Number((await db.query("select order_number('#AHWMB-new2') n")).rows[0].n), 5)
 await db.exec('reset role')
})
