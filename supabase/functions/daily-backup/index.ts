// ═══════════════════════════════════════════════════
// AHWMB — Data Backup (order portal + POS)
// ═══════════════════════════════════════════════════
//
// Two ways in:
// 1. Nightly (pg_cron): POST with header x-backup-secret = BACKUP_SECRET.
//    Emails the full backup as a JSON attachment to ahwmb1965@gmail.com,
//    so a copy survives even if this Supabase project is lost.
// 2. Admin "Download Backup" button: POST with the admin's login token.
//    Returns the backup JSON directly.
//
// Secrets: BACKUP_SECRET, RESEND_API_KEY, NOTIFY_FROM_EMAIL
// Deploy:  supabase functions deploy daily-backup --no-verify-jwt
//          (the function checks the secret / admin token itself)
// ═══════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const BACKUP_SECRET = Deno.env.get('BACKUP_SECRET') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL = Deno.env.get('NOTIFY_FROM_EMAIL') || ''
const TO_EMAIL = 'ahwmb1965@gmail.com'

// Business data only (push_subscriptions are device keys and are recreated automatically).
const TABLES = [
  'orders', 'order_items', 'customers', 'customer_ledger', 'products', 'daily_expenses',
  'stock_items', 'stock_transfers', 'items', 'sales',
]

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Constant-time compare so the secret can't be guessed by timing. */
function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function isAdmin(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return false
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data, error } = await userClient.rpc('is_ahwmb_admin')
  return !error && data === true
}

async function buildBackup() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const table of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select('*').range(from, from + 999)
      if (error) throw new Error(`${table}: ${error.message}`)
      rows.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    tables[table] = rows
    counts[table] = rows.length
  }
  return { app: 'AHWMB', created_at: new Date().toISOString(), counts, tables }
}

const karachiDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) // yyyy-mm-dd

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  try {
    const fromCron = safeEqual(req.headers.get('x-backup-secret') || '', BACKUP_SECRET)
    if (!fromCron && !(await isAdmin(req.headers.get('Authorization')))) {
      return json({ error: 'Not authorized' }, 401)
    }

    const backup = await buildBackup()
    if (!fromCron) return json(backup)

    if (!RESEND_API_KEY || !FROM_EMAIL) return json({ error: 'Email service is not configured' }, 503)
    const date = karachiDate()
    const summary = Object.entries(backup.counts).map(([t, n]) => `<tr><td style="padding:4px 12px 4px 0">${t}</td><td style="text-align:right">${n}</td></tr>`).join('')
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `backup/${date}` },
      body: JSON.stringify({
        from: `AHWMB Backup <${FROM_EMAIL}>`,
        to: [TO_EMAIL],
        subject: `🗄️ AHWMB daily backup — ${date}`,
        html: `<div style="font-family:Arial,sans-serif;color:#073d25">
          <h2 style="margin:0 0 8px">AHWMB daily backup</h2>
          <p style="margin:0 0 12px;color:#374151">The attached file is a full copy of the order portal and POS data for ${date}. Keep these emails — they are your backup.</p>
          <table style="font-size:14px;color:#374151">${summary}</table></div>`,
        attachments: [{ filename: `ahwmb-backup-${date}.json`, content: toBase64(JSON.stringify(backup)) }],
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      console.error('[AHWMB] Backup email failed:', detail)
      return json({ error: 'Backup email failed', detail }, 502)
    }
    return json({ success: true, counts: backup.counts })
  } catch (err) {
    console.error('[AHWMB] Backup error:', err)
    return json({ error: String(err) }, 500)
  }
})
