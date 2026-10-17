import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const payload = await request.json()
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) return new Response(JSON.stringify({ skipped: true, reason: 'RESEND_API_KEY is not configured' }), { headers: { ...cors, 'Content-Type': 'application/json' }, status: 200 })
    const email = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: Deno.env.get('NOTIFY_FROM_EMAIL') || 'AHWMB Orders <onboarding@resend.dev>', to: [Deno.env.get('NOTIFY_TO_EMAIL') || 'ahwmb1965@gmail.com'], subject: `New AHWMB Order ${payload.order_ref}`, text: `New order ${payload.order_ref}\nCustomer: ${payload.customer_name}\nPhone: ${payload.customer_phone}\nAddress: ${payload.customer_address}` }) })
    const result = await email.json()
    return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' }, status: email.ok ? 200 : 502 })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 })
  }
})
