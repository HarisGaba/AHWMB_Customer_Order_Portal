// ═══════════════════════════════════════════════════
// AHWMB — New Order Email Notification
// ═══════════════════════════════════════════════════
//
// SETUP REQUIRED (one-time):
//
// 1. Create account at https://resend.com (free tier:
//    100 emails/day, 3,000/month — enough for AHWMB)
//
// 2. In Resend dashboard → API Keys → Create API Key
//    Name: "AHWMB Portal"
//    Permission: "Sending access"
//    Copy the key (shown only once)
//
// 3. In Supabase Dashboard → Edge Functions → Secrets:
//    Add: RESEND_API_KEY = re_xxxxxxxxxxxx
//    Add: NOTIFY_FROM_EMAIL = orders@yourdomain.com
//    Add: NOTIFY_CC_EMAIL = second@email.com (optional)
//    Recipient is fixed in code to ahwmb1965@gmail.com
//    (no NOTIFY_TO_EMAIL secret needed).
//
// 4. In Resend → Domains → Add Domain:
//    Add your domain for professional from-address
//    (Without this, use onboarding@resend.dev for testing —
//    it only delivers to the Resend account owner's email,
//    so sign up to Resend with ahwmb1965@gmail.com)
//
// 5. Deploy this function:
//    supabase functions deploy notify-new-order
//
// TEST: Submit a test order through the portal and
// check the inbox of ahwmb1965@gmail.com
// ═══════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const NOTIFY_TO_EMAIL = 'ahwmb1965@gmail.com'
const NOTIFY_FROM_EMAIL = Deno.env.get('NOTIFY_FROM_EMAIL')
  || ''
const NOTIFY_CC_EMAIL = Deno.env.get('NOTIFY_CC_EMAIL') || ''

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const payload = await req.json()
    const reference = payload?.order?.order_ref || payload?.order_ref
    if (typeof reference !== 'string' || !/^#?AHWMB-[A-Za-z0-9-]+$/.test(reference)) {
      return new Response('Invalid order reference', { status: 400, headers: cors })
    }
    const databaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!databaseUrl || !serviceKey || !RESEND_API_KEY || !NOTIFY_FROM_EMAIL) {
      return new Response(JSON.stringify({ success: false, reason: 'Email service is not configured' }), {
        status: 503, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
    // Load the actual saved order; never email arbitrary browser-supplied content.
    const lookup = new URL(databaseUrl + '/rest/v1/orders')
    lookup.searchParams.set('order_ref', 'eq.' + reference)
    lookup.searchParams.set('select', '*')
    const saved = await fetch(lookup, { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } })
    if (!saved.ok) throw new Error('Order lookup failed')
    const records = await saved.json()
    const order = records[0]
    if (!order || Date.now() - new Date(order.created_at).getTime() > 86400000) {
      return new Response('Recent order not found', { status: 404, headers: cors })
    }

    if (!order) {
      return new Response('Missing order data', { status: 400 })
    }

    const {
      order_ref = 'Unknown',
      customer_name = 'Unknown',
      customer_phone = '',
      customer_address = '',
      items = [],
      grand_total = 0,
      created_at = new Date().toISOString(),
      location_link = null,
    } = order

    if (!Array.isArray(items) || items.length > 500) return new Response('Invalid items', { status: 400, headers: cors })
    // Format items as HTML table rows
    const itemRows = items.map((item: any, i: number) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 8px 12px; color: #374151;">
          ${i + 1}
        </td>
        <td style="padding: 8px 12px; font-weight: 600;
          color: #111827;">
          ${escapeHtml(item.name)}
        </td>
        <td style="padding: 8px 12px; color: #374151;">
          ${escapeHtml(item.quantity_value)} ${escapeHtml(item.unit_type)}
        </td>
        <td style="padding: 8px 12px; text-align: right;
          color: #374151;">
          ${item.total ? `Rs. ${Number(item.total)
            .toLocaleString('en-PK')}` : '—'}
        </td>
      </tr>
    `).join('')

    const formatDate = (iso: string) => {
      return new Date(iso).toLocaleString('en-PK', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Karachi',
      })
    }

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>New Order — ${escapeHtml(order_ref)}</title>
</head>
<body style="margin:0; padding:0;
  font-family: Arial, sans-serif;
  background: #f3f4f6;">

  <div style="max-width: 600px; margin: 0 auto;
    padding: 24px 16px;">

    <!-- Header -->
    <div style="background: #073d25; border-radius: 12px 12px 0 0;
      padding: 24px; text-align: center;">
      <h1 style="margin: 0; color: #e4aa2a;
        font-size: 20px; letter-spacing: 0.1em;">
        AHWMB
      </h1>
      <p style="margin: 4px 0 0; color: #b8f0d4;
        font-size: 13px;">
        Adam Haji Wali Muhammad & Brothers
      </p>
    </div>

    <!-- Alert bar -->
    <div style="background: #e4aa2a; padding: 14px 24px;">
      <p style="margin: 0; font-size: 18px;
        font-weight: 900; color: #073d25; text-align: center;">
        🛒 New Order Received!
      </p>
    </div>

    <!-- Body -->
    <div style="background: #fff; padding: 24px;
      border: 1px solid #e5e7eb; border-top: none;">

      <!-- Order ref + date -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="border-collapse: collapse; margin-bottom: 20px;
        border-bottom: 2px solid #f3f4f6;">
        <tr>
        <td valign="top" style="padding: 0 12px 16px 0;">
          <p style="margin: 0 0 4px; font-size: 12px;
            color: #9ca3af; font-weight: 700;
            text-transform: uppercase;">Order Reference</p>
          <p style="margin: 0; font-size: 22px;
            font-weight: 900; color: #073d25;">
            ${escapeHtml(order_ref)}
          </p>
        </td>
        <td valign="top" align="right" style="padding: 0 0 16px 12px; text-align: right;">
          <p style="margin: 0 0 4px; font-size: 12px;
            color: #9ca3af; font-weight: 700;
            text-transform: uppercase;">Date & Time</p>
          <p style="margin: 0; font-size: 15px;
            font-weight: 700; color: #374151;">
            ${formatDate(created_at)}
          </p>
        </td>
        </tr>
      </table>

      <!-- Customer info -->
      <div style="background: #f0faf5; border-radius: 10px;
        padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 10px; font-size: 13px;
          font-weight: 900; color: #0a5533;
          text-transform: uppercase; letter-spacing: 0.05em;">
          Customer Details
        </p>
        <p style="margin: 0 0 6px; font-size: 20px;
          font-weight: 900; color: #073d25;">
          ${escapeHtml(customer_name)}
        </p>
        <p style="margin: 0 0 4px; font-size: 15px;
          color: #374151;">
          📞 ${escapeHtml(customer_phone)}
        </p>
        <p style="margin: 0; font-size: 15px; color: #374151;">
          📍 ${escapeHtml(customer_address)}
        </p>
        ${location_link && /^https:\/\//i.test(location_link) ? `
        <p style="margin: 8px 0 0;">
          <a href="${escapeHtml(location_link)}"
            style="color: #0d6b40; font-weight: 700;
            font-size: 14px;">
            🗺 Open Map Location
          </a>
        </p>` : ''}
      </div>

      <!-- Items table -->
      <p style="margin: 0 0 10px; font-size: 13px;
        font-weight: 900; color: #374151;
        text-transform: uppercase; letter-spacing: 0.05em;">
        Order Items (${items.length})
      </p>
      <table style="width: 100%; border-collapse: collapse;
        margin-bottom: 20px; border: 1px solid #e5e7eb;
        border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: #f0faf5;">
            <th style="padding: 10px 12px; text-align: left;
              font-size: 12px; color: #0a5533;
              font-weight: 900; text-transform: uppercase;">
              #
            </th>
            <th style="padding: 10px 12px; text-align: left;
              font-size: 12px; color: #0a5533;
              font-weight: 900; text-transform: uppercase;">
              Item
            </th>
            <th style="padding: 10px 12px; text-align: left;
              font-size: 12px; color: #0a5533;
              font-weight: 900; text-transform: uppercase;">
              Qty
            </th>
            <th style="padding: 10px 12px; text-align: right;
              font-size: 12px; color: #0a5533;
              font-weight: 900; text-transform: uppercase;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Grand total -->
      <div style="background: #073d25; border-radius: 10px;
        padding: 16px 20px; text-align: right;
        margin-bottom: 24px;">
        <span style="color: #b8f0d4; font-size: 14px;
          font-weight: 700;">Grand Total</span>
        <span style="color: #e4aa2a; font-size: 28px;
          font-weight: 900; margin-left: 16px;">
          Rs. ${Number(grand_total).toLocaleString('en-PK')}
        </span>
      </div>

      <!-- Action note -->
      <div style="background: #fef9c3; border: 1px solid #fde047;
        border-radius: 8px; padding: 14px 16px;">
        <p style="margin: 0; font-size: 14px;
          color: #854d0e; font-weight: 700;">
          ⚡ Action Required: Log in to the admin panel
          to review and price this order.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #f9fafb; border-radius: 0 0 12px 12px;
      border: 1px solid #e5e7eb; border-top: none;
      padding: 16px 24px; text-align: center;">
      <p style="margin: 0; font-size: 13px; color: #9ca3af;">
        AHWMB Customer Order Portal · Jodia Bazaar, Karachi
      </p>
      <p style="margin: 4px 0 0; font-size: 12px;
        color: #d1d5db;">
        This is an automated notification.
        Do not reply to this email.
      </p>
    </div>

  </div>
</body>
</html>`

    // Send via Resend
    if (!RESEND_API_KEY) {
      console.warn('[AHWMB] RESEND_API_KEY not set — ' +
        'email notification skipped')
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'RESEND_API_KEY not configured'
        }),
        { status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    const toEmails = [NOTIFY_TO_EMAIL]
    if (NOTIFY_CC_EMAIL) toEmails.push(NOTIFY_CC_EMAIL)

    const resendResponse = await fetch(
      'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Idempotency-Key': `new-order/${order.id}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `AHWMB Orders <${NOTIFY_FROM_EMAIL}>`,
        to: toEmails,
        subject: `🛒 New Order ${escapeHtml(order_ref)} — ${escapeHtml(customer_name)}`,
        html: emailHtml,
        tags: [
          { name: 'order_ref', value: String(order_ref).replace(/[^a-zA-Z0-9_-]/g, '') },
          { name: 'source', value: 'ahwmb_portal' }
        ]
      }),
    })

    if (!resendResponse.ok) {
      const errText = await resendResponse.text()
      console.error('[AHWMB] Resend error:', errText)
      return new Response(
        JSON.stringify({ success: false, error: errText }),
        { status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[AHWMB] Notification function error:', err)
    return new Response(
      JSON.stringify({
        success: false,
        error: String(err)
      }),
      { status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  }
})
