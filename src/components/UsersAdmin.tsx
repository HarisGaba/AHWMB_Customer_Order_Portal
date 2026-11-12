import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PERMISSIONS, permissionLabel, type Permission } from '../lib/access'

type AppUser = { user_id: string; email: string; name: string; permissions: Permission[]; active: boolean; created_at: string; last_sign_in_at: string | null }
type Draft = { user_id?: string; email: string; name: string; password: string; permissions: Permission[]; active: boolean }

const emptyDraft = (): Draft => ({ email: '', name: '', password: '', permissions: [], active: true })
const errorText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

async function callManageUsers<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  // Edge-function errors carry the JSON body in error.context; surface its message.
  if (error) {
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') message = (await ctx.json())?.error || message
    } catch { /* keep generic message */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

/** Main admin only: list, create, edit and delete staff logins and their page access. */
export function UsersAdmin() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'error' } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    try {
      const { users } = await callManageUsers<{ users: AppUser[] }>({ action: 'list' })
      setUsers(users)
    } catch (e) {
      setMessage({ text: `Could not load users: ${errorText(e)}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // Live: changes made on another device show up here too.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel(`users-admin-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users' }, () => void load())
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [load])

  const togglePermission = (key: Permission) => setDraft(d => d && ({
    ...d, permissions: d.permissions.includes(key) ? d.permissions.filter(p => p !== key) : [...d.permissions, key],
  }))

  const save = async () => {
    if (!draft || saving) return
    const creating = !draft.user_id
    setFormError('')
    if (creating && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return setFormError('Enter a valid email address.')
    if ((creating || draft.password) && draft.password.length < 12) return setFormError('Password must be at least 12 characters.')
    if (!draft.permissions.length) return setFormError('Select at least one page this user can open.')
    setSaving(true)
    try {
      if (creating) {
        await callManageUsers({ action: 'create', email: draft.email.trim(), password: draft.password, name: draft.name, permissions: draft.permissions })
        setMessage({ text: `✓ Created ${draft.email.trim()}. They can log in now.`, type: 'ok' })
      } else {
        await callManageUsers({ action: 'update', user_id: draft.user_id, name: draft.name, permissions: draft.permissions, active: draft.active, ...(draft.password ? { password: draft.password } : {}) })
        setMessage({ text: `✓ Updated ${draft.email}${draft.password ? ' (password changed)' : ''}.`, type: 'ok' })
      }
      setDraft(null)
      await load()
    } catch (e) {
      setFormError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (user: AppUser) => {
    if (!window.confirm(`Delete ${user.email}?\n\nThey will no longer be able to log in. This cannot be undone.`)) return
    try {
      await callManageUsers({ action: 'delete', user_id: user.user_id })
      setMessage({ text: `✓ Deleted ${user.email}.`, type: 'ok' })
      await load()
    } catch (e) {
      setMessage({ text: `Could not delete: ${errorText(e)}`, type: 'error' })
    }
  }

  const areas = ['Portal', 'System', 'POS'] as const

  return <section className="panel report-panel users-panel">
    <div className="report-heading">
      <div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading"><Users size={24} /> Users</h2>
        <p className="panel-sub">Create staff logins and choose exactly which pages each person can open.</p></div>
      <button type="button" className="btn-submit report-add" onClick={() => { setFormError(''); setDraft(emptyDraft()) }}><UserPlus size={17} /> Create User</button>
    </div>
    {message && <p className={`stock-message stock-message--${message.type}`} role="status">{message.text}</p>}

    <div className="report-table-wrap"><table className="report-table users-table"><thead><tr><th>Email</th><th>Name / Role</th><th>Allowed Pages</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>
      <tr className="users-main-admin"><td data-label="Email"><strong>ahwmb1965@gmail.com</strong></td><td data-label="Name / Role">Main Admin</td><td data-label="Allowed Pages"><span className="perm-chip perm-chip--all">All pages + Users</span></td><td data-label="Status"><span className="user-status user-status--on">Active</span></td><td data-label="Actions" className="stock-row-actions"><small>Owner</small></td></tr>
      {loading && <tr><td colSpan={5} className="stock-empty">Loading users…</td></tr>}
      {!loading && users.length === 0 && <tr><td colSpan={5} className="stock-empty">No staff users yet. Click “Create User”.</td></tr>}
      {users.map(u => <tr key={u.user_id}>
        <td data-label="Email"><strong>{u.email}</strong>{u.last_sign_in_at && <small className="user-last-login">Last login {new Date(u.last_sign_in_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</small>}</td>
        <td data-label="Name / Role">{u.name || '—'}</td>
        <td data-label="Allowed Pages"><div className="perm-chips">{u.permissions.length ? u.permissions.map(p => <span key={p} className="perm-chip">{permissionLabel(p)}</span>) : <span className="perm-chip perm-chip--none">No pages</span>}</div></td>
        <td data-label="Status"><span className={`user-status ${u.active ? 'user-status--on' : 'user-status--off'}`}>{u.active ? 'Active' : 'Disabled'}</span></td>
        <td data-label="Actions" className="stock-row-actions">
          <button type="button" className="ledger-edit-btn" onClick={() => { setFormError(''); setDraft({ user_id: u.user_id, email: u.email, name: u.name, password: '', permissions: u.permissions, active: u.active }) }}><Pencil size={14} /> Edit</button>
          <button type="button" className="ledger-delete-btn" onClick={() => void remove(u)} aria-label={`Delete ${u.email}`}><Trash2 size={14} /></button>
        </td>
      </tr>)}
    </tbody></table></div>

    {draft && <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={draft.user_id ? 'Edit user' : 'Create user'} onClick={e => { if (e.target === e.currentTarget && !saving) setDraft(null) }}>
      <form className="user-modal" onSubmit={e => { e.preventDefault(); void save() }}>
        <div className="user-modal-head">
          <h3>{draft.user_id ? <><Pencil size={18} /> Edit {draft.email}</> : <><Plus size={18} /> Create User</>}</h3>
          <button type="button" className="install-banner-dismiss" onClick={() => setDraft(null)} disabled={saving} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="user-modal-grid">
          <label className="field"><span className="field-label">Email</span>
            <input className="field-input" type="email" dir="ltr" autoComplete="off" value={draft.email} disabled={!!draft.user_id} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="name@example.com" /></label>
          <label className="field"><span className="field-label">Name / Role</span>
            <input className="field-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Haris (Stock)" /></label>
          <label className="field user-modal-wide"><span className="field-label"><KeyRound size={14} /> {draft.user_id ? 'New password (leave empty to keep current)' : 'Password'}</span>
            <input className="field-input" type="text" dir="ltr" autoComplete="new-password" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} placeholder="At least 12 characters" /></label>
        </div>
        <div className="user-perms">
          <span className="field-label">Allowed pages</span>
          {areas.map(area => <fieldset key={area} className="user-perm-group">
            <legend>{area === 'Portal' ? 'Customer Order Portal' : area === 'System' ? 'Admin System (reports & management)' : 'POS billing'}</legend>
            {PERMISSIONS.filter(p => p.area === area).map(p => <label key={p.key} className="user-perm">
              <input type="checkbox" checked={draft.permissions.includes(p.key)} onChange={() => togglePermission(p.key)} /> {p.label}
            </label>)}
          </fieldset>)}
        </div>
        {draft.user_id && <label className="user-perm user-active"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /> Account active (untick to block this login without deleting it)</label>}
        {formError && <p className="stock-message stock-message--error" role="alert">{formError}</p>}
        <div className="user-modal-actions">
          <button type="button" className="btn-secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-submit" disabled={saving}>{saving ? 'Saving…' : draft.user_id ? 'Save Changes' : 'Create User'}</button>
        </div>
      </form>
    </div>}
  </section>
}

/** Shown when a user opens a page they were not given. */
export function AccessDenied({ onBack }: { onBack?: () => void }) {
  return <section className="panel report-panel access-denied">
    <h2 className="admin-heading">Access denied</h2>
    <p className="panel-sub">Your account does not have permission to open this page. Ask the admin if you need access.</p>
    {onBack && <button type="button" className="btn-secondary" onClick={onBack}>← Back</button>}
  </section>
}
