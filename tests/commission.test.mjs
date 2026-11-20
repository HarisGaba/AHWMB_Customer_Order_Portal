import test from 'node:test'
import assert from 'node:assert/strict'
import { jsPDF } from 'jspdf'
import { calculateCommission, encodeOrderTag, readOrderTag, rupees, decimal } from '../src/lib/commission.ts'

// Line totals from Qapas_Altaf_Company_Redesigned_Invoice_20-11-2026.pdf (34 items).
const totals = [12500,3800,1600,7800,16500,11500,42000,23000,11500,43000,28000,900,7000,10500,22000,2600,1100,500,3500,4000,12000,11000,7000,128000,48000,144000,7000,6500,3000,64500,12900,45000,18000,5400]
const lines = totals.map((total, i) => ({ name: `Item ${i + 1}`, quantity: '1 kg', rate: total, total }))

test('Qapas Altaf sample: 5.5% commission matches the invoice exactly', () => {
  const r = calculateCommission(lines, 5.5)
  assert.equal(r.grandTotal, 765600)
  assert.equal(r.totalCommission, 42108)
  assert.equal(r.grandAfter, 807708)
  assert.equal(r.lines.length, 34)
  assert.equal(r.lines[0].commission, 687.5); assert.equal(rupees(r.lines[0].after), '13,188')
  assert.equal(r.lines[11].commission, 49.5); assert.equal(r.lines[11].after, 949.5)
  assert.equal(r.remaining, 807708)
  assert.equal(calculateCommission(lines, 5.5, 1000, 300).remaining, 808408)
  assert.equal(decimal(calculateCommission([{ name: 'Sugar', quantity: '550 kg', rate: 129, total: 70675 }], 5.5).lines[0].commission), '3,887.125')
  assert.equal(calculateCommission(lines, 0).grandAfter, 765600)
})

test('order data embedded in a compressed order PDF is read back exactly (Urdu too)', () => {
  const order = { customer: 'Qapas Altaf Company', date: '20-11-2026', ref: 'AH-1', lines: [{ name: 'چاول Rice 1121 (CH)', quantity: '150 kg', rate: 320, total: 48000 }, ...lines] }
  const doc = new jsPDF({ unit: 'mm', format: 'a5', compress: true })
  doc.text('SALES INVOICE', 10, 10)
  doc.setProperties({ title: 'Invoice', keywords: encodeOrderTag(order) })
  const back = readOrderTag(doc.output('arraybuffer'))
  assert.deepEqual(back, order)
  assert.equal(readOrderTag(new jsPDF().output('arraybuffer')), null)
})
