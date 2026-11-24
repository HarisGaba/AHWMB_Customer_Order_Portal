import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// An ephemeral PostgreSQL instance: never connects to Supabase or production.
test('purchase accounts start empty; earlier auto-made accounts are hidden (kept); lines, deposits, clear', async t => {
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
 await db.query('select * from save_purchase($1,null)',[JSON.stringify({ id: leela, party: 'leela foods', area: '', item: 'chana dal', amount: 382200, date: '2026-11-15' })])
 await db.exec('reset role')
 await db.exec(read('migrations/20261201_purchase_accounts.sql'))
 assert.equal((await db.query('select count(*)::int n from purchase_accounts')).rows[0].n, 0) // fresh install: empty
 // Simulate the earlier version: a pre-made account with a copy of the old bill, plus one account the user made.
 const { rows: [old] } = await db.query("insert into purchase_accounts(name) values('Leela Foods') returning id")
 await db.query("insert into purchase_lines(id,account_id,date,item,amount) values($1,$2,'2026-11-15','chana dal',382200)",[leela, old.id])
 const { rows: [mine] } = await db.query("insert into purchase_accounts(name) values('Haji Traders') returning id")
 await db.query("insert into purchase_lines(account_id,date,item,amount) values($1,'2026-11-20','Mash Dal',43000)",[mine.id])
 await db.exec(read('migrations/20261202_accounts_start_empty.sql')); await db.exec(read('migrations/20261202_accounts_start_empty.sql'))
 const visible = (await db.query('select name from purchase_accounts where archived_at is null')).rows.map(r => r.name)
 assert.deepEqual(visible, ['Haji Traders'])
 assert.equal((await db.query('select count(*)::int n from purchase_lines')).rows[0].n, 2) // nothing deleted
 assert.equal((await db.query('select count(*)::int n from purchases')).rows[0].n, 1) // main Purchase Report untouched
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',email:'ahwmb1965@gmail.com'})])
 await db.exec('set role authenticated')
 const { rows: [acc] } = await db.query("insert into purchase_accounts(name) values('Leela Foods') returning id") // same name reusable
 await db.query('insert into purchase_lines(account_id,date,item,quantity,rate,bags,amount) values($1,$2,$3,$4,$5,$6,$7)',[acc.id,'2026-11-24','Chana Dal',100,280,4,28000])
 await db.query('insert into purchase_account_deposits(account_id,date,amount,method) values($1,$2,$3,$4)',[acc.id,'2026-11-24',8000,'Online'])
 const r = (await db.query('select clear_purchase_account($1) r',[acc.id])).rows[0].r
 assert.deepEqual([r.lines, r.deposits], [1, 1])
 await assert.rejects(db.query('delete from purchase_lines where account_id=$1',[acc.id]), /permission denied/)
 await db.exec('reset role')

 // Purchase Report -> Accounts link
 await db.exec(read("migrations/20261203_purchase_account_link.sql")); await db.exec(read("migrations/20261203_purchase_account_link.sql"))
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:"authenticated",email:"ahwmb1965@gmail.com"})])
 await db.exec("set role authenticated")
 const pid = "aaaaaaaa-1111-2222-3333-444444444444"
 const { rows: [p] } = await db.query("select * from save_purchase($1,null)",[JSON.stringify({ id: pid, party: "haji traders ", area: "", item: "Moong Dal", quantity: "100", amount: 30000, date: "2026-11-24" })])
 let ln = (await db.query("select account_id, amount, quantity, rate from purchase_lines where id=$1",[pid])).rows[0]
 assert.equal(ln.account_id, mine.id); assert.equal(Number(ln.amount), 30000); assert.equal(Number(ln.rate), 300)
 await db.query("select * from save_purchase($1,$2)",[JSON.stringify({ id: pid, party: "Haji Traders", area: "", item: "Moong Dal", quantity: "100", amount: 31000, date: "2026-11-24" }), p.version])
 assert.equal(Number((await db.query("select amount from purchase_lines where id=$1",[pid])).rows[0].amount), 31000)
 const { rows: [dp] } = await db.query("select * from add_purchase_deposit($1,$2,$3,$4,$5)",[pid, 5000, "2026-11-24", "", "Cheque"])
 assert.equal((await db.query("select method from purchase_account_deposits where id=$1",[dp.id])).rows[0].method, "Cheque")
 await db.query("select remove_purchase_deposit($1)",[dp.id])
 assert.ok((await db.query("select archived_at from purchase_account_deposits where id=$1",[dp.id])).rows[0].archived_at)
 await db.query("select archive_purchase($1)",[pid])
 assert.ok((await db.query("select archived_at from purchase_lines where id=$1",[pid])).rows[0].archived_at)
 await db.exec("reset role")

 // Sync existing Purchase Report suppliers into Accounts
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:"authenticated",email:"ahwmb1965@gmail.com"})])
 await db.exec("set role authenticated")
 const hb = "bbbbbbbb-1111-2222-3333-444444444444"
 await db.exec("drop trigger if exists purchases_to_account on purchases; drop trigger if exists purchase_deposits_to_account on purchase_deposits").catch(() => {})
 await db.exec("reset role")
 await db.exec("drop trigger if exists purchases_to_account on purchases; drop trigger if exists purchase_deposits_to_account on purchase_deposits")
 await db.exec("set role authenticated")
 await db.query("select * from save_purchase($1,null)",[JSON.stringify({ id: hb, party: "hanif broker", area: "", item: "Sugar", amount: 64500, date: "2026-11-10" })])
 await db.query("select * from add_purchase_deposit($1,$2,$3,$4,$5)",[hb, 20000, "2026-11-12", "", "Online"])
 await db.exec("reset role")
 await db.exec(read("migrations/20261204_sync_suppliers_to_accounts.sql")); await db.exec(read("migrations/20261204_sync_suppliers_to_accounts.sql"))
 const vis = (await db.query("select name from purchase_accounts where archived_at is null order by name")).rows.map(r => r.name)
 assert.deepEqual(vis, ["Haji Traders", "hanif broker", "Leela Foods"].sort((a, b) => a.localeCompare(b)).sort())
 const hacc = (await db.query("select id from purchase_accounts where name='hanif broker'")).rows[0].id
 assert.equal(Number((await db.query("select sum(amount) s from purchase_lines where account_id=$1 and archived_at is null",[hacc])).rows[0].s), 64500)
 assert.equal((await db.query("select method from purchase_account_deposits where account_id=$1",[hacc])).rows[0].method, "Online")
 const leelaLine = (await db.query("select account_id, archived_at from purchase_lines where id=$1",[leela])).rows[0]
 assert.equal(leelaLine.account_id, acc.id); assert.equal(leelaLine.archived_at, null)   // joined the visible Leela Foods account
 assert.equal((await db.query("select count(*)::int n from purchase_lines where id in ($1,$2)",[hb, leela])).rows[0].n, 2) // no duplicates
})
