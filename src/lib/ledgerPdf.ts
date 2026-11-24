import { ddmmyyyy } from './dates'

export type LedgerInput = {
  account: string
  area?: string
  lines: { date: string; item: string; quantity: number | null; rate: number | null; bags: number | null; amount: number; note?: string }[]
  deposits: { date: string; amount: number; method: string }[]
  totalBill: number
  totalDeposited: number
}

const rs = (n: number) => `Rs. ${(Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
const num = (n: number | null) => (n == null ? '-' : n.toLocaleString('en-PK', { maximumFractionDigits: 3 }))

/** A4 supplier ledger: header, bill lines, deposits and the balance summary. Black on white, crisp text. */
export async function buildLedgerPdf(input: LedgerInput): Promise<Blob> {
  const [{ jsPDF }, tableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable/es')])
  const autoTable = tableMod.default
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const W = 210, M = 14
  const remaining = Math.round((input.totalBill - input.totalDeposited) * 100) / 100

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(90)
  doc.text('ADAM HAJI WALI MUHAMMAD & BROTHERS · Jodia Bazaar, Karachi', W / 2, 14, { align: 'center' })
  doc.setFontSize(18); doc.setTextColor(0)
  doc.text('SUPPLIER LEDGER', W / 2, 23, { align: 'center' })
  doc.setLineWidth(0.6); doc.line(M, 27, W - M, 27)
  doc.setFontSize(12); doc.text(`Account: ${input.account}`, M, 35)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  if (input.area) doc.text(`Area: ${input.area}`, M, 41)
  doc.text(`Printed: ${ddmmyyyy(new Date())}`, W - M, 35, { align: 'right' })

  const table = { theme: 'grid' as const, margin: { left: M, right: M, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 9, textColor: 0, lineColor: [80, 80, 80] as [number, number, number], lineWidth: 0.15, cellPadding: 1.6 },
    headStyles: { fillColor: [0, 0, 0] as [number, number, number], textColor: 255, fontStyle: 'bold' as const } }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Bill lines', M, 50)
  autoTable(doc, { ...table, startY: 52,
    head: [['#', 'Date', 'Item Name', 'Quantity', 'Rate', 'Bags', 'Amount']],
    body: input.lines.length ? input.lines.map((l, i) => [String(i + 1), ddmmyyyy(l.date), l.note ? `${l.item}\n${l.note}` : l.item, num(l.quantity), l.rate == null ? '-' : rs(l.rate), num(l.bags), rs(l.amount)]) : [['', '', 'No bill lines', '', '', '', '']],
    foot: [['', '', 'Total Amount', '', '', '', { content: rs(input.totalBill), styles: { halign: 'right' } }]],
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 1: { cellWidth: 22 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = ((doc as any).lastAutoTable?.finalY ?? 60) + 9

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Deposits', M, y)
  autoTable(doc, { ...table, startY: y + 2,
    head: [['#', 'Date', 'Method', 'Amount']],
    body: input.deposits.length ? input.deposits.map((d, i) => [String(i + 1), ddmmyyyy(d.date), d.method, rs(d.amount)]) : [['', '', 'No deposits', '']],
    foot: [['', '', 'Total Deposited', { content: rs(input.totalDeposited), styles: { halign: 'right' } }]],
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 1: { cellWidth: 26 }, 3: { halign: 'right', fontStyle: 'bold' } } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 8
  if (y + 30 > 285) { doc.addPage(); y = 20 }

  // Balance summary.
  doc.setFillColor(0, 0, 0); doc.rect(M, y, W - 2 * M, 24, 'F')
  const col = (W - 2 * M) / 3
  ;[['TOTAL AMOUNT', input.totalBill], ['TOTAL DEPOSITED', input.totalDeposited], ['REMAINING BALANCE', remaining]].forEach(([label, value], i) => {
    const cx = M + col * i + col / 2
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(String(label), cx, y + 8, { align: 'center' })
    doc.setFontSize(14); doc.text(rs(Number(value)), cx, y + 17, { align: 'center' })
  })
  doc.setTextColor(0)
  return doc.output('blob')
}
