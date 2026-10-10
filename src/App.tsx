import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  AlertCircle, Check, ChevronDown, FileDown, Info, Languages, LogIn, LogOut,
  MapPin, MessageCircle, Navigation, PackageCheck, Phone, Plus,
  ReceiptText, RefreshCw, Send, ShoppingBag, Trash2, UserRound, X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { calculateLineTotal, PRODUCT_CATALOG, sumLineTotals, type CatalogProduct } from './lib/pricing'

// ─── Constants ────────────────────────────────────────────────────────────────
const ADMIN_EMAILS = ['ahmedyounus1978@gmail.com', 'ahwmb1965@gmail.com']
const SHOPKEEPER_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || import.meta.env.VITE_SHOPKEEPER_WHATSAPP || '923001234567'

// ─── Types ────────────────────────────────────────────────────────────────────
type Language = 'en' | 'ur'
type UnitType = 'KG' | 'GRAMS' | 'PCS'
type OrderRow = { id: string; itemName: string; quantityValue: string; unitType: UnitType }
type OrderItem = {
  sr: number
  name: string
  quantity: string
  quantity_value: number
  unit_type: UnitType
  rate: number
  unit_price: number
  total: number
}
type OrderRecord = {
  id: string
  order_ref: string
  customer_name: string
  customer_phone: string
  customer_address: string
  location_link?: string | null
  items: OrderItem[]
  status: 'pending' | 'completed'
  grand_total: number
  total_amount?: number | null
  balance?: number | null
  total_balance?: number | null
  deposit?: number | null
  remaining_balance?: number | null
  created_at: string
}
type FormErrors = Partial<Record<'name' | 'phone' | 'address' | 'items', string>>
type ToastType = 'success' | 'error' | 'info'
type Toast = { id: string; message: string; type: ToastType }

// ─── Unit Options ─────────────────────────────────────────────────────────────
const UNIT_OPTIONS: { value: UnitType; en: string; ur: string }[] = [
  { value: 'KG', en: 'KG', ur: 'کلو' },
  { value: 'GRAMS', en: 'Grams', ur: 'گرام' },
  { value: 'PCS', en: 'Packet / Piece', ur: 'پیکٹ / عدد' },
]

// ─── Pure helpers ─────────────────────────────────────────────────────────────
const createRow = (): OrderRow => ({ id: crypto.randomUUID(), itemName: '', quantityValue: '', unitType: 'KG' })
const createDefaultRows = () => Array.from({ length: 8 }, createRow)

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  return digits.startsWith('0') ? `92${digits.slice(1)}` : digits
}
const validPhone = (value: string) => /^923\d{9}$/.test(normalizePhone(value))

const formatMoney = (value: number) => `Rs. ${Math.round(value || 0).toLocaleString('en-PK')}`

const readableError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const details = [value.message, value.details, value.hint, value.code]
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .map(String)
    if (details.length) return details.join(' — ')
    try { return JSON.stringify(error) } catch { /* fall through */ }
  }
  return String(error || 'Unknown error')
}

const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))

const formatDateShort = (value: string | Date) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(value))

const createOrderRef = () => `#AHWMB-${Math.floor(100 + Math.random() * 900)}`
const isAdminEmail = (email?: string | null) => ADMIN_EMAILS.includes((email || '').toLowerCase())
const parseQuantity = (value: string) => {
  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}
const parseUnit = (value: string): UnitType =>
  /gram|g\b|گرام/i.test(value) ? 'GRAMS'
  : /packet|pack|pcs|piece|پیکٹ|عدد/i.test(value) ? 'PCS'
  : 'KG'

const unitLabel = (unit: UnitType, language: Language) =>
  UNIT_OPTIONS.find(o => o.value === unit)?.[language === 'ur' ? 'ur' : 'en'] || unit

const quantityText = (value: number, unit: UnitType, language: Language) =>
  `${value || 0} ${unitLabel(unit, language)}`

const pdfQuantityText = (value: number, unit: UnitType) => {
  const qty = Number.isInteger(value) ? value : Number(value.toFixed(3))
  const label = unit === 'KG' ? 'kg' : unit === 'GRAMS' ? 'grams' : 'pieces'
  return `${qty} ${label}`
}

const unitRateLabel = (unit: UnitType) =>
  unit === 'PCS' ? 'Per Piece' : 'Per KG'

const safeItems = (items: unknown): OrderItem[] => {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const v = item as Partial<OrderItem>
    const rawQuantity = String(v.quantity || '')
    const quantityValue = Number(v.quantity_value) || parseQuantity(rawQuantity)
    const rawUnit = v.unit_type
    const unitType: UnitType = rawUnit === 'KG' || rawUnit === 'GRAMS' || rawUnit === 'PCS'
      ? rawUnit : parseUnit(rawQuantity)
    const unitPrice = Number(v.unit_price ?? v.rate) || 0
    const total = unitType === 'GRAMS'
      ? calculateLineTotal({ quantity_value: quantityValue, unit_type: unitType, unit_price: unitPrice, rate: unitPrice })
      : v.total !== undefined && v.total !== null && Number.isFinite(Number(v.total))
      ? Number(v.total)
      : calculateLineTotal({ quantity_value: quantityValue, unit_type: unitType, unit_price: unitPrice, rate: unitPrice })
    return {
      sr: Number(v.sr) || index + 1,
      name: String(v.name || ''),
      quantity: rawQuantity || `${quantityValue} ${unitType}`,
      quantity_value: quantityValue,
      unit_type: unitType,
      rate: unitPrice,
      unit_price: unitPrice,
      total,
    }
  }).filter(item => item.name || item.quantity)
}

// ─── Copy / i18n ──────────────────────────────────────────────────────────────
const copy = {
  en: {
    brand: 'Customer Order Portal', company: 'Adam Haji Wali Muhammad & Brothers',
    easy: 'Easy Order', switch: 'اردو',
    login: 'Login', logout: 'Logout',
    welcome: 'Place Your Order', subtitle: 'Send your grocery order to the shopkeeper in a few simple steps.',
    customer: 'Customer Details', customerSub: 'Name, mobile number, and delivery address',
    name: 'Full Name', phone: 'Phone Number', address: 'Delivery Address',
    namePh: 'Enter your full name', phonePh: '0300-1234567', addressPh: 'Enter your complete home address',
    location: 'Pin / Current Location', locationPh: 'Paste a Google Maps link or use the button',
    locate: 'Share Location', locating: 'Finding...', locationReady: 'Location ready',
    locationError: 'Permission denied. Paste a Maps link instead.',
    items: 'Order Items', itemsSub: 'Select unit and enter quantity. Admin fills in the price.',
    number: 'No.', item: 'Item Name', quantity: 'Qty', unit: 'Unit', rate: 'Rate', total: 'Total',
    locked: 'Admin only', itemPh: 'e.g. Rice, Sugar', quantityPh: 'Quantity',
    quantityHelp: 'Weight rates use the per-KG price: grams are converted to kilograms · pieces use per-piece price',
    delete: 'Remove', add: '+ Add Item', rows: (n: number) => `${n} rows`,
    notes: 'Additional Notes', notesSub: 'Extra instructions or items', notesLabel: 'Notes',
    notesPh: 'Extra item or delivery instructions…',
    clear: 'Clear order', submit: 'Submit Order', submitting: 'Saving…',
    success: 'Order Submitted!', ref: 'Your order reference',
    send: 'Send via WhatsApp', adminTitle: 'Shopkeeper Dashboard',
    loginTitle: 'Admin Login', loginSub: 'Sign in to manage orders and print invoices.',
    email: 'Email', password: 'Password', signIn: 'Sign In', signingIn: 'Signing in…',
    back: 'Back to Customer Portal',
    orders: 'Orders', pending: 'Pending', completed: 'Completed', all: 'All',
    noOrders: 'No orders yet.', select: 'Select an order to start pricing.',
    price: 'Invoice Editor', priceSub: 'Enter the per-KG price for KG or grams, and the per-piece price for pieces. Example: 250 g at Rs 1,600/kg = Rs 400.',
    unitPrice: 'Rate (per KG / gram / piece)', lineTotal: 'Total', editTotal: 'You can manually override line totals',
    addAdmin: 'Add Item', remove: 'Remove',
    savePrint: 'Save & Print Invoice', sharePdf: 'Share PDF File', balance: 'Balance', deposit: 'Deposit', remaining: 'Remaining Balance', saving: 'Generating PDF…', refresh: 'Refresh',
    grand: 'Grand Total', status: 'Status', created: 'Date',
    customerLabel: 'Customer', delivery: 'Address', itemCount: 'items',
    openLocation: 'Open map', riderWhatsApp: 'Send to rider',
    successHint: 'The shopkeeper can now see your order.',
    errors: {
      name: 'Please enter your name.',
      phone: 'Enter a valid Pakistani mobile number (03xx-xxxxxxx).',
      address: 'Please enter your delivery address.',
      items: 'Fill in item name and quantity for every row you use.',
      setup: 'Supabase is not configured for this preview.',
      submit: 'Order could not be saved. Please try again.',
      login: 'Login failed. Check your email and password.',
      permission: 'This account is not authorized as shopkeeper.',
      save: 'Invoice could not be saved.',
    },
    confirm: 'Clear the entire order?',
    whatsapp: 'AHWMB CUSTOMER ORDER',
    pdfName: 'ahwmb-sales-invoice',
    footer: 'AHWMB Customer Order Portal',
    cash: 'Cash on Delivery',
  },
  ur: {
    brand: 'کسٹمر آرڈر پورٹل', company: 'آدم حاجی ولی محمد اینڈ برادرز',
    easy: 'آسان آرڈر', switch: 'English',
    login: 'لاگ ان', logout: 'لاگ آؤٹ',
    welcome: 'اپنا آرڈر بھیجیں', subtitle: 'چند آسان مراحل میں اپنا سامان دکاندار کو بھیجیں۔',
    customer: 'گاہک کی معلومات', customerSub: 'نام، موبائل اور ترسیل کا پتہ',
    name: 'پورا نام', phone: 'موبائل نمبر', address: 'ترسیل کا پتہ',
    namePh: 'اپنا پورا نام لکھیں', phonePh: '0300-1234567', addressPh: 'گھر کا مکمل پتہ لکھیں',
    location: 'پن / موجودہ مقام', locationPh: 'گوگل میپس کا لنک لکھیں یا بٹن دبائیں',
    locate: 'مقام بھیجیں', locating: 'تلاش…', locationReady: 'مقام تیار ہے',
    locationError: 'اجازت نہیں ملی، میپس کا لنک لکھیں۔',
    items: 'آرڈر کی فہرست', itemsSub: 'اکائی منتخب کریں اور مقدار لکھیں۔ دکاندار قیمت ڈالے گا۔',
    number: 'نمبر', item: 'سامان', quantity: 'مقدار', unit: 'اکائی', rate: 'قیمت', total: 'کل',
    locked: 'صرف دکاندار', itemPh: 'مثلاً چاول، چینی', quantityPh: 'مقدار',
    quantityHelp: 'کلو اور گرام دونوں کے لیے فی کلو قیمت ہوگی، گرام خود کلو میں تبدیل ہوں گے · عدد کی فی عدد قیمت',
    delete: 'حذف کریں', add: '+ سامان شامل کریں', rows: (n: number) => `${n} قطاریں`,
    notes: 'اضافی نوٹس', notesSub: 'اضافی ہدایات یا سامان', notesLabel: 'نوٹس',
    notesPh: 'کوئی اضافی سامان یا ترسیل کی ہدایت…',
    clear: 'آرڈر صاف کریں', submit: 'آرڈر جمع کروائیں', submitting: 'محفوظ ہو رہا ہے…',
    success: 'آرڈر جمع ہو گیا!', ref: 'آپ کا آرڈر نمبر',
    send: 'واٹس ایپ پر بھیجیں', adminTitle: 'دکاندار ڈیش بورڈ',
    loginTitle: 'دکاندار لاگ ان', loginSub: 'آرڈر دیکھنے اور رسید بنانے کے لیے لاگ ان کریں۔',
    email: 'ای میل', password: 'پاس ورڈ', signIn: 'لاگ ان کریں', signingIn: 'لاگ ان ہو رہا ہے…',
    back: 'گاہک کے پورٹل پر واپس',
    orders: 'آرڈرز', pending: 'زیر التوا', completed: 'مکمل', all: 'سب',
    noOrders: 'ابھی کوئی آرڈر نہیں۔', select: 'قیمت کے لیے آرڈر منتخب کریں۔',
    price: 'رسید ایڈیٹر', priceSub: 'کلو یا گرام کے لیے فی کلو قیمت، اور عدد کے لیے فی عدد قیمت درج کریں۔',
    unitPrice: 'ریٹ (فی کلو / گرام / عدد)', lineTotal: 'کل رقم', editTotal: 'کل رقم بھی بدلی جا سکتی ہے',
    addAdmin: 'سامان شامل کریں', remove: 'حذف کریں',
    savePrint: 'محفوظ کریں اور رسید پرنٹ کریں', sharePdf: 'PDF فائل شیئر کریں', balance: 'کل بیلنس', deposit: 'جمع رقم', remaining: 'باقی بیلنس', saving: 'PDF بن رہی ہے…', refresh: 'تازہ کریں',
    grand: 'کل رقم', status: 'حالت', created: 'تاریخ',
    customerLabel: 'گاہک', delivery: 'پتہ', itemCount: 'اشیاء',
    openLocation: 'مقام کھولیں', riderWhatsApp: 'رائڈر کو بھیجیں',
    successHint: 'دکاندار اب آپ کا آرڈر دیکھ سکتا ہے۔',
    errors: {
      name: 'اپنا نام لکھیں۔',
      phone: 'درست پاکستانی موبائل نمبر لکھیں۔',
      address: 'ترسیل کا پتہ لکھیں۔',
      items: 'ہر استعمال شدہ قطار میں سامان اور مقدار لکھیں۔',
      setup: 'Supabase کنفیگر نہیں ہے۔',
      submit: 'آرڈر محفوظ نہیں ہو سکا، دوبارہ کوشش کریں۔',
      login: 'لاگ ان ناکام ہوا۔',
      permission: 'یہ اکاؤنٹ مجاز نہیں ہے۔',
      save: 'رسید محفوظ نہیں ہو سکی۔',
    },
    confirm: 'کیا پورا آرڈر صاف کریں؟',
    whatsapp: 'AHWMB کسٹمر آرڈر',
    pdfName: 'ahwmb-sales-invoice',
    footer: 'AHWMB کسٹمر آرڈر پورٹل',
    cash: 'نقد ادائیگی',
  },
} as const

// ─── Toast system ─────────────────────────────────────────────────────────────
function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="alert">
          <span className="toast-icon">
            {t.type === 'success' ? <Check size={17} />
              : t.type === 'error' ? <AlertCircle size={17} />
              : <Info size={17} />}
          </span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const add = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200)
  }, [])
  const dismiss = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])
  return { toasts, add, dismiss }
}

// ─── Router ───────────────────────────────────────────────────────────────────
const usePath = () => {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path
}

const navigate = (path: string) => {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ─── Invoice document and PDF generator ────────────────────────────────────────
// Keep the printable invoice as a real HTML table. Browsers and PDF print
// engines can paginate a semantic table; fixed canvas coordinates cannot.
type InvoicePayload = {
  order: { order_ref: string; customer_name: string; items: OrderItem[]; created_at: string }
  items: OrderItem[]
  financials: { totalAmount: number; balance: number; totalBalance: number; deposit: number; remainingBalance: number }
}

const invoiceSubtotal = (items: OrderItem[]) => sumLineTotals(items)

const invoiceNumber = (value: number) => Math.round(Number(value) || 0).toLocaleString('en-PK')

function InvoiceDocument({ order, items, financials }: InvoicePayload) {
  const subtotal = invoiceSubtotal(items)
  return (
    <article className="invoice-document" dir="ltr">
      <header className="invoice-header">
        <div className="invoice-logo" aria-hidden="true">✦</div>
        <h1>SALES INVOICE</h1>
        <table className="invoice-customer-bar"><tbody><tr>
          <td><strong>Customer Name:</strong> {order.customer_name || '—'}</td>
          <td><strong>Date:</strong> {formatDateShort(order.created_at)}</td>
        </tr></tbody></table>
      </header>

      <table className="invoice-table">
        <thead>
          <tr>
            <th>S.No</th>
            <th>Item Name</th>
            <th>Quantity</th>
            <th>Per Unit Price<br />(Rs.)</th>
            <th>Total Price<br />(Rs.)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.sr}-${index}`}>
              <td>{index + 1}</td>
              <td>{item.name || '—'}</td>
              <td>{pdfQuantityText(item.quantity_value, item.unit_type)}</td>
              <td>{invoiceNumber(item.unit_price)}</td>
              <td>{invoiceNumber(item.total)}</td>
            </tr>
          ))}
          <tr className="invoice-total-items">
            <td>{items.length + 1}</td>
            <td><strong>Total Items</strong></td>
            <td><strong>{items.length}</strong></td>
            <td></td>
            <td></td>
          </tr>
          <tr className="invoice-subtotal">
            <td colSpan={4}><strong>Subtotal</strong></td>
            <td><strong>{invoiceNumber(subtotal)}</strong></td>
          </tr>
        </tbody>
      </table>

      <table className="invoice-financials" aria-label="Invoice financial summary"><tbody><tr>
        <td><strong>TOTAL AMOUNT</strong><span>Rs. {invoiceNumber(financials.totalAmount)}</span></td>
        <td><strong>BALANCE</strong><span>Rs. {invoiceNumber(financials.balance)}</span></td>
        <td><strong>TOTAL BALANCE</strong><span>Rs. {invoiceNumber(financials.totalBalance)}</span></td>
        <td><strong>DEPOSIT</strong><span>Rs. {invoiceNumber(financials.deposit)}</span></td>
        <td><strong>REMAINING BALANCE</strong><span>Rs. {invoiceNumber(financials.remainingBalance)}</span></td>
      </tr></tbody></table>
      <table className="invoice-total-amount"><tbody><tr><td><strong>Total Amount:</strong></td><td><span>Rs. {invoiceNumber(financials.totalAmount)}</span></td></tr></tbody></table>
      <footer className="invoice-footer"><em>Thank You</em><strong>For Doing Business With Us</strong></footer>
    </article>
  )
}

const invoicePrintCss = `
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #fff; color: #050505; }
  body { font-family: Georgia, 'Times New Roman', serif; }
  .invoice-document { width: 100%; max-width: 190mm; margin: 0 auto; padding: 5mm; border: 3px double #050505; font-size: 11px; }
  .invoice-header { text-align: center; }
  .invoice-logo { width: 22mm; height: 22mm; margin: 0 auto 3mm; border: 2px solid #050505; border-radius: 50%; display: grid; place-items: center; font-size: 26px; }
  .invoice-header h1 { margin: 0 auto 5mm; width: 58%; border: 2px solid #050505; padding: 2mm 1mm; font-size: 25px; line-height: 1; }
  .invoice-customer-bar { width: 100%; border-collapse: collapse; border: 2px solid #050505; margin-bottom: 4mm; font-size: 14px; }
  .invoice-customer-bar td { width: 50%; padding: 3mm 5mm; }
  .invoice-customer-bar td + td { border-left: 2px solid #050505; text-align: left; }
  .invoice-table { width: 100%; border-collapse: collapse; table-layout: fixed; page-break-inside: auto; }
  .invoice-table thead { display: table-header-group; }
  .invoice-table tr { page-break-inside: avoid; page-break-after: auto; }
  .invoice-table th, .invoice-table td { border: 1px solid #050505; padding: 2mm 1.5mm; text-align: center; vertical-align: middle; overflow-wrap: anywhere; }
  .invoice-table th { background: #050505; color: #fff; font-size: 11px; line-height: 1.08; }
  .invoice-table th:nth-child(1), .invoice-table td:nth-child(1) { width: 9%; }
  .invoice-table th:nth-child(2), .invoice-table td:nth-child(2) { width: 35%; text-align: left; }
  .invoice-table th:nth-child(3), .invoice-table td:nth-child(3) { width: 18%; }
  .invoice-table th:nth-child(4), .invoice-table td:nth-child(4) { width: 19%; }
  .invoice-table th:nth-child(5), .invoice-table td:nth-child(5) { width: 19%; }
  .invoice-total-items td, .invoice-subtotal td { background: #050505; color: #fff; }
  .invoice-subtotal td:first-child { text-align: left; }
  .invoice-financials { width: 100%; border-collapse: collapse; border: 2px solid #050505; margin-top: 5mm; page-break-inside: avoid; }
  .invoice-financials td { width: 20%; border-right: 1px solid #050505; text-align: center; }
  .invoice-financials td:last-child { border-right: 0; }
  .invoice-financials strong { display: block; background: #050505; color: #fff; padding: 2mm 1mm; font-size: 11px; }
  .invoice-financials span { display: block; padding: 5mm 1mm; font-size: 14px; }
  .invoice-total-amount { width: 100%; border-collapse: collapse; border: 2px solid #050505; margin-top: 5mm; font-size: 17px; page-break-inside: avoid; }
  .invoice-total-amount td { padding: 4mm 7mm; }
  .invoice-total-amount td:last-child { text-align: right; }
  .invoice-footer { text-align: center; margin-top: 7mm; display: grid; gap: 2mm; }
  .invoice-footer em { font-size: 25px; }
  .invoice-footer strong { font-size: 13px; }
  @media print { .invoice-document { border-width: 3px; } }
`

function printInvoiceElement(element: HTMLElement) {
  const iframe = document.createElement('iframe')
  iframe.title = 'Invoice print preview'
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${invoicePrintCss}</style></head><body>${element.outerHTML}</body></html>`
  iframe.onload = () => window.setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() }
    finally { window.setTimeout(() => iframe.remove(), 1200) }
  }, 150)
  document.body.appendChild(iframe)
}

async function drawInvoice(
  order: InvoicePayload['order'],
  items: OrderItem[],
  _grandTotal: number,
  financials: InvoicePayload['financials'],
  filename: string,
): Promise<Blob> {
  const subtotal = invoiceSubtotal(items)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  doc.setFont('times', 'bold')
  doc.setFontSize(20)
  doc.text('SALES INVOICE', 105, 20, { align: 'center' })
  doc.setFontSize(10)
  doc.text(`Customer Name: ${order.customer_name || '—'}`, 16, 31)
  doc.text(`Date: ${formatDateShort(order.created_at)}`, 194, 31, { align: 'right' })

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    theme: 'grid',
    headStyles: { fillColor: [5, 5, 5], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    styles: { font: 'times', fontSize: 8, cellPadding: 2, textColor: [5, 5, 5], lineColor: [5, 5, 5], lineWidth: 0.25 },
    head: [['S.No', 'Item Name', 'Quantity', 'Per Unit Price (Rs.)', 'Total Price (Rs.)']],
    body: items.map((item, index) => [String(index + 1), item.name || '—', pdfQuantityText(item.quantity_value, item.unit_type), invoiceNumber(item.unit_price), invoiceNumber(item.total)]),
    foot: [[String(items.length + 1), 'Total Items', String(items.length), '', ''], ['', 'Subtotal', '', '', invoiceNumber(subtotal)]],
    footStyles: { fillColor: [5, 5, 5], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 15, halign: 'center' }, 1: { cellWidth: 65 }, 2: { cellWidth: 30, halign: 'center' }, 3: { cellWidth: 38, halign: 'center' }, 4: { cellWidth: 38, halign: 'center' } },
    showHead: 'everyPage',
  })
  const tableEndY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 45
  // A long table can span pages. Start the balance block after the table, or
  // on a fresh page when there is not enough room for the block and total.
  const balanceY = tableEndY + 8 > 255 ? (doc.addPage(), 20) : tableEndY + 8
  autoTable(doc, {
    startY: balanceY,
    theme: 'grid',
    margin: { left: 10, right: 10 },
    head: [['TOTAL AMOUNT', 'BALANCE', 'TOTAL BALANCE', 'DEPOSIT', 'REMAINING BALANCE']],
    body: [[invoiceNumber(financials.totalAmount), invoiceNumber(financials.balance), invoiceNumber(financials.totalBalance), invoiceNumber(financials.deposit), invoiceNumber(financials.remainingBalance)]],
    headStyles: { fillColor: [5, 5, 5], textColor: [255, 255, 255], halign: 'center', fontStyle: 'bold', fontSize: 7 },
    styles: { font: 'times', fontSize: 8, halign: 'center', lineColor: [5, 5, 5] },
  })
  const balanceEndY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || balanceY + 18
  const totalY = balanceEndY + 8 > 285 ? (doc.addPage(), 20) : balanceEndY + 8
  doc.setFontSize(14)
  doc.rect(10, totalY, 190, 10)
  doc.text('Total Amount:', 18, totalY + 6)
  doc.text(`Rs. ${invoiceNumber(financials.totalAmount)}`, 192, totalY + 6, { align: 'right' })
  doc.autoPrint()
  const pdfBlob = doc.output('blob')
  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) throw new Error('The invoice PDF was empty and could not be downloaded.')
  const pdfUrl = URL.createObjectURL(pdfBlob)
  const downloadLink = document.createElement('a')
  downloadLink.href = pdfUrl; downloadLink.download = filename; downloadLink.style.display = 'none'
  document.body.appendChild(downloadLink); downloadLink.click(); downloadLink.remove()
  window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 10 * 60 * 1000)
  return pdfBlob
}

// ─── Notify ───────────────────────────────────────────────────────────────────
async function notifyNewOrder(order: {
  order_ref: string; customer_name: string
  customer_phone: string; customer_address: string
}) {
  if (!supabase) return
  try {
    await supabase.functions.invoke('notify-new-order', { body: order })
  } catch (err) {
    console.warn('Notification not delivered:', err)
  }
}

// ─── Header ───────────────────────────────────────────────────────────────────
function PortalHeader({
  language, setLanguage, onAdmin, isAuthenticated,
}: {
  language: Language; setLanguage: (v: Language) => void
  onAdmin: () => void; isAuthenticated: boolean
}) {
  const t = copy[language]
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo" aria-hidden="true">
          <ShoppingBag size={26} />
        </div>
        <div className="header-brand-text">
          <p className="header-eyebrow">AHWMB</p>
          <h1 className="header-title">{t.brand}</h1>
          <span className="header-sub">{t.company}</span>
        </div>
      </div>
      <div className="header-actions">
        <div className="easy-badge">{t.easy}</div>
        <button type="button" className="btn-header-icon" onClick={onAdmin}>
          {isAuthenticated ? <LogOut size={16} /> : <LogIn size={16} />}
          <span>{isAuthenticated ? t.logout : t.login}</span>
        </button>
        <button
          type="button"
          className="btn-lang"
          onClick={() => setLanguage(language === 'ur' ? 'en' : 'ur')}
          aria-label={`Switch to ${t.switch}`}
        >
          <Languages size={17} />
          <span>{t.switch}</span>
        </button>
      </div>
    </header>
  )
}

// ─── Success Modal ────────────────────────────────────────────────────────────
function SuccessModal({ reference, language, onClose }: {
  reference: string; language: Language; onClose: () => void
}) {
  const t = copy[language]
  const send = () => window.open(
    `https://wa.me/${SHOPKEEPER_NUMBER}?text=${encodeURIComponent(`${t.whatsapp}\n${t.ref}: ${reference}`)}`,
    '_blank', 'noopener,noreferrer'
  )
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-box">
        <div className="modal-check">
          <Check size={32} />
        </div>
        <h2 className="modal-title">{t.success}</h2>
        <p className="modal-label">{t.ref}</p>
        <strong className="modal-ref">{reference}</strong>
        <p className="modal-hint">{t.successHint}</p>
        <div className="modal-actions">
          <button className="btn-whatsapp" type="button" onClick={send}>
            <MessageCircle size={20} /> {t.send}
          </button>
          <button className="btn-modal-close" type="button" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

// ─── Customer Page ────────────────────────────────────────────────────────────
function CustomerPage({
  language, setLanguage, onAuth, isAuthenticated,
}: {
  language: Language; setLanguage: (v: Language) => void
  onAuth: () => void; isAuthenticated: boolean
}) {
  const t = copy[language]
  const isRtl = language === 'ur'
  const { toasts, add: addToast, dismiss } = useToasts()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [locationLink, setLocationLink] = useState('')
  const [locationState, setLocationState] = useState<'idle' | 'locating' | 'ready' | 'error'>('idle')
  const [rows, setRows] = useState<OrderRow[]>(createDefaultRows)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [successRef, setSuccessRef] = useState('')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)

  const catalogMatches = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase()
    if (!query) return PRODUCT_CATALOG.slice(0, 10)
    return PRODUCT_CATALOG.filter(product =>
      `${product.name} ${product.category}`.toLowerCase().includes(query)
    ).slice(0, 12)
  }, [catalogSearch])

  const catalogGroups = useMemo(() => {
    const groups = new Map<string, CatalogProduct[]>()
    PRODUCT_CATALOG.forEach(product => {
      const group = groups.get(product.category) || []
      group.push(product)
      groups.set(product.category, group)
    })
    return [...groups.entries()]
  }, [])

  const addCatalogProduct = (productName: string) => {
    setRows(current => {
      const emptyIndex = current.findIndex(row => !row.itemName.trim() && !row.quantityValue.trim())
      if (emptyIndex === -1) return [...current, { ...createRow(), itemName: productName }]
      return current.map((row, index) => index === emptyIndex ? { ...row, itemName: productName } : row)
    })
    setCatalogSearch('')
    setCatalogOpen(false)
    setErrors(current => ({ ...current, items: undefined }))
  }

  const filledRows = useMemo(
    () => rows.filter(r => r.itemName.trim() || r.quantityValue.trim()),
    [rows]
  )
  const hasContent = filledRows.length > 0 || notes.trim().length > 0

  const updateRow = (id: string, field: keyof Pick<OrderRow, 'itemName' | 'quantityValue' | 'unitType'>, value: string) => {
    setRows(curr => {
      const next = curr.map(r => r.id === id ? { ...r, [field]: value } as OrderRow : r)
      if (curr[curr.length - 1]?.id === id && value.trim()) next.push(createRow())
      return next
    })
    setErrors(curr => ({ ...curr, items: undefined }))
  }

  const shareLocation = () => {
    if (!navigator.geolocation) { setLocationState('error'); return }
    setLocationState('locating')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocationLink(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`)
        setLocationState('ready')
      },
      () => setLocationState('error'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }

  const clear = () => {
    const dirty = hasContent || name || phone || address || locationLink
    if (dirty && !window.confirm(t.confirm)) return
    setRows(createDefaultRows())
    setName(''); setPhone(''); setAddress(''); setLocationLink('')
    setNotes(''); setErrors({}); setLocationState('idle')
  }

  const submit = async () => {
    const next: FormErrors = {}
    if (!name.trim()) next.name = t.errors.name
    if (!validPhone(phone)) next.phone = t.errors.phone
    if (!address.trim()) next.address = t.errors.address
    if (!hasContent || filledRows.some(r => !r.itemName.trim() || !r.quantityValue.trim()))
      next.items = t.errors.items
    setErrors(next)
    if (Object.keys(next).length) return
    if (!supabase) { addToast(t.errors.setup, 'error'); return }

    setSaving(true)
    const orderRef = createOrderRef()
    const items: OrderItem[] = filledRows.map((row, index) => {
      const quantityValue = Number(row.quantityValue) || 0
      return {
        sr: index + 1,
        name: row.itemName.trim(),
        quantity: quantityText(quantityValue, row.unitType, 'en'),
        quantity_value: quantityValue,
        unit_type: row.unitType,
        rate: 0,
        unit_price: 0,
        total: 0,
      }
    })

    try {
      const { error } = await supabase.rpc('submit_order', {
        p_order_ref: orderRef,
        p_customer_name: name.trim(),
        p_customer_phone: normalizePhone(phone),
        p_customer_address: address.trim(),
        p_location_link: locationLink.trim() || null,
        p_items: items,
      })

      if (error) throw error

      void notifyNewOrder({ order_ref: orderRef, customer_name: name.trim(), customer_phone: phone.trim(), customer_address: address.trim() })
      setSuccessRef(orderRef)
    } catch (err) {
      console.error('Order submit error:', err)
      addToast(t.errors.submit, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={`app-shell ${isRtl ? 'rtl-mode' : 'ltr-mode'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <PortalHeader language={language} setLanguage={setLanguage} onAdmin={onAuth} isAuthenticated={isAuthenticated} />
      <ToastContainer toasts={toasts} dismiss={dismiss} />

      <div className="page-wrap">
        {/* Hero */}
        <section className="hero-section">
          <h2 className="hero-title">{t.welcome}</h2>
          <p className="hero-sub">{t.subtitle}</p>
        </section>

        {/* Customer details */}
        <section className="card">
          <div className="card-header">
            <span className="card-icon card-icon--green"><UserRound size={20} /></span>
            <div>
              <h2 className="card-title">{t.customer}</h2>
              <p className="card-sub">{t.customerSub}</p>
            </div>
          </div>

          <div className="field-group">
            <label className={`field ${errors.name ? 'field--error' : ''}`}>
              <span className="field-label">{t.name} <b className="req">*</b></span>
              <div className="field-input-wrap">
                <UserRound size={18} className="field-icon" />
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t.namePh}
                  autoComplete="name"
                  className="field-input"
                />
              </div>
              {errors.name && <small className="field-error-msg">{errors.name}</small>}
            </label>

            <label className={`field ${errors.phone ? 'field--error' : ''}`}>
              <span className="field-label">{t.phone} <b className="req">*</b></span>
              <div className="field-input-wrap">
                <Phone size={18} className="field-icon field-icon--start" />
                <input
                  className="field-input field-input--ltr"
                  dir="ltr"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder={t.phonePh}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
              {errors.phone && <small className="field-error-msg">{errors.phone}</small>}
            </label>

            <label className={`field ${errors.address ? 'field--error' : ''}`}>
              <span className="field-label">{t.address} <b className="req">*</b></span>
              <div className="field-input-wrap">
                <MapPin size={18} className="field-icon" />
                <textarea
                  className="field-textarea"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder={t.addressPh}
                  rows={3}
                />
              </div>
              {errors.address && <small className="field-error-msg">{errors.address}</small>}
            </label>

            <div className="location-group">
              <span className="field-label">{t.location}</span>
              <div className="location-row">
                <input
                  className="location-input"
                  value={locationLink}
                  onChange={e => {
                    setLocationLink(e.target.value)
                    setLocationState(e.target.value ? 'ready' : 'idle')
                  }}
                  placeholder={t.locationPh}
                  dir="ltr"
                />
                <button
                  type="button"
                  className="btn-location"
                  onClick={shareLocation}
                  disabled={locationState === 'locating'}
                >
                  <Navigation size={16} />
                  <span>{locationState === 'locating' ? t.locating : t.locate}</span>
                </button>
              </div>
              {locationState === 'ready' && (
                <small className="location-status location-status--ok">
                  <Check size={14} /> {t.locationReady}
                </small>
              )}
              {locationState === 'error' && (
                <small className="location-status location-status--err">
                  <Info size={14} /> {t.locationError}
                </small>
              )}
            </div>
          </div>
        </section>

        {/* Items */}
        <section className="card items-card">
          <div className="card-header">
            <span className="card-icon card-icon--gold"><ReceiptText size={20} /></span>
            <div>
              <h2 className="card-title">{t.items}</h2>
              <p className="card-sub">{t.itemsSub}</p>
            </div>
          </div>

          <div className="catalog-picker">
            <label className="field-label" htmlFor="product-catalog-search">{language === 'ur' ? 'سامان تلاش کریں' : 'Search official product menu'}</label>
            <input
              id="product-catalog-search"
              className="catalog-search"
              value={catalogSearch}
              onChange={e => { setCatalogSearch(e.target.value); setCatalogOpen(true) }}
              onFocus={() => setCatalogOpen(true)}
              onKeyDown={e => { if (e.key === 'Enter' && catalogMatches[0]) { e.preventDefault(); addCatalogProduct(catalogMatches[0].name) } }}
              placeholder={language === 'ur' ? 'چاول، دال، مصالحہ تلاش کریں' : 'Search rice, pulses, spices, wheat…'}
              list="ahwmb-product-catalog"
              autoComplete="off"
            />
            <datalist id="ahwmb-product-catalog">
              {PRODUCT_CATALOG.map(product => <option key={product.name} value={product.name}>{product.category}</option>)}
            </datalist>
            {catalogOpen && catalogMatches.length > 0 && (
              <div className="catalog-results" role="listbox">
                {catalogMatches.map(product => <button key={product.name} type="button" onClick={() => addCatalogProduct(product.name)}><span>{product.name}</span><small>{product.category}</small></button>)}
              </div>
            )}
            <div className="catalog-groups" aria-label="Browse products by category">
              {catalogGroups.map(([category, products]) => (
                <section className="catalog-group" key={category}>
                  <h3>{category}</h3>
                  <div className="catalog-grid">
                    {products.map(product => (
                      <button key={product.name} type="button" onClick={() => addCatalogProduct(product.name)}>
                        {product.name}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table className="order-table">
              <thead>
                <tr>
                  <th className="col-sr">{t.number}</th>
                  <th className="col-item">{t.item}</th>
                  <th className="col-qty">{t.quantity}</th>
                  <th className="col-unit">{t.unit}</th>
                  <th className="col-rate">{t.rate}</th>
                  <th className="col-total">{t.total}</th>
                  <th className="col-del"><span className="sr-only">{t.delete}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="col-sr td-sr">{index + 1}</td>
                    <td>
                      <input
                        className="cell-input"
                        value={row.itemName}
                        onChange={e => updateRow(row.id, 'itemName', e.target.value)}
                        placeholder={t.itemPh}
                        aria-label={`${t.item} ${index + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.quantityValue}
                        onChange={e => updateRow(row.id, 'quantityValue', e.target.value)}
                        placeholder={t.quantityPh}
                        aria-label={`${t.quantity} ${index + 1}`}
                      />
                    </td>
                    <td>
                      <div className="select-wrap">
                        <select
                          className="cell-select"
                          value={row.unitType}
                          onChange={e => updateRow(row.id, 'unitType', e.target.value)}
                          aria-label={`${t.unit} ${index + 1}`}
                        >
                          {UNIT_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>
                              {o[language === 'ur' ? 'ur' : 'en']}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="select-icon" />
                      </div>
                    </td>
                    <td>
                      <div className="cell-locked">
                        <span>{t.locked}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-locked">
                        <span>{t.locked}</span>
                      </div>
                    </td>
                    <td className="col-del">
                      <button
                        type="button"
                        className="btn-del"
                        onClick={() => setRows(curr => curr.length > 1 ? curr.filter(r => r.id !== row.id) : [createRow()])}
                        aria-label={`${t.delete} ${index + 1}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-help">
            <Info size={15} />
            <span>{t.quantityHelp}</span>
          </div>

          {errors.items && (
            <div className="inline-error" role="alert">
              <AlertCircle size={17} /> {errors.items}
            </div>
          )}

          <div className="table-footer">
            <button type="button" className="btn-add-row" onClick={() => setRows(curr => [...curr, createRow()])}>
              <Plus size={17} /> {t.add}
            </button>
            <span className="row-count">{t.rows(rows.length)}</span>
          </div>
        </section>

        {/* Notes */}
        <section className="card">
          <div className="card-header">
            <span className="card-icon card-icon--purple"><Plus size={20} /></span>
            <div>
              <h2 className="card-title">{t.notes}</h2>
              <p className="card-sub">{t.notesSub}</p>
            </div>
          </div>
          <label className="field">
            <span className="field-label">{t.notesLabel}</span>
            <textarea
              className="field-textarea notes-textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t.notesPh}
              rows={4}
            />
          </label>
          <button type="button" className="btn-clear" onClick={clear}>{t.clear}</button>
        </section>

        {/* Submit */}
        <section className="submit-card">
          <div className="submit-copy">
            <PackageCheck size={24} />
            <div>
              <strong>{t.submit}</strong>
              <span>{t.successHint}</span>
            </div>
          </div>
          <button
            className="btn-submit"
            type="button"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? <RefreshCw size={21} className="spin" /> : <Send size={21} />}
            <span>{saving ? t.submitting : t.submit}</span>
            <FileDown size={19} />
          </button>
        </section>

        <footer className="page-footer">
          <span>{t.footer}</span>
          <span>{t.cash}</span>
        </footer>
      </div>

      {successRef && (
        <SuccessModal
          reference={successRef}
          language={language}
          onClose={() => {
            setSuccessRef('')
            setRows(createDefaultRows())
            setName(''); setPhone(''); setAddress('')
            setLocationLink(''); setNotes('')
          }}
        />
      )}
    </main>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage({
  language, setLanguage, onAuth, isAuthenticated,
}: {
  language: Language; setLanguage: (v: Language) => void
  onAuth: () => void; isAuthenticated: boolean
}) {
  const t = copy[language]
  const isRtl = language === 'ur'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const login = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!supabase) { setError(t.errors.setup); return }
    setBusy(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError || !data.user) { setError(t.errors.login); return }
      if (!isAdminEmail(data.user.email)) {
        await supabase.auth.signOut()
        setError(t.errors.permission)
        return
      }
      navigate('/admin')
    } catch {
      setError(t.errors.login)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={`app-shell auth-shell ${isRtl ? 'rtl-mode' : 'ltr-mode'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <PortalHeader language={language} setLanguage={setLanguage} onAdmin={onAuth} isAuthenticated={isAuthenticated} />
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-icon">
            <LogIn size={28} />
          </div>
          <h2 className="auth-title">{t.loginTitle}</h2>
          <p className="auth-sub">{t.loginSub}</p>
          <form onSubmit={e => void login(e)} autoComplete="off" noValidate>
            <label className="field">
              <span className="field-label">{t.email}</span>
              <input
                className="field-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
                autoComplete="off"
                dir="ltr"
              />
            </label>
            <label className="field" style={{ marginTop: 12 }}>
              <span className="field-label">{t.password}</span>
              <input
                className="field-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                type="password"
                autoComplete="off"
                dir="ltr"
              />
            </label>
            {error && (
              <div className="inline-error" role="alert" style={{ marginTop: 12 }}>
                <AlertCircle size={17} /> {error}
              </div>
            )}
            <button className="btn-submit auth-submit" type="submit" disabled={busy}>
              {busy ? <RefreshCw size={20} className="spin" /> : <LogIn size={20} />}
              <span>{busy ? t.signingIn : t.signIn}</span>
            </button>
          </form>
          <button type="button" className="btn-back" onClick={() => navigate('/')}>
            {t.back}
          </button>
        </div>
      </div>
    </main>
  )
}

// ─── Admin Page ───────────────────────────────────────────────────────────────
function AdminPage({
  language, setLanguage, onAuth, isAuthenticated,
}: {
  language: Language; setLanguage: (v: Language) => void
  onAuth: () => void; isAuthenticated: boolean
}) {
  const t = copy[language]
  const isRtl = language === 'ur'
  const { toasts, add: addToast, dismiss } = useToasts()

  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [selected, setSelected] = useState<OrderRecord | null>(null)
  const [pricedItems, setPricedItems] = useState<OrderItem[]>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [balance, setBalance] = useState(0)
  const [deposit, setDeposit] = useState(0)
  const [lastPdf, setLastPdf] = useState<{ blob: Blob; name: string } | null>(null)
  const [printPayload, setPrintPayload] = useState<InvoicePayload | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  // Computed grand total from priced items
  const grandTotal = useMemo(
    () => sumLineTotals(pricedItems),
    [pricedItems]
  )
  const totalAmount = grandTotal
  const totalBalance = totalAmount + balance
  const remainingBalance = totalBalance - deposit

  useEffect(() => {
    if (!printPayload || !printRef.current) return
    const timer = window.setTimeout(() => {
      if (printRef.current) printInvoiceElement(printRef.current)
      setPrintPayload(null)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [printPayload])

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return }
    const { data: session } = await supabase.auth.getSession()
    const email = session.session?.user.email
    if (!session.session || !isAdminEmail(email)) {
      setAuthorized(false); setLoading(false); navigate('/login'); return
    }
    setAuthorized(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      addToast(error.message, 'error')
      setLoading(false)
      return
    }
    setOrders((data || []).map(row => ({ ...row, items: safeItems(row.items) })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const channel = supabase?.channel('orders-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void refresh() })
      .subscribe()
    return () => { if (channel) void supabase?.removeChannel(channel) }
  }, [refresh])

  const choose = (order: OrderRecord) => {
    setSelected(order)
    setPricedItems(safeItems(order.items))
    setBalance(Number(order.balance) || 0)
    setDeposit(Number(order.deposit) || 0)
    setLastPdf(null)
  }

  /**
   * CRITICAL FIX: updateItem
   * When unit_price changes → recalculate total using calculateLineTotal
   * When quantity_value changes → recalculate total
   * When unit_type changes → recalculate total (rate stays the same)
   * When total is edited manually → allow override (no recalc)
   */
  const updateItem = (index: number, field: keyof OrderItem, value: string | number) => {
    setPricedItems(curr => curr.map((item, i) => {
      if (i !== index) return item
      const next = { ...item }

      if (field === 'name') {
        next.name = String(value)
      } else if (field === 'unit_type') {
        next.unit_type = value as UnitType
        next.quantity = quantityText(next.quantity_value, next.unit_type, 'en')
        // Recalculate with existing rate and new unit
        next.total = calculateLineTotal(next)
      } else if (field === 'quantity_value') {
        next.quantity_value = Number(value) || 0
        next.quantity = quantityText(next.quantity_value, next.unit_type, 'en')
        // Recalculate — this is the FIXED grams calculation
        next.total = calculateLineTotal(next)
      } else if (field === 'unit_price' || field === 'rate') {
        next.unit_price = Number(value) || 0
        next.rate = next.unit_price
        // Recalculate total — correct for all units
        next.total = calculateLineTotal(next)
      } else if (field === 'total') {
        // Manual override: allow editing total directly
        next.total = Number(value) || 0
      }

      return next
    }))
  }

  const addAdminItem = () =>
    setPricedItems(curr => [...curr, {
      sr: curr.length + 1, name: '', quantity: '',
      quantity_value: 1, unit_type: 'KG', rate: 0, unit_price: 0, total: 0,
    }])

  const removeAdminItem = (index: number) =>
    setPricedItems(curr =>
      curr.filter((_, i) => i !== index).map((item, i) => ({ ...item, sr: i + 1 }))
    )

  const sharePdf = async () => {
    if (!lastPdf) return
    const file = new File([lastPdf.blob], lastPdf.name, { type: 'application/pdf' })
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({ title: 'AHWMB Invoice', files: [file] })
      } catch (err) {
        if ((err as DOMException)?.name !== 'AbortError') addToast('PDF sharing was not completed.', 'error')
      }
    } else {
      addToast('The PDF file is downloaded. Attach that file to WhatsApp; no dashboard link is shared.', 'info')
    }
  }

  const saveAndPrint = async () => {
    if (!selected) return
    if (!supabase) { addToast(t.errors.setup, 'error'); return }
    setSaving(true)

    const items = pricedItems
      .filter(item => item.name.trim() || item.quantity.trim())
      .map((item, index) => ({
        ...item,
        sr: index + 1,
        quantity: quantityText(Number(item.quantity_value) || parseQuantity(item.quantity), item.unit_type, 'en'),
        quantity_value: Number(item.quantity_value) || parseQuantity(item.quantity),
        unit_price: Number(item.unit_price ?? item.rate) || 0,
        rate: Number(item.unit_price ?? item.rate) || 0,
        total: Number(item.total) || 0,
      }))

    const finalTotalAmount = sumLineTotals(items)
    const finalBalance = Number(balance) || 0
    const finalTotalBalance = finalTotalAmount + finalBalance
    const finalDeposit = Number(deposit) || 0
    const finalRemaining = finalTotalBalance - finalDeposit
    const nextOrder: OrderRecord = { ...selected, items, grand_total: finalTotalBalance, total_amount: finalTotalAmount, balance: finalBalance, total_balance: finalTotalBalance, deposit: finalDeposit, remaining_balance: finalRemaining, status: 'completed' }

    try {
      const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({ items, grand_total: finalTotalBalance, total_amount: finalTotalAmount, balance: finalBalance, total_balance: finalTotalBalance, deposit: finalDeposit, remaining_balance: finalRemaining, status: 'completed' })
        .eq('id', selected.id)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!updatedOrder) throw new Error('The order was not updated. Refresh the order list and try again.')

      setSelected(nextOrder)
      setPricedItems(items)
      setBalance(finalBalance)
      setDeposit(finalDeposit)
      setOrders(curr => curr.map(o => o.id === selected.id ? nextOrder : o))

      try {
        const pdfName = `${copy[language].pdfName}-${selected.customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
        const blob = await drawInvoice(nextOrder, items, finalTotalAmount, {
          totalAmount: finalTotalAmount,
          balance: finalBalance,
          totalBalance: finalTotalBalance,
          deposit: finalDeposit,
          remainingBalance: finalRemaining,
        }, pdfName)
        setLastPdf({ blob, name: pdfName })
        setPrintPayload({ order: nextOrder, items, financials: { totalAmount: finalTotalAmount, balance: finalBalance, totalBalance: finalTotalBalance, deposit: finalDeposit, remainingBalance: finalRemaining } })
        addToast('Invoice saved, downloaded, and sent to the current-window print preview. Use Share PDF File to share only the PDF.', 'success')
      } catch (invoiceErr) {
        console.error('PDF generation error:', invoiceErr)
        addToast('Invoice data was saved, but PDF generation failed. Please try Save & Print again.', 'error')
      }
    } catch (err) {
      const msg = readableError(err)
      addToast(msg || t.errors.save, 'error')
    } finally {
      setSaving(false)
    }
  }

  const shownOrders = useMemo(
    () => orders.filter(o => filter === 'all' || o.status === filter),
    [orders, filter]
  )

  if (authorized === null || loading) {
    return (
      <main className="app-shell">
        <div className="loading-screen">
          <RefreshCw className="spin" size={30} />
          <p>{t.refresh}…</p>
          <div style={{ display: 'grid', gap: 8, marginTop: 20, width: 300 }}>
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="skeleton--h40" />)}
          </div>
        </div>
      </main>
    )
  }

  if (!authorized) return null

  return (
    <main className={`app-shell admin-shell ${isRtl ? 'rtl-mode' : 'ltr-mode'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <PortalHeader language={language} setLanguage={setLanguage} onAdmin={onAuth} isAuthenticated={isAuthenticated} />
      <ToastContainer toasts={toasts} dismiss={dismiss} />

      <div className="admin-wrap">
        {/* Topbar */}
        <div className="admin-topbar">
          <div>
            <p className="admin-eyebrow">AHWMB</p>
            <h2 className="admin-heading">{t.adminTitle}</h2>
            <span className="admin-emails">{ADMIN_EMAILS.join(' · ')}</span>
          </div>
          <div className="admin-top-actions">
            <button type="button" className="btn-secondary" onClick={() => void refresh()}>
              <RefreshCw size={16} /> {t.refresh}
            </button>
            <button type="button" className="btn-secondary btn-danger" onClick={onAuth}>
              <LogOut size={16} /> {t.logout}
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="admin-grid">
          {/* Orders list */}
          <section className="panel orders-panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">{t.orders}</h3>
                <p className="panel-sub">{orders.length} {t.itemCount}</p>
              </div>
              <div className="filter-tabs">
                {(['pending', 'completed', 'all'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    className={`filter-tab ${filter === v ? 'filter-tab--active' : ''}`}
                    onClick={() => setFilter(v)}
                  >
                    {t[v]}
                    <span className="filter-count">
                      {v === 'all' ? orders.length : orders.filter(o => o.status === v).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {shownOrders.length === 0 ? (
              <div className="empty-state">
                <ReceiptText size={36} />
                <p>{t.noOrders}</p>
              </div>
            ) : (
              <div className="order-list">
                {shownOrders.map(order => (
                  <button
                    key={order.id}
                    type="button"
                    className={`order-card ${selected?.id === order.id ? 'order-card--selected' : ''}`}
                    onClick={() => choose(order)}
                  >
                    <div className="order-card-top">
                      <span className="order-ref">{order.order_ref}</span>
                      <span className={`status-badge status-badge--${order.status}`}>
                        {order.status === 'pending' ? t.pending : t.completed}
                      </span>
                    </div>
                    <strong className="order-name">{order.customer_name}</strong>
                    <div className="order-meta">
                      <span>{safeItems(order.items).length} {t.itemCount}</span>
                      <span className="dot">·</span>
                      <span>{formatDate(order.created_at)}</span>
                    </div>
                    {order.grand_total > 0 && (
                      <span className="order-total">{formatMoney(order.grand_total)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Editor panel */}
          <section className="panel editor-panel">
            {!selected ? (
              <div className="empty-state editor-empty">
                <PackageCheck size={48} />
                <p>{t.select}</p>
              </div>
            ) : (
              <>
                {/* Order header */}
                <div className="editor-head">
                  <div className="editor-head-info">
                    <p className="admin-eyebrow">{selected.order_ref}</p>
                    <h3 className="editor-customer">{selected.customer_name}</h3>
                    <div className="editor-contact">
                      <span><Phone size={13} /> {selected.customer_phone}</span>
                    </div>
                    <p className="editor-address"><MapPin size={13} /> {selected.customer_address}</p>
                    {selected.location_link && (
                      <div className="editor-location">
                        <a href={selected.location_link} target="_blank" rel="noreferrer">
                          <MapPin size={14} /> {t.openLocation}
                        </a>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(`${selected.customer_name}: ${selected.location_link}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle size={14} /> {t.riderWhatsApp}
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="editor-head-meta">
                    <span className={`status-badge status-badge--${selected.status}`}>
                      {selected.status === 'pending' ? t.pending : t.completed}
                    </span>
                    <span className="editor-date">{formatDate(selected.created_at)}</span>
                  </div>
                </div>

                {/* Pricing section */}
                <div className="price-section">
                  <div className="price-section-head">
                    <div>
                      <h3 className="panel-title">{t.price}</h3>
                      <p className="panel-sub">{t.priceSub}</p>
                    </div>
                    <div className="grand-total-display">
                      <span className="grand-label">{t.grand}</span>
                      <strong className="grand-value">{formatMoney(grandTotal)}</strong>
                    </div>
                  </div>

                  <div className="pricing-wrap">
                    <table className="pricing-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t.item}</th>
                          <th>{t.quantity}</th>
                          <th>{t.unit}</th>
                          <th>{t.unitPrice}</th>
                          <th>{t.lineTotal}</th>
                          <th><span className="sr-only">{t.remove}</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pricedItems.map((item, index) => (
                          <tr key={`${item.sr}-${index}`}>
                            <td className="td-sr">{index + 1}</td>
                            <td>
                              <input
                                className="pricing-input"
                                value={item.name}
                                onChange={e => updateItem(index, 'name', e.target.value)}
                                aria-label={`${t.item} ${index + 1}`}
                              />
                            </td>
                            <td>
                              <input
                                className="pricing-input pricing-input--num"
                                type="number"
                                min="0"
                                step="0.001"
                                value={item.quantity_value || ''}
                                onChange={e => updateItem(index, 'quantity_value', e.target.value)}
                                aria-label={`${t.quantity} ${index + 1}`}
                              />
                            </td>
                            <td>
                              <div className="select-wrap">
                                <select
                                  className="pricing-select"
                                  value={item.unit_type}
                                  onChange={e => updateItem(index, 'unit_type', e.target.value as UnitType)}
                                  aria-label={`${t.unit} ${index + 1}`}
                                >
                                  {UNIT_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.en}</option>
                                  ))}
                                </select>
                                <ChevronDown size={13} className="select-icon" />
                              </div>
                            </td>
                            <td>
                              <input
                                className="pricing-input pricing-input--num"
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unit_price || ''}
                                onChange={e => updateItem(index, 'unit_price', e.target.value)}
                                aria-label={`${t.unitPrice} ${index + 1}`}
                              />
                            </td>
                            <td>
                              <input
                                className="pricing-input pricing-input--num pricing-input--total"
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.total || ''}
                                onChange={e => updateItem(index, 'total', e.target.value)}
                                aria-label={`${t.lineTotal} ${index + 1}`}
                                title={t.editTotal}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn-del"
                                onClick={() => removeAdminItem(index)}
                                aria-label={`${t.remove} ${index + 1}`}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="pricing-actions">
                    <button type="button" className="btn-add-item" onClick={addAdminItem}>
                      <Plus size={16} /> {t.addAdmin}
                    </button>
                    <p className="pricing-note"><Info size={14} /> {t.editTotal}</p>
                  </div>

                  <div className="financial-grid financial-grid--five" aria-label="Invoice financial calculator">
                    <label className="financial-field financial-field--readonly">
                      <span>Total amount</span><output>{formatMoney(totalAmount)}</output>
                    </label>
                    <label className="financial-field">
                      <span>Balance</span><input type="number" min="0" step="0.01" value={balance || ''} onChange={e => setBalance(Number(e.target.value) || 0)} />
                    </label>
                    <label className="financial-field financial-field--readonly">
                      <span>Total balance</span><output>{formatMoney(totalBalance)}</output>
                    </label>
                    <label className="financial-field">
                      <span>Deposit</span><input type="number" min="0" step="0.01" value={deposit || ''} onChange={e => setDeposit(Number(e.target.value) || 0)} />
                    </label>
                    <label className="financial-field financial-field--readonly">
                      <span>Remaining balance</span><output>{formatMoney(remainingBalance)}</output>
                    </label>
                  </div>

                  <button
                    className="btn-print"
                    type="button"
                    onClick={() => void saveAndPrint()}
                    disabled={saving}
                  >
                    {saving
                      ? <><RefreshCw size={20} className="spin" /> {t.saving}</>
                      : <><FileDown size={20} /> {t.savePrint}</>
                    }
                  </button>
                  {lastPdf && (
                    <button className="btn-share-pdf" type="button" onClick={() => void sharePdf()}>
                      <Send size={18} /> {t.sharePdf}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
      <div ref={printRef} className="invoice-print-mount" aria-hidden="true">
        {printPayload && <InvoiceDocument order={printPayload.order} items={printPayload.items} financials={printPayload.financials} />}
      </div>
    </main>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const path = usePath()
  const [language, setLanguage] = useState<Language>(() => {
    try { return (localStorage.getItem('ahwmb-language-v2') as Language) || 'en' }
    catch { return 'en' }
  })
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    try { localStorage.setItem('ahwmb-language-v2', language) }
    catch { /* storage unavailable */ }
  }, [language])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(Boolean(data.session?.user && isAdminEmail(data.session.user.email)))
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(Boolean(session?.user && isAdminEmail(session.user.email)))
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const onAuth = useCallback(async () => {
    if (isAuthenticated) {
      await supabase?.auth.signOut()
      setIsAuthenticated(false)
      navigate('/')
    } else {
      navigate('/login')
    }
  }, [isAuthenticated])

  const props = { language, setLanguage, onAuth, isAuthenticated }

  if (path === '/login') return <LoginPage {...props} />
  if (path === '/admin') return <AdminPage {...props} />
  return <CustomerPage {...props} />
}
