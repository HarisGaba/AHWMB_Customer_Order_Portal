// ═══════════════════════════════════════════════════
// AHWMB — User management (main admin only)
// ═══════════════════════════════════════════════════
// Creating logins and changing passwords needs the service-role key, which must never
// be in the browser, so the Users page calls this function. Only the main admin
// (is_ahwmb_admin) may use it. The main admin's own account cannot be edited here.
//
// POST { action: 'list' }
// POST { action: 'create', email, password, name, permissions }
// POST { action: 'update', user_id, name?, permissions?, active?, password? }
// POST { action: 'delete', user_id }
//
// Deploy: supabase functions deploy manage-users
// ═══════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const MAIN_ADMIN = 'ahwmb1965@gmail.com'

// Must match src/lib/access.ts and the has_perm() checks in the database.
const PERMISSIONS = new Set([
  'orders', 'daily_report', 'customer_report', 'add_customer', 'stock_report', 'stock_transfer',
  'purchase_report', 'products', 'pos_billing', 'pos_items', 'pos_summary',
])

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (message: string, status = 400) => json({ error: message }, status)

const cleanPermissions = (value: unknown) =>
  Array.isArray(value) ? [...new Set(value.filter((p): p is string => typeof p === 'string' && PERMISSIONS.has(p)))] : []
const validEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
// Matches the project's sign-in rules (minimum 12 characters).
const validPassword = (v: unknown): v is string => typeof v === 'string' && v.length >= 12 && v.length <= 72

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Method not allowed', 405)

  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return fail('Not authorized', 401)
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
    const { data: isAdmin, error: adminError } = await caller.rpc('is_ahwmb_admin')
    if (adminError || isAdmin !== true) return fail('Only the main admin can manage users', 403)

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const body = await req.json().catch(() => ({}))
    const action = body?.action

    const findUser = async (userId: unknown) => {
      if (typeof userId !== 'string') return null
      const { data } = await db.auth.admin.getUserById(userId)
      return data?.user ?? null
    }

    if (action === 'list') {
      const users: { id: string; email?: string; created_at: string; last_sign_in_at?: string }[] = []
      for (let page = 1; ; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        users.push(...data.users)
        if (data.users.length < 200) break
      }
      const { data: rows, error } = await db.from('app_users').select('*')
      if (error) throw error
      const byId = new Map((rows || []).map(r => [r.user_id, r]))
      return json({
        users: users
          .filter(u => (u.email || '').toLowerCase() !== MAIN_ADMIN)
          .map(u => {
            const row = byId.get(u.id)
            return {
              user_id: u.id,
              email: u.email || '',
              name: row?.name || '',
              permissions: row?.permissions || [],
              active: row ? row.active : false,
              created_at: u.created_at,
              last_sign_in_at: u.last_sign_in_at || null,
            }
          })
          .sort((a, b) => a.email.localeCompare(b.email)),
      })
    }

    if (action === 'create') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!validEmail(email)) return fail('Enter a valid email address')
      if (email === MAIN_ADMIN) return fail('That is the main admin account')
      if (!validPassword(body.password)) return fail('Password must be at least 12 characters')
      const permissions = cleanPermissions(body.permissions)
      if (!permissions.length) return fail('Select at least one page')
      const { data, error } = await db.auth.admin.createUser({ email, password: body.password, email_confirm: true })
      if (error) return fail(error.message.includes('already') ? 'A user with this email already exists' : error.message)
      const { error: rowError } = await db.from('app_users').insert({
        user_id: data.user.id, email, name: typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '', permissions,
      })
      if (rowError) {
        await db.auth.admin.deleteUser(data.user.id) // don't leave a login without permissions
        throw rowError
      }
      return json({ success: true, user_id: data.user.id })
    }

    if (action === 'update') {
      const user = await findUser(body.user_id)
      if (!user) return fail('User not found', 404)
      if ((user.email || '').toLowerCase() === MAIN_ADMIN) return fail('The main admin account cannot be changed here')
      if (body.password !== undefined && body.password !== '') {
        if (!validPassword(body.password)) return fail('Password must be at least 12 characters')
        const { error } = await db.auth.admin.updateUserById(user.id, { password: body.password })
        if (error) throw error
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), email: user.email }
      if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 80)
      if (body.permissions !== undefined) patch.permissions = cleanPermissions(body.permissions)
      if (typeof body.active === 'boolean') patch.active = body.active
      const { error } = await db.from('app_users').upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
      if (error) throw error
      // A disabled user loses all data access at once (has_perm checks "active"), and the
      // app signs them out as soon as it sees the change.
      return json({ success: true })
    }

    if (action === 'delete') {
      const user = await findUser(body.user_id)
      if (!user) return fail('User not found', 404)
      if ((user.email || '').toLowerCase() === MAIN_ADMIN) return fail('The main admin account cannot be deleted')
      const { error } = await db.auth.admin.deleteUser(user.id) // app_users row is removed by cascade
      if (error) throw error
      return json({ success: true })
    }

    return fail('Unknown action')
  } catch (err) {
    console.error('[AHWMB] manage-users error:', err)
    return fail(String((err as { message?: string })?.message || err), 500)
  }
})
