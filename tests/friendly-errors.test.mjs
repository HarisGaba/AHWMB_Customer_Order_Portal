import test from 'node:test'
import assert from 'node:assert/strict'
import { friendlyError } from '../src/lib/errors.ts'

test('database and network failures become clear, actionable messages', () => {
  assert.match(friendlyError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }), /^Not saved: this record was not found/)
  assert.match(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "customers_pkey"' }), /already exists/)
  assert.match(friendlyError({ code: 'PGRST202', message: 'Could not find the function public.x' }), /check_setup\.sql/)
  assert.match(friendlyError(new TypeError('Failed to fetch')), /No internet connection/)
  assert.match(friendlyError({ code: 'PGRST301', message: 'JWT expired' }), /login has expired/)
  assert.match(friendlyError({ code: 'P0001', message: 'Customer prices must be confirmed by staff' }), /Log in again/)
  // Our own clear SQL messages pass through unchanged.
  assert.equal(friendlyError({ code: 'P0001', message: 'Not enough Chawal in Shop (available 5, requested 9)' }), 'Not enough Chawal in Shop (available 5, requested 9)')
  // The original text is kept in brackets for troubleshooting.
  assert.match(friendlyError({ code: '23503', message: 'violates foreign key constraint' }), /\[violates foreign key constraint\]$/)
})
