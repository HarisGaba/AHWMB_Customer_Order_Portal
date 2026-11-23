import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createClient } from '@supabase/supabase-js'
import { homePathFor, NO_ACCESS } from '../src/lib/access.ts'

const source = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const compiled = stripTypeScriptTypes(source
  .replace(/^import .*$/gm, '')
  .replaceAll('import.meta.env', 'env')
  .replaceAll('export ', ''))
const portalKey = 'sb-example-auth-token'
const posKey = 'ahwmb-pos-auth'
const owner = { admin: true, active: true, name: 'Admin', permissions: [] }
const session = id => JSON.stringify({
  access_token: 'header.payload.signature', refresh_token: `refresh-${id}`,
  expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400,
  token_type: 'bearer', user: { id, email: `${id}@example.com` },
})
function storage(entries = []) {
  const data = new Map(entries)
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k), data }
}
function tab(url, shared, markers = storage()) {
  const location = new URL(url, 'https://portal.example')
  const requestedOptions = []
  const requests = []
  let destination
  const result = runInNewContext(`${compiled}\n;({supabase, clientFor, openPosFromPortal, openPortalFromPos, signOutEverywhere})`, {
    URL,
    env: { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-public-key' },
    URLSearchParams,
    window: { localStorage: shared, location: { pathname: location.pathname, search: location.search, assign: p => { destination = p } } },
    localStorage: shared, sessionStorage: markers,
    createClient: (url, key, options) => {
      requestedOptions.push(options)
      return createClient(url, key, {
        ...options, auth: { ...options.auth, autoRefreshToken: false },
        global: { fetch: async (url) => { requests.push(String(url)); return new Response('{}', { status: 200 }) } },
      })
    },
  })
  return { ...result, requestedOptions, requests, destination: () => destination }
}

test('customer/admin and POS tabs retain separate sessions; POS logout leaves portal intact', async () => {
  const shared = storage([[portalKey, session('admin')], [posKey, session('cashier')], ['ahwmb-saved-customers', '["preserve"]']])
  const admin = tab('/admin', shared)
  const customer = tab('/', shared)
  const pos = tab('/pos', shared)
  const secondPos = tab('/pos', shared)
  assert.equal((await admin.supabase.auth.getSession()).data.session.user.id, 'admin')
  assert.equal((await customer.supabase.auth.getSession()).data.session.user.id, 'admin')
  assert.equal((await secondPos.supabase.auth.getSession()).data.session.user.id, 'cashier')
  const before = shared.getItem(portalKey)
  await pos.supabase.auth.signOut({ scope: 'local' })
  assert.equal(shared.getItem(portalKey), before)
  assert.equal((await secondPos.supabase.auth.getSession()).data.session, null)
  assert.equal(shared.getItem('ahwmb-saved-customers'), '["preserve"]')
  assert.ok(pos.requests[0].includes('scope=local'))
  assert.equal(admin.requestedOptions[0].auth.persistSession, true)
  assert.equal(admin.requestedOptions[0].auth.autoRefreshToken, true)
})

test('portal logout leaves POS session untouched', async () => {
  const shared = storage([[portalKey, session('admin')], [posKey, session('cashier')]])
  const admin = tab('/admin', shared)
  const before = shared.getItem(posKey)
  await admin.supabase.auth.signOut({ scope: 'local' })
  assert.equal(shared.getItem(posKey), before)
})

test('a new tab uses the login from the other area instead of asking again; Logout ends both', async () => {
  for (const [route, savedKey] of [['/admin', posKey], ['/pos', portalKey]]) {
    const shared = storage([[savedKey, session('owner')]])
    const page = tab(route, shared)
    assert.equal((await page.supabase.auth.getSession()).data.session.user.id, 'owner')
  }
  const shared = storage([[portalKey, session('admin')], [posKey, session('cashier')], ['ahwmb-saved-customers', '["preserve"]']])
  const page = tab('/pos', shared)
  await page.signOutEverywhere()
  assert.equal(shared.getItem(portalKey), null); assert.equal(shared.getItem(posKey), null)
  assert.equal(shared.getItem('ahwmb-saved-customers'), '["preserve"]')
})

test('portal switching changes only the URL, and POS login uses its existing key', async () => {
  const shared = storage([[portalKey, session('admin')], [posKey, session('cashier')]])
  const before = [...shared.data]
  const admin = tab('/admin', shared)
  admin.openPosFromPortal()
  assert.equal(admin.destination(), '/pos')
  const pos = tab('/login?next=/pos', shared)
  assert.equal((await pos.supabase.auth.getSession()).data.session.user.id, 'cashier')
  pos.openPortalFromPos()
  assert.equal(pos.destination(), '/admin')
  assert.deepEqual([...shared.data], before)
})

test('owner accounts always log in to their own home first; other users follow the page they came from', () => {
  assert.equal(homePathFor(owner, '/pos', 'ahmedyounus1978@gmail.com'), '/admin')
  assert.equal(homePathFor(owner, '/admin', 'ahwmb1965@gmail.com'), '/pos')
  assert.equal(homePathFor(owner, '/admin', 'ahmedyounus1978@gmail.com'), '/admin')
  assert.equal(homePathFor(owner, '/pos', 'staff@example.com'), '/pos')
  assert.equal(homePathFor(owner, '/admin', 'staff@example.com'), '/admin')
  assert.equal(homePathFor(NO_ACCESS, '/pos', 'ahwmb1965@gmail.com'), '/login')
  assert.equal(homePathFor(NO_ACCESS, '/admin', 'ahmedyounus1978@gmail.com'), '/login')
  assert.equal(homePathFor(owner, null, 'ahwmb1965@gmail.com'), '/pos')
})

