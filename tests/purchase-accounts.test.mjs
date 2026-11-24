import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('purchase accounts: existing bills copied once, lines + deposits per account, clear keeps history', async t => {
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
 for (const m of ['20261126_purchase_deposits','20261127_activity_log','20261128_purchase_quantity','20261129_deposit_method']) await db.exec(read(`migrations/${m}.sql`))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const leela = 'd45386fd-f81b-4caf-aca5-194abb50380c'
 await db.query('select * from save_purchase($1,null)',[JSON.stringify({ id: leela, party: 'leela foods', area: 'nooriyabad', item: 'chana dal', quantity: '50 bags', amount: 382200, date: '2026-11-15' })])
 await db.query('select * from save_purchase($1,null)',[JSON.stringify({ id: '3c2423b8-b7c6-4b93-8092-f008e6ca46a9', party: 'journal impex', area: '', item: 'kali mirch', amount: 241000, date: '2026-11-16' })])
 for (const [amt, d] of [[82800,'2026-11-17'],[100000,'2026-11-19']]) await db.query('select * from add_purchase_deposit($1,$2,$3,$4,$5)',[leela, amt, d, '', 'Cash'])
 await db.exec('reset role')
 await db.exec(read('migrations/20261201_purchase_accounts.sql')); await db.exec(read('migrations/20261201_purchase_accounts.sql'))
 const accounts = (await db.query('select name from purchase_accounts order by name')).rows.map(r => r.name)
 assert.deepEqual(accounts, ['Farhan Dal Mill','Hamdan Dal Mill','journal impex','Kinjar Dal Mill','Leela Foods','Shahbaz Dal Mill','Wahab Dal Mill'].sort((a,b)=>a.localeCompare(b)).filter(() => true).sort())
 const acc = (await db.query("select id from purchase_accounts where lower(name)='leela foods'")).rows[0].id
 const sum = async (tbl) => Number((await db.query(`select coalesce(sum(amount),0) s from ${tbl} where account_id=$1 and archived_at is null and cleared_at is null`,[acc])).rows[0].s)
 assert.equal(await sum('purchase_lines'), 382200); assert.equal(await sum('purchase_account_deposits'), 182800)
 const line = (await db.query('select note from purchase_lines where id=$1',[leela])).rows[0]
 assert.equal(line.note, 'Quantity: 50 bags')
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 await db.query('insert into purchase_lines(account_id,date,item,quantity,rate,bags,amount) values($1,$2,$3,$4,$5,$6,$7)',[acc,'2026-11-20','Mash Dal',100,430,4,43000])
 await db.query('insert into purchase_account_deposits(account_id,date,amount,method) values($1,$2,$3,$4)',[acc,'2026-11-21',50000,'Cheque'])
 assert.equal(await sum('purchase_lines') - await sum('purchase_account_deposits'), 382200 + 43000 - 232800)
 const r = (await db.query('select clear_purchase_account($1) r',[acc])).rows[0].r
 assert.deepEqual([r.lines, r.deposits], [2, 3])
 assert.equal(await sum('purchase_lines'), 0)
 await assert.rejects(db.query('delete from purchase_lines where account_id=$1',[acc]), /permission denied/)
 await db.exec('reset role')
 assert.equal((await db.query('select count(*)::int n from purchase_lines')).rows[0].n, 3)
 assert.equal((await db.query('select count(*)::int n from purchases')).rows[0].n, 2) // old table untouched
})
