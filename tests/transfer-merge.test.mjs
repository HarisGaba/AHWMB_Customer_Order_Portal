import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('transfers add into the matching destination item instead of creating duplicates', async t => {
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
 for (const m of ['20261119_site_to_jodia_transfer','20261121_audit_fixes','20261124_transfer_merge','20261124_transfer_merge']) await db.exec(read(`migrations/${m}.sql`))
 await db.exec(`insert into public.stock_items(location,item,weight,quantity) values
  ('Site Area Godown','b2 toota basmati',25,100),('Jodia Bazaar Godown','B2  Toota',25,50),
  ('Site Area Godown','Masoor-Dal',50,80),('Jodia Bazaar Godown','masoor dal',50,10),('Jodia Bazaar Godown','Masoor Dal CH',50,7)`)
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const all = async () => (await db.query("select location,item,quantity::float q from stock_items order by location,item")).rows
 const q = async (loc,item) => (await all()).find(r => r.location===loc && r.item===item)?.q
 const count = async () => (await all()).length
 const before = await count()
 const move = (lines) => db.query('select * from transfer_stock($1,$2,$3)',['Site Area Godown','Jodia Bazaar Godown',JSON.stringify(lines)]).then(r => r.rows[0])
 // 1. Chosen destination: "b2 toota basmati" -> existing "B2  Toota"
 const t1 = await move([{ item: 'b2 toota basmati', to_item: 'b2 toota', quantity: 40 }])
 assert.equal(await q('Jodia Bazaar Godown','B2  Toota'), 90); assert.equal(await q('Site Area Godown','b2 toota basmati'), 60)
 assert.equal(t1.lines[0].to_item, 'B2  Toota')
 // 2. Same name written differently merges automatically; "Masoor Dal CH" is untouched.
 await move([{ item: 'Masoor-Dal', quantity: 30 }])
 assert.equal(await q('Jodia Bazaar Godown','masoor dal'), 40); assert.equal(await q('Jodia Bazaar Godown','Masoor Dal CH'), 7)
 assert.equal(await count(), before, 'no duplicate rows created')
 // 3. Edit then reverse take stock back from the same destination item.
 await db.query('select * from edit_transfer($1,$2)',[t1.id, JSON.stringify([{ item: 'b2 toota basmati', to_item: 'B2  Toota', quantity: 10 }])])
 assert.equal(await q('Jodia Bazaar Godown','B2  Toota'), 60); assert.equal(await q('Site Area Godown','b2 toota basmati'), 90)
 await db.query('select delete_transfer($1)',[t1.id])
 assert.equal(await q('Jodia Bazaar Godown','B2  Toota'), 50); assert.equal(await q('Site Area Godown','b2 toota basmati'), 100)
 assert.equal(await count(), before)
 // 4. Nothing matching -> a new item is created at the destination.
 await move([{ item: 'b2 toota basmati', quantity: 5 }])
 assert.equal(await q('Jodia Bazaar Godown','b2 toota basmati'), 5)
})
