import { calculateCommission, decimal, ratePercentLabel, rupees, type CommissionLine } from './commission'

/**
 * A4 "SALES INVOICE" with commission columns, laid out like
 * Qapas_Altaf_Company_Redesigned_Invoice_20-11-2026.pdf. Black on white so it prints sharp.
 * Rows continue on extra pages automatically; the totals block never gets clipped.
 */
export type CommissionInvoiceInput = {
  customer: string
  date: string
  ratePercent: number
  lines: CommissionLine[]
  balance: number | null
  deposit: number | null
  logoUrl?: string
}

const NON_LATIN = /[^\u0000-ɏ -⁯]/

async function imageData(url?: string): Promise<string | null> {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob) })
  } catch { return null }
}

/** Urdu / other scripts: draw with the browser's fonts onto a canvas, then place as an image. */
function textImage(text: string, fontPx: number, bold = false) {
  const scale = 4
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${bold ? '700 ' : ''}${fontPx * scale}px "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Jameel Noori Nastaleeq", Arial, sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 4 * scale
  const h = Math.ceil(fontPx * scale * 1.9)
  canvas.width = w; canvas.height = h
  ctx.font = font; ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 2 * scale, h / 2)
  return { data: canvas.toDataURL('image/png'), ratio: w / h }
}

export async function buildCommissionInvoice(input: CommissionInvoiceInput): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable/es')])
  const r = calculateCommission(input.lines, input.ratePercent, input.balance ?? 0, input.deposit ?? 0)
  const pct = ratePercentLabel(input.ratePercent)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const W = 210, H = 297, M = 12
  doc.setProperties({ title: `Sales Invoice ${input.customer}`.trim() })

  // Decorative double border with corner blocks (every page).
  const frame = () => {
    doc.setDrawColor(0); doc.setLineWidth(0.9); doc.rect(5, 5, W - 10, H - 10)
    doc.setLineWidth(0.3); doc.rect(7, 7, W - 14, H - 14)
    for (const [x, y] of [[4, 4], [W - 12, 4], [4, H - 12], [W - 12, H - 12]]) {
      doc.setFillColor(255, 255, 255); doc.rect(x, y, 8, 8, 'FD')
      doc.setLineWidth(0.25)
      for (let i = 1; i < 4; i++) { doc.line(x + i * 2, y, x + i * 2, y + 8); doc.line(x, y + i * 2, x + 8, y + i * 2) }
    }
  }
  frame()

  // Logo + boxed title.
  const logo = await imageData(input.logoUrl)
  let y = 11
  if (logo) { doc.addImage(logo, 'PNG', W / 2 - 7, y, 14, 14); y += 15.5 } else y += 4
  doc.setLineWidth(1.1); doc.rect(W / 2 - 44, y, 88, 13)
  doc.setLineWidth(0.3); doc.rect(W / 2 - 42.5, y + 1.4, 85, 10.2)
  doc.setFont('times', 'bold'); doc.setFontSize(23); doc.setTextColor(0)
  doc.text('SALES INVOICE', W / 2, y + 9.4, { align: 'center' })
  y += 16.5

  // Customer name / date bar.
  const barH = 10, divX = W - M - 62
  doc.setLineWidth(0.6); doc.rect(M, y, W - 2 * M, barH); doc.line(divX, y, divX, y + barH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('Customer Name:', M + 4, y + 7)
  if (NON_LATIN.test(input.customer)) {
    const img = textImage(input.customer, 11, true); const h = 7
    doc.addImage(img.data, 'PNG', M + 37, y + 2, Math.min(h * img.ratio, divX - M - 42), h)
  } else doc.text(doc.splitTextToSize(input.customer || '-', divX - M - 42)[0], M + 37, y + 7)
  doc.text('Date:', divX + 5, y + 7)
  doc.text(input.date || '-', divX + 22, y + 7)
  doc.setLineWidth(0.15); doc.setDrawColor(150); doc.line(M + 37, y + 8.6, divX - 4, y + 8.6); doc.line(divX + 22, y + 8.6, W - M - 4, y + 8.6); doc.setDrawColor(0)
  y += barH + 3

  // Items table.
  const nameImages = new Map<number, ReturnType<typeof textImage>>()
  const body = r.lines.map((l, i) => {
    if (NON_LATIN.test(l.name)) nameImages.set(i, textImage(l.name, 8))
    return [String(i + 1), nameImages.has(i) ? '' : l.name, l.quantity, l.rate ? decimal(l.rate, 2) : '-', rupees(l.total), decimal(l.commission, 3), rupees(l.after)]
  })
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 16, bottom: 16 },
    head: [['S.No', 'Item Name', 'Quantity', 'Per Unit Price\n(Rs.)', 'Total Price\n(Rs.)', `Percent\n(${pct})`, 'After Percentage\nTotal Price (Rs.)']],
    body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.2, textColor: 0, lineColor: [60, 60, 60], lineWidth: 0.15, cellPadding: { top: 0.8, bottom: 0.8, left: 1.6, right: 1.6 }, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 7.2, cellPadding: { top: 1, bottom: 1, left: 1, right: 1 }, halign: 'center', valign: 'middle', lineColor: [0, 0, 0] },
    alternateRowStyles: { fillColor: [244, 244, 244] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' }, 1: { cellWidth: 'auto' }, 2: { halign: 'center', cellWidth: 21 },
      3: { halign: 'center', cellWidth: 21 }, 4: { halign: 'center', cellWidth: 21 }, 5: { halign: 'center', cellWidth: 21 }, 6: { halign: 'center', cellWidth: 25 },
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 1) return
      const img = nameImages.get(d.row.index)
      if (!img) return
      const h = Math.min(d.cell.height - 0.8, 4.6)
      doc.addImage(img.data, 'PNG', d.cell.x + 1.4, d.cell.y + (d.cell.height - h) / 2, Math.min(h * img.ratio, d.cell.width - 2.8), h)
    },
    didDrawPage: (d) => { if (d.pageNumber > 1) frame() },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 4

  // Totals band + balance box + thank you need ~60 mm; start a new page if they would not fit.
  if (y + 60 > H - 9) { doc.addPage(); frame(); y = 16 }

  const bandH = 19, colW = (W - 2 * M) / 3
  doc.setFillColor(0, 0, 0); doc.rect(M, y, W - 2 * M, bandH, 'F')
  doc.setDrawColor(255); doc.setLineWidth(0.4)
  const blocks: [string, string, string][] = [
    ['GRAND TOTAL', `(Without Total ${pct} (Additional))`, `Rs. ${rupees(r.grandTotal)}`],
    [`TOTAL ${pct}`, '(ADDITIONAL)', `Rs. ${rupees(r.totalCommission)}`],
    ['GRAND TOTAL', `(After Total ${pct} (Additional))`, `Rs. ${rupees(r.grandAfter)}`],
  ]
  blocks.forEach(([title, sub, value], i) => {
    const cx = M + colW * i + colW / 2
    if (i) doc.line(M + colW * i, y + 3, M + colW * i, y + bandH - 3)
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(title, cx, y + 4.9, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.text(sub, cx, y + 7.7, { align: 'center' })
    doc.line(cx - colW / 2 + 5, y + 9, cx + colW / 2 - 5, y + 9)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(value, cx, y + 15.4, { align: 'center' })
  })
  doc.setTextColor(0); doc.setDrawColor(0)
  y += bandH + 2.5

  // Balance / Deposit / Remaining balance (left blank to fill by hand when not entered).
  const boxH = 21
  doc.setLineWidth(0.6); doc.rect(M, y, W - 2 * M, boxH)
  const inner = { x: M + 3, w: W - 2 * M - 6 }, cw = inner.w / 3
  doc.setFillColor(0, 0, 0); doc.rect(inner.x, y + 2.5, inner.w, 7, 'F')
  doc.setLineWidth(0.3); doc.rect(inner.x, y + 2.5, inner.w, boxH - 5)
  const values = [input.balance, input.deposit, input.balance == null && input.deposit == null ? null : r.remaining]
  ;['BALANCE', 'DEPOSIT', 'REMAINING BALANCE'].forEach((label, i) => {
    const x = inner.x + cw * i
    if (i) doc.line(x, y + 2.5, x, y + boxH - 2.5)
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(label, x + cw / 2, y + 7.4, { align: 'center' })
    doc.setTextColor(0); doc.setFontSize(10.5); doc.text('Rs.', x + 4, y + 15)
    const v = values[i]
    if (v != null) { doc.setFontSize(12); doc.text(rupees(v), x + cw / 2 + 4, y + 14.6, { align: 'center' }) }
    doc.setLineWidth(0.2); doc.setDrawColor(120); doc.line(x + 13, y + 16, x + cw - 6, y + 16); doc.setDrawColor(0)
  })
  y += boxH + 7

  // Thank you.
  doc.setFont('times', 'bolditalic'); doc.setFontSize(24); doc.text('Thank You', W / 2, y + 4, { align: 'center' })
  doc.setLineWidth(0.4); doc.line(W / 2 - 58, y + 1.5, W / 2 - 24, y + 1.5); doc.line(W / 2 + 24, y + 1.5, W / 2 + 58, y + 1.5)
  doc.setFont('times', 'italic'); doc.setFontSize(12); doc.text('For Doing Business With Us', W / 2, y + 11, { align: 'center' })
  doc.setLineWidth(0.3); doc.line(W / 2 - 22, y + 15, W / 2 + 22, y + 15)

  return doc.output('blob')
}
