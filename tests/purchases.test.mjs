import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/purchases.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ',''))
const {readLocalPurchases,saveLocalPurchase,persistPurchase}=runInNewContext(`${source};({readLocalPurchases,saveLocalPurchase,persistPurchase})`,{Date,crypto:webcrypto})
const row=()=>({id:webcrypto.randomUUID(),party:'Supplier',area:'Karachi',item:'Rice',amount:'125.50',date:'2026-11-15'})
function storage(initial={}) {
 const map=new Map(Object.entries(initial))
 return {get length(){return map.size},key:i=>[...map.keys()][i] ?? null,getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,v),map}
}
test('missing purchase RPC saves a recoverable device record without changing legacy data',async()=>{
 const old=row(),original=JSON.stringify([old]),store=storage({'ahwmb-purchase-report':original}),draft=row()
 const db={rpc:async()=>({data:null,error:{code:'PGRST202',message:'Missing function'}})}
 const result=await persistPurchase(db,draft,async r=>saveLocalPurchase(store,r))
 assert.equal(result.destination,'device');assert.equal(result.row.amount,'125.50')
 assert.equal(store.getItem('ahwmb-purchase-report'),original)
 assert.equal(readLocalPurchases(store).length,2)
 // Retrying the same commit cannot duplicate the purchase.
 await persistPurchase(db,draft,async r=>saveLocalPurchase(store,r))
 assert.equal(readLocalPurchases(store).length,2)
})
test('database success returns confirmed record and does not use device fallback',async()=>{
 const draft=row()
 const result=await persistPurchase({rpc:async()=>({data:{...draft,version:1},error:null})},draft,async()=>assert.fail('Unexpected local write'))
 assert.equal(result.destination,'database');assert.equal(result.row.version,1)
})
test('permission/network failures keep the form data and never claim a local save',async()=>{
 for(const code of ['42501','NETWORK_ERROR']) {
  const draft=row(),before=JSON.stringify(draft)
  await assert.rejects(persistPurchase({rpc:async()=>({data:null,error:{code,message:'Save failed'}})},draft,async()=>assert.fail('Must not fallback')),/Save failed/)
  assert.equal(JSON.stringify(draft),before)
 }
})
test('device edits preserve previous snapshots and reject stale edits',()=>{
 const store=storage(),first=saveLocalPurchase(store,row())
 const second=saveLocalPurchase(store,{...first,amount:'200'})
 assert.equal(store.length,2)
 assert.equal(readLocalPurchases(store)[0].amount,'200')
 assert.ok(second.localRevision>first.localRevision)
 assert.throws(()=>saveLocalPurchase(store,{...first,amount:'300'}),/another tab/)
 assert.equal(store.length,2)
})
test('unreadable old storage, quota errors and remote edits cannot be silently overwritten',async()=>{
 const malformed=storage({'ahwmb-purchase-report':'broken json'})
 assert.throws(()=>saveLocalPurchase(malformed,row()))
 assert.equal(malformed.getItem('ahwmb-purchase-report'),'broken json')
 const full=storage();full.setItem=()=>{throw new Error('Quota exceeded')}
 await assert.rejects(persistPurchase(null,row(),async r=>saveLocalPurchase(full,r)),/Quota exceeded/)
 assert.throws(()=>saveLocalPurchase(storage(),{...row(),version:2}),/cannot be edited locally/)
})
