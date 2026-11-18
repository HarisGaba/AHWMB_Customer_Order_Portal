import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

// Uses the real Supabase client with a fake network: nothing is sent anywhere.
test('POS duplicate-sale check sends valid JSON to the database (no "invalid input syntax for type json")', async () => {
  const urls = []
  const fakeFetch = async (url, init) => {
    urls.push(String(url))
    const u = new URL(String(url))
    if (u.pathname.endsWith('/rpc/record_sale_v2')) return new Response(JSON.stringify({ code: 'PGRST202', message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    if (u.pathname.endsWith('/sales')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.pathname.endsWith('/rpc/record_sale')) {
      const body = JSON.parse(init.body) // the sale itself must be valid JSON too
      assert.ok(Array.isArray(body.p_lines) && body.p_lines[0].name === 'Chawal')
      return new Response(JSON.stringify({ id: 's1', day: body.p_day, lines: body.p_lines }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  }
  const db = createClient('https://example.supabase.co', 'anon', { global: { fetch: fakeFetch }, auth: { persistSession: false } })
  const { savePosSale } = await import('../src/lib/saveRequests.ts').catch(() => import('../src/lib/saveRequests.js'))
  const store = new Map(); const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const sale = await savePosSale(db, { p_day: '2026-11-18', p_lines: [{ name: 'Chawal', qty: 2, rate: 300 }], p_payment: 'cash', p_customer_name: null, p_request_id: '00000000-0000-4000-8000-000000000001' }, storage)
  assert.equal(sale.id, 's1')
  const check = new URL(urls.find(u => new URL(u).pathname.endsWith('/sales')))
  const filter = check.searchParams.get('lines')
  assert.ok(filter.startsWith('cs.'), filter)
  assert.doesNotThrow(() => JSON.parse(filter.slice(3)), `not JSON: ${filter}`)
})
