import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateLineTotal, roundCurrency, sumLineTotals } from '../src/lib/pricing.ts'

// Exact decimal reference = PostgreSQL round(q*r, 2) (half away from zero), using integers only.
const exact = (q, r, grams) => {
  const Q = BigInt(Math.round(q * 1000)), R = BigInt(Math.round(r * 100)) // q has 3 dp, r has 2 dp
  let num = Q * R, den = 1000n * 100n * (grams ? 1000n : 1n) // value = num/den
  const cents = (num * 100n * 2n + den) / (den * 2n)               // half-up
  return Number(cents) / 100
}

test('line totals match the database rounding exactly (the "Line total does not match" rejection)', () => {
  assert.equal(roundCurrency(1.005), 1.01)
  assert.equal(calculateLineTotal({ quantity_value: 2.5, unit_type: 'KG', unit_price: 10.01 }), 25.03)
  let seed = 7; const rnd = n => (seed = (seed * 48271) % 2147483647) % n
  for (let i = 0; i < 20000; i++) {
    const q = rnd(500000) / 1000, r = rnd(5000000) / 100, unit = ['KG', 'PCS', 'GRAMS', 'LITRE'][i % 4]
    assert.equal(calculateLineTotal({ quantity_value: q, unit_type: unit, unit_price: r }), exact(q, r, unit === 'GRAMS'), `${q} ${unit} @ ${r}`)
  }
})

test('36-item invoice total equals the sum of its lines to the paisa', () => {
  const items = Array.from({ length: 36 }, (_, i) => ({ total: calculateLineTotal({ quantity_value: 1 + i * 0.125, unit_type: 'KG', unit_price: 5.5 + i }) }))
  const cents = items.reduce((s, l) => s + Math.round(l.total * 100), 0)
  assert.equal(sumLineTotals(items), cents / 100)
})
