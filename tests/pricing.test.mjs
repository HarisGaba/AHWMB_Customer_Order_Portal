import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateLineTotal, sumLineTotals } from '../src/lib/pricing.ts'

test('250 grams at Rs 1,600 per KG totals Rs 400', () => {
  assert.equal(calculateLineTotal({ quantity_value: 250, unit_type: 'GRAMS', unit_price: 1600 }), 400)
})

test('500 grams at Rs 1,600 per KG totals Rs 800', () => {
  assert.equal(calculateLineTotal({ quantity_value: 500, unit_type: 'GRAMS', unit_price: 1600 }), 800)
})

test('1 kilogram at Rs 1,600 per kilogram totals Rs 1,600', () => {
  assert.equal(calculateLineTotal({ quantity_value: 1, unit_type: 'KG', unit_price: 1600 }), 1600)
})

test('piece quantities use the per-piece price', () => {
  assert.equal(calculateLineTotal({ quantity_value: 3, unit_type: 'PCS', unit_price: 25 }), 75)
})

test('legacy rate field is supported when unit_price is absent', () => {
  assert.equal(calculateLineTotal({ quantity_value: 250, unit_type: 'GRAMS', rate: 1600 }), 400)
})

test('line totals are rounded to currency precision', () => {
  assert.equal(calculateLineTotal({ quantity_value: 333, unit_type: 'GRAMS', unit_price: 100 }), 33.3)
})

test('subtotal sums any number of line totals without floating point noise', () => {
  assert.equal(sumLineTotals([{ total: 0.1 }, { total: 0.2 }, { total: 0.3 }]), 0.6)
})
