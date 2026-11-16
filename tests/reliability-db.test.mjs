import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('reliability migration preserves records and enforces atomic workflows', async t => {
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
 await db.exec(`insert into public.orders(order_ref,customer_name,customer_phone,customer_address,items) values('existing','Existing customer','923001234567','Existing address','[]');`)
 const before = (await db.query('select id,order_ref,items from orders')).rows
 await db.exec(read('migrations/20261115_reliability.sql'))
 assert.deepEqual((await db.query('select id,order_ref,items from orders')).rows,before)
 const identity = async (role,email='') => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,email})]); await db.exec(`set role ${role}`) }
 const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0]
 const line = [{name:'Rice',quantity:'2 KG',quantity_value:2,unit_type:'KG',unit_price:0,total:0}]
 await t.test('anonymous clients cannot retrieve history or bypass verification',async () => {
  await identity('anon')
  await assert.rejects(db.query("select previous_order('923001234567')"),/permission denied/)
  await assert.rejects(db.query("select submit_order('ref','Name','03001234567','Address',null,$1,'')",[JSON.stringify(line)]),/permission denied/)
 })
 let id
 await t.test('verified submissions save notes and normalized lines; invalid quantities fail',async () => {
  await identity('service_role')
  id=(await one("select submit_order('verified','Name','03001234567','Address',null,$1,'Leave at reception') as id",[JSON.stringify(line)])).id
  await assert.rejects(db.query("select submit_order('bad','Name','03001234567','Address',null,$1,'')",[JSON.stringify([{...line[0],quantity_value:-1}])]),/positive quantity/)
  await identity('authenticated','ahwmb1965@gmail.com')
  assert.equal((await one('select notes from orders where id=$1',[id])).notes,'Leave at reception')
  assert.equal((await one('select count(*)::int as n from order_items where order_id=$1',[id])).n,1)
 })
 await t.test('invoice edits update both representations and reject stale versions',async () => {
  const priced=[{...line[0],unit_price:100,total:200}]
  const row=await one('select * from save_order_invoice($1,1,$2,10,50)',[id,JSON.stringify(priced)])
  assert.equal(row.version,2); assert.equal(Number(row.remaining_balance),160)
  assert.equal(Number((await one('select total from order_items where order_id=$1',[id])).total),200)
  await assert.rejects(db.query('select save_order_invoice($1,2,$2,0,0)',[id,JSON.stringify([{...priced[0],total:1}])]),/does not match/)
  await assert.rejects(db.query('select save_order_invoice($1,1,$2,0,0)',[id,JSON.stringify(line)]),/another tab/)
  assert.equal(Number((await one('select total from order_items where order_id=$1',[id])).total),200)
 })
 await t.test('staff flat charges remain supported, while customer units stay mandatory',async () => {
  const flat=[{name:'Delivery',quantity:'',quantity_value:0,unit_type:'NONE',unit_price:50,total:50}]
  await db.query("select submit_order('staff-flat','Name','','',null,$1,'')",[JSON.stringify(flat)])
  await identity('service_role')
  await assert.rejects(db.query("select submit_order('customer-flat','Name','03001234567','Address',null,$1,'')",[JSON.stringify(flat)]),/positive quantity/)
  await identity('authenticated','ahwmb1965@gmail.com')
 })
 await t.test('purchases persist and reject conflicting edits',async () => {
  const p={id:crypto.randomUUID(),party:'Supplier',area:'Karachi',item:'Rice',amount:'100',date:'2026-11-15'}
  await db.query('select save_purchase($1,null)',[JSON.stringify(p)])
  await db.query('select save_purchase($1,null)',[JSON.stringify(p)])
  assert.equal((await one('select count(*)::int as n from purchases where id=$1',[p.id])).n,1)
  await assert.rejects(db.query('select save_purchase($1,null)',[JSON.stringify({...p,amount:'NaN'})]),/Invalid purchase amount/)
  await db.query('select save_purchase($1,1)',[JSON.stringify({...p,amount:'150'})])
  await assert.rejects(db.query('select save_purchase($1,1)',[JSON.stringify(p)]),/another tab/)
  assert.equal(Number((await one('select amount from purchases where id=$1',[p.id])).amount),150)
 })
 await t.test('stock reversal is atomic, retains history and cannot be repeated',async () => {
  await db.exec("insert into stock_items(location,item,quantity) values('Jodia Bazaar Godown','Test rice',100),('Jodia Bazaar Godown','Test flour',100)")
  const tr=await one("select * from transfer_stock('Jodia Bazaar Godown','Shop',$1)",[JSON.stringify([{item:'Test rice',quantity:20},{item:'Test flour',quantity:30}])])
  await db.exec("update stock_items set quantity=0 where location='Shop' and item='Test flour'")
  const before=(await db.query('select location,item,quantity from stock_items order by location,item')).rows
  await assert.rejects(db.query('select delete_transfer($1)',[tr.id]),/Not enough/)
  assert.deepEqual((await db.query('select location,item,quantity from stock_items order by location,item')).rows,before)
  assert.equal((await one('select cancelled_at from stock_transfers where id=$1',[tr.id])).cancelled_at,null)
  await db.exec("update stock_items set quantity=30 where location='Shop' and item='Test flour'")
  await db.query('select delete_transfer($1)',[tr.id])
  assert.ok((await one('select cancelled_at from stock_transfers where id=$1',[tr.id])).cancelled_at)
  assert.equal(Number((await one("select quantity from stock_items where location='Jodia Bazaar Godown' and item='Test rice'")).quantity),100)
  await assert.rejects(db.query('select delete_transfer($1)',[tr.id]),/already reversed/)
  await assert.rejects(db.query('select edit_transfer($1,$2)',[tr.id,JSON.stringify([{item:'Test rice',quantity:1}])]))
  await db.query('delete from stock_transfers where id=$1',[tr.id])
  assert.equal((await one('select count(*)::int as n from stock_transfers where id=$1',[tr.id])).n,1)
 })
 await t.test('checkout retries are idempotent and reversals retain the receipt',async () => {
  const request=crypto.randomUUID(),lines=JSON.stringify([{name:'Rice',qty:2,rate:100}])
  const a=await one("select * from record_sale_v2('2026-11-15',$1,'Cash','Customer',$2)",[lines,request])
  const b=await one("select * from record_sale_v2('2026-11-15',$1,'Cash','Customer',$2)",[lines,request])
  assert.equal(a.id,b.id)
  await assert.rejects(db.query("select record_sale_v2('2026-11-15',$1,'Balance','Customer',$2)",[lines,request]),/different details/)
  await db.query("select reverse_sale($1,'refund','Customer returned bill')",[a.id])
  assert.ok((await one('select reversed_at from sales where id=$1',[a.id])).reversed_at)
  await db.query('delete from sales where id=$1',[a.id])
  assert.equal((await one('select count(*)::int as n from sales where id=$1',[a.id])).n,1)
 })
 await t.test('search provides counts and audit records exist',async () => {
  const result=(await one("select search_orders('Name','completed',null,null,0) as result")).result
  assert.equal(result.total,1); assert.equal(result.counts.completed,1)
  assert.ok((await one("select count(*)::int as n from activity_log where entity='orders' and record_id=$1",[id])).n>=2)
 })
 await t.test('direct customer RPC migration preserves existing orders and validates new submissions',async () => {
  await db.exec('reset role')
  const previous=(await db.query('select * from orders order by id')).rows
  await db.exec(read('migrations/20261116_direct_customer_orders.sql'))
  assert.deepEqual((await db.query('select * from orders order by id')).rows,previous)
  await identity('anon')
  const created=await one("select submit_order('direct-customer','Customer','03001234567','Address',null,$1,'Ring bell') as id",[JSON.stringify(line)])
  assert.ok(created.id)
  await assert.rejects(db.query("select submit_order('bad-direct','Customer','03001234567','Address',null,$1,'')",[JSON.stringify([{...line[0],quantity_value:-1}])]),/positive quantity/)
  await assert.rejects(db.query("select previous_order('923001234567')"),/permission denied/)
  // Anonymous visitors must never read orders: either no table access at all, or RLS returns nothing.
  try { assert.equal((await db.query('select * from orders')).rows.length,0) } catch(e) { assert.match(String(e.message),/permission denied/) }
  await identity('authenticated','ahwmb1965@gmail.com')
  assert.equal((await one('select notes from orders where id=$1',[created.id])).notes,'Ring bell')
 })
 await t.test('4-argument save_order_invoice saves an invoice without a version number',async () => {
  await db.exec('reset role')
  await db.exec(read('migrations/20261116_save_order_invoice.sql'))
  const target=(await one("select id from orders where order_ref='existing'")).id
  const others=(await db.query('select * from orders where id<>$1 order by id',[target])).rows
  await identity('authenticated','ahwmb1965@gmail.com')
  const saved=(await one('select (save_order_invoice($1::uuid,$2::jsonb,$3::numeric,$4::numeric)).*',[target,JSON.stringify([{...line[0],total:500}]),100,50]))
  assert.equal(Number(saved.total_amount),500); assert.equal(Number(saved.remaining_balance),550); assert.equal(saved.status,'completed')
  await identity('anon')
  await assert.rejects(db.query('select save_order_invoice($1::uuid,$2::jsonb,0,0)',[target,JSON.stringify(line)]),/permission denied|Not authorized/)
  await db.exec('reset role')
  assert.deepEqual((await db.query('select * from orders where id<>$1 order by id',[target])).rows,others)
 })
})
