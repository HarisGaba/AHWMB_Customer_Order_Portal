import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('godown transfer routes: Jodia -> Site/Shop, Site -> Shop only; stock moves exactly', async t => {
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
 await db.exec(`insert into public.stock_items(location,item,weight,quantity) values('Site Area Godown','Chawal',50,500),('Jodia Bazaar Godown','Chawal',50,300),('Shop','Chawal',50,20)`)
 await db.exec(`insert into public.stock_transfers(from_location,to_location,lines,total_quantity) values('Site Area Godown','Jodia Bazaar Godown','[{"item":"Chawal","quantity":10}]',10)`)
 const history = (await db.query('select * from stock_transfers order by created_at')).rows
 await db.exec(read('migrations/20261118_transfer_routes.sql'))
 assert.deepEqual((await db.query('select * from stock_transfers order by created_at')).rows, history)
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const qty = async loc => Number((await db.query("select quantity from stock_items where location=$1 and item='Chawal'",[loc])).rows[0]?.quantity)
 const move = (from,to,q) => db.query('select transfer_stock($1,$2,$3)',[from,to,JSON.stringify([{item:'Chawal',quantity:q}])])
 await move('Site Area Godown','Shop',120)
 assert.equal(await qty('Site Area Godown'),380); assert.equal(await qty('Shop'),140)
 await move('Jodia Bazaar Godown','Site Area Godown',50)
 await move('Jodia Bazaar Godown','Shop',30)
 assert.equal(await qty('Jodia Bazaar Godown'),220); assert.equal(await qty('Site Area Godown'),430); assert.equal(await qty('Shop'),170)
 await assert.rejects(move('Site Area Godown','Jodia Bazaar Godown',1),/Allowed transfers/)
 await assert.rejects(move('Site Area Godown','Shop',100000),/Not enough/)
 assert.equal(await qty('Site Area Godown'),430)
 assert.equal((await db.query('select count(*)::int n from stock_transfers')).rows[0].n, 4)
})
