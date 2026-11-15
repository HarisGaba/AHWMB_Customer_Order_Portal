import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/searchOrders.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('export async function','async function'))
const searchOrders=runInNewContext(`${source}; searchOrders`,{Date})
const args={p_search:'',p_status:'all',p_from:null,p_to:null,p_page:0}
test('missing search RPC falls back to RLS-protected orders with complete pagination and counts',async()=>{
 const rows=Array.from({length:1002},(_,i)=>({id:String(i),customer_name:'Customer',customer_phone:'123',order_ref:`ref-${i}`,created_at:'2020-01-01',status:i%2?'completed':'pending'}))
 let reads=0
 const db={rpc:async()=>({data:null,error:{code:'PGRST202'}}),from:table=>{
  assert.equal(table,'orders');const q={select:()=>q,order:()=>q,range:(start,end)=>{reads++;return Promise.resolve({data:rows.slice(start,end+1),error:null})}};return q
 }}
 const result=await searchOrders(db,{...args,p_status:'urgent',p_page:20})
 assert.equal(reads,2);assert.equal(result.data.total,501);assert.equal(result.data.rows.length,1)
 assert.equal(result.data.counts.completed,501);assert.equal(result.data.counts.urgent,501)
})
test('permission and network errors are not replaced by fallback reads',async()=>{
 for(const code of ['42501','PGRST301','NETWORK_ERROR']) {
  const error={code,message:'Failed'}
  const result=await searchOrders({rpc:async()=>({data:null,error}),from:()=>assert.fail('Must not fall back')},args)
  assert.equal(result.error,error)
 }
})
test('installed search RPC is used without a fallback query',async()=>{
 const data={rows:[],total:0,counts:{all:0,pending:0,urgent:0,completed:0}}
 assert.equal((await searchOrders({rpc:async()=>({data,error:null}),from:()=>assert.fail('Unexpected fallback')},args)).data,data)
})
