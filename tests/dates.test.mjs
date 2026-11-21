import test from 'node:test'
import assert from 'node:assert/strict'
import { ddmmyyyy, ddmmyyyyTime } from '../src/lib/dates.ts'
test('dates show as dd/mm/yyyy without shifting a day', () => {
  assert.equal(ddmmyyyy('2026-11-16'), '16/11/2026')
  assert.equal(ddmmyyyy('2026-06-21'), '21/06/2026')
  assert.equal(ddmmyyyy(new Date(2026, 10, 21, 20, 14)), '21/11/2026')
  assert.equal(ddmmyyyyTime(new Date(2026, 10, 21, 20, 14)), '21/11/2026, 08:14 pm')
  assert.equal(ddmmyyyyTime(new Date(2026, 10, 21, 0, 5)), '21/11/2026, 12:05 am')
  assert.equal(ddmmyyyy(''), '')
})
