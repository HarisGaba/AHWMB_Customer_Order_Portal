/**
 * One date style everywhere: dd/mm/yyyy (e.g. 21/11/2026), time as hh:mm am/pm.
 * Date-only values ("2026-11-21") are read as calendar dates, so they never shift by a day.
 * Display only: stored values are not changed.
 */
const pad = (n: number) => String(n).padStart(2, '0')

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 21/11/2026 */
export function ddmmyyyy(value: string | Date | null | undefined): string {
  const d = toDate(value)
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : String(value ?? '')
}

/** 21/11/2026, 08:14 pm */
export function ddmmyyyyTime(value: string | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return String(value ?? '')
  const h = d.getHours()
  return `${ddmmyyyy(d)}, ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}
