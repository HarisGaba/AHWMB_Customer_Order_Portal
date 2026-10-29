import { useEffect, useMemo, useState, useCallback } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  AlertCircle, Check, ChevronDown, FileDown, Info, Languages, LogIn, LogOut,
  MapPin, MessageCircle, Navigation, PackageCheck, Phone, Plus,
  ReceiptText, RefreshCw, Send, ShoppingBag, Trash2, UserRound, X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { calculateFinancials, calculateLineTotal, PRODUCT_CATALOG, sumLineTotals, type CatalogProduct } from './lib/pricing'

let runtimeCatalog: CatalogProduct[] = [...PRODUCT_CATALOG]

// ─── Constants ────────────────────────────────────────────────────────────────
const SHOPKEEPER_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || import.meta.env.VITE_SHOPKEEPER_WHATSAPP || '923001234567'
const SAVED_CUSTOMERS = [
  ['AHMED STORE', 'MANZOOR COLONY'], ['NAZAR KHAN', 'MANZOOR COLONY'], ['HAJI HAIDER GUL', 'CANT'],
  ['QAPAS ALTAF COMPANY', 'PORT QASIM'], ['DARAKSHAN/PEHALVI HOTEL', 'SADAR'], ['SAIFUULAH DEFENSE', 'DEFENCE'],
  ['ABDUL HADI DEFENSE', 'DEFENCE'], ['YOUSUF JABBAR', 'PECHS'], ['ISMAIL VAYANI', 'BMCHS'], ['ASHRAF VAYANI', 'GULSHAN E IQBAL'],
  ['SALMAN DEHLI COLONY', 'DEHLI COLONY'], ['MAMU BHANJA RESTURANT', 'PHASE 2 EXT'], ['FARHAN SHAH FAISAL', 'SHAH FASAL COLONY'],
  ['HAKEEM SHAH', 'TARIQ ROAD'], ['FAHIM GABA', 'GULSHAN E JAMAL'], ['IRFAN GABA', 'GULSHAN E JAMAL'], ['IMRAN GABA', 'GULSHAN E JAMAL'],
  ['JAWED MOSMIYAT', 'MOSMIYAT'], ['UMER BHATIYABAD', 'BHATIYABAD'], ['BAJAJ STORE', 'MIR PUR MATHELO'], ['JANNAT SUPER STORE', 'METROWIL'],
  ['UBAID MULANA', 'HUSAINABAD'], ['ILYAS BHATIYABAD', 'BHITAYABAD'], ['TAYYAB STORE', 'HUSAINABAD'], ['M RAFEEQ', 'MACHAR COLONY'],
  ['IDRESS BHAI', 'TARIQ ROAD'], ['IBRAHIM PASATA', ''], ['MAHRAJ', 'KARADAR'], ['BABA STORE', 'LIYAQTABAD'],
  ['FAROOQ TEA POINT', ''], ['INSAF HOTEL', 'JODIA BAZAR'], ['TARIQ BROTHERS', 'JODIA BAZAR'], ['GHULAM ALI', 'DEFENCE'],
  ['IQBAL MANZOOR ENTERPRISES', ''], ['KHUWAJA MALIR', 'MALIR'], ['ZAIQA FOODS', ''], ['IMRAN BABA BHIT', 'BHIT'],
  ['M ALI KHATRI', ''], ['KHALID MARRIOT ROAD', 'MARRIOT ROAD'], ['ANWAR BHITAYABAD', 'BHITAYABAD'], ['TAHIRA BAJI', 'PHASE 8'],
  ['HAJI MURAD', ''], ['KASHIF BUFERZONE', 'BUFERZONE'], ['HASHIM SHAMMIM', ''], ['NISAR FILTER', 'GHARO'],
].map(([name, address]) => ({ name, address }))

// ─── Types ────────────────────────────────────────────────────────────────────
type Language = 'en' | 'ur'
type UnitType = 'KG' | 'GRAMS' | 'LITRE' | 'PCS' | 'PACKETS' | 'BAGS' | 'NONE'
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
  { value: 'NONE', en: 'Null / No unit', ur: 'کوئی اکائی نہیں' },
  { value: 'KG', en: 'KG', ur: 'کلو' },
  { value: 'GRAMS', en: 'Grams', ur: 'گرام' },
  { value: 'LITRE', en: 'Litre', ur: 'لیٹر' },
  { value: 'PCS', en: 'Pieces', ur: 'عدد' },
  { value: 'PACKETS', en: 'Packets', ur: 'پیکٹ' },
  { value: 'BAGS', en: 'Bags', ur: 'تھیلے' },
]

// ─── Pure helpers ─────────────────────────────────────────────────────────────
const createRow = (): OrderRow => ({ id: crypto.randomUUID(), itemName: '', quantityValue: '', unitType: 'NONE' })
const createDefaultRows = () => Array.from({ length: 8 }, createRow)

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  return digits.startsWith('0') ? `92${digits.slice(1)}` : digits
}
const validPhone = (value: string) => /^923\d{9}$/.test(normalizePhone(value))

const formatMoney = (value: number) => `Rs. ${Math.round(value || 0).toLocaleString('en-PK')}`
const isCurrentAdmin = async () => {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('is_ahwmb_admin')
  return !error && Boolean(data)
}

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

const createOrderRef = () => `#AHWMB-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(10 + Math.random() * 90)}`
const parseQuantity = (value: string) => {
  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}
const parseUnit = (value: string): UnitType =>
  /gram|g\b|گرام/i.test(value) ? 'GRAMS'
  : /litre|liter|(?:^|\s)l(?:\s|$)|لیتر/i.test(value) ? 'LITRE'
  : /packet|pack|پیکٹ/i.test(value) ? 'PACKETS'
  : /pcs|piece|عدد/i.test(value) ? 'PCS'
  : /bag|bags|تھیلا|تھیلے/i.test(value) ? 'BAGS'
  : 'NONE'

const unitLabel = (unit: UnitType, language: Language) =>
  UNIT_OPTIONS.find(o => o.value === unit)?.[language === 'ur' ? 'ur' : 'en'] || unit
const calculateAppLineTotal = (item: Pick<OrderItem, 'quantity_value' | 'unit_type' | 'unit_price' | 'rate'>) => {
  const quantity = Number(item.quantity_value) || 0
  const price = Number(item.unit_price ?? item.rate) || 0
  if (item.unit_type === 'NONE') return Math.round(price * 100) / 100
  if (item.unit_type === 'LITRE') return Math.round(quantity * price * 100) / 100
  return calculateLineTotal({ quantity_value: quantity, unit_type: item.unit_type, unit_price: price, rate: price })
}

const quantityText = (value: number, unit: UnitType, language: Language) =>
  unit === 'NONE' ? String(value || 0) : `${value || 0} ${unitLabel(unit, language)}`

const pdfQuantityText = (value: number, unit: UnitType) => {
  const qty = Number.isInteger(value) ? value : Number(value.toFixed(3))
  const label = unit === 'KG' ? 'kg' : unit === 'GRAMS' ? 'grams' : unit === 'LITRE' ? 'litres' : unit === 'PCS' ? 'pieces' : unit === 'PACKETS' ? 'packets' : unit === 'BAGS' ? 'bags' : ''
  return label ? `${qty} ${label}` : String(qty)
}

// Enter advances to the next item row without submitting the surrounding form.
// Tab is intentionally left native so the DOM order remains Item -> Qty -> Unit -> Rate.
function advanceItemRow(event: React.KeyboardEvent<HTMLElement>, addRow: () => void) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  const row = event.currentTarget.closest('tr')
  const nextRow = row?.nextElementSibling
  const focusNext = () => {
    const target = nextRow?.querySelector<HTMLElement>('[data-item-name]')
      || row?.parentElement?.lastElementChild?.querySelector<HTMLElement>('[data-item-name]')
    target?.focus()
  }
  if (nextRow) focusNext()
  else { addRow(); window.setTimeout(focusNext, 0) }
}

function autoExpandTextarea(event: React.FormEvent<HTMLTextAreaElement>) {
  const textarea = event.currentTarget
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function insertTextareaLineBreak(event: React.KeyboardEvent<HTMLTextAreaElement>, setValue: (value: string) => void) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
  const textarea = event.currentTarget
  const start = textarea.selectionStart ?? textarea.value.length
  const end = textarea.selectionEnd ?? start
  const next = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`
  setValue(next)
  window.setTimeout(() => {
    textarea.selectionStart = start + 1
    textarea.selectionEnd = start + 1
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, 0)
}

const unitRateLabel = (unit: UnitType) =>
  unit === 'PCS' ? 'Per Piece' : unit === 'PACKETS' ? 'Per Packet' : unit === 'BAGS' ? 'Per Bag' : unit === 'LITRE' ? 'Per Litre' : unit === 'NONE' ? 'Amount' : 'Per KG'

const productSuggestions = (query: string) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return runtimeCatalog.slice(0, 12)
  return runtimeCatalog
    .filter(product => product.name.toLowerCase().includes(normalized))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(normalized) ? 0 : 1
      const bStarts = b.name.toLowerCase().startsWith(normalized) ? 0 : 1
      return aStarts - bStarts
    })
    .slice(0, 12)
}

function ProductSuggestionMenu({ query, onSelect }: { query: string; onSelect: (name: string) => void }) {
  const matches = productSuggestions(query)
  if (!matches.length) return null
  return <div className="item-suggestions" role="listbox">
    {matches.map(product => (
      <button key={product.name} type="button" role="option" onMouseDown={e => e.preventDefault()} onClick={() => onSelect(product.name)}>
        <span>{product.name}</span><small>{product.category}</small>
      </button>
    ))}
  </div>
}

const safeItems = (items: unknown): OrderItem[] => {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const v = item as Partial<OrderItem>
    const rawQuantity = String(v.quantity || '')
    const quantityValue = Number(v.quantity_value) || parseQuantity(rawQuantity)
    const rawUnit = v.unit_type
    const candidateUnit = rawUnit === 'KG' || rawUnit === 'GRAMS' || rawUnit === 'LITRE' || rawUnit === 'PCS' || rawUnit === 'PACKETS' || rawUnit === 'BAGS' || rawUnit === 'NONE'
      ? rawUnit : parseUnit(rawQuantity)
    // Keep submissions aligned with the existing Supabase check constraint.
    const unitType: UnitType = candidateUnit === 'KG' || candidateUnit === 'GRAMS' || candidateUnit === 'LITRE' || candidateUnit === 'PCS' || candidateUnit === 'PACKETS' || candidateUnit === 'BAGS' || candidateUnit === 'NONE'
      ? candidateUnit : 'NONE'
    const unitPrice = Number(v.unit_price ?? v.rate) || 0
    const total = unitType === 'GRAMS'
      ? calculateAppLineTotal({ quantity_value: quantityValue, unit_type: unitType, unit_price: unitPrice, rate: unitPrice })
      : v.total !== undefined && v.total !== null && Number.isFinite(Number(v.total))
      ? Number(v.total)
      : calculateAppLineTotal({ quantity_value: quantityValue, unit_type: unitType, unit_price: unitPrice, rate: unitPrice })
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
    number: 'No.', item: 'Item Name', quantity: 'Qty/Wt', unit: 'Unit', rate: 'Rate', total: 'Total',
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
    unitPrice: 'Rate Per Unit', lineTotal: 'Total', editTotal: 'You can manually override line totals',
    addAdmin: 'Add Item', remove: 'Remove',
    savePrint: 'Save & Print Invoice', sharePdf: 'Share PDF File', balance: 'Balance', deposit: 'Deposit', remaining: 'Remaining Balance', saving: 'Generating PDF…', refresh: 'Refresh', reports: 'Daily Reports', ordersView: 'Orders',
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
    savePrint: 'محفوظ کریں اور رسید پرنٹ کریں', sharePdf: 'PDF فائل شیئر کریں', balance: 'کل بیلنس', deposit: 'جمع رقم', remaining: 'باقی بیلنس', saving: 'PDF بن رہی ہے…', refresh: 'تازہ کریں', reports: 'روزانہ رپورٹس', ordersView: 'آرڈرز',
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

// Invoice output must not round decimal rates, quantities, or totals to integers.
// Keep up to two meaningful decimal places while preserving values such as 128.5.
const invoiceNumber = (value: number) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0'
  const [whole, rawFraction] = numeric.toFixed(2).split('.')
  const fraction = rawFraction.replace(/0+$/, '')
  return `${Number(whole).toLocaleString('en-PK')}${fraction ? `.${fraction}` : ''}`
}
const invoiceFilename = (customerName: string) => {
  const safeName = customerName.trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Customer'
  return `${safeName}_Sales_Invoice.pdf`
}

// ── Invoice cell style constants (inline = immune to print-CSS cascade) ────────
const INV_BASE: React.CSSProperties = {
  border: '1px solid #050505',
  padding: '2.5mm 2mm',
  fontWeight: 800,
  color: '#000000',
  fontSize: '11px',
  verticalAlign: 'middle',
  overflowWrap: 'anywhere',
  lineHeight: 1.25,
}
const INV_TH_C: React.CSSProperties = { ...INV_BASE, textAlign: 'center', background: '#050505', color: '#ffffff', fontSize: '11px' }
const INV_TH_L: React.CSSProperties = { ...INV_TH_C, textAlign: 'left' }
const INV_TD_C: React.CSSProperties = { ...INV_BASE, textAlign: 'center' }
const INV_TD_L: React.CSSProperties = { ...INV_BASE, textAlign: 'left' }
const INV_FOOT_C: React.CSSProperties = { ...INV_BASE, textAlign: 'center', borderColor: '#777777', background: '#ffffff' }
const INV_FOOT_L: React.CSSProperties = { ...INV_FOOT_C, textAlign: 'left' }
const INV_FOOT_R: React.CSSProperties = { ...INV_FOOT_C, textAlign: 'right' }

function InvoiceDocument({ order, items, financials }: InvoicePayload) {
  return (
    <article className="invoice-document" dir="ltr">
      <header className="invoice-header">
        <h1>SALES INVOICE</h1>
        <table className="invoice-customer-bar"><tbody><tr>
          <td><span className="inv-clabel">Customer Name:</span><span className="inv-cval">{order.customer_name || '—'}</span></td>
          <td><span className="inv-clabel">Date:</span><span className="inv-cval">{formatDateShort(order.created_at)}</span></td>
        </tr></tbody></table>
      </header>

      <table className="invoice-table">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '36%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '19%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={INV_TH_C}>S.No</th>
            <th style={INV_TH_L}>Item</th>
            <th style={INV_TH_C}>Quantity</th>
            <th style={INV_TH_C}>Per KG/Gram/Piece</th>
            <th style={INV_TH_C}>Amount (PKR)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.sr}-${index}`}>
              <td style={INV_TD_C}>{index + 1}</td>
              <td style={{ ...INV_TD_L, whiteSpace: 'pre-wrap' }}>{item.name || '—'}</td>
              <td style={INV_TD_C}>{pdfQuantityText(item.quantity_value, item.unit_type)}</td>
              <td style={INV_TD_C}>{item.unit_price > 0 ? invoiceNumber(item.unit_price) : ''}</td>
              <td style={INV_TD_C}>{invoiceNumber(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="invoice-financials" aria-label="Invoice financial summary"><tbody><tr>
        <td><strong>TOTAL AMOUNT</strong><span>Rs. {invoiceNumber(financials.totalAmount)}</span></td>
        <td><strong>BALANCE</strong><span>Rs. {invoiceNumber(financials.balance)}</span></td>
        <td><strong>TOTAL BALANCE</strong><span>Rs. {invoiceNumber(financials.totalBalance)}</span></td>
        <td><strong>DEPOSIT</strong><span>Rs. {invoiceNumber(financials.deposit)}</span></td>
        <td><strong>REMAINING BALANCE</strong><span>Rs. {invoiceNumber(financials.remainingBalance)}</span></td>
      </tr></tbody></table>
      <table className="invoice-total-amount"><tbody><tr>
        <td><strong>Remaining Balance:</strong></td>
        <td><strong>Rs. {invoiceNumber(financials.remainingBalance)}</strong></td>
      </tr></tbody></table>
      <footer className="invoice-footer">
        <em className="inv-ftr-ty">Thank You</em>
        {/* <span className="inv-ftr-sub">For Doing Business With Us</span> */}
      </footer>
    </article>
  )
}

const invoicePrintCss = `
  @page { size: A4 portrait; margin: 10mm; }
  *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #fff; color: #000; font-family: Georgia, 'Times New Roman', serif; font-weight: 750; }
  .invoice-document { width: 100%; max-width: 190mm; margin: 0 auto; padding: 6mm; border: 3px double #050505; font-size: 11px; }
  .invoice-header { text-align: center; margin-bottom: 4mm; }
  .invoice-header h1 { display: inline-block; margin: 0 auto; border: 2.5px solid #050505; padding: 2mm 10mm; font-size: 22px; line-height: 1.2; font-weight: 900; letter-spacing: .05em; }
  /* Customer bar — fixed two-column layout, no overflow */
  .invoice-customer-bar { width: calc(100% - 8mm); border-collapse: collapse; border: 2px solid #050505; margin: 4mm auto; font-size: 12px; font-weight: 750; table-layout: fixed; }
  .invoice-customer-bar td { padding: 3mm 4mm; font-weight: 750; color: #000; vertical-align: middle; overflow: hidden; }
  .invoice-customer-bar td:first-child { width: 63%; }
  .invoice-customer-bar td:last-child  { width: 37%; border-left: 2px solid #050505; }
  .inv-clabel { font-size: 11px; font-weight: 750; white-space: nowrap; }
  .inv-cval   { display: block; border-bottom: 1.5px solid #050505; padding-bottom: 1mm; margin-top: 1mm; font-size: 13px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .invoice-table { width: calc(100% - 8mm); margin-left:auto; margin-right:auto; border-collapse: collapse; table-layout: fixed; page-break-inside: auto; }
  .invoice-table thead { display: table-header-group; }
  .invoice-table tr { page-break-inside: avoid; page-break-after: auto; }
  .invoice-financials { width: calc(100% - 8mm); margin-left:auto; margin-right:auto; border-collapse: collapse; border: 2px solid #050505; margin-top: 5mm; page-break-inside: avoid; }
  .invoice-financials td { width: 20%; border-right: 1px solid #050505; text-align: center; font-weight: 750; color: #000; }
  .invoice-financials td:last-child { border-right: 0; }
  .invoice-financials strong { display: block; background: #000; color: #fff; font-weight: 900; padding: 2mm 1mm; font-size: 9px; letter-spacing: .04em; text-transform: uppercase; }
  .invoice-financials span { display: block; padding: 4mm 1mm; font-size: 13px; color: #000; font-weight: 750; }
  .invoice-total-amount { width: calc(100% - 8mm); margin-left:auto; margin-right:auto; border-collapse: collapse; border: 2px solid #050505; margin-top: 4mm; font-size: 16px; font-weight: 900; page-break-inside: avoid; }
  .invoice-total-amount td { padding: 4mm 7mm; font-weight: 900; color: #000; }
  .invoice-total-amount td:last-child { text-align: right; }
  /* Footer — plain cursive joining text only */
  .invoice-footer { text-align: center; margin-top: 7mm; }
  .inv-ftr-ty  { display: block; font-family: "Brush Script MT", cursive; font-size: 28px; font-weight: 400; font-style: italic; color: #000; line-height: 1.1; }
  .inv-ftr-sub { display: block; font-family: "Brush Script MT", cursive; font-size: 17px; font-weight: 400; font-style: italic; color: #000; margin-top: 2mm; }
  @media print { .invoice-document { border-width: 3px; } }
`

// ── Pure-string invoice HTML generator ────────────────────────────────────────
// Matches the reference design: wheat SVG logo, ornate corner frame,
// underline-style customer bar, black header row, auto multi-page support.
function buildInvoiceHtml(payload: InvoicePayload): string {
  const { order, items, financials } = payload

  // ── Shared inline style strings ──────────────────────────────────────────
  const F = 'font-family:Georgia,"Times New Roman",serif;'
  const TH = `${F}background:#000;color:#fff;font-weight:900;font-size:12px;padding:8px 6px;text-align:center;border:2px solid #000;vertical-align:middle;`
  const TH_L = `${TH}text-align:left;`
  const TD = `${F}font-weight:800;font-size:13px;color:#000;padding:8px 6px;text-align:center;border:1.5px solid #000;vertical-align:middle;`
  const TD_L = `${TD}text-align:left;white-space:pre-wrap;font-weight:900;`
  const FT = `${F}font-weight:700;font-size:12px;color:#000;padding:7px 6px;border:1.5px solid #000;vertical-align:middle;`

  // ── Corner SVG ornament ───────────────────────────────────────────────────
  const corner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="36" height="36">
    <path d="M2,2 L38,2 L38,6 L6,6 L6,38 L2,38 Z" fill="#000"/>
    <path d="M10,10 L20,10 L10,20 Z" fill="#000"/>
    <rect x="22" y="10" width="6" height="6" fill="#000"/>
    <rect x="10" y="22" width="6" height="6" fill="#000"/>
  </svg>`

  // ── Data rows ─────────────────────────────────────────────────────────────
  // Convert \n to <br> and escape HTML special chars in item names
  const escHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const nameHtml = (name: string) => escHtml(name || '—').replace(/\n/g, '<br>')

  const dataRows = items.map((item, i) => `
    <tr>
      <td style="${TD}">${i + 1}</td>
      <td dir="auto" style="${TD_L}unicode-bidi:plaintext;line-height:1.8;">${nameHtml(item.name)}</td>
      <td style="${TD}">${pdfQuantityText(item.quantity_value, item.unit_type)}</td>
      <td style="${TD}">${item.unit_price > 0 ? invoiceNumber(item.unit_price) : ''}</td>
      <td style="${TD}">${invoiceNumber(item.total)}</td>
    </tr>`).join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <style>
    @page { size:A4 portrait; margin:12mm; }
    *, *::before, *::after { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    html, body { margin:0; padding:0; background:#fff; font-family:Georgia,"Times New Roman",serif; font-size:13px; color:#000; font-weight:700; }

    /* ── Outer frame ── */
    .page { position:relative; width:100%; padding:8mm; border:3px solid #000; }
    @media print { body { counter-reset: page; } .print-continuation { position:fixed; bottom:0; left:0; right:0; text-align:center; font-size:10px; padding:2mm; background:#fff; border-top:1px solid #000; } .print-continuation::after { content:' ➡️ Continued on Next Page / Page ' counter(page) ' of ' counter(pages); } .print-origin { position:fixed; top:0; left:0; right:0; text-align:center; font-size:10px; background:#fff; } .print-origin::after { content:'⬅️ Continued from Page 1 / Page ' counter(page) ' of ' counter(pages); } }
    .page::before {
      content:'';
      position:absolute; inset:4px;
      border:1.5px solid #000;
      pointer-events:none;
    }

    /* ── Corner ornaments ── */
    .corner { position:absolute; width:36px; height:36px; }
    .corner--tl { top:4px; left:4px; }
    .corner--tr { top:4px; right:4px; transform:scaleX(-1); }
    .corner--bl { bottom:4px; left:4px; transform:scaleY(-1); }
    .corner--br { bottom:4px; right:4px; transform:scale(-1); }

    /* ── Header ── */
    .hdr { text-align:center; margin-bottom:5mm; }
    .inv-title { display:inline-block; border:3px solid #000; padding:3mm 12mm; font-size:26px; font-weight:900; letter-spacing:.06em; font-family:Georgia,"Times New Roman",serif; }

    /* ── Customer bar ── */
    /* Two fixed columns: name side gets 65%, date side 35% — no overlap ever */
    .cbar { width:calc(100% - 8mm); border-collapse:collapse; border:2px solid #000; margin:5mm auto; font-size:13px; table-layout:fixed; }
    .cbar td { padding:3mm 5mm; font-weight:700; color:#000; border:none; vertical-align:middle; overflow:hidden; }
    .cbar td:first-child { width:65%; }
    .cbar td:last-child  { width:35%; border-left:2px solid #000; }
    .cbar .clabel { font-size:12px; font-weight:700; white-space:nowrap; }
    .cbar .cval {
      display:block;
      border-bottom:1.5px solid #000;
      padding-bottom:1mm; margin-top:1mm;
      font-size:14px; font-weight:900;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }

    /* ── Main invoice table ── */
    .inv { width:calc(100% - 8mm); margin-left:auto; margin-right:auto; border-collapse:collapse; table-layout:fixed; page-break-inside:auto; }
    .inv thead { display:table-header-group; }
    .inv tr { page-break-inside:avoid; page-break-after:auto; }

    /* ── Financials block ── */
    .fin-wrap { page-break-inside:auto; break-inside:auto; margin-top:4mm; }
    .fin { width:calc(100% - 8mm); margin-left:auto; margin-right:auto; border-collapse:collapse; border:2.5px solid #000; }
    .fin td { width:20%; border-right:2px solid #000; text-align:center; padding:0; font-weight:700; color:#000; }
    .fin td:last-child { border-right:none; }
    .fin .lbl { display:block; background:#000; color:#fff; font-weight:900; font-size:10px; letter-spacing:.04em; padding:3mm 2mm; border-bottom:none; text-transform:uppercase; }
    .fin .val { display:block; padding:5mm 2mm; font-size:15px; font-weight:900; color:#000; font-family:Georgia,"Times New Roman",serif; }

    /* ── Remaining balance row ── */
    .rem { width:calc(100% - 8mm); margin-left:auto; margin-right:auto; border-collapse:collapse; border:2.5px solid #000; margin-top:3mm; font-size:18px; font-weight:900; page-break-inside:avoid; break-inside:avoid; }
    .rem td { padding:4mm 8mm; font-weight:900; color:#000; }
    .rem td:last-child { text-align:right; }

    /* ── Footer — plain cursive joining text, no extra decoration ── */
    .ftr { text-align:center; margin-top:8mm; }
    .ftr-ty  { font-family:"Brush Script MT","URW Chancery L","Comic Sans MS",cursive; font-size:30px; font-weight:400; font-style:italic; color:#000; display:block; line-height:1.1; }
    .ftr-sub { font-family:"Brush Script MT","URW Chancery L","Comic Sans MS",cursive; font-size:18px; font-weight:400; font-style:italic; color:#000; display:block; margin-top:2mm; line-height:1.2; }
  </style>
  </head><body>

  <div class="print-origin" aria-hidden="true"></div><div class="print-continuation" aria-hidden="true"></div>
  <div class="page">
    <!-- Corner ornaments -->
    <div class="corner corner--tl">${corner}</div>
    <div class="corner corner--tr">${corner}</div>
    <div class="corner corner--bl">${corner}</div>
    <div class="corner corner--br">${corner}</div>

    <!-- Header -->
    <div class="hdr">
      <span class="inv-title">SALES INVOICE</span>
    </div>

    <!-- Customer bar -->
    <table class="cbar"><tbody><tr>
      <td>
        <span class="clabel">Customer Name:</span>
        <span class="cval" dir="auto">${escHtml(order.customer_name || '—')}</span>
      </td>
      <td>
        <span class="clabel">Date:</span>
        <span class="cval">${formatDateShort(order.created_at)}</span>
      </td>
    </tr></tbody></table>

    <!-- Invoice table -->
    <table class="inv">
      <colgroup>
        <col style="width:9%">
        <col style="width:36%">
        <col style="width:16%">
        <col style="width:20%">
        <col style="width:19%">
      </colgroup>
      <thead><tr>
        <th style="${TH}">S.No</th>
        <th style="${TH_L}">Item</th>
        <th style="${TH}">Quantity</th>
        <th style="${TH}">Per KG/Gram/Piece</th>
        <th style="${TH}">Amount (PKR)</th>
      </tr></thead>
      <tbody>
        ${dataRows}
      </tbody>
    </table>

    <!-- Financials (always at end, page-break-inside:avoid keeps them together) -->
    <div class="fin-wrap">
      <table class="fin"><tbody><tr>
        <td><span class="lbl">TOTAL AMOUNT</span><span class="val">Rs. ${invoiceNumber(financials.totalAmount)}</span></td>
        <td><span class="lbl">BALANCE</span><span class="val">Rs. ${invoiceNumber(financials.balance)}</span></td>
        <td><span class="lbl">TOTAL BALANCE</span><span class="val">Rs. ${invoiceNumber(financials.totalBalance)}</span></td>
        <td><span class="lbl">DEPOSIT</span><span class="val">Rs. ${invoiceNumber(financials.deposit)}</span></td>
        <td><span class="lbl">REMAINING BALANCE</span><span class="val">Rs. ${invoiceNumber(financials.remainingBalance)}</span></td>
      </tr></tbody></table>

      <table class="rem"><tbody><tr>
        <td><strong>Remaining Balance:</strong></td>
        <td><strong>Rs. ${invoiceNumber(financials.remainingBalance)}</strong></td>
      </tr></tbody></table>

      <!-- Footer — plain cursive joining text only -->
      <div class="ftr">
        <span class="ftr-ty">Thank You</span>
        <span class="ftr-sub">For Doing Business With Us</span>
      </div>
    </div>
  </div>

  </body></html>`
}

async function waitForInvoiceAssets(printDocument: Document) {
  const fontReady = printDocument.fonts?.ready ?? Promise.resolve()
  const imageReady = [...printDocument.images].map(image => {
    if (image.complete) return Promise.resolve()
    if (typeof image.decode === 'function') return image.decode().catch(() => undefined)
    return new Promise<void>(resolve => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
      window.setTimeout(resolve, 4000)
    })
  })
  await Promise.race([Promise.allSettled([fontReady, ...imageReady]), new Promise(resolve => window.setTimeout(resolve, 5000))])
}
function printInvoiceHtml(html: string) {
  const iframe = document.createElement('iframe')
  iframe.title = 'Invoice print preview'
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  iframe.srcdoc = html
  iframe.onload = async () => {
    try {
      const printWindow = iframe.contentWindow
      if (!printWindow) throw new Error('Print preview could not be opened.')
      await waitForInvoiceAssets(printWindow.document)
      printWindow.focus()
      printWindow.print()
    } catch (error) {
      console.error('Invoice browser-print fallback:', error)
      try {
        const fallbackWindow = iframe.contentWindow
        if (!fallbackWindow) throw error
        fallbackWindow.focus()
        fallbackWindow.print()
      } catch (fallbackError) {
        console.error('Invoice print fallback failed:', fallbackError)
        try {
          const fallbackTab = window.open('', '_blank')
          if (fallbackTab) {
            fallbackTab.document.open()
            fallbackTab.document.write(html)
            fallbackTab.document.close()
            await waitForInvoiceAssets(fallbackTab.document)
            fallbackTab.focus()
            fallbackTab.print()
          }
        } catch (tabError) {
          console.error('Invoice new-window print fallback failed:', tabError)
        }
      }
    } finally {
      window.setTimeout(() => iframe.remove(), 1800)
    }
  }
  document.body.appendChild(iframe)
}

// ── Pure-jsPDF invoice — no autoTable plugin ─────────────────────────────
async function drawInvoice(
  order: InvoicePayload['order'],
  items: OrderItem[],
  _grandTotal: number,
  financials: InvoicePayload['financials'],
  filename: string,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5', compress: true })
  await document.fonts.ready
  // Browser shaping preserves Urdu joins and Unicode glyphs unsupported by Times.
  const unicodeName = (text: string, width: number) => {
    if (!/[^\x00-\x7F]/.test(text)) return null
    const scale = 12
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Invoice text rendering is unavailable')
    const font = 'bold 46px "Noto Naskh Arabic", Arial, sans-serif'
    ctx.font = font
    const lines: string[] = []
    for (const paragraph of text.split(/\r?\n/)) {
      let line = ''
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word
        if (line && ctx.measureText(candidate).width > canvas.width - 16) {
          lines.push(line)
          line = word
        } else line = candidate
      }
      lines.push(line)
    }
    const lineHeight = 80
    canvas.height = lines.length * lineHeight + 24
    ctx.font = font
    ctx.fillStyle = '#000'
    ctx.textBaseline = 'middle'
    lines.forEach((line, index) => {
      const rtl = /^[^A-Za-z\u0600-\u06ff]*[\u0600-\u06ff]/.test(line)
      ctx.direction = rtl ? 'rtl' : 'ltr'
      ctx.textAlign = rtl ? 'right' : 'left'
      ctx.fillText(line, rtl ? canvas.width - 8 : 8, 12 + (index + 0.5) * lineHeight, canvas.width - 16)
    })
    return { canvas, height: canvas.height / scale }
  }
  const PW = 148, PH = 210, M = 8

  // Double-border frame with corner ornaments
  const drawFrame = () => {
    doc.setDrawColor(0); doc.setLineWidth(0.8)
    doc.rect(M, M, PW - M*2, PH - M*2)
    doc.setLineWidth(0.3)
    doc.rect(M+2, M+2, PW-M*2-4, PH-M*2-4)
    doc.setFillColor(0)
    const corners: [number,number][] = [[M+2,M+2],[PW-M-2,M+2],[M+2,PH-M-2],[PW-M-2,PH-M-2]]
    corners.forEach(([cx2, cy]) => {
      const sx = cx2 === M+2 ? 1 : -1, sy = cy === M+2 ? 1 : -1
      doc.rect(cx2, cy, sx*6, sy*1.2, 'F')
      doc.rect(cx2, cy, sx*1.2, sy*6, 'F')
      doc.rect(cx2+sx*3, cy+sy*3, sx*2.5, sy*2.5, 'F')
    })
  }
  drawFrame()

  // SALES INVOICE title box
  const cx = PW/2, titleY = M+12
  doc.setFont('times','bold'); doc.setFontSize(17); doc.setTextColor(0)
  doc.text('SALES INVOICE', cx, titleY+7, {align:'center'})
  doc.setLineWidth(0.7); doc.rect(cx-40, titleY, 80, 11)

  // Customer / Date bar
  const barY = titleY+15, barH = 14
  const bL = M+9, bW = PW-M*2-18, divX = bL + bW*0.63
  doc.setLineWidth(0.5); doc.rect(bL, barY, bW, barH)
  doc.line(divX, barY, divX, barY+barH)
  doc.setFont('times','bold'); doc.setFontSize(8.5); doc.setTextColor(0)
  doc.text('Customer Name:', bL+4, barY+6)
  const nameLines = doc.splitTextToSize(order.customer_name || '—', divX - (bL+34) - 3)
  const customerImage = unicodeName(order.customer_name || '', divX - (bL+34) - 3)
  doc.setFontSize(9)
  if (customerImage) {
    doc.addImage(customerImage.canvas, 'PNG', bL+34, barY+1, divX-(bL+34)-3, Math.min(7, customerImage.height))
  } else doc.text(nameLines[0] ?? '', bL+34, barY+6)
  doc.setLineWidth(0.3); doc.line(bL+34, barY+8, divX-3, barY+8)
  doc.setFontSize(10); doc.text('Date:', divX+4, barY+6)
  doc.setFontSize(11); doc.text(formatDateShort(order.created_at), divX+18, barY+6)
  doc.setLineWidth(0.3); doc.line(divX+18, barY+8, bL+bW-3, barY+8)

  // ── Items table (pure jsPDF, no autoTable) ────────────────────────────
  const TL = M+5, TW = PW-M*2-10
  // Compact A5 columns: S.No, Item, Quantity, Rate, Amount.
  const CX = [TL, TL+10, TL+50, TL+75, TL+101]
  const CW = [10,    40,    25,    26,     26]
  const HDR_H = 10

  const drawItemsHeader = (y: number): number => {
    doc.setFillColor(0); doc.setDrawColor(0); doc.setLineWidth(0.4)
    doc.rect(TL, y, TW, HDR_H, 'FD')
    for (let i = 1; i < 5; i++) doc.line(CX[i], y, CX[i], y+HDR_H)
    doc.setFont('times','bold'); doc.setFontSize(7.5); doc.setTextColor(255)
    const hdrs = ['S.No','Item','Quantity','Per KG/Gram/Piece','Amount (PKR)']
    for (let i = 0; i < 5; i++) {
      const mx = CX[i] + CW[i]/2
      if (i === 3) {
        doc.text('Per', mx, y+4.5, {align:'center'})
        doc.text('KG/Gram/Piece', mx, y+8, {align:'center'})
      } else {
        doc.text(hdrs[i], mx, y+HDR_H/2+2, {align:'center'})
      }
    }
    doc.setTextColor(0)
    return y + HDR_H
  }

  let curY = barY + barH + 4
  curY = drawItemsHeader(curY)
  doc.setFont('times','bold'); doc.setFontSize(8.5); doc.setTextColor(0)

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    const nameLines2 = doc.splitTextToSize(item.name || '—', CW[1]-4)
    const nameImage = unicodeName(item.name || '', CW[1]-4)
    const rh = Math.max(7, (nameImage ? Math.min(nameImage.height, 6) : nameLines2.length * 4) + 3)
    // Page break
    if (curY + rh > PH - M - 40) {
      doc.addPage(); drawFrame(); curY = M+16
      curY = drawItemsHeader(curY)
      doc.setFont('times','bold'); doc.setFontSize(11); doc.setTextColor(0)
    }
    doc.setDrawColor(0); doc.setLineWidth(0.4)
    doc.rect(TL, curY, TW, rh)
    for (let i = 1; i < 5; i++) doc.line(CX[i], curY, CX[i], curY+rh)
    const midY = curY + rh/2 + 1.5
    doc.text(String(idx+1),                                    CX[0]+CW[0]/2, midY, {align:'center'})
    if (nameImage) {
      doc.addImage(nameImage.canvas, 'PNG', CX[1]+1.5, curY+1.5, CW[1]-3, Math.min(nameImage.height, rh-2))
    } else doc.text(nameLines2, CX[1]+1.5, curY+2.5+2.5)
    doc.text(pdfQuantityText(item.quantity_value, item.unit_type), CX[2]+CW[2]/2, midY, {align:'center'})
    doc.text(item.unit_price > 0 ? invoiceNumber(item.unit_price) : '—', CX[3]+CW[3]/2, midY, {align:'center'})
    doc.text(invoiceNumber(item.total),                        CX[4]+CW[4]/2, midY, {align:'center'})
    curY += rh
  }

  // ── Financials (5-col) ────────────────────────────────────────────────
  const FCW = TW / 5   // 34.8 mm per column
  const FH  = 8, FRH = 9
  if (curY + 5 + FH + FRH + 28 > PH - M) { doc.addPage(); drawFrame(); curY = M+16 }
  const fY = curY + 5

  doc.setFillColor(0); doc.setDrawColor(0); doc.setLineWidth(0.4)
  doc.rect(TL, fY, TW, FH, 'FD')
  doc.setFont('times','bold'); doc.setFontSize(6.2); doc.setTextColor(255)
  const fHdrs = ['TOTAL AMOUNT','BALANCE','TOTAL BALANCE','DEPOSIT','REMAINING BALANCE']
  for (let i = 0; i < 5; i++) {
    const fx = TL + i*FCW
    if (i > 0) doc.line(fx, fY, fx, fY+FH)
    const ls = doc.splitTextToSize(fHdrs[i], FCW-1)
    doc.text(ls, fx+FCW/2, fY+FH/2+(ls.length>1?0:1.5), {align:'center'})
  }
  const fDY = fY + FH
  doc.rect(TL, fDY, TW, FRH)
  doc.setFont('times','bold'); doc.setFontSize(8); doc.setTextColor(0)
  const fVals = [
    `Rs. ${invoiceNumber(financials.totalAmount)}`,
    `Rs. ${invoiceNumber(financials.balance)}`,
    `Rs. ${invoiceNumber(financials.totalBalance)}`,
    `Rs. ${invoiceNumber(financials.deposit)}`,
    `Rs. ${invoiceNumber(financials.remainingBalance)}`,
  ]
  for (let i = 0; i < 5; i++) {
    const fx = TL + i*FCW
    if (i > 0) doc.line(fx, fDY, fx, fDY+FRH)
    doc.text(fVals[i], fx+FCW/2, fDY+FRH/2+2, {align:'center'})
  }

  // ── Remaining balance box ─────────────────────────────────────────────
  const rY = fDY + FRH + 3, rH = 10
  doc.setLineWidth(0.6); doc.rect(TL, rY, TW, rH)
  doc.setFont('times','bold'); doc.setFontSize(10); doc.setTextColor(0)
  doc.text('Remaining Balance:', TL+4, rY+rH/2+2)
  doc.text(`Rs. ${invoiceNumber(financials.remainingBalance)}`, TL+TW-3, rY+rH/2+2, {align:'right'})

  // ── Footer ────────────────────────────────────────────────────────────
  doc.setFontSize(13); doc.setFont('times','bolditalic'); doc.setTextColor(0)
  doc.text('Thank You', PW/2, rY+rH+14, {align:'center'})

  // Resolve the blob before triggering the browser download. This avoids
  // Safari/Chromium races where save() can run before jsPDF has finished
  // serialising the document.
  const blob = doc.output('blob') as Blob
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return blob
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
  const [cartOpen, setCartOpen] = useState(false)
  const [cartPrompt, setCartPrompt] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [expandedCategories] = useState<Set<string>>(() => new Set(runtimeCatalog.map(product => product.category)))
  const [orderSearch, setOrderSearch] = useState('')
  const [orderSearchOpen, setOrderSearchOpen] = useState(false)
  const [suggestionRowId, setSuggestionRowId] = useState<string | null>(null)

  const catalogMatches = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase()
    if (!query) return runtimeCatalog.slice(0, 10)
    return runtimeCatalog.filter(product =>
      `${product.name} ${product.category}`.toLowerCase().includes(query)
    ).slice(0, 12)
  }, [catalogSearch])

  const orderSearchMatches = useMemo(() => {
    const query = orderSearch.trim().toLowerCase()
    if (!query) return []
    return runtimeCatalog.filter(product =>
      `${product.name} ${product.category}`.toLowerCase().includes(query)
    ).slice(0, 12)
  }, [orderSearch])

  const catalogGroups = useMemo(() => {
    const groups = new Map<string, CatalogProduct[]>()
    runtimeCatalog.forEach(product => {
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
    addToast(`✓ ${productName} added to order list!`, 'success')
  }

  const filledRows = useMemo(
    () => rows.filter(r => r.itemName.trim() || r.quantityValue.trim()),
    [rows]
  )
  const hasContent = filledRows.length > 0 || notes.trim().length > 0

  const addToCart = () => {
    const next: FormErrors = {}
    if (!name.trim()) next.name = t.errors.name
    if (!validPhone(phone)) next.phone = t.errors.phone
    if (!address.trim()) next.address = t.errors.address
    if (!hasContent || filledRows.some(r => !r.itemName.trim() || !r.quantityValue.trim())) next.items = t.errors.items
    setErrors(next)
    if (Object.keys(next).length) return
    setCartPrompt(true)
  }

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
      const message = readableError(err)
      addToast(message && message !== '[object Object]' ? `Order could not be saved: ${message}` : t.errors.submit, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={`app-shell ${isRtl ? 'rtl-mode' : 'ltr-mode'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <PortalHeader language={language} setLanguage={setLanguage} onAdmin={onAuth} isAuthenticated={isAuthenticated} />
      <ToastContainer toasts={toasts} dismiss={dismiss} />

      <div className="page-wrap">
        <section className="image-hero" aria-label="AHWMB premium products">
          <picture>
            <source media="(min-width: 768px)" srcSet="/images/ahwmb-hero-desktop.png" />
            <img src="/images/ahwmb-hero.png" alt="AHWMB premium rice, pulses and spices delivery" />
          </picture>
          <div className="image-hero-shade" aria-hidden="true" />
          <div className="image-hero-copy" dir={isRtl ? 'rtl' : 'ltr'}>
            <span className="image-hero-kicker">{isRtl ? 'جوڑیا بازار · کراچی' : 'JODIA BAZAAR · KARACHI'}</span>
            <h2>{isRtl ? <>اعلیٰ معیار کے چاول، دالیں <strong>اور مصالحے</strong></> : <>Premium Rice,<br />Pulses <strong>&amp; Spices</strong></>}</h2>
            <p>{isRtl ? 'آدم حاجی ولی محمد اینڈ برادرز سے براہ راست آرڈر کریں — 1965 سے قابل اعتماد ہول سیل سپلائرز۔' : 'Order directly from Adam Haji Wali Muhammad & Brothers — trusted wholesale suppliers since 1965.'}</p>
            <a href="#customer-details" className="image-hero-cta"><span>🛒</span>{isRtl ? ' اپنا آرڈر دیں' : ' Place Your Order'}</a>
          </div>
        </section>
        {/* Customer details */}
        <section className="card" id="customer-details">
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

          {/* Search bar above order list */}
          <div className="catalog-picker" style={{ marginBottom: '0.75rem', position: 'relative' }}>
            <label className="field-label" htmlFor="order-list-search">
              {language === 'ur' ? 'سامان تلاش کریں اور شامل کریں' : 'Search & add item to order'}
            </label>
            <input
              id="order-list-search"
              className="catalog-search"
              value={orderSearch}
              onChange={e => { setOrderSearch(e.target.value); setOrderSearchOpen(true) }}
              onFocus={() => setOrderSearchOpen(true)}
              onBlur={() => setTimeout(() => setOrderSearchOpen(false), 150)}
              onKeyDown={e => {
                if (e.key === 'Enter' && orderSearchMatches[0]) {
                  e.preventDefault()
                  addCatalogProduct(orderSearchMatches[0].name)
                  setOrderSearch('')
                  setOrderSearchOpen(false)
                }
              }}
              placeholder={language === 'ur' ? 'چاول، دال، مصالحہ تلاش کریں…' : 'Search rice, pulses, spices…'}
              autoComplete="off"
            />
            {orderSearchOpen && orderSearchMatches.length > 0 && (
              <div className="catalog-results" role="listbox">
                {orderSearchMatches.map(product => (
                  <button key={product.name} type="button" onMouseDown={e => e.preventDefault()} onClick={() => {
                    addCatalogProduct(product.name)
                    setOrderSearch('')
                    setOrderSearchOpen(false)
                  }}>
                    <span>{product.name}</span><small>{product.category}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table className="order-table customer-order-table">
              <thead>
                <tr>
                  <th className="col-sr">{t.number}</th>
                  <th className="col-item">{t.item}</th>
                  <th className="col-qty">{t.quantity}</th>
                  <th className="col-unit">{t.unit}</th>
                  <th className="col-del"><span className="sr-only">{t.delete}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="col-sr td-sr">{index + 1}</td>
                    <td>
                      <div className="item-typeahead">
                        <input
                          className="cell-input"
                          data-item-name
                          onFocus={() => setSuggestionRowId(row.id)}
                          onBlur={() => window.setTimeout(() => setSuggestionRowId(null), 150)}
                          value={row.itemName}
                          onChange={e => updateRow(row.id, 'itemName', e.target.value)}
                          placeholder={t.itemPh}
                          aria-label={`${t.item} ${index + 1}`}
                          list={`product-suggestions-${row.id}`}
                          autoComplete="off"
                        />
                        {suggestionRowId === row.id && <ProductSuggestionMenu query={row.itemName} onSelect={name => { updateRow(row.id, 'itemName', name); setSuggestionRowId(null) }} />}
                        <datalist id={`product-suggestions-${row.id}`}>
                          {productSuggestions(row.itemName).map(product => <option key={product.name} value={product.name} />)}
                        </datalist>
                      </div>
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        onKeyDown={e => advanceItemRow(e, () => setRows(curr => [...curr, createRow()]))}
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
                          onKeyDown={e => advanceItemRow(e, () => setRows(curr => [...curr, createRow()]))}
                          value={row.unitType === 'NONE' ? '' : row.unitType}
                          onChange={e => updateRow(row.id, 'unitType', e.target.value || 'NONE')}
                          aria-label={`${t.unit} ${index + 1}`}
                        >
                          <option value="">Select Unit</option>
                          {UNIT_OPTIONS.filter(o => o.value !== 'NONE' && o.value !== 'BAGS').map(o => (
                            <option key={o.value} value={o.value}>
                              {o[language === 'ur' ? 'ur' : 'en']}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="select-icon" />
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

        {/* Order Summary — appears directly below Notes, strictly above Submit */}
        {filledRows.length > 0 && (
          <section className="card order-summary-card">
            <div className="card-header">
              <span className="card-icon card-icon--gold"><PackageCheck size={20} /></span>
              <div>
                <h2 className="card-title">{language === 'ur' ? 'آرڈر کا خلاصہ' : 'Order Summary'}</h2>
                <p className="card-sub">{language === 'ur' ? 'جمع کروانے سے پہلے اپنا آرڈر جانچیں' : 'Review your selected items before submitting'}</p>
              </div>
            </div>
            <ul className="order-summary-list">
              {filledRows.map((row, index) => (
                <li key={row.id} className="order-summary-item">
                  <span className="order-summary-sr">{index + 1}.</span>
                  <span className="order-summary-name">{row.itemName}</span>
                  <span className="order-summary-qty">{row.quantityValue} {unitLabel(row.unitType, language)}</span>
                </li>
              ))}
            </ul>
            <p className="order-summary-count">
              {language === 'ur' ? `کل اشیاء: ${filledRows.length}` : `Total items: ${filledRows.length}`}
            </p>
          </section>
        )}

        {/* Product Menu — browse & add last-minute items before submitting */}
        <section className="card items-card">
          <div className="card-header">
            <span className="card-icon card-icon--gold"><ShoppingBag size={20} /></span>
            <div>
              <h2 className="card-title">{language === 'ur' ? 'مصنوعات کی فہرست' : 'Product List'}</h2>
              <p className="card-sub">{language === 'ur' ? 'آخری لمحے میں کوئی سامان شامل کریں' : 'Browse categories and tap any item to add it to your order'}</p>
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
              {runtimeCatalog.map(product => <option key={product.name} value={product.name}>{product.category}</option>)}
            </datalist>
            {catalogOpen && catalogMatches.length > 0 && (
              <div className="catalog-results" role="listbox">
                {catalogMatches.map(product => <button key={product.name} type="button" onClick={() => addCatalogProduct(product.name)}><span>{product.name}</span><small>{product.category}</small></button>)}
              </div>
            )}
            <div className="catalog-groups" aria-label="Browse products by category">
              {catalogGroups.map(([category, products]) => {
                const isOpen = expandedCategories.has(category) || !PRODUCT_CATALOG.some(product => product.category === category)
                return (
                  <section className={`catalog-group ${isOpen ? 'catalog-group--open' : ''}`} key={category}>
                    <div className="catalog-group-header" aria-expanded="true">
                      <span className="catalog-group-title">{category}</span>
                      <span className="catalog-group-count">{products.length}</span>
                    </div>
                    <div className="catalog-group-body" aria-hidden="false">
                      <div className="catalog-grid">
                        {products.map(product => (
                          <button key={product.name} type="button" className="catalog-item-btn" onClick={() => addCatalogProduct(product.name)}>
                            <span className="catalog-item-name">{product.name}</span>
                            <span className="catalog-item-add">Add</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </section>

        {/* Cart / Submit */}
        <section className="submit-card">
          <div className="submit-copy">
            <PackageCheck size={24} />
            <div>
              <strong>{cartOpen ? 'Your Cart' : 'Review Your Order'}</strong>
              <span>{filledRows.length} item{filledRows.length === 1 ? '' : 's'} ready to review</span>
            </div>
          </div>
          <button
            className={`btn-submit ${saving ? 'is-submitting' : ''}`}
            type="button"
            onClick={addToCart}
            disabled={saving}
          >
            {saving ? <RefreshCw size={21} className="spin" /> : <Send size={21} />}
            {saving && <span className="submit-rickshaw" aria-hidden="true"><i /><b /><em /></span>}
            <span>{saving ? t.submitting : 'Add to Cart'}</span>
            <FileDown size={19} />
          </button>
        </section>

        <footer className="page-footer">
          <div><strong>AHWMB Customer Order Portal</strong><span>{t.cash}</span></div>
          <div><span>For any queries or questions, please contact us</span><a href="tel:03223928421">0322-3928421</a></div>
        </footer>
      </div>

      {cartPrompt && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-box cart-prompt"><div className="modal-check"><ShoppingBag size={32} /></div><h2 className="modal-title">Check Your Items in the Cart</h2><p className="modal-hint">Review quantities and details before placing your order.</p><div className="modal-actions"><button className="btn-modal-close" type="button" onClick={() => setCartPrompt(false)}>Continue Shopping</button><button className="btn-submit cart-prompt-btn" type="button" onClick={() => { setCartPrompt(false); setCartOpen(true) }}>Open Cart</button></div></div></div>}

      {cartOpen && <aside className="cart-drawer" aria-label="Shopping cart"><div className="cart-drawer-head"><div><p className="admin-eyebrow">AHWMB</p><h2>Shopping Cart</h2></div><button type="button" className="icon-btn" onClick={() => setCartOpen(false)} aria-label="Close cart"><X size={22} /></button></div><div className="cart-drawer-body">{filledRows.length === 0 ? <p className="account-empty">Your cart is empty.</p> : filledRows.map(row => <div className="cart-item" key={row.id}><div><strong>{row.itemName}</strong><div className="cart-item-controls"><input type="number" min="0" value={row.quantityValue} onChange={e => updateRow(row.id, 'quantityValue', e.target.value)} aria-label={`Quantity for ${row.itemName}`} /><select value={row.unitType} onChange={e => updateRow(row.id, 'unitType', e.target.value as UnitType)} aria-label={`Unit for ${row.itemName}`}>{UNIT_OPTIONS.filter(option => option.value !== 'NONE' && option.value !== 'BAGS').map(option => <option key={option.value} value={option.value}>{option.en}</option>)}</select></div></div><button type="button" className="cart-remove" onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={17} /></button></div>)}</div><div className="cart-drawer-foot"><button type="button" className="btn-secondary" onClick={() => { setCartOpen(false); document.getElementById('customer-details')?.scrollIntoView({ behavior: 'smooth' }) }}>Continue Shopping</button><button type="button" className="btn-submit" onClick={() => void submit()} disabled={saving || filledRows.length === 0}>{saving ? 'Submitting…' : 'Place Order'}</button></div></aside>}

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
      if (!(await isCurrentAdmin())) {
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


// ─── Dukan Daily Expense Ledger ───────────────────────────────────────────────
type ExpenseRow = { id: string; expense_title: string; amount: string; saved: boolean }

/** Returns today's date as YYYY-MM-DD in local time */
const todayDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Clamp date to [2 months ago … today] */
const clampToLedgerRange = (dateStr: string): string => {
  const today = todayDate()
  const twoMonthsAgo = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 60)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  if (dateStr > today) return today
  if (dateStr < twoMonthsAgo) return twoMonthsAgo
  return dateStr
}

const reportDateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(`${date}T00:00:00`))

const reportDayLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(`${date}T00:00:00`))

const reportAmount = (value: string | number) => Math.round(Number(value) || 0).toLocaleString('en-PK')

function buildExpenseLedgerPdf(date: string, rows: ExpenseRow[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const validRows = rows.filter(r => r.expense_title.trim() || Number(r.amount))
  const total = validRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.7)
  doc.rect(12, 12, 186, 273)
  doc.setFont('times', 'bold')
  doc.setFontSize(22)
  doc.text('DUKAN DAILY EXPENSE LEDGER', 105, 25, { align: 'center' })
  doc.setFontSize(11)
  doc.text(`Date: ${reportDateLabel(date)}    Day: ${reportDayLabel(date)}`, 105, 33, { align: 'center' })
  // Build table WITHOUT foot first, then manually append the total row ONLY after
  // all body rows are drawn (i.e., on the final page only).
  let tableEndY = 42
  autoTable(doc, {
    startY: 42,
    margin: { left: 18, right: 18 },
    theme: 'grid',
    head: [['#', 'Expense Title / Description', 'Amount (Rs.)']],
    body: validRows.map((row, i) => [i + 1, row.expense_title || '—', reportAmount(row.amount)]),
    // No foot here — we draw the total manually after the table ends (on the last page only)
    styles: { font: 'times', fontStyle: 'bold', fontSize: 11, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.4, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'left' },
    tableWidth: 'auto',
    columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 118, halign: 'left' }, 2: { cellWidth: 44, halign: 'right' } },
    didDrawPage: (_data) => {
      // Re-draw border on each new page
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.7)
      doc.rect(12, 12, 186, 273)
      doc.setFont('times', 'bold')
      doc.setFontSize(22)
      doc.text('DUKAN DAILY EXPENSE LEDGER', 105, 25, { align: 'center' })
      doc.setFontSize(11)
      doc.text(`Date: ${reportDateLabel(date)}    Day: ${reportDayLabel(date)}`, 105, 33, { align: 'center' })
    },
    didDrawCell: (data) => {
      // Track the Y position after the last body row on the final page
      if (data.section === 'body') {
        tableEndY = data.cell.y + data.cell.height
      }
    },
  })
  // Draw the total row ONLY at the end of the last page
  const colWidths = [12, 118, 44]
  const colXs = [18, 30, 148]
  const rowH = 10
  const footY = tableEndY
  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.4)
  doc.rect(colXs[0], footY, colWidths[0], rowH, 'FD')
  doc.rect(colXs[1], footY, colWidths[1], rowH, 'FD')
  doc.rect(colXs[2], footY, colWidths[2], rowH, 'FD')
  doc.setFont('times', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(0, 0, 0)
  doc.text('Total Daily Kharcha', colXs[1] + 1, footY + 6.5)
  doc.text(reportAmount(total), colXs[2] + colWidths[2] - 1, footY + 6.5, { align: 'right' })
  doc.setFontSize(9)
  doc.text('AHWMB — Dukan Daily Expense Ledger', 105, 278, { align: 'center', maxWidth: 174 })
  return doc.output('blob')
}

function downloadAndPrintPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.style.display = 'none'
  document.body.appendChild(link); link.click(); link.remove()
  const iframe = document.createElement('iframe')
  iframe.title = 'Expense ledger print preview'
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  iframe.src = url
  iframe.onload = () => window.setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() }
    finally { window.setTimeout(() => iframe.remove(), 1200) }
  }, 150)
  document.body.appendChild(iframe)
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000)
}

/** Build a mini calendar grid for the given year/month, returns array of date strings (YYYY-MM-DD) or null for padding */
function buildCalendarMonth(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return cells
}

function LedgerCalendar({
  selected, onSelect, activeDates,
}: {
  selected: string
  onSelect: (date: string) => void
  activeDates: Set<string>
}) {
  const today = todayDate()
  const twoMonthsAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 60)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  // Show the 2 months that contain our range
  const months = useMemo(() => {
    const result: { year: number; month: number; label: string }[] = []
    const anchor = new Date()
    for (let i = 1; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
      result.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
      })
    }
    return result
  }, [])

  return (
    <div className="ledger-calendar">
      {months.map(({ year, month, label }) => {
        const cells = buildCalendarMonth(year, month)
        return (
          <div key={`${year}-${month}`} className="ledger-cal-month">
            <div className="ledger-cal-month-label">{label}</div>
            <div className="ledger-cal-grid">
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d} className="ledger-cal-dow">{d}</div>)}
              {cells.map((dateStr, i) => {
                if (!dateStr) return <div key={`pad-${i}`} />
                const isToday = dateStr === today
                const isSelected = dateStr === selected
                const isDisabled = dateStr > today || dateStr < twoMonthsAgo
                const hasData = activeDates.has(dateStr)
                return (
                  <button
                    key={dateStr}
                    type="button"
                    className={[
                      'ledger-cal-day',
                      isSelected ? 'ledger-cal-day--selected' : '',
                      isToday ? 'ledger-cal-day--today' : '',
                      isDisabled ? 'ledger-cal-day--disabled' : '',
                      hasData ? 'ledger-cal-day--has-data' : '',
                    ].filter(Boolean).join(' ')}
                    disabled={isDisabled}
                    onClick={() => onSelect(dateStr)}
                    aria-label={dateStr}
                    aria-pressed={isSelected}
                  >
                    {Number(dateStr.slice(8))}
                    {hasData && <span className="ledger-cal-dot" />}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DailyReports({ language, onBack }: { language: Language; onBack: () => void }) {
  const isRtl = language === 'ur'
  const [date, setDate] = useState(() => todayDate())
  const [rows, setRows] = useState<ExpenseRow[]>([{ id: crypto.randomUUID(), expense_title: '', amount: '', saved: false }])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastPdf, setLastPdf] = useState<{ blob: Blob; name: string } | null>(null)
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set())
  const { toasts, add: addToast, dismiss } = useToasts()

  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [rows])

  // Load all dates that have expense data (for calendar dots)
  useEffect(() => {
    try {
      const localProducts = JSON.parse(localStorage.getItem('ahwmb-extra-products') || '[]') as CatalogProduct[]
      if (localProducts.length) { runtimeCatalog = [...PRODUCT_CATALOG, ...localProducts].filter((product, index, all) => all.findIndex(item => item.name.toLowerCase() === product.name.toLowerCase()) === index); setCatalogVersion(value => value + 1) }
    } catch { /* storage unavailable */ }
    if (!supabase) return
    const twoMonthsAgo = (() => {
      const d = new Date(); d.setDate(d.getDate() - 60)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    supabase
      .from('daily_expenses')
      .select('expense_date')
      .gte('expense_date', twoMonthsAgo)
      .then(({ data }) => {
        if (data) setActiveDates(new Set(data.map((r: { expense_date: string }) => r.expense_date)))
      })
  }, [])

  // Load expenses for selected date
  useEffect(() => {
    setRows([{ id: crypto.randomUUID(), expense_title: '', amount: '', saved: false }])
    if (!supabase) return
    setLoading(true)
    supabase
      .from('daily_expenses')
      .select('*')
      .eq('expense_date', date)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        setLoading(false)
        if (error || !data || data.length === 0) return
        const loaded: ExpenseRow[] = data.map((r: { id: string; expense_title: string; amount: number }) => ({
          id: r.id,
          expense_title: r.expense_title,
          amount: String(r.amount),
          saved: true,
        }))
        // Add one empty row at the bottom for adding new entries
        loaded.push({ id: crypto.randomUUID(), expense_title: '', amount: '', saved: false })
        setRows(loaded)
      })
  }, [date])

  const handleDateSelect = (d: string) => setDate(clampToLedgerRange(d))

  const updateRow = (id: string, field: 'expense_title' | 'amount', value: string) =>
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value, saved: false } : row))

  const addRow = () => setRows(current => [...current, { id: crypto.randomUUID(), expense_title: '', amount: '', saved: false }])

  const removeRow = async (id: string) => {
    const target = rows.find(row => row.id === id)
    if (!target) return

    // If this row was saved to the database, delete it permanently first
    if (target.saved && supabase) {
      const { error } = await supabase
        .from('daily_expenses')
        .delete()
        .eq('id', id)
      if (error) {
        addToast(`Delete failed: ${error.message}`, 'error')
        return
      }
      addToast('✓ Expense deleted permanently!', 'success')
    }

    // Remove from local state (keep at least one row)
    setRows(current => current.length > 1 ? current.filter(row => row.id !== id) : current)
  }

  /** Save all unsaved rows to Supabase, then prune old data */
  const saveExpenses = async () => {
    const validRows = rows.filter(r => r.expense_title.trim() || Number(r.amount))
    if (!validRows.length) { addToast('Add at least one expense entry before saving.', 'info'); return }

    if (!supabase) {
      addToast('Supabase not configured. Data saved locally only.', 'info')
      setRows(current => current.map(r => ({ ...r, saved: true })))
      return
    }

    setSaving(true)
    try {
      // Fix: use UPSERT with row id as the conflict key.
      // - New rows: client-generated UUID not in DB → INSERT
      // - Edited existing rows: same UUID they had in DB → UPDATE (no duplicate created)
      const unsaved = validRows.filter(r => !r.saved)
      if (unsaved.length > 0) {
        const { error } = await supabase
          .from('daily_expenses')
          .upsert(
            unsaved.map(r => ({
              id: r.id,
              expense_title: r.expense_title.trim() || 'Expense',
              amount: Number(r.amount) || 0,
              expense_date: date,
            })),
            { onConflict: 'id' }
          )
        if (error) { addToast(`Save failed: ${error.message}`, 'error'); setSaving(false); return }
      }

      // Prune records older than 60 days
      try { await supabase.rpc('prune_old_expenses') } catch { /* non-blocking */ }

      // Mark all rows as saved
      setRows(current => current.map(r => ({ ...r, saved: true })))

      // Update active dates set
      setActiveDates(prev => new Set([...prev, date]))

      addToast('✓ Expense saved successfully!', 'success')
    } catch (err) {
      addToast(readableError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const createPdf = () => {
    const filename = `ahwmb-expense-ledger-${date}.pdf`
    const blob = buildExpenseLedgerPdf(date, rows)
    setLastPdf({ blob, name: filename })
    return { blob, filename }
  }

  const print = () => {
    const { blob, filename } = createPdf()
    downloadAndPrintPdf(blob, filename)
  }

  const share = async () => {
    const { blob, filename } = createPdf()
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try { await navigator.share({ title: 'AHWMB Expense Ledger', files: [file] }) }
      catch (error) { if ((error as DOMException)?.name !== 'AbortError') addToast('PDF sharing was not completed.', 'error') }
    } else {
      downloadAndPrintPdf(blob, filename)
      addToast('PDF downloaded. Attach the PDF file to share it.', 'info')
    }
  }

  return (
    <section className={`daily-report-page panel ${isRtl ? 'rtl-mode' : 'ltr-mode'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <ToastContainer toasts={toasts} dismiss={dismiss} />

      {/* Header */}
      <div className="daily-report-head">
        <div>
          <p className="admin-eyebrow">AHWMB</p>
          <h2 className="admin-heading">{isRtl ? 'دکان روزانہ اخراجات لیجر' : 'Dukan Daily Expense Ledger'}</h2>
          <p className="panel-sub">{isRtl ? 'روزانہ دکان کے اخراجات، بلز، اور ادائیگیاں ریکارڈ کریں' : 'Record daily shop expenses, bills, staff kharchi & vendor payments.'}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onBack}><ReceiptText size={16} /> {isRtl ? 'آرڈرز' : 'Orders'}</button>
      </div>

      {/* Summary bar */}
      <div className="daily-report-summary">
        <div><span>{isRtl ? 'منتخب تاریخ' : 'Selected Date'}</span><strong>{reportDateLabel(date)}</strong></div>
        <div><span>{isRtl ? 'دن' : 'Day'}</span><strong>{reportDayLabel(date)}</strong></div>
        <div><span>{isRtl ? 'کل اخراجات' : 'Total Kharcha'}</span><strong className="ledger-total-highlight">Rs. {reportAmount(total)}</strong></div>
      </div>

      {/* Calendar date picker */}
      <LedgerCalendar selected={date} onSelect={handleDateSelect} activeDates={activeDates} />

      {/* Expense table */}
      {loading ? (
        <div className="ledger-loading"><RefreshCw size={18} className="spin" /> {isRtl ? 'لوڈ ہو رہا ہے…' : 'Loading expenses…'}</div>
      ) : (
        <div className="daily-report-table-wrap">
          <table className="daily-report-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>{isRtl ? 'اخراجات کی تفصیل' : 'Expense Title / Description'}</th>
                <th style={{ width: 140 }}>{isRtl ? 'رقم (Rs.)' : 'Amount (Rs.)'}</th>
                <th aria-label="Actions" style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} className={row.saved ? 'ledger-row-saved' : ''}>
                  <td className="ledger-sr">{idx + 1}</td>
                  <td>
                    <div className="daily-report-name-wrap">
                      <textarea
                        data-item-name
                        onKeyDown={e => insertTextareaLineBreak(e, value => updateRow(row.id, 'expense_title', value))}
                        onInput={autoExpandTextarea}
                        value={row.expense_title}
                        rows={Math.max(1, (row.expense_title.match(/\n/g) || []).length + 1)}
                        onChange={e => updateRow(row.id, 'expense_title', e.target.value)}
                        placeholder={isRtl ? 'مثال: اسٹاف خرچی، بجلی کا بل' : 'e.g. Staff Kharchi, Electricity Bill'}
                        aria-label="Expense title"
                      />
                    </div>
                  </td>
                  <td>
                    <input
                        onKeyDown={e => advanceItemRow(e, addRow)}
                      type="number"
                      min="0"
                      step="1"
                      value={row.amount}
                      onChange={e => updateRow(row.id, 'amount', e.target.value)}
                      placeholder="0"
                      aria-label="Amount"
                    />
                  </td>
                  <td>
                    <button type="button" className="btn-del" onClick={() => void removeRow(row.id)} aria-label="Remove row">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{isRtl ? 'کل اخراجات' : 'Total Daily Kharcha'}</td>
                <td>Rs. {reportAmount(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className="daily-report-actions">
        <button type="button" className="btn-add-item" onClick={addRow}>
          <Plus size={16} /> {isRtl ? 'اخراجات شامل کریں' : 'Add Expense'}
        </button>
        <div className="daily-report-main-actions">
          <button type="button" className="btn-secondary" onClick={() => void saveExpenses()} disabled={saving}>
            {saving ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}
            {isRtl ? 'محفوظ کریں' : saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn-print" onClick={print}><FileDown size={18} /> {isRtl ? 'پرنٹ' : 'Print'}</button>
          <button type="button" className="btn-share-pdf" onClick={() => void share()}><Send size={18} /> {isRtl ? 'PDF شیئر کریں' : 'Share PDF'}</button>
        </div>
      </div>

      {lastPdf && (
        <p className="daily-report-saved">
          <Check size={15} /> {isRtl ? 'PDF تیار ہے۔' : 'PDF ready to share.'}
        </p>
      )}
    </section>
  )
}

type SavedCustomer = { name: string; address: string; phone: string }
function CustomerReport() {
  const [customers, setCustomers] = useState<SavedCustomer[]>(() => { try { return JSON.parse(localStorage.getItem('ahwmb-saved-customers') || 'null') || SAVED_CUSTOMERS.map(customer => ({ ...customer, phone: '' })) } catch { return SAVED_CUSTOMERS.map(customer => ({ ...customer, phone: '' })) } })
  const [ledger, setLedger] = useState<Record<string, { id: string; date: string; amount: string; type: 'cash' | 'balance' }[]>>(() => { try { return JSON.parse(localStorage.getItem('ahwmb-customer-ledger') || '{}') } catch { return {} } })
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<SavedCustomer>({ name: '', address: '', phone: '' })
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [entry, setEntry] = useState({ date: todayDate(), amount: '', type: 'cash' as 'cash' | 'balance' })
  const [editingLedgerId, setEditingLedgerId] = useState<string | null>(null)
  const [customerFormOpen, setCustomerFormOpen] = useState(false)
  const [customerSaving, setCustomerSaving] = useState(false)
  useEffect(() => { try { localStorage.setItem('ahwmb-saved-customers', JSON.stringify(customers)) } catch { /* storage unavailable */ } }, [customers])
  useEffect(() => { try { localStorage.setItem('ahwmb-customer-ledger', JSON.stringify(ledger)) } catch { /* storage unavailable */ } }, [ledger])
  useEffect(() => {
    if (!supabase) return
    supabase.from('customers').select('name,phone,address').order('name').then(({ data }) => {
      if (data?.length) setCustomers(data.map(customer => ({ name: customer.name, phone: customer.phone || '', address: customer.address || '' })))
    })
  }, [])
  const matches = customers.filter(customer => `${customer.name} ${customer.address}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const selectedCustomer = customers.find(customer => customer.name === selectedName)
  const customerEntries = ledger[selectedName] || []
  const cashTotal = customerEntries.filter(item => item.type === 'cash').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const balanceTotal = customerEntries.filter(item => item.type === 'balance').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const netTotal = cashTotal - balanceTotal
  const saveCustomer = async () => { if (!draft.name.trim()) return; const customer = { ...draft, name: draft.name.trim() }; if (supabase) await supabase.from('customers').upsert(customer, { onConflict: 'name' }); setCustomers(current => editing === null ? [...current, customer] : current.map((item, index) => index === editing ? customer : item)); setSelectedName(customer.name); setDraft({ name: '', address: '', phone: '' }); setEditing(null) }
  const addEntry = () => { if (!selectedName || !entry.amount) return; setLedger(current => ({ ...current, [selectedName]: editingLedgerId ? (current[selectedName] || []).map(item => item.id === editingLedgerId ? { ...item, ...entry } : item) : [...(current[selectedName] || []), { id: crypto.randomUUID(), ...entry }] })); setEditingLedgerId(null); setEntry({ date: todayDate(), amount: '', type: 'cash' }) }
  const saveLedgerEntry = () => {
    if (!selectedName || !entry.amount) return
    if (!editingLedgerId) { addEntry(); return }
    setLedger(current => ({ ...current, [selectedName]: (current[selectedName] || []).map(item => item.id === editingLedgerId ? { ...item, ...entry } : item) }))
    setEditingLedgerId(null)
    setEntry({ date: todayDate(), amount: '', type: 'cash' })
  }
  const editLedgerEntry = (item: { id: string; date: string; amount: string; type: 'cash' | 'balance' }) => { setEditingLedgerId(item.id); setEntry({ date: item.date, amount: item.amount, type: item.type }) }
  const deleteLedgerEntry = (id: string) => { if (!selectedName || !window.confirm('Delete this ledger entry?')) return; setLedger(current => ({ ...current, [selectedName]: (current[selectedName] || []).filter(item => item.id !== id) })); if (editingLedgerId === id) { setEditingLedgerId(null); setEntry({ date: todayDate(), amount: '', type: 'cash' }) } }
  const addCustomer = async () => {
    if (!draft.name.trim() || !supabase) return
    setCustomerSaving(true)
    const customer = { name: draft.name.trim(), phone: draft.phone.trim(), address: draft.address.trim() }
    const { error } = await supabase.from('customers').insert(customer)
    if (!error) { setCustomers(current => [...current, customer].sort((a, b) => a.name.localeCompare(b.name))); setQuery(customer.name); setSelectedName(customer.name); setDraft({ name: '', phone: '', address: '' }); setCustomerFormOpen(false) }
    setCustomerSaving(false)
  }
  return <section className="panel report-panel"><div className="report-heading"><div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Customer Report</h2><p className="panel-sub">Search a customer to open their account ledger.</p></div></div><div className="account-search-wrap"><input className="report-search account-search" value={query} onChange={e => { setQuery(e.target.value); setSelectedName('') }} placeholder="Search customer name, e.g. Ahmed Store" />{query && !selectedName && matches.length > 0 && <div className="customer-suggestions report-suggestions">{matches.map(customer => <button type="button" key={customer.name} onClick={() => { setSelectedName(customer.name); setQuery(customer.name) }}><strong>{customer.name}</strong><small>{customer.address}</small></button>)}</div>}</div>{selectedCustomer ? <div className="ledger-card ledger-card--top"><div className="report-heading"><div><p className="admin-eyebrow">CUSTOMER ACCOUNT</p><h3 className="panel-title">{selectedCustomer.name}</h3><p className="panel-sub">{selectedCustomer.phone || 'No contact saved'} · {selectedCustomer.address}</p></div><button type="button" className="btn-secondary" onClick={() => { setSelectedName(''); setQuery('') }}>Close</button></div><div className="ledger-summary"><span>Cash: <strong className="money-positive">+ Rs. {cashTotal.toLocaleString('en-PK')}</strong></span><span>Balance: <strong className="money-negative">− Rs. {balanceTotal.toLocaleString('en-PK')}</strong></span><span>Net: <strong className={netTotal >= 0 ? 'money-positive' : 'money-negative'}>{netTotal >= 0 ? '+' : '−'} Rs. {Math.abs(netTotal).toLocaleString('en-PK')}</strong></span></div><div className="ledger-entry-form"><input className="report-cell-input" type="date" value={entry.date} onChange={e => setEntry({ ...entry, date: e.target.value })} /><input className="report-cell-input" type="number" value={entry.amount} onChange={e => setEntry({ ...entry, amount: e.target.value })} placeholder="Amount" /><select className="report-cell-input" value={entry.type} onChange={e => setEntry({ ...entry, type: e.target.value as 'cash' | 'balance' })}><option value="cash">Cash (+ received)</option><option value="balance">Balance (− due)</option></select><button type="button" className="btn-submit report-add" onClick={addEntry}><Plus size={17} /> Add Entry</button></div><div className="ledger-table"><div className="ledger-header"><span>Date</span><span>Amount</span><span>Cash / Balance</span></div>{customerEntries.map(item => <div className="ledger-row" key={item.id}><span>{item.date}</span><span>Rs. {Number(item.amount).toLocaleString('en-PK')}</span><span className={item.type === 'cash' ? 'money-positive' : 'money-negative'}>{item.type === 'cash' ? 'Cash +' : 'Balance −'}</span><span className="ledger-row-actions"><button type="button" className="ledger-edit-btn" onClick={() => editLedgerEntry(item)}>Edit</button><button type="button" className="ledger-delete-btn" onClick={() => deleteLedgerEntry(item.id)}>Delete</button></span></div>)}</div><div className="account-actions"><button type="button" className="btn-secondary" onClick={() => { const index = customers.findIndex(customer => customer.name === selectedName); setEditing(index); setDraft(selectedCustomer) }}><Check size={16} /> Edit Customer</button><button type="button" className="btn-submit report-add" onClick={() => { setEditing(null); setDraft({ name: '', address: '', phone: '' }) }}><Plus size={17} /> Add Customer</button></div></div> : <div className="account-empty"><UserRound size={42} /><p>Search and select a customer to open the account.</p></div>}{draft.name || editing !== null ? <div className="report-form account-editor"><input className="field-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Customer name" /><input className="field-input" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="Contact number" /><input className="field-input" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} placeholder="Address" /><button type="button" className="btn-secondary" onClick={saveCustomer}><Check size={16} /> {editing === null ? 'Save Customer' : 'Update Customer'}</button></div> : null}</section>
}

function CustomerReportV2() {
  const defaultCustomers = SAVED_CUSTOMERS.map(customer => ({ ...customer, phone: '' }))
  const [customers, setCustomers] = useState<SavedCustomer[]>(defaultCustomers)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<SavedCustomer>({ name: '', phone: '', address: '' })
  useEffect(() => {
    let stored: SavedCustomer[] = []
    try { stored = JSON.parse(localStorage.getItem('ahwmb-saved-customers') || '[]') as SavedCustomer[] } catch { /* storage unavailable */ }
    const merge = (items: SavedCustomer[]) => items.filter((item, index, all) => all.findIndex(existing => existing.name.toLowerCase() === item.name.toLowerCase()) === index).sort((a, b) => a.name.localeCompare(b.name))
    setCustomers(merge([...defaultCustomers, ...stored]))
    if (supabase) supabase.from('customers').select('name,phone,address').order('name').then(({ data }) => { if (data) setCustomers(merge([...defaultCustomers, ...stored, ...data.map(item => ({ name: item.name, phone: item.phone || '', address: item.address || '' }))])) })
  }, [])
  const matches = customers.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const selected = customers.find(item => item.name === selectedName)
  const save = async () => {
    const customer = { name: draft.name.trim(), phone: draft.phone.trim(), address: draft.address.trim() }
    if (!customer.name) { setMessage('Customer name is required.'); return }
    if (customers.some(item => item.name.toLowerCase() === customer.name.toLowerCase())) { setMessage('This customer already exists.'); return }
    setSaving(true); setMessage('')
    if (supabase) { const { error } = await supabase.from('customers').insert(customer); if (error) { setMessage(error.message); setSaving(false); return } }
    const next = [...customers, customer].sort((a, b) => a.name.localeCompare(b.name)); setCustomers(next)
    try { localStorage.setItem('ahwmb-saved-customers', JSON.stringify(next)) } catch { /* storage unavailable */ }
    setQuery(customer.name); setSelectedName(customer.name); setDraft({ name: '', phone: '', address: '' }); setFormOpen(false); setMessage('Customer added successfully.'); setSaving(false)
  }
  return <section className="panel report-panel"><div className="report-heading"><div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Customer Report</h2><p className="panel-sub">Search saved customers and open their account ledger.</p></div><button type="button" className="btn-submit report-add" onClick={() => { setDraft({ name: '', phone: '', address: '' }); setMessage(''); setFormOpen(true) }}><Plus size={17} /> Add Customer</button></div>{message && <p className="form-message">{message}</p>}<div className="account-search-wrap"><input className="report-search account-search" value={query} onChange={event => { setQuery(event.target.value); setSelectedName('') }} placeholder="Search customer name, e.g. Ahmed Store" />{query && !selectedName && matches.length > 0 && <div className="customer-suggestions report-suggestions">{matches.map(item => <button type="button" key={item.name} onClick={() => { setSelectedName(item.name); setQuery(item.name) }}><strong>{item.name}</strong><small>{item.address}</small></button>)}</div>}</div>{selected ? <div className="ledger-card ledger-card--top"><div className="report-heading"><div><p className="admin-eyebrow">CUSTOMER ACCOUNT</p><h3 className="panel-title">{selected.name}</h3><p className="panel-sub">{selected.phone || 'No contact saved'} · {selected.address}</p></div><button type="button" className="btn-secondary" onClick={() => { setSelectedName(''); setQuery('') }}>Close</button></div><div className="account-empty"><UserRound size={36} /><p>Customer account selected. Existing ledger entries remain available in the Customer Report workflow.</p></div></div> : <div className="account-empty"><UserRound size={42} /><p>Search and select a customer to open the account.</p></div>}{formOpen && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-box admin-entry-modal"><h2 className="modal-title">Add Customer</h2><label className="field"><span className="field-label">Customer name *</span><input className="field-input" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} autoFocus /></label><label className="field"><span className="field-label">Phone number</span><input className="field-input" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label className="field"><span className="field-label">Address</span><textarea className="field-textarea" value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} rows={3} /></label><div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button><button type="button" className="btn-submit" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Customer'}</button></div></div></div>}</section>
}

function CustomerReportWithAdd() {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<SavedCustomer>({ name: '', phone: '', address: '' })
  const save = async () => {
    const customer = { name: draft.name.trim(), phone: draft.phone.trim(), address: draft.address.trim() }
    if (!customer.name) { setMessage('Customer name is required.'); return }
    setSaving(true); setMessage('')
    if (supabase) {
      const { error } = await supabase.from('customers').upsert(customer, { onConflict: 'name' })
      if (error) { setMessage(error.message); setSaving(false); return }
    }
    try {
      const existing = JSON.parse(localStorage.getItem('ahwmb-saved-customers') || '[]') as SavedCustomer[]
      const merged = [...existing.filter(item => item.name.toLowerCase() !== customer.name.toLowerCase()), customer]
      localStorage.setItem('ahwmb-saved-customers', JSON.stringify(merged))
    } catch { /* storage unavailable */ }
    setOpen(false); setDraft({ name: '', phone: '', address: '' }); setMessage('Customer added successfully.'); setSaving(false)
  }
  return <div className="customer-report-shell"><button type="button" className="btn-submit customer-add-top" onClick={() => { setMessage(''); setOpen(true) }}><Plus size={17} /> Add Customer</button><CustomerReport />{message && <p className="form-message customer-add-message">{message}</p>}{open && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-box admin-entry-modal"><h2 className="modal-title">Add Customer</h2><label className="field"><span className="field-label">Customer name *</span><input className="field-input" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} autoFocus /></label><label className="field"><span className="field-label">Phone number</span><input className="field-input" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label className="field"><span className="field-label">Address</span><textarea className="field-textarea" value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} rows={3} /></label><div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-submit" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Customer'}</button></div></div></div>}</div>
}

function PurchaseReport() {
  const [rows, setRows] = useState([{ id: crypto.randomUUID(), party: '', area: '', item: '', amount: '', date: todayDate() }])
  const update = (id: string, key: 'party' | 'area' | 'item' | 'amount' | 'date', value: string) => setRows(current => current.map(row => row.id === id ? { ...row, [key]: value } : row))
  return <section className="panel report-panel"><div className="report-heading"><div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Purchase Report</h2><p className="panel-sub">Record supplier purchases, deposits, and payment dates.</p></div><button type="button" className="btn-submit report-add" onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), party: '', area: '', item: '', amount: '', date: todayDate() }])}><Plus size={17} /> Add Purchase</button></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Party Name</th><th>Area</th><th>Item</th><th>Amount / Deposit</th><th>Date</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><input className="report-cell-input" value={row.party} onChange={e => update(row.id, 'party', e.target.value)} placeholder="Supplier" /></td><td><input className="report-cell-input" value={row.area} onChange={e => update(row.id, 'area', e.target.value)} placeholder="Area" /></td><td><input className="report-cell-input" value={row.item} onChange={e => update(row.id, 'item', e.target.value)} placeholder="Item" /></td><td><input className="report-cell-input" type="number" value={row.amount} onChange={e => update(row.id, 'amount', e.target.value)} placeholder="Rs." /></td><td><input className="report-cell-input" type="date" value={row.date} onChange={e => update(row.id, 'date', e.target.value)} /></td></tr>)}</tbody></table></div></section>
}

function StockReport() {
  type StockRow = { id: string; item: string; weight: string; quantity: string; bags: string }
  const [site, setSite] = useState<'Jodia Bazaar' | 'Godam Site'>('Jodia Bazaar')
  const [allStock, setAllStock] = useState<Record<string, StockRow[]>>(() => { try { return JSON.parse(localStorage.getItem('ahwmb-stock-report') || '{}') } catch { return {} } })
  const rows = allStock[site] || [{ id: crypto.randomUUID(), item: '', weight: '', quantity: '', bags: '' }]
  useEffect(() => { try { localStorage.setItem('ahwmb-stock-report', JSON.stringify(allStock)) } catch { /* storage unavailable */ } }, [allStock])
  const update = (id: string, key: 'item' | 'weight' | 'quantity' | 'bags', value: string) => setAllStock(current => ({ ...current, [site]: rows.map(row => row.id === id ? { ...row, [key]: value, ...(key === 'quantity' ? { bags: row.weight && Number(row.weight) > 0 ? String(Math.ceil(Number(value || 0) / Number(row.weight))) : value } : {}) } : row) }))
  const addRow = () => setAllStock(current => ({ ...current, [site]: [...rows, { id: crypto.randomUUID(), item: '', weight: '', quantity: '', bags: '' }] }))
  return <section className="panel report-panel"><div className="report-heading"><div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Stock Report</h2><p className="panel-sub">Manage stock independently by storage location.</p></div><select className="stock-location-select" value={site} onChange={e => setSite(e.target.value as 'Jodia Bazaar' | 'Godam Site')}><option>Jodia Bazaar</option><option>Godam Site</option></select></div><div className="site-tabs"><span className="stock-location-label">Saving in: <strong>{site}</strong></span><button type="button" className="btn-submit report-add" onClick={addRow}><Plus size={17} /> Add Item</button></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Item</th><th>Weight</th><th>Quantity</th><th>Bags</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><input className="report-cell-input" value={row.item} onChange={e => update(row.id, 'item', e.target.value)} placeholder="e.g. Chana Dal" /></td><td><input className="report-cell-input" type="number" min="1" value={row.weight} onChange={e => update(row.id, 'weight', e.target.value)} placeholder="50 kg" /></td><td><input className="report-cell-input" type="number" min="0" value={row.quantity} onChange={e => update(row.id, 'quantity', e.target.value)} placeholder="500 kg" /></td><td><input className="report-cell-input stock-bags" type="number" value={row.bags} readOnly aria-label="Auto calculated bags" /></td></tr>)}</tbody></table></div></section>
}

function AdminProducts({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('EXTRA ITEMS')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const categories = [...new Set(runtimeCatalog.map(product => product.category))]
  const matches = runtimeCatalog.filter(product => `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()))
  const addProduct = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) { setMessage('Enter a product name first.'); return }
    setSaving(true)
    setMessage('')
    const product = { name: trimmedName, category }
    if (!supabase) {
      runtimeCatalog = [...runtimeCatalog, product].filter((item, index, all) => all.findIndex(existing => existing.name.toLowerCase() === item.name.toLowerCase()) === index)
      try { localStorage.setItem('ahwmb-extra-products', JSON.stringify(runtimeCatalog.filter(item => !PRODUCT_CATALOG.some(base => base.name.toLowerCase() === item.name.toLowerCase())))) } catch { /* storage unavailable */ }
      setName(''); setMessage('Product added locally. Connect Supabase to save it permanently.'); onChanged(); setSaving(false); return
    }
    const { error } = await supabase.from('products').insert(product)
    if (error) {
      if (error.message.toLowerCase().includes('could not find the table') || error.message.toLowerCase().includes('relation') && error.message.toLowerCase().includes('products')) {
        runtimeCatalog = [...runtimeCatalog, product].filter((item, index, all) => all.findIndex(existing => existing.name.toLowerCase() === item.name.toLowerCase()) === index)
        try { localStorage.setItem('ahwmb-extra-products', JSON.stringify(runtimeCatalog.filter(item => !PRODUCT_CATALOG.some(base => base.name.toLowerCase() === item.name.toLowerCase())))) } catch { /* storage unavailable */ }
        setName(''); setMessage('Product added on this device. Run the products SQL migration to save it permanently.'); onChanged(); setSaving(false); return
      }
      setMessage(error.message.includes('duplicate') ? 'This product already exists.' : `Could not save product: ${error.message}`); setSaving(false); return
    }
    runtimeCatalog = [...runtimeCatalog, product].filter((item, index, all) => all.findIndex(existing => existing.name.toLowerCase() === item.name.toLowerCase()) === index).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    setName(''); setMessage('Product added successfully.'); onChanged()
    setSaving(false)
  }
  return <section className="panel report-panel products-panel"><div className="report-heading"><div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Products</h2><p className="panel-sub">Add products to the shared customer and admin product menu.</p></div><span className="report-count">{runtimeCatalog.length} products</span></div><div className="report-form product-form"><input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Product name" /><select className="field-input" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select><button type="button" className="btn-submit report-add" onClick={() => void addProduct()} disabled={saving}><Plus size={17} /> {saving ? 'Saving...' : 'Add Product'}</button></div>{message && <p className="form-message">{message}</p>}<input className="report-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products..." /><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Product Name</th><th>Category</th></tr></thead><tbody>{matches.map(product => <tr key={`${product.category}-${product.name}`}><td><strong>{product.name}</strong></td><td>{product.category}</td></tr>)}</tbody></table></div></section>
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
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [adminView, setAdminView] = useState<'orders' | 'reports' | 'create-order' | 'customer-report' | 'purchase-report' | 'stock-report' | 'products'>('orders')
  const [, setCatalogVersion] = useState(0)
  const [editCustomerOrder, setEditCustomerOrder] = useState<OrderRecord | null>(null)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editCustomerPhone, setEditCustomerPhone] = useState('')
  const [editCustomerAddress, setEditCustomerAddress] = useState('')
  const [savingCustomer, setSavingCustomer] = useState(false)

  // Centralized, rounded calculation for all five financial fields.
  const financials = useMemo(() => calculateFinancials(sumLineTotals(pricedItems), balance, deposit), [pricedItems, balance, deposit])
  const grandTotal = financials.totalAmount
  const { totalAmount, totalBalance, remainingBalance } = financials

  useEffect(() => {
    if (!printPayload) return
    const timer = window.setTimeout(() => {
      printInvoiceHtml(buildInvoiceHtml(printPayload))
      setPrintPayload(null)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [printPayload])

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return }
    const { data: session } = await supabase.auth.getSession()
    if (!session.session || !(await isCurrentAdmin())) {
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
        next.total = calculateAppLineTotal(next)
      } else if (field === 'quantity_value') {
        next.quantity_value = Number(value) || 0
        next.quantity = quantityText(next.quantity_value, next.unit_type, 'en')
        // Recalculate — this is the FIXED grams calculation
        next.total = calculateAppLineTotal(next)
      } else if (field === 'unit_price' || field === 'rate') {
        next.unit_price = Number(value) || 0
        next.rate = next.unit_price
        // Recalculate total — correct for all units
        next.total = calculateAppLineTotal(next)
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
      quantity_value: 1, unit_type: 'NONE', rate: 0, unit_price: 0, total: 0,
    }])

  const addQuickAdminItem = (name: string) => setPricedItems(curr => [...curr, {
    sr: curr.length + 1, name, quantity: '', quantity_value: 1, unit_type: 'NONE', rate: 0, unit_price: 0, total: 0,
  }])

  const removeAdminItem = (index: number) =>
    setPricedItems(curr =>
      curr.filter((_, i) => i !== index).map((item, i) => ({ ...item, sr: i + 1 }))
    )

  const confirmDeleteOrder = async () => {
    if (!deleteOrderId || !supabase) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('orders').delete().eq('id', deleteOrderId)
      if (error) throw error
      setOrders(curr => curr.filter(o => o.id !== deleteOrderId))
      if (selected?.id === deleteOrderId) {
        setSelected(null)
        setPricedItems([])
        setBalance(0)
        setDeposit(0)
      }
      addToast('Order deleted successfully.', 'success')
    } catch (err) {
      addToast(readableError(err) || 'Failed to delete order.', 'error')
    } finally {
      setDeleting(false)
      setDeleteOrderId(null)
    }
  }

  const openEditCustomer = (order: OrderRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditCustomerOrder(order)
    setEditCustomerName(order.customer_name)
    setEditCustomerPhone(order.customer_phone)
    setEditCustomerAddress(order.customer_address)
  }

  const saveCustomerInfo = async () => {
    if (!editCustomerOrder || !supabase) return
    setSavingCustomer(true)
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          customer_name: editCustomerName.trim(),
          customer_phone: editCustomerPhone.trim(),
          customer_address: editCustomerAddress.trim(),
        })
        .eq('id', editCustomerOrder.id)
      if (error) throw error
      // Update local state
      const updatedOrder = {
        ...editCustomerOrder,
        customer_name: editCustomerName.trim(),
        customer_phone: editCustomerPhone.trim(),
        customer_address: editCustomerAddress.trim(),
      }
      setOrders(curr => curr.map(o => o.id === editCustomerOrder.id ? updatedOrder : o))
      if (selected?.id === editCustomerOrder.id) setSelected(updatedOrder)
      addToast('✓ Customer info updated successfully!', 'success')
      setEditCustomerOrder(null)
    } catch (err) {
      addToast(readableError(err) || 'Failed to update customer info.', 'error')
    } finally {
      setSavingCustomer(false)
    }
  }

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

    const finalFinancials = calculateFinancials(sumLineTotals(items), balance, deposit)
    const { totalAmount: finalTotalAmount, balance: finalBalance, totalBalance: finalTotalBalance, deposit: finalDeposit, remainingBalance: finalRemaining } = finalFinancials
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
        const pdfName = invoiceFilename(selected.customer_name)
        const blob = await drawInvoice(nextOrder, items, finalTotalAmount, {
          totalAmount: finalTotalAmount,
          balance: finalBalance,
          totalBalance: finalTotalBalance,
          deposit: finalDeposit,
          remainingBalance: finalRemaining,
        }, pdfName)
        setLastPdf({ blob, name: pdfName })
        // Keep the existing native print workflow, but only after a successful
        // PDF export. No fallback-warning toast is shown.
        printInvoiceHtml(buildInvoiceHtml({
          order: nextOrder,
          items,
          financials: { totalAmount: finalTotalAmount, balance: finalBalance, totalBalance: finalTotalBalance, deposit: finalDeposit, remainingBalance: finalRemaining },
        }))
        addToast('Invoice saved and PDF downloaded successfully.', 'success')
      } catch (invoiceErr) {
        addToast('The invoice could not be exported. Please try again.', 'error')
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
          </div>
          <div className="admin-top-actions">
            {([['orders', 'Orders', ReceiptText], ['create-order', 'Create Order', Plus], ['products', 'Products', ShoppingBag], ['reports', 'Daily Reports', ReceiptText], ['customer-report', 'Customer Report', UserRound], ['purchase-report', 'Purchase Report', ReceiptText], ['stock-report', 'Stock Report', ShoppingBag]] as const).map(([view, label, Icon]) => <button key={view} type="button" className={`btn-secondary ${adminView === view ? 'btn-secondary--active' : ''}`} onClick={() => setAdminView(view)}><Icon size={16} /> {label}</button>)}
            {adminView === 'orders' && <button type="button" className="btn-secondary" onClick={() => void refresh()}><RefreshCw size={16} /> {t.refresh}</button>}
            <button type="button" className="btn-secondary btn-danger" onClick={onAuth}>
              <LogOut size={16} /> {t.logout}
            </button>
          </div>
        </div>

        {/* Orders, Daily Reports, and Create Order views */}
        {adminView === 'reports'
          ? <DailyReports language={language} onBack={() => setAdminView('orders')} />
          : adminView === 'customer-report'
          ? <CustomerReportWithAdd />
          : adminView === 'purchase-report'
          ? <PurchaseReport />
          : adminView === 'stock-report'
          ? <StockReport />
          : adminView === 'products'
          ? <AdminProducts onChanged={() => setCatalogVersion(value => value + 1)} />
          : adminView === 'create-order'
          ? <AdminCreateOrder language={language} onSuccess={() => { setAdminView('orders'); void refresh() }} onBack={() => setAdminView('orders')} />
          : <div className="admin-grid">
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

            {loading ? (
              <div>{Array.from({ length: 5 }).map((_, index) => <div key={index} className="skeleton" style={{ height: 72, marginBottom: 8, borderRadius: 10 }} />)}</div>
            ) : shownOrders.length === 0 ? (
              <div className="empty-state">
                <ReceiptText size={36} />
                <p>{t.noOrders}</p>
              </div>
            ) : (
              <div className="order-list">
                {shownOrders.map(order => (
                  <div
                    key={order.id}
                    className={`order-card-wrap ${selected?.id === order.id ? 'order-card-wrap--selected' : ''}`}
                  >
                    <button
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
                    <button
                      type="button"
                      className="order-card-edit-customer"
                      title="Edit customer info"
                      onClick={e => openEditCustomer(order, e)}
                      aria-label={`Edit customer info for ${order.order_ref}`}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="order-card-delete"
                      title="Delete order"
                      onClick={e => { e.stopPropagation(); setDeleteOrderId(order.id) }}
                      aria-label={`Delete order ${order.order_ref}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Delete confirmation modal */}
            {deleteOrderId && (
              <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="del-title">
                <div className="modal-box">
                  <div className="modal-icon"><Trash2 size={28} /></div>
                  <h3 className="modal-title" id="del-title">Delete Order?</h3>
                  <p className="modal-body">
                    This will permanently remove the order and all its data from the database.
                    This action <strong>cannot be undone</strong>.
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="modal-btn modal-btn--cancel"
                      onClick={() => setDeleteOrderId(null)}
                      disabled={deleting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="modal-btn modal-btn--danger"
                      onClick={() => void confirmDeleteOrder()}
                      disabled={deleting}
                    >
                      {deleting ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
                      {deleting ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Edit Customer Info Modal */}
          {editCustomerOrder && (
            <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-customer-title">
              <div className="modal-box">
                <div className="modal-icon"><UserRound size={28} /></div>
                <h3 className="modal-title" id="edit-customer-title">Edit Customer Info</h3>
                <p className="modal-body" style={{ marginBottom: 16 }}>
                  <strong>{editCustomerOrder.order_ref}</strong> — Fix typos in customer details below.
                </p>
                <label className="field" style={{ marginBottom: 10, display: 'block', textAlign: 'left' }}>
                  <span className="field-label">Customer Name</span>
                  <input
                    className="field-input"
                    value={editCustomerName}
                    onChange={e => setEditCustomerName(e.target.value)}
                    placeholder="Customer name"
                  />
                </label>
                <label className="field" style={{ marginBottom: 10, display: 'block', textAlign: 'left' }}>
                  <span className="field-label">Phone Number</span>
                  <input
                    className="field-input"
                    value={editCustomerPhone}
                    onChange={e => setEditCustomerPhone(e.target.value)}
                    placeholder="Phone number"
                    dir="ltr"
                  />
                </label>
                <label className="field" style={{ marginBottom: 16, display: 'block', textAlign: 'left' }}>
                  <span className="field-label">Address</span>
                  <textarea
                    className="field-textarea"
                    value={editCustomerAddress}
                    onChange={e => setEditCustomerAddress(e.target.value)}
                    placeholder="Delivery address"
                    rows={3}
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="modal-btn modal-btn--cancel"
                    onClick={() => setEditCustomerOrder(null)}
                    disabled={savingCustomer}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="modal-btn modal-btn--confirm"
                    onClick={() => void saveCustomerInfo()}
                    disabled={savingCustomer || !editCustomerName.trim()}
                  >
                    {savingCustomer ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}
                    {savingCustomer ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

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
                            <td className="td-name">
                              <div className="pricing-name-wrap">
                                <textarea
                                  className="pricing-input pricing-input--name"
                                  data-item-name
                                  onKeyDown={e => insertTextareaLineBreak(e, value => updateItem(index, 'name', value))}
                                  onInput={autoExpandTextarea}
                                  value={item.name}
                                  rows={Math.max(1, (item.name.match(/\n/g) || []).length + 1)}
                                  onChange={e => updateItem(index, 'name', e.target.value)}
                                  aria-label={`${t.item} ${index + 1}`}
                                  placeholder="e.g. Rice, Sugar"
                                />
                              </div>
                            </td>
                            <td>
                              <input
                                className="pricing-input pricing-input--num"
                                onKeyDown={e => advanceItemRow(e, addAdminItem)}
                                type="number"
                                min="0"
                                step="0.001"
                                value={item.quantity_value || ''}
                                onChange={e => updateItem(index, 'quantity_value', e.target.value)}
                                aria-label={`${t.quantity} ${index + 1}`}
                                placeholder="Quantity"
                              />
                            </td>
                            <td>
                              <div className="select-wrap">
                                  <select
                                  className="pricing-select"
                                  onKeyDown={e => advanceItemRow(e, addAdminItem)}
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
                                onKeyDown={e => advanceItemRow(e, addAdminItem)}
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unit_price || ''}
                                onChange={e => updateItem(index, 'unit_price', e.target.value)}
                                aria-label={`${t.unitPrice} ${index + 1}`}
                                placeholder="Rs"
                              />
                            </td>
                            <td>
                              <input
                                className="pricing-input pricing-input--num pricing-input--total"
                                onKeyDown={e => advanceItemRow(e, addAdminItem)}
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.total || ''}
                                onChange={e => updateItem(index, 'total', e.target.value)}
                                aria-label={`${t.lineTotal} ${index + 1}`}
                                title={t.editTotal}
                                placeholder="Total"
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
                    <button type="button" className="btn-add-item btn-quick-item" onClick={() => addQuickAdminItem('Rent')}><Plus size={16} /> Rent</button>
                    <button type="button" className="btn-add-item btn-quick-item" onClick={() => addQuickAdminItem('Tulai')}><Plus size={16} /> Tulai</button>
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
        </div>}
      </div>
    </main>
  )
}

// ─── Admin Create Order ───────────────────────────────────────────────────────
type AdminOrderRow = { id: string; itemName: string; quantityValue: string; unitType: UnitType; rate: string }
const createAdminRow = (): AdminOrderRow => ({ id: crypto.randomUUID(), itemName: '', quantityValue: '', unitType: 'NONE', rate: '' })

function AdminCreateOrder({
  language, onSuccess, onBack,
}: {
  language: Language; onSuccess: () => void; onBack: () => void
}) {
  const isRtl = language === 'ur'
  const { toasts, add: addToast, dismiss } = useToasts()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<AdminOrderRow[]>(() => Array.from({ length: 5 }, createAdminRow))
  const [suggestionRowId, setSuggestionRowId] = useState<string | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const customerMatches = useMemo(() => {
    const query = name.trim().toLowerCase()
    if (!query) return []
    let saved = SAVED_CUSTOMERS
    try { saved = [...saved, ...(JSON.parse(localStorage.getItem('ahwmb-saved-customers') || '[]') as typeof SAVED_CUSTOMERS)] } catch { /* storage unavailable */ }
    return saved.filter((customer, index, all) => all.findIndex(item => item.name.toLowerCase() === customer.name.toLowerCase()) === index).filter(customer => customer.name.toLowerCase().includes(query)).slice(0, 8)
  }, [name])

  const updateRow = (id: string, field: keyof Omit<AdminOrderRow, 'id'>, value: string) => {
    setRows(curr => {
      const next = curr.map(r => r.id === id ? { ...r, [field]: value } as AdminOrderRow : r)
      if (curr[curr.length - 1]?.id === id && value.trim()) next.push(createAdminRow())
      return next
    })
    setErrors(curr => ({ ...curr, items: undefined }))
  }

  const filledRows = rows.filter(r => r.itemName.trim() || r.quantityValue.trim())

  const grandTotal = useMemo(() =>
    sumLineTotals(filledRows.map(r => {
      const qv = Number(r.quantityValue) || 0
      const rv = Number(r.rate) || 0
      return { quantity_value: qv, unit_type: r.unitType, unit_price: rv, rate: rv, total: calculateAppLineTotal({ quantity_value: qv, unit_type: r.unitType, unit_price: rv, rate: rv }) }
    }))
  , [filledRows])

  const submit = async () => {
    const next: FormErrors = {}
    if (filledRows.length === 0 || filledRows.some(r => !r.itemName.trim() || !r.quantityValue.trim()))
      next.items = 'Fill in item name and quantity for every row you use.'
    setErrors(next)
    if (Object.keys(next).length) return
    if (!supabase) { addToast('Supabase not configured.', 'error'); return }

    setSaving(true)
    const orderRef = createOrderRef()
    const items: OrderItem[] = filledRows.map((row, index) => {
      const quantityValue = Number(row.quantityValue) || 0
      const unitPrice = Number(row.rate) || 0
      const total = calculateAppLineTotal({ quantity_value: quantityValue, unit_type: row.unitType, unit_price: unitPrice, rate: unitPrice })
      return {
        sr: index + 1,
        name: row.itemName.trim(),
        quantity: quantityText(quantityValue, row.unitType, 'en'),
        quantity_value: quantityValue,
        unit_type: row.unitType,
        rate: unitPrice,
        unit_price: unitPrice,
        total,
      }
    })

    const phoneNorm = phone.trim() ? normalizePhone(phone) : '0000000000'
    const addressVal = address.trim() + (notes.trim() ? `\nNotes: ${notes.trim()}` : '')

    try {
      const { data: orderId, error: rpcError } = await supabase.rpc('submit_order', {
        p_order_ref: orderRef,
        p_customer_name: name.trim(),
        p_customer_phone: phoneNorm,
        p_customer_address: addressVal,
        p_location_link: null,
        p_items: items,
      })
      if (rpcError) throw rpcError

      // Update financials to reflect rates entered by admin
      if (orderId) {
        await supabase
          .from('orders')
          .update({ grand_total: grandTotal, total_amount: grandTotal })
          .eq('id', orderId)
      }

      addToast(`✓ Order ${orderRef} created successfully!`, 'success')
      setTimeout(() => onSuccess(), 700)
    } catch (err) {
      addToast(readableError(err) || 'Failed to create order.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`daily-report-page panel ${isRtl ? 'rtl-mode' : 'ltr-mode'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <ToastContainer toasts={toasts} dismiss={dismiss} />

      <div className="daily-report-head">
        <div>
          <p className="admin-eyebrow">AHWMB</p>
          <h2 className="admin-heading">{isRtl ? 'نیا آرڈر بنائیں' : 'Create Order'}</h2>
          <p className="panel-sub">{isRtl ? 'نیا آرڈر براہ راست ریٹ کے ساتھ بنائیں۔' : 'Create a new order with item rates. It will appear in the Orders dashboard immediately.'}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onBack}>
          <ReceiptText size={16} /> {isRtl ? 'آرڈرز' : 'Orders'}
        </button>
      </div>

      {/* Customer details */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-icon card-icon--green"><UserRound size={20} /></span>
          <div>
            <h2 className="card-title">{isRtl ? 'گاہک کی معلومات' : 'Customer Details'}</h2>
            <p className="card-sub">{isRtl ? 'نام، موبائل اور ترسیل کا پتہ' : 'Name, mobile, and delivery address'}</p>
          </div>
        </div>
        <div className="field-group">
          <label className={`field customer-autocomplete ${errors.name ? 'field--error' : ''}`}>
            <span className="field-label">{isRtl ? 'گاہک کا نام' : 'Customer Name'}</span>
            <div className="field-input-wrap">
              <UserRound size={18} className="field-icon" />
              <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder={isRtl ? 'گاہک کا پورا نام' : 'Customer full name'} autoComplete="off" />
            </div>
            {customerMatches.length > 0 && <div className="customer-suggestions">{customerMatches.map(customer => <button type="button" key={customer.name} onMouseDown={e => e.preventDefault()} onClick={() => { setName(customer.name); setAddress(customer.address) }}><strong>{customer.name}</strong><small>{customer.address}</small></button>)}</div>}
            {errors.name && <small className="field-error-msg">{errors.name}</small>}
          </label>
          <label className="field">
            <span className="field-label">{isRtl ? 'موبائل نمبر' : 'Phone Number'}</span>
            <div className="field-input-wrap">
              <Phone size={18} className="field-icon field-icon--start" />
              <input className="field-input field-input--ltr" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0300-1234567" type="tel" inputMode="tel" />
            </div>
          </label>
          <label className={`field ${errors.address ? 'field--error' : ''}`}>
            <span className="field-label">{isRtl ? 'ترسیل کا پتہ' : 'Delivery Address'}</span>
            <div className="field-input-wrap">
              <MapPin size={18} className="field-icon" />
              <textarea className="field-textarea" value={address} onChange={e => setAddress(e.target.value)} placeholder={isRtl ? 'گھر کا مکمل پتہ' : 'Full delivery address'} rows={3} />
            </div>
            {errors.address && <small className="field-error-msg">{errors.address}</small>}
          </label>
          <label className="field">
            <span className="field-label">{isRtl ? 'اضافی نوٹس' : 'Additional Notes'}</span>
            <textarea className="field-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder={isRtl ? 'اضافی ہدایات…' : 'Extra delivery instructions or special requests…'} rows={2} />
          </label>
        </div>
      </div>

      {/* Items with rates */}
      <div className="card items-card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-icon card-icon--gold"><ReceiptText size={20} /></span>
          <div>
            <h2 className="card-title">{isRtl ? 'آرڈر کی فہرست' : 'Order Items'}</h2>
            <p className="card-sub">{isRtl ? 'سامان، مقدار، اکائی اور ریٹ درج کریں۔' : 'Enter item, quantity, unit, and rate for each item.'}</p>
          </div>
        </div>
        {errors.items && (
          <div className="inline-error" role="alert" style={{ marginBottom: 8 }}>
            <AlertCircle size={17} /> {errors.items}
          </div>
        )}
        <div className="table-wrap">
          <table className="order-table admin-create-table">
            <thead>
              <tr>
                <th className="col-sr">#</th>
                <th className="col-item">{isRtl ? 'سامان' : 'Item Name'}</th>
                <th className="col-qty">{isRtl ? 'مقدار' : 'Qty'}</th>
                <th className="col-unit">{isRtl ? 'اکائی' : 'Unit'}</th>
                <th className="col-rate">{isRtl ? 'ریٹ' : 'Rate'}</th>
                <th className="col-total">{isRtl ? 'کل' : 'Total'}</th>
                <th className="col-del"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const qv = Number(row.quantityValue) || 0
                const rv = Number(row.rate) || 0
                const lineTotal = qv && rv ? calculateAppLineTotal({ quantity_value: qv, unit_type: row.unitType, unit_price: rv, rate: rv }) : 0
                return (
                  <tr key={row.id}>
                    <td className="col-sr td-sr">{index + 1}</td>
                    <td>
                      <div className="item-typeahead">
                        <input
                          className="cell-input"
                          data-item-name
                          onFocus={() => setSuggestionRowId(row.id)}
                          onBlur={() => window.setTimeout(() => setSuggestionRowId(null), 150)}
                          value={row.itemName}
                          onChange={e => updateRow(row.id, 'itemName', e.target.value)}
                          placeholder={isRtl ? 'مثلاً چاول، چینی' : 'e.g. Rice, Sugar'}
                          list={`admin-product-suggestions-${row.id}`}
                          autoComplete="off"
                        />
                        {suggestionRowId === row.id && <ProductSuggestionMenu query={row.itemName} onSelect={name => { updateRow(row.id, 'itemName', name); setSuggestionRowId(null) }} />}
                        <datalist id={`admin-product-suggestions-${row.id}`}>
                          {productSuggestions(row.itemName).map(p => <option key={p.name} value={p.name} />)}
                        </datalist>
                      </div>
                    </td>
                    <td>
                      <input className="cell-input" type="number" min="0" step="0.001" value={row.quantityValue} onChange={e => updateRow(row.id, 'quantityValue', e.target.value)} onKeyDown={e => advanceItemRow(e, () => setRows(curr => [...curr, createAdminRow()]))} placeholder={isRtl ? 'مقدار' : 'Quantity'} aria-label={`Quantity ${index + 1}`} />
                    </td>
                    <td>
                      <div className="select-wrap">
                        <select className="cell-select" value={row.unitType} onChange={e => updateRow(row.id, 'unitType', e.target.value as UnitType)} onKeyDown={e => advanceItemRow(e, () => setRows(curr => [...curr, createAdminRow()]))} aria-label={`Unit ${index + 1}`}>
                          {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o[language === 'ur' ? 'ur' : 'en']}</option>)}
                        </select>
                        <ChevronDown size={14} className="select-icon" />
                      </div>
                    </td>
                    <td>
                      <input className="cell-input" type="number" min="0" step="0.01" value={row.rate} onChange={e => updateRow(row.id, 'rate', e.target.value)} onKeyDown={e => advanceItemRow(e, () => setRows(curr => [...curr, createAdminRow()]))} placeholder="Rs" aria-label={`Rate ${index + 1}`} />
                    </td>
                    <td>
                      <div className="cell-locked admin-total-value">
                        <span>{lineTotal > 0 ? `Rs. ${Math.round(lineTotal).toLocaleString('en-PK')}` : '—'}</span>
                      </div>
                    </td>
                    <td className="col-del">
                      <button type="button" className="btn-del" onClick={() => setRows(curr => curr.length > 1 ? curr.filter(r => r.id !== row.id) : [createAdminRow()])} aria-label={`Remove ${index + 1}`}>
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <button type="button" className="btn-add-row" onClick={() => setRows(curr => [...curr, createAdminRow()])}>
            <Plus size={17} /> {isRtl ? '+ سامان شامل کریں' : '+ Add Item'}
          </button>
          {grandTotal > 0 && (
            <span className="grand-value" style={{ fontSize: '1rem' }}>
              {isRtl ? 'کل:' : 'Grand Total:'} {formatMoney(grandTotal)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button type="button" className="btn-secondary" onClick={onBack} style={{ flex: '0 0 auto' }}>
          {isRtl ? 'منسوخ' : 'Cancel'}
        </button>
        <button type="button" className="btn-submit" style={{ flex: 1 }} onClick={() => void submit()} disabled={saving}>
          {saving ? <RefreshCw size={20} className="spin" /> : <Send size={20} />}
          <span>{saving ? (isRtl ? 'محفوظ ہو رہا ہے…' : 'Creating…') : (isRtl ? 'آرڈر جمع کروائیں' : 'Submit Order')}</span>
        </button>
      </div>
    </section>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const path = usePath()
  const [, setCatalogVersion] = useState(0)
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
    let localProducts: CatalogProduct[] = []
    try { localProducts = JSON.parse(localStorage.getItem('ahwmb-extra-products') || '[]') as CatalogProduct[] } catch { /* storage unavailable */ }
    if (localProducts.length) {
      runtimeCatalog = [...PRODUCT_CATALOG, ...localProducts].filter((product, index, all) => all.findIndex(item => item.name.toLowerCase() === product.name.toLowerCase()) === index)
      setCatalogVersion(value => value + 1)
    }
    if (!supabase) return
    supabase.from('products').select('name,category').order('name').then(({ data }) => {
      if (data?.length || localProducts.length) {
        runtimeCatalog = [...PRODUCT_CATALOG, ...localProducts, ...(data || [])].filter((product, index, all) => all.findIndex(item => item.name.toLowerCase() === product.name.toLowerCase()) === index)
        setCatalogVersion(value => value + 1)
      }
    })
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(async ({ data }) => { setIsAuthenticated(Boolean(data.session && await isCurrentAdmin())) })
    const { data: listener } = supabase.auth.onAuthStateChange(() => { void isCurrentAdmin().then(setIsAuthenticated) })
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
