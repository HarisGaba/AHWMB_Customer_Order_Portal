import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { jsPDF } from 'jspdf'
const compile=path=>stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ',''))
const {receiptHeightMm,prepareReceiptPage}=runInNewContext(`${compile('../src/lib/receiptLayout.ts')};({receiptHeightMm,prepareReceiptPage})`)
const SHOP=runInNewContext(`${compile('../src/pos/lib/config.ts')};SHOP`)
const receiptHtml=runInNewContext(`${compile('../src/pos/lib/receipt.ts')};receiptHtml`,{SHOP,URL,window:{location:{origin:'https://shop.test'}},format:()=> '16 Nov 2026',fmt:n=>`Rs ${n.toFixed(2)}`,fmtKg:n=>`${n} kg`,remainingBalance:s=>Math.max(0,s.total-(s.paidAmount??(s.payment==='Cash'?s.total:0))),totalWeight:lines=>lines.reduce((sum,l)=>sum+l.qty,0)})
for(const count of [1,30,75])test(`${count} receipt items remain sequential with one footer and exact return policy`,()=>{
 const lines=Array.from({length:count},(_,i)=>({name:`Item-${i+1} <rice>`,nameUr:'چاول',qty:1,rate:100}))
 const html=receiptHtml({id:'receipt',customerNo:1,createdAt:'2026-11-16',lines,total:count*100,payment:'Cash',customerName:'Name'})
 assert.equal((html.match(/class="name"/g)||[]).length,count)
 assert.equal((html.match(/خریدا ہوا مال واپس ہو جائے گا/g)||[]).length,1)
 assert.ok(html.indexOf('Item-1 ')<=html.indexOf(`Item-${count} `));assert.ok(html.includes('&lt;rice&gt;'))
 assert.ok(!html.includes('Receipt No'));assert.ok(html.includes('Remaining Balance'));assert.ok(!html.includes('80mm auto'));assert.ok(!html.includes('واپس نہیں'))
})
test('long thermal content uses an explicit one-page height instead of A4 or clipping',()=>{
 const styles=[]
 const doc={querySelector:()=>({scrollHeight:8000,getBoundingClientRect:()=>({height:8000})}),getElementById:()=>null,createElement:()=>({}),head:{appendChild:s=>styles.push(s)}}
 const size=prepareReceiptPage(doc)
 assert.ok(styles[0].textContent.includes(`80mm ${size.heightMm}mm`))
 const pdf=new jsPDF({unit:'mm',format:[80,size.heightMm]})
 assert.equal(pdf.getNumberOfPages(),1)
 assert.ok(Math.abs(pdf.internal.pageSize.getHeight()-size.heightMm)<0.1)
 assert.equal(receiptHeightMm(8000),2120)
 assert.throws(()=>receiptHeightMm(100000),/exceeds/)
})
