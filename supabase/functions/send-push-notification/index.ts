// ═══════════════════════════════════════════════════
// AHWMB — New Order Push Notification
// ═══════════════════════════════════════════════════
//
// Sends a browser push to every admin device saved in
// public.push_subscriptions when a customer submits an order.
//
// SETUP (one-time):
// 1. pnpm generate-vapid
// 2. Supabase secrets: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY,
//    VAPID_SUBJECT=mailto:ahwmb1965@gmail.com
// 3. Frontend env (Vercel + .env.local): VITE_VAPID_PUBLIC_KEY
// 4. Apply supabase/migrations/20261101_push_subscriptions.sql
// 5. supabase functions deploy send-push-notification
// ═══════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:ahwmb1965@gmail.com'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  try {
    const payload = await req.json()
    const reference = payload?.order?.order_ref || payload?.order_ref
    if (typeof reference !== 'string' || !/^#?AHWMB-[A-Za-z0-9-]+$/.test(reference)) {
      return json({ sent: 0, error: 'Invalid order reference' }, 400)
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
      return json({ sent: 0, reason: 'Push service is not configured' }, 503)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Load the actual saved order; never push arbitrary browser-supplied content.
    const { data: order, error: orderError } = await supabase
      .from('orders').select('*').eq('order_ref', reference).maybeSingle()
    if (orderError) throw orderError
    if (!order || Date.now() - new Date(order.created_at).getTime() > 86400000) {
      return json({ sent: 0, error: 'Recent order not found' }, 404)
    }

    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions').select('*')
    if (subError) throw subError
    if (!subscriptions?.length) return json({ sent: 0, reason: 'No subscriptions' })

    const items = Array.isArray(order.items) ? order.items : []
    const message = JSON.stringify({
      title: `🛒 New Order — ${order.customer_name || 'Customer'}`,
      body: `${order.order_ref} · ${items.length} item${items.length === 1 ? '' : 's'}`,
      tag: `order-${order.order_ref}`,
      url: '/admin',
      orderId: order.id,
    })

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    let sent = 0
    const expired: string[] = []
    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
          { TTL: 86400, urgency: 'high' },
        )
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404/410: the browser unsubscribed or the subscription expired.
        if (status === 404 || status === 410) expired.push(sub.endpoint)
        else console.error('[AHWMB] Push failed:', status, String(err))
      }
    }))

    if (expired.length) await supabase.from('push_subscriptions').delete().in('endpoint', expired)

    return json({ sent, removed: expired.length })
  } catch (err) {
    console.error('[AHWMB] Push function error:', err)
    return json({ sent: 0, error: String(err) }, 500)
  }
})
