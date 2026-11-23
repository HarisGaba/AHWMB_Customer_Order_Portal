import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('products: edit fixes names, delete hides (never erases), built-ins can be edited or hidden', async t => {
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
 await db.exec(read('migrations/20261130_products_edit.sql')); await db.exec(read('migrations/20261130_products_edit.sql'))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahmedyounus1978@gmail.com'})])
 await db.exec('set role authenticated')
 const save = (id, name, cat, orig = null) => db.query('select * from save_product($1,$2,$3,$4)',[id, name, cat, orig]).then(r => r.rows[0])
 const p = await save(null, 'Chawal Sela', 'RICE')
 const e = await save(p.id, 'Chawal Sella', 'RICE')            // spelling fix
 assert.equal(e.name, 'Chawal Sella'); assert.equal(e.id, p.id)
 await assert.rejects(save(null, 'chawal sella', 'RICE'), /already exists/)
 await db.query('select delete_product($1,$2,$3)',[p.id, 'Chawal Sella', 'RICE'])
 const all = async () => (await db.query('select name, archived_at is not null as hidden, original_name from products order by name')).rows
 assert.deepEqual((await all()).map(r => [r.name, r.hidden]), [['Chawal Sella', true]])
 const back = await save(null, 'Chawal Sella', 'RICE')          // adding again brings it back
 assert.equal(back.id, p.id); assert.equal(back.archived_at, null)
 const b = await save(null, 'Basmati Rice 1121', 'RICE', 'Basmati 1121')   // edit a built-in product
 assert.equal(b.original_name, 'Basmati 1121')
 await db.query('select delete_product($1,$2,$3)',[null, 'Aloo Bukhara', 'SPICES'])   // hide a built-in product
 const hidden = (await all()).find(r => r.name === 'Aloo Bukhara')
 assert.ok(hidden.hidden && hidden.original_name === 'Aloo Bukhara')
 await db.exec('reset role')
 assert.equal((await db.query('select count(*)::int n from products')).rows[0].n, 3)
})
