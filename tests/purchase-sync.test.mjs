import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('browser-only purchases sync to the database without duplicates or overwriting newer data', async t => {
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
 for (const m of ['20261126_purchase_deposits','20261128_purchase_quantity']) await db.exec(read(`migrations/${m}.sql`))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const { syncLocalPurchases } = await import('../src/lib/purchases.ts')
 const rpc = async (name, args) => { try { const { rows } = await db.query(`select * from ${name}($1,$2)`, [JSON.stringify(args.p_row), args.p_version]); return { data: rows[0], error: null } } catch (e) { return { data: null, error: { message: e.message } } } }
 const remote = async () => (await db.query('select * from purchases order by party')).rows
 const leela = { id: 'd45386fd-f81b-4caf-aca5-194abb50380c', party: 'leela foods ', area: 'nooriyabad', item: 'chana dal', amount: '382200', date: '2026-06-21', localRevision: 1795211951315 }
 const journal = { id: '3c2423b8-b7c6-4b93-8092-f008e6ca46a9', party: 'journal impex ', area: 'joida bazar ', item: 'kali mirchi sabut ', amount: '241000', date: '2026-11-16', localRevision: 1795212041534 }
 let r = await syncLocalPurchases({ rpc }, [leela, journal], await remote())
 assert.deepEqual([r.imported, r.updated, r.problems.length], [2, 0, 0])
 r = await syncLocalPurchases({ rpc }, [leela, journal], await remote()) // second time: identical, nothing written
 assert.deepEqual([r.imported, r.updated], [0, 0]); assert.equal((await remote()).length, 2)
 // Browser copy edited later than the database copy -> database updated; older browser copy -> ignored.
 r = await syncLocalPurchases({ rpc }, [{ ...journal, amount: '250000', localRevision: Date.now() + 60000 }], await remote())
 assert.equal(r.updated, 1); assert.equal(Number((await remote()).find(x => x.party === 'journal impex').amount), 250000)
 r = await syncLocalPurchases({ rpc }, [{ ...journal, amount: '1', localRevision: 1 }], await remote())
 assert.equal(r.updated, 0); assert.equal(Number((await remote()).find(x => x.party === 'journal impex').amount), 250000)
 await db.exec('reset role')
})
