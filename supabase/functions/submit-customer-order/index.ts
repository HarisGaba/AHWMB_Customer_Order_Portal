import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
serve(async req => {
 if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
 if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
 try {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  const hosts = (Deno.env.get('TURNSTILE_ALLOWED_HOSTNAMES') || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!secret || !hosts.length) return reply({ error: 'Online ordering is temporarily unavailable. Please contact the shop.' }, 503)
  const raw = await req.text()
  if (raw.length > 100000) return reply({ error: 'Order is too large' }, 413)
  const body = JSON.parse(raw)
  if (typeof body.token !== 'string' || !body.token || body.token.length > 2048) return reply({ error: 'Please complete the security check.' }, 400)
  if (typeof body.p_order_ref !== 'string' || !/^#AHWMB-[0-9a-f-]{36}$/i.test(body.p_order_ref)) return reply({ error: 'Invalid order reference' }, 400)
  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
   method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ secret, response: body.token }), signal: AbortSignal.timeout(10000),
  })
  const checked = await verification.json()
  if (!verification.ok || !checked.success || !hosts.includes(checked.hostname) || checked.action !== 'customer-order') return reply({ error: 'Security check expired or failed. Please try again.' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // Explicit allowlist: no prices, staff identity or authorization is accepted from the caller.
  const args = {
   p_order_ref: body.p_order_ref, p_customer_name: body.p_customer_name,
   p_customer_phone: body.p_customer_phone, p_customer_address: body.p_customer_address,
   p_location_link: body.p_location_link || null, p_items: body.p_items, p_notes: body.p_notes || '',
  }
  const { data, error } = await db.rpc('submit_order', args)
  // A repeated reference cannot create a second order, including after a lost response.
  if (error?.code === '23505') {
   const { data: existing } = await db.from('orders').select('id,items,customer_name,customer_phone,customer_address,location_link,notes').eq('order_ref', args.p_order_ref).maybeSingle()
   const phone = String(args.p_customer_phone || '').replace(/[^0-9]/g, '').replace(/^0/, '92')
   if (existing && canonical(existing.items) === canonical(args.p_items) && existing.customer_phone === phone && existing.customer_name === String(args.p_customer_name).trim() && existing.customer_address === String(args.p_customer_address).trim() && (existing.location_link || '') === String(args.p_location_link || '').trim() && existing.notes === String(args.p_notes).slice(0,2000)) return reply({ id: existing.id })
  }
  if (error) return reply({ error: error.code === 'P0001' ? error.message : 'Order could not be saved. Please retry with the same order.' }, 400)
  return reply({ id: data })
 } catch {
  return reply({ error: 'Unable to verify or save the order. Please try again.' }, 503)
 }
})
