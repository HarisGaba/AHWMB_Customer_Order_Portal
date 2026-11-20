import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('edit_sale_payment changes only payment/paid amount and logs the old values', async t => {
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
 await db.exec(read('migrations/20261120_sale_payment_edit.sql'))
 const { rows: [sale] } = await db.query(`insert into public.sales(day,customer_no,lines,total,payment) values('2026-11-20',1,'[{"name":"Chawal","qty":2,"rate":500}]',1000,'Cash') returning *`)
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const edit = (p,paid) => db.query('select * from edit_sale_payment($1,$2,$3)',[sale.id,p,paid])
 const { rows: [after] } = await edit('Balance',300)
 assert.equal(after.payment,'Balance'); assert.equal(Number(after.paid_amount),300)
 assert.equal(Number(after.total),1000); assert.deepEqual(after.lines,sale.lines); assert.equal(after.customer_no,1)
 assert.equal(after.payment_edit_log.length,1); assert.equal(after.payment_edit_log[0].old_payment,'Cash')
 await assert.rejects(edit('Cash',1001),/between 0 and/)
 await assert.rejects(edit('Card',0),/Cash or Balance/)
 await db.exec('reset role')
 assert.equal((await db.query('select count(*)::int n from public.sales')).rows[0].n,1)
 await db.exec(read("migrations/20261122_reverse_sale.sql")); await db.exec(read("migrations/20261122_reverse_sale.sql"))
 await db.exec("set role authenticated")
 await assert.rejects(db.query("select * from reverse_sale($1,$2,$3)",[sale.id,"void","x"]),/reason/)
 const { rows: [rev] } = await db.query("select * from reverse_sale($1,$2,$3)",[sale.id,"refund","Customer returned"])
 assert.ok(rev.reversed_at); assert.equal(rev.reversal_kind,"refund")
 await assert.rejects(db.query("select * from reverse_sale($1,$2,$3)",[sale.id,"void","again"]),/already reversed/)
 await db.exec("reset role")
 assert.equal((await db.query("select count(*)::int n from public.sales")).rows[0].n,1)
})
