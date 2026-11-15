import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../src/pos/lib/store.ts', import.meta.url), 'utf8')
const compiled = stripTypeScriptTypes(source.replace(/^import .*$/gm, '').replaceAll('export ', ''))
function setup({ salesPages = [{ data: [], error: null }], itemError = null } = {}) {
  let resolveItems
  const items = new Promise(resolve => { resolveItems = resolve })
  let subscriptions = 0
  const db = {
    from: table => {
      const chain = { select: () => chain, gte: () => chain, is: () => { throw new Error('Legacy sales schema has no reversed_at column') }, order: () => chain, range: from => table === 'items' ? (itemError ? Promise.resolve({ data: null, error: itemError }) : items) : Promise.resolve(salesPages[Math.floor(from / 1000)] || { data: [], error: null }) }
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

test('legacy database without reversal columns loads for either signed-in POS account', async () => {
 const store = setup({ salesPages: [{ data: [{ id:'sale', day:'2026-11-15', customer_no:1, total:120, payment:'Cash', lines:[], created_at:'2026-11-15' }], error:null }] })
 store.resolveItems({data:[],error:null})
 await store.actions.load()
 assert.equal(store.getState().status,'ready')
 assert.equal(store.getState().sales['2026-11-15'][0].id,'sale')
})

test('reversed receipts stay excluded without truncating later sales pages', async () => {
 const base={day:'2026-11-15',customer_no:1,total:10,payment:'Cash',lines:[],created_at:'2026-11-15'}
 const store=setup({salesPages:[{data:Array.from({length:1000},(_,i)=>({...base,id:String(i),reversed_at:'2026-11-15'})),error:null},{data:[{...base,id:'active'}],error:null}]})
 store.resolveItems({data:[],error:null}); await store.actions.load()
 assert.equal(store.getState().sales['2026-11-15'].length,1)
 assert.equal(store.getState().sales['2026-11-15'][0].id,'active')
})

test('Supabase plain-object errors display the actual message', async () => {
 const store=setup({itemError:{code:'42501',message:'Permission denied for items'}})
 await store.actions.load()
 assert.equal(store.getState().status,'error')
 assert.equal(store.getState().error,'Permission denied for items')
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
