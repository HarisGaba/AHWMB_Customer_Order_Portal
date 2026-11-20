import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('audit fixes: reversing a transfer keeps history; staff order + invoice save', async t => {
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
 await db.exec(read('migrations/20261119_site_to_jodia_transfer.sql'))
 await db.exec(read('migrations/20261121_audit_fixes.sql'))
 await db.exec(read('migrations/20261121_audit_fixes.sql')) // safe to run twice
 await db.exec(read('migrations/20261123_admin_orders.sql')); await db.exec(read('migrations/20261123_admin_orders.sql'))
 await db.exec(`insert into auth.users(id,email) values('11111111-1111-1111-1111-111111111111','ahmedyounus1978@gmail.com')`)
 await db.exec(`insert into public.stock_items(location,item,weight,quantity) values('Jodia Bazaar Godown','Chawal',50,300)`)
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const qty = async loc => Number((await db.query("select quantity from stock_items where location=$1 and item='Chawal'",[loc])).rows[0]?.quantity ?? 0)
 const { rows: [tr] } = await db.query('select * from transfer_stock($1,$2,$3)',['Jodia Bazaar Godown','Shop',JSON.stringify([{item:'Chawal',quantity:100}])])
 assert.equal(await qty('Shop'),100)
 const res = (await db.query('select delete_transfer($1) r',[tr.id])).rows[0].r
 assert.equal(res.returned[0].quantity,100)
 assert.equal(await qty('Shop'),0); assert.equal(await qty('Jodia Bazaar Godown'),300)
 const kept = (await db.query('select * from stock_transfers where id=$1',[tr.id])).rows[0]
 assert.ok(kept && kept.cancelled_at, 'transfer row kept and marked reversed')
 await assert.rejects(db.query('select delete_transfer($1)',[tr.id]),/already reversed/)
 const items = [{sr:1,name:'Chawal',quantity:'2.5 kg',quantity_value:2.5,unit_type:'KG',unit_price:10.01,total:25.03}]
 const { rows: [o] } = await db.query('select submit_order($1,$2,$3,$4,$5,$6,$7) id',['REF-1','Kapa Altaf','03001234567','Shop','',JSON.stringify(items),''])
 const { rows: [inv] } = await db.query('select * from save_order_invoice($1,$2,$3,$4)',[o.id,JSON.stringify(items),0,10])
 assert.equal(Number(inv.total_amount),25.03); assert.equal(Number(inv.remaining_balance),15.03); assert.equal(inv.status,'completed')
 await assert.rejects(db.query('select * from save_order_invoice($1,$2,$3,$4)',[o.id,JSON.stringify([{name:'',total:1}]),0,0]),/item name/)
 await db.exec("reset role")
 // Owner identified by account id even when the token has no email -> full admin, prices allowed.
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:"authenticated",sub:"11111111-1111-1111-1111-111111111111"})])
 await db.exec("set role authenticated")
 await db.query("select submit_order($1,$2,$3,$4,$5,$6,$7)",["REF-2","Kapa Altaf","","","",JSON.stringify(items),""])
 await db.exec("reset role")
 // No login (expired session) with prices -> clear message, nothing saved.
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:"anon"})])
 await db.exec("set role anon")
 await assert.rejects(db.query("select submit_order($1,$2,$3,$4,$5,$6,$7)",["REF-3","X","03001234567","Addr","",JSON.stringify(items),""]),/login has expired/)
 await db.exec("reset role")
 assert.equal((await db.query("select count(*)::int n from orders where order_ref='REF-3'")).rows[0].n,0)
})
