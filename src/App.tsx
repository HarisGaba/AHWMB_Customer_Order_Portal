import { useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  Check,
  FileDown,
  Info,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  ReceiptText,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react'

type OrderRow = {
  id: string
  itemName: string
  quantity: string
}

type FormErrors = {
  name?: string
  phone?: string
  address?: string
  items?: string
}

const SHOPKEEPER_NUMBER = import.meta.env.VITE_SHOPKEEPER_WHATSAPP || '923001234567'

const createRow = (): OrderRow => ({ id: crypto.randomUUID(), itemName: '', quantity: '' })
const createDefaultRows = () => Array.from({ length: 10 }, () => createRow())

const normalizeWhatsAppNumber = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('0092')) return digits.slice(2)
  if (digits.startsWith('92')) return digits
  if (digits.startsWith('0')) return `92${digits.slice(1)}`
  return digits
}

const isValidPakistaniPhone = (value: string) => {
  const normalized = normalizeWhatsAppNumber(value)
  return normalized.length === 12 && normalized.startsWith('923')
}

const formatPhoneForPdf = (value: string) => {
  const normalized = normalizeWhatsAppNumber(value)
  return normalized.length === 12 ? `+${normalized.slice(0, 2)} ${normalized.slice(2, 5)} ${normalized.slice(5)}` : value || '—'
}

const formatExactTimestamp = (date: Date) => {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = date.getHours()
  const hour12 = String(hours % 12 || 12).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const period = hours >= 12 ? 'PM' : 'AM'
  return `Date: ${day}/${month}/${year} | Time: ${hour12}:${minutes} ${period}`
}

function App() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [rows, setRows] = useState<OrderRow[]>(createDefaultRows)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [downloaded, setDownloaded] = useState(false)
  const [pdfName, setPdfName] = useState('')

  const filledRows = useMemo(() => rows.filter((row) => row.itemName.trim() || row.quantity.trim()), [rows])
  const hasOrderContent = filledRows.length > 0 || notes.trim().length > 0

  const updateRow = (id: string, field: 'itemName' | 'quantity', value: string) => {
    setRows((current) => {
      const next = current.map((row) => row.id === id ? { ...row, [field]: value } : row)
      const isLastRow = current[current.length - 1]?.id === id
      if (isLastRow && value.trim()) next.push(createRow())
      return next
    })
    setDownloaded(false)
    setErrors((current) => ({ ...current, items: undefined }))
  }

  const addRow = () => {
    setRows((current) => [...current, createRow()])
    setDownloaded(false)
  }

  const deleteRow = (id: string) => {
    setRows((current) => {
      const next = current.filter((row) => row.id !== id)
      return next.length ? next : [createRow()]
    })
    setDownloaded(false)
  }

  const clearOrder = () => {
    if ((hasOrderContent || name.trim() || phone.trim() || address.trim()) && !window.confirm('کیا آپ پورا آرڈر صاف کرنا چاہتے ہیں؟')) return
    setRows(createDefaultRows())
    setNotes('')
    setName('')
    setPhone('')
    setAddress('')
    setErrors({})
    setDownloaded(false)
    setPdfName('')
  }

  const validate = () => {
    const next: FormErrors = {}
    if (!name.trim()) next.name = 'براہ کرم اپنا نام لکھیں۔'
    if (!isValidPakistaniPhone(phone)) next.phone = 'درست موبائل نمبر لکھیں، مثلاً 0300-1234567۔'
    if (!address.trim()) next.address = 'براہ کرم گھر کا مکمل پتہ لکھیں۔'
    if (!hasOrderContent || filledRows.some((row) => !row.itemName.trim() || !row.quantity.trim())) {
      next.items = 'جس قطار میں سامان لکھا ہے، اس میں مقدار بھی لکھیں۔'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const generatePdf = () => {
    if (!validate()) {
      document.getElementById('order-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const generatedAt = new Date()
    const timestamp = formatExactTimestamp(generatedAt)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 10
    const green = '#087F5B'
    const dark = '#12352B'
    const muted = '#5B6B65'

    doc.setFillColor(green)
    doc.rect(0, 0, pageWidth, 34, 'F')
    doc.setFillColor('#F4C542')
    doc.rect(margin, 8, 9, 9, 'F')
    doc.setTextColor(dark)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('AH', margin + 1.2, 14.5)
    doc.setTextColor('#FFFFFF')
    doc.setFontSize(14)
    doc.text('AHWMB', margin + 13, 11)
    doc.setFontSize(8.2)
    doc.text('Adam Haji Wali Muhammad & Brothers', margin + 13, 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.2)
    doc.text('CUSTOMER ORDER PORTAL · INVOICE / RIDER COPY', margin + 13, 24)

    doc.setTextColor(dark)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('Customer details', margin, 43)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(muted)
    doc.text(`Name: ${name.trim() || '—'}`, margin, 49)
    doc.text(`Mobile: ${formatPhoneForPdf(phone)}`, margin, 54)
    doc.text(`Address: ${address.trim() || '—'}`, margin, 59)
    doc.text(timestamp, pageWidth - margin, 49, { align: 'right' })

    autoTable(doc, {
      startY: 66,
      margin: { left: margin, right: margin },
      head: [['SR #', 'Item Name', 'Quantity', 'Rate', 'Total Price']],
      body: filledRows.map((row, index) => [String(index + 1), row.itemName.trim(), row.quantity.trim(), '________', '________']),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7.2, textColor: dark, lineColor: '#B9CCC4', lineWidth: 0.25, cellPadding: 2.5, valign: 'middle' },
      headStyles: { fillColor: green, textColor: '#FFFFFF', fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: '#F1FAF5' },
      columnStyles: { 0: { cellWidth: 14, halign: 'center' }, 1: { cellWidth: 46 }, 2: { cellWidth: 28 }, 3: { cellWidth: 22, halign: 'center' }, 4: { cellWidth: 27, halign: 'center' } },
    })

    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 77
    let summaryY = Math.min(finalY + 10, pageHeight - 48)
    if (notes.trim()) {
      doc.setTextColor(dark)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.8)
      doc.text('Extra notes / additional items', margin, summaryY)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.2)
      doc.setTextColor(muted)
      const noteLines = doc.splitTextToSize(notes.trim(), pageWidth - margin * 2 - 4)
      doc.text(noteLines.slice(0, 3), margin + 2, summaryY + 5)
      summaryY += 5 + Math.min(noteLines.length, 3) * 3.5
    }

    doc.setTextColor(dark)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Shopkeeper fill-in', margin, summaryY + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text('Grand Total', pageWidth - 62, summaryY + 12)
    doc.rect(pageWidth - 39, summaryY + 7, 29, 9)
    doc.setFontSize(6.2)
    doc.setTextColor(muted)
    doc.text('Write total here', pageWidth - 24.5, summaryY + 12.5, { align: 'center' })

    doc.setFillColor('#E8F7F0')
    doc.rect(margin, pageHeight - 22, pageWidth - margin * 2, 12, 'F')
    doc.setTextColor(green)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Rider Copy - Cash on Delivery', pageWidth / 2, pageHeight - 15, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text('Please confirm rates and grand total with the customer.', pageWidth / 2, pageHeight - 11, { align: 'center' })

    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer'
    const filename = `ahwmb-order-${safeName}.pdf`
    doc.save(filename)
    setPdfName(filename)
    setDownloaded(true)
  }

  const sendWhatsApp = () => {
    const number = normalizeWhatsAppNumber(SHOPKEEPER_NUMBER)
    const itemSummary = filledRows.map((row, index) => `${index + 1}. ${row.itemName.trim()} — ${row.quantity.trim()}`)
    const message = [
      'AHWMB CUSTOMER ORDER PORTAL',
      'Adam Haji Wali Muhammad & Brothers',
      '',
      `Customer: ${name.trim()}`,
      `Mobile: ${phone.trim()}`,
      `Address: ${address.trim()}`,
      '',
      'Items:',
      ...itemSummary,
      notes.trim() ? `\nExtra notes: ${notes.trim()}` : '',
      '',
      'PDF invoice downloaded. I will attach it in this chat.',
    ].filter(Boolean).join('\n')
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <main className="simple-app" dir="rtl">
      <header className="simple-header">
        <div className="simple-brand">
          <div className="simple-logo" aria-hidden="true"><ReceiptText size={27} /></div>
          <div><p>AHWMB</p><h1>کسٹمر آرڈر پورٹل</h1><span>آدم حاجی ولی محمد اینڈ برادرز</span></div>
        </div>
        <div className="urdu-tag" lang="ur">آسان آرڈر</div>
      </header>

      <div className="simple-wrap">
        <section className="welcome-block" aria-label="خوش آمدید">
          <h2>اپنا آرڈر بھیجیں</h2>
          <p>اپنی معلومات اور سامان کی فہرست نیچے لکھیں</p>
        </section>

        <form id="order-form" onSubmit={(event) => { event.preventDefault(); generatePdf() }}>
          <section className="simple-card customer-card" aria-labelledby="customer-title">
            <div className="simple-card-title"><span className="title-icon"><UserRound size={20} /></span><div><h2 id="customer-title">گاہک کی معلومات</h2><p>نام، موبائل اور گھر کا پتہ</p></div></div>
            <label className={`big-field ${errors.name ? 'field-error' : ''}`}>
              <span>نام <b>*</b></span>
              <div className="big-input-wrap"><UserRound size={20} /><input required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); setDownloaded(false) }} placeholder="اپنا نام لکھیں" autoComplete="name" /></div>
              {errors.name && <small id="name-error">{errors.name}</small>}
            </label>
            <label className={`big-field ${errors.phone ? 'field-error' : ''}`}>
              <span>موبائل نمبر <b>*</b></span>
              <div className="big-input-wrap phone-wrap"><Phone size={20} /><input className="phone-input" dir="ltr" required aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'phone-error' : undefined} value={phone} onChange={(event) => { setPhone(event.target.value); setErrors((current) => ({ ...current, phone: undefined })); setDownloaded(false) }} placeholder="0300-1234567" type="tel" inputMode="tel" autoComplete="tel" /></div>
              {errors.phone && <small id="phone-error">{errors.phone}</small>}
            </label>
            <label className={`big-field ${errors.address ? 'field-error' : ''}`}>
              <span>ترسیل کا پتہ <b>*</b></span>
              <div className="big-input-wrap textarea-wrap"><MapPin size={20} /><textarea required aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? 'address-error' : undefined} value={address} onChange={(event) => { setAddress(event.target.value); setErrors((current) => ({ ...current, address: undefined })); setDownloaded(false) }} placeholder="گھر کا مکمل پتہ لکھیں" rows={3} autoComplete="street-address" /></div>
              {errors.address && <small id="address-error">{errors.address}</small>}
            </label>
          </section>

          <section className="simple-card items-card" aria-labelledby="items-title">
            <div className="simple-card-title"><span className="title-icon green-icon"><ReceiptText size={20} /></span><div><h2 id="items-title">اشیاء کی فہرست (سامان کا آرڈر)</h2><p>سامان اور مقدار لکھیں، قیمت دکاندار بھرے گا</p></div></div>
            <div className="table-hint"><Info size={16} /> موبائل پر جدول کو دائیں بائیں کریں</div>
            <div className="table-scroll">
              <table className="order-table">
                <thead><tr><th className="sr-column">نمبر</th><th>سامان کا نام</th><th>مقدار</th><th>قیمت</th><th>کل رقم</th><th className="delete-column"><span className="sr-only">حذف کریں</span></th></tr></thead>
                <tbody>
                  {rows.map((row, index) => <tr key={row.id}>
                    <td className="sr-cell">{index + 1}</td>
                    <td><input value={row.itemName} onChange={(event) => updateRow(row.id, 'itemName', event.target.value)} placeholder="مثلاً: آٹا، چینی، چائے" aria-label={`سامان کا نام ${index + 1}`} /></td>
                    <td><input value={row.quantity} onChange={(event) => updateRow(row.id, 'quantity', event.target.value)} placeholder="مثلاً: 10 کلو، 2 پیکٹ" aria-label={`مقدار ${index + 1}`} /></td>
                    <td><div className="locked-cell"><span>دکاندار بھرے گا</span><Info size={17} /></div></td>
                    <td><div className="locked-cell"><span>دکاندار بھرے گا</span><Info size={17} /></div></td>
                    <td className="delete-cell"><button type="button" className="delete-button" onClick={() => deleteRow(row.id)} aria-label={`قطار ${index + 1} حذف کریں`}><Trash2 size={22} /></button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {errors.items && <div className="table-error" role="alert"><Info size={19} /> {errors.items}</div>}
            <div className="table-actions"><button type="button" className="add-row-button" onClick={addRow}>➕ اور سامان شامل کریں</button><span>{rows.length} قطاریں موجود ہیں</span></div>
          </section>

          <section className="simple-card notes-card" aria-labelledby="notes-title">
            <div className="simple-card-title"><span className="title-icon yellow-icon"><Plus size={22} /></span><div><h2 id="notes-title">مزید کچھ؟</h2><p>اضافی ہدایات یا کوئی اور سامان</p></div></div>
            <label className="big-field">
              <span>اضافی نوٹس</span>
              <textarea className="custom-textarea" value={notes} onChange={(event) => { setNotes(event.target.value); setErrors((current) => ({ ...current, items: undefined })); setDownloaded(false) }} placeholder="کچھ اور چاہیے؟ یہاں لکھیں (مثلاً: شان مصالحہ 2 پیکٹ، بیسن 1 کلو)..." rows={4} />
            </label>
            <button type="button" className="clear-button" onClick={clearOrder}>آرڈر صاف کریں</button>
          </section>

          <section className="action-card" aria-label="آرڈر بنائیں اور بھیجیں">
            <div className="action-copy"><Check size={21} /><div><strong>آرڈر تیار ہے؟</strong><span>پی ڈی ایف بنائیں اور دکاندار کو بھیجیں</span></div></div>
            <button className="order-button" type="submit"><FileDown size={24} /> <span>آرڈر کی پی ڈی ایف بنائیں<br /><small>دکاندار کے لیے رسید</small></span><Send size={22} /></button>
            {downloaded && <div className="download-success" role="status"><div><Check size={20} /><span><strong>پی ڈی ایف تیار ہے!</strong><small>{pdfName}</small></span></div><button type="button" className="whatsapp-send" onClick={sendWhatsApp}><MessageCircle size={22} /> واٹس ایپ پر آرڈر بھیجیں</button></div>}
          </section>
        </form>

        <footer className="simple-footer"><span>AHWMB کسٹمر آرڈر پورٹل</span><span>نقد ادائیگی</span></footer>
      </div>
    </main>
  )
}

export default App
