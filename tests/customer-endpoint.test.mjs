import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/submit-customer-order/index.ts',import.meta.url),'utf8').replace(/^import .*$/gm,''))
const payload={token:'test-token',p_order_ref:'#AHWMB-12345678-1234-1234-1234-123456789abc',p_customer_name:'Name',p_customer_phone:'03001234567',p_customer_address:'Address',p_notes:'Note',p_items:[{name:'Rice',quantity_value:2,unit_type:'KG',unit_price:0,total:0}]}
function setup({verified={success:true,hostname:'shop.test',action:'customer-order'},secret='test-secret',rpc={data:'saved-id',error:null},existing=null}={}) {
 let handler, calls=0
 runInNewContext(source,{
  serve:fn=>{handler=fn},Request,Response,AbortSignal,JSON,
  Deno:{env:{get:name=>({TURNSTILE_SECRET_KEY:secret,TURNSTILE_ALLOWED_HOSTNAMES:'shop.test',SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test-only'})[name]}},
  fetch:async()=>Response.json(verified),
  createClient:()=>({rpc:async(name,args)=>{calls++;return typeof rpc === 'function' ? rpc(name,args,calls) : rpc},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:existing})})})})}),
 })
 return {send:(body=payload)=>handler(new Request('https://example.test/order',{method:'POST',body:JSON.stringify(body)})),calls:()=>calls}
}
test('customer endpoint fails closed when its secret is missing',async()=>{
 const app=setup({secret:''});assert.equal((await app.send()).status,503);assert.equal(app.calls(),0)
})
test('invalid token, hostname and action cannot reach the database',async()=>{
 for(const verified of [{success:false},{success:true,hostname:'other.test',action:'customer-order'},{success:true,hostname:'shop.test',action:'other'}]) {
  const app=setup({verified});assert.equal((await app.send()).status,400);assert.equal(app.calls(),0)
 }
})
test('verified order returns the saved receipt ID',async()=>{
 const app=setup();const response=await app.send();assert.equal(response.status,200);assert.equal((await response.json()).id,'saved-id');assert.equal(app.calls(),1)
})
test('lost-response retry compares JSON values regardless of object key order',async()=>{
 const app=setup({rpc:{error:{code:'23505'},data:null},existing:{id:'existing-id',customer_name:'Name',customer_phone:'923001234567',customer_address:'Address',location_link:null,notes:'Note',items:[{total:0,unit_price:0,unit_type:'KG',quantity_value:2,name:'Rice'}]}})
 const response=await app.send();assert.equal(response.status,200);assert.equal((await response.json()).id,'existing-id')
})
test('same reference with different order details cannot claim an existing receipt',async()=>{
 const app=setup({rpc:{error:{code:'23505'},data:null},existing:{id:'existing-id',customer_name:'Someone else',customer_phone:'923001234567',customer_address:'Address',notes:'Note',items:payload.p_items}})
 assert.equal((await app.send()).status,400)
})
test('verified customer submissions support the older RPC without dropping notes',async()=>{
 const app=setup({rpc:(name,args,calls)=>{
  assert.equal(name,'submit_order')
  if(calls===1)return {data:null,error:{code:'PGRST202'}}
  assert.equal(args.p_notes,undefined);assert.equal(args.p_customer_address,'Address\nNotes: Note')
  return {data:'legacy-order',error:null}
 }})
 assert.equal((await (await app.send()).json()).id,'legacy-order')
 assert.equal(app.calls(),2)
})
test('invalid customer prices are rejected before either database RPC',async()=>{
 const app=setup()
 const response=await app.send({...payload,p_items:[{...payload.p_items[0],unit_price:100,total:200}]})
 assert.equal(response.status,400);assert.equal(app.calls(),0)
})
