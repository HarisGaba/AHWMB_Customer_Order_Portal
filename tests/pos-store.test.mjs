import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../src/pos/lib/store.ts', import.meta.url), 'utf8')
const compiled = stripTypeScriptTypes(source.replace(/^import .*$/gm, '').replaceAll('export ', ''))
function setup() {
  let resolveItems
  const items = new Promise(resolve => { resolveItems = resolve })
  let subscriptions = 0
  const db = {
    from: table => {
      const chain = { select: () => chain, gte: () => chain, is: () => chain, order: () => chain, range: () => table === 'items' ? items : Promise.resolve({ data: [], error: null }) }
      return chain
    },
    channel: () => {
      const channel = { on: () => channel, subscribe: () => { subscriptions++; return channel } }
      return channel
    },
    removeChannel: () => {},
  }
  const result = runInNewContext(`${compiled}\n;({actions, getState: () => state})`, {
    supabase: db, useSyncExternalStore: () => {},
    format: () => '2026-11-15', subDays: d => d,
    window: { addEventListener() {} }, document: { addEventListener() {} },
  })
  return { ...result, resolveItems, subscriptions: () => subscriptions }
}

test('a POS load completing after logout cannot restore data or a realtime subscription', async () => {
  const store = setup()
  const loading = store.actions.load()
  store.actions.reset()
  store.resolveItems({ data: [{ id: 'real-product', name: 'Rice', rate: 120, created_at: '2026-11-15' }], error: null })
  await loading
  assert.equal(store.getState().status, 'idle')
  assert.equal(store.getState().items.length, 0)
  assert.equal(store.subscriptions(), 0)
})

test('empty sales history still loads the live catalog and makes POS ready for billing', async () => {
  const store = setup()
  const loading = store.actions.load()
  store.resolveItems({ data: [{ id: 'real-product', name: 'Rice', rate: 120, created_at: '2026-11-15' }], error: null })
  await loading
  assert.equal(store.getState().status, 'ready')
  assert.equal(store.getState().items[0].name, 'Rice')
  assert.equal(store.getState().items[0].rate, 120)
  assert.equal(Object.keys(store.getState().sales).length, 0)
  assert.equal(store.subscriptions(), 1)
})
