import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/saveRequests.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ',''))
const {savePosSale,saveStaffOrder,boundedRequest}=runInNewContext(`${source};({savePosSale,saveStaffOrder,boundedRequest})`,{setTimeout,clearTimeout})
const missing={data:null,error:{code:'PGRST202',message:'Missing function'}}
const args={p_day:'2026-11-16',p_lines:[{name:'Rice',qty:2,rate:100}],p_payment:'Cash',p_customer_name:'Customer',p_request_id:'test-request'}
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}}
function legacyDb(handler) {
 let existing=null,calls=0
 const db={rpc:async(name,values)=>{
  if(name==='record_sale_v2')return missing
  assert.equal(name,'record_sale');calls++
  return handler(values,row=>{existing=row})
 },from:table=>{assert.equal(table,'sales');const q={select:()=>q,contains:()=>q,limit:()=>q,maybeSingle:async()=>({data:existing,error:null})};return q}}
 return {db,calls:()=>calls}
}
test('legacy sale RPC saves once and recovers a retry from its receipt marker',async()=>{
 const mock=legacyDb((v,save)=>{const row={id:'receipt',lines:v.p_lines,payment:v.p_payment,customer_name:v.p_customer_name};save(row);return {data:row,error:null}}),store=storage()
 assert.equal((await savePosSale(mock.db,args,store)).id,'receipt')
 assert.equal((await savePosSale(mock.db,args,store)).id,'receipt')
 assert.equal(mock.calls(),1)
})
test('an uncertain legacy save is never blindly inserted again',async()=>{
 const mock=legacyDb(()=>{throw new Error('Connection dropped')}),store=storage()
 await assert.rejects(savePosSale(mock.db,args,store),/Connection dropped/)
 await assert.rejects(savePosSale(mock.db,args,store),/previous save is not yet confirmed/)
 assert.equal(mock.calls(),1)
})
test('receipt committed before a lost response can be recovered without duplication',async()=>{
 const mock=legacyDb((v,save)=>{save({id:'receipt',lines:v.p_lines,payment:v.p_payment,customer_name:v.p_customer_name});throw new Error('Response lost')}),store=storage()
 await assert.rejects(savePosSale(mock.db,args,store),/Response lost/)
 assert.equal((await savePosSale(mock.db,args,store)).id,'receipt');assert.equal(mock.calls(),1)
})
test('modern permission errors are reported without falling back',async()=>{
 await assert.rejects(savePosSale({rpc:async name=>{assert.equal(name,'record_sale_v2');return {error:{code:'42501',message:'Not authorized'}}}},args,storage()),/Not authorized/)
})
test('bounded requests release the busy state path rather than waiting forever',async()=>{
 await assert.rejects(boundedRequest(new Promise(()=>{}),5),/did not confirm/)
})
test('legacy staff order preserves notes and finalizes only its new pending order',async()=>{
 let calls=0,patch,filters=[]
 const db={rpc:async(name,v)=>{assert.equal(name,'submit_order');calls++;if(calls===1)return missing;assert.equal(v.p_notes,undefined);assert.equal(v.p_customer_address,'Address\nNotes: Ring bell');return {data:'new-order',error:null}},from:table=>{assert.equal(table,'orders');const q={update:v=>{patch=v;return q},eq:(k,v)=>{filters.push([k,v]);return q},then:resolve=>resolve({error:null})};return q}}
 const id=await saveStaffOrder(db,{p_order_ref:'ref',p_customer_name:'Customer',p_customer_phone:'923001234567',p_customer_address:'Address',p_location_link:null,p_notes:'Ring bell',p_items:[{total:200}]})
 assert.equal(id,'new-order');assert.equal(patch.grand_total,200);assert.deepEqual(filters,[['id','new-order'],['status','pending']])
})
