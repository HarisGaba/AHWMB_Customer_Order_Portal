/**
 * Add Commission: exact calculation + the order data embedded in order PDFs.
 *
 * Money is handled as whole numbers so nothing drifts:
 *   line total  -> paisa (1/100 rupee)
 *   rate        -> thousandths of a percent (5.5% = 5500)
 *   commission  = paisa × rate ÷ 100000  -> kept exactly as "units of 1e-7 rupee" (paisa × rate)
 */
export type CommissionLine = { name: string; quantity: string; rate: number; total: number }
export type CommissionOrder = { customer: string; date: string; ref?: string; lines: CommissionLine[] }

export type CalculatedLine = CommissionLine & { commission: number; after: number }
export type CommissionResult = {
  lines: CalculatedLine[]
  grandTotal: number        // sum of line totals
  totalCommission: number   // sum of commissions
  grandAfter: number        // sum after percentage
  remaining: number         // grandAfter + balance - deposit
}

const PER_RUPEE = 10_000_000 // exact unit = paisa × rate(thousandths) = 1e-2 × 1e-3 × 1e-2 rupee

const toPaisa = (v: number) => Math.round(Number((Math.abs(Number(v) || 0) * 100).toPrecision(15))) * (Number(v) < 0 ? -1 : 1)
const toRateUnits = (pct: number) => Math.round(Number(((Number(pct) || 0) * 1000).toPrecision(15)))

/** Round an exact value (in 1e-7 rupee units) to `dp` decimals, half away from zero. */
const fromUnits = (units: number, dp: number) => {
  const step = PER_RUPEE / 10 ** dp
  const r = Math.round(Math.abs(units) / step) * step
  return (units < 0 ? -r : r) / PER_RUPEE
}

export function calculateCommission(lines: CommissionLine[], ratePercent: number, balance = 0, deposit = 0): CommissionResult {
  const rate = toRateUnits(ratePercent)
  let sumTotal = 0, sumCommission = 0
  const out = lines.map(l => {
    const paisa = toPaisa(l.total)
    const commissionUnits = paisa * rate               // exact integer
    sumTotal += paisa * 100_000                        // paisa -> units
    sumCommission += commissionUnits
    return {
      ...l,
      commission: fromUnits(commissionUnits, 3),
      after: fromUnits(paisa * 100_000 + commissionUnits, 2),
    }
  })
  const grandAfterUnits = sumTotal + sumCommission
  return {
    lines: out,
    grandTotal: fromUnits(sumTotal, 2),
    totalCommission: fromUnits(sumCommission, 2),
    grandAfter: fromUnits(grandAfterUnits, 2),
    remaining: fromUnits(grandAfterUnits + toPaisa(balance) * 100_000 - toPaisa(deposit) * 100_000, 2),
  }
}

/** "5.5" -> "5.5%", "5" -> "5%" */
export const ratePercentLabel = (pct: number) => `${Number((Number(pct) || 0).toFixed(3))}%`

/** Whole rupees with thousands separators, like the sample invoice: 13,187.5 -> "13,188". */
export const rupees = (v: number) => Math.round(Number(v) || 0).toLocaleString('en-US')
/** Up to `dp` decimals, no trailing zeros: 687.5 -> "687.5", 3887.125 -> "3,887.125". */
export const decimal = (v: number, dp = 3) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: dp })

// ---------- Order data embedded in order PDFs ----------
const TAG = 'AHWMB-ORDER:'

const b64encode = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)))

/** Text placed in the PDF's Keywords property (ASCII only, survives PDF compression). */
export function encodeOrderTag(order: CommissionOrder) {
  return TAG + b64encode(JSON.stringify({ v: 1, ...order }))
}

/** Read the order back from an order PDF made by this app. Returns null if the PDF has no tag. */
export function readOrderTag(pdfBytes: ArrayBuffer | Uint8Array): CommissionOrder | null {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes)
  let text = ''
  for (let i = 0; i < bytes.length; i += 65536) text += String.fromCharCode(...bytes.subarray(i, i + 65536))
  const match = text.match(/AHWMB-ORDER:([A-Za-z0-9+/=]+)/)
  if (!match) return null
  try {
    const data = JSON.parse(b64decode(match[1]))
    if (!data || !Array.isArray(data.lines)) return null
    return {
      customer: String(data.customer ?? ''),
      date: String(data.date ?? ''),
      ref: data.ref ? String(data.ref) : undefined,
      lines: data.lines.map((l: Record<string, unknown>) => ({
        name: String(l.name ?? ''), quantity: String(l.quantity ?? ''),
        rate: Number(l.rate) || 0, total: Number(l.total) || 0,
      })),
    }
  } catch {
    return null
  }
}
