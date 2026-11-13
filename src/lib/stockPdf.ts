/**
 * Premium A5 Stock Report PDF, drawn directly with jsPDF (real text and lines, not a
 * screenshot), so it is crisp, never cut mid-row and the header repeats on every page.
 */
export type StockPdfRow = { item: string; weight: number | null; quantity: number; bags: number | null }

const GREEN: [number, number, number] = [7, 61, 37]
const GREEN_SOFT: [number, number, number] = [236, 245, 239]
const GOLD: [number, number, number] = [228, 170, 42]
const INK: [number, number, number] = [23, 33, 28]
const MUTED: [number, number, number] = [96, 112, 104]
const LINE: [number, number, number] = [214, 226, 219]

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 })
const URDU = /[؀-ۿ]/
const URDU_RUN = /\(?\s*[؀-ۿ][؀-ۿ‌‍\s.,،-]*\s*\)?/g

/** Urdu can't be typeset by jsPDF: draw it with the browser (proper joining) into an image. */
function urduImage(text: string) {
  const px = 44
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `700 ${px}px "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 8
  canvas.width = w
  canvas.height = Math.ceil(px * 1.7)
  ctx.font = font
  ctx.fillStyle = 'rgb(23,33,28)'
  ctx.direction = 'rtl'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w - 4, canvas.height / 2)
  return { data: canvas.toDataURL('image/png'), ratio: canvas.width / canvas.height }
}

async function logoData(): Promise<string | null> {
  try {
    const blob = await (await fetch('/logo.png')).blob()
    return await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => resolve(null); r.readAsDataURL(blob) })
  } catch { return null }
}

export async function buildStockReportPdf(location: string, rows: StockPdfRow[], when = new Date()): Promise<Blob> {
  const [{ jsPDF }, tableMod, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable/es'), logoData()])
  const autoTable = tableMod.default
  await Promise.race([document.fonts.load('700 44px "Noto Naskh Arabic"', 'اردو').catch(() => undefined), new Promise(r => setTimeout(r, 3000))])

  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait', compress: true })
  const W = 148, H = 210, M = 10
  const dateText = when.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const timeText = when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const totalKg = rows.reduce((a, r) => a + r.quantity, 0)
  const totalBags = rows.reduce((a, r) => a + (r.bags ?? 0), 0)

  // ── Header band (first page) ───────────────────────────────────────────────
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 30, 'F')
  doc.setFillColor(...GOLD); doc.rect(0, 30, W, 1.2, 'F')
  if (logo) {
    // Round logo with a gold ring (the image is clipped to a circle).
    doc.setFillColor(...GOLD); doc.circle(M + 8, 15, 8.9, 'F')
    doc.saveGraphicsState()
    doc.circle(M + 8, 15, 8.2, null)
    doc.clip()
    doc.discardPath()
    doc.addImage(logo, 'PNG', M - 0.2, 6.8, 16.4, 16.4)
    doc.restoreGraphicsState()
  }
  const tx = logo ? M + 21 : M
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('STOCK REPORT', tx, 14.2)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...GOLD)
  doc.text('ADAM HAJI WALI MUHAMMAD & BROTHERS', tx, 19.4)
  doc.setTextColor(214, 232, 221); doc.text('Jodia Bazaar, Karachi', tx, 23.4)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
  doc.text(dateText, W - M, 14.2, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setTextColor(214, 232, 221)
  doc.text(timeText, W - M, 18.6, { align: 'right' })

  // ── Summary cards ──────────────────────────────────────────────────────────
  const cards: [string, string][] = [['LOCATION', location], ['ITEMS', String(rows.length)], ['TOTAL QUANTITY', `${num(totalKg)} kg`], ['TOTAL BAGS', totalBags ? num(totalBags) : '-']]
  const gap = 2.5, cw = (W - M * 2 - gap * 3) / 4, cy = 36, ch = 14
  cards.forEach(([label, value], i) => {
    const x = M + i * (cw + gap)
    doc.setFillColor(...GREEN_SOFT); doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
    doc.roundedRect(x, cy, cw, ch, 1.6, 1.6, 'FD')
    doc.setFillColor(...(i === 0 ? GOLD : GREEN)); doc.rect(x, cy + 2, 0.9, ch - 4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(...MUTED)
    doc.text(label, x + 3, cy + 5)
    doc.setFontSize(i === 0 ? 7.2 : 9.5); doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(value, cw - 4.5) as string[]
    doc.text(lines.slice(0, 2), x + 3, cy + (i === 0 && lines.length > 1 ? 8.8 : 10.6))
  })

  // ── Table ──────────────────────────────────────────────────────────────────
  const urduOf = new Map<number, string>()
  const body = rows.map((r, i) => {
    let name = r.item.trim()
    if (URDU.test(name)) {
      const urdu = (name.match(URDU_RUN) || []).join(' ').replace(/[()]/g, '').trim()
      name = name.replace(URDU_RUN, ' ').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim()
      if (urdu) urduOf.set(i, urdu)
    }
    return [String(i + 1), name || '-', r.weight ? num(r.weight) : '-', num(r.quantity), r.bags != null ? num(r.bags) : '-']
  })
  autoTable(doc, {
    startY: cy + ch + 5,
    margin: { left: M, right: M, top: 16, bottom: 14 },
    head: [['#', 'ITEM', 'KG / BAG', 'TOTAL KG', 'BAGS']],
    body: body.length ? body : [['', 'No stock recorded', '', '', '']],
    foot: body.length ? [['', `TOTAL  (${rows.length} item${rows.length === 1 ? '' : 's'})`, '', num(totalKg), totalBags ? num(totalBags) : '-']] : undefined,
    showFoot: 'lastPage',
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.8, textColor: INK, cellPadding: { top: 2.1, bottom: 2.1, left: 2, right: 2 }, lineColor: LINE, lineWidth: { bottom: 0.15 }, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8, cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 }, lineWidth: 0 },
    footStyles: { fillColor: [253, 246, 227], textColor: GREEN, fontStyle: 'bold', fontSize: 8.4, lineColor: GOLD, lineWidth: { top: 0.5 } },
    alternateRowStyles: { fillColor: [248, 251, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8, textColor: MUTED },
      1: { halign: 'left', fontStyle: 'bold' },
      2: { halign: 'right', cellWidth: 17 },
      3: { halign: 'right', cellWidth: 23, fontStyle: 'bold' },
      4: { halign: 'right', cellWidth: 14 },
    },
    didParseCell: data => {
      if (data.section === 'head' && data.column.index >= 2) data.cell.styles.halign = 'right'
      if (data.section === 'head' && data.column.index === 0) data.cell.styles.halign = 'center'
      if (data.section === 'foot') data.cell.styles.halign = data.column.index >= 2 ? 'right' : 'left'
      // leave room on the right of the name for the Urdu text
      if (data.section === 'body' && data.column.index === 1 && urduOf.has(data.row.index)) data.cell.styles.cellPadding = { top: 2.1, bottom: 2.1, left: 2, right: 20 }
    },
    didDrawCell: data => {
      if (data.section !== 'body' || data.column.index !== 1) return
      const urdu = urduOf.get(data.row.index)
      if (!urdu) return
      const img = urduImage(urdu)
      const h = 4.2, w = Math.min(h * img.ratio, 18)
      doc.addImage(img.data, 'PNG', data.cell.x + data.cell.width - w - 1.5, data.cell.y + (data.cell.height - (w / img.ratio)) / 2, w, w / img.ratio)
    },
    didDrawPage: () => {
      // Slim header on pages after the first
      if (doc.getCurrentPageInfo().pageNumber > 1) {
        doc.setFillColor(...GREEN); doc.rect(0, 0, W, 10, 'F')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
        doc.text('STOCK REPORT', M, 6.4)
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...GOLD)
        doc.text(`${location}  ·  ${dateText}`, W - M, 6.4, { align: 'right' })
      }
    },
  })

  // ── Signatures (kept together, on a new page only if they don't fit) ──────
  type WithTable = { lastAutoTable?: { finalY: number } }
  let y = ((doc as unknown as WithTable).lastAutoTable?.finalY ?? 60) + 16
  if (y + 14 > H - 16) { doc.addPage(); y = 34 }
  const sw = (W - M * 2 - 14) / 2
  ;['Checked by', 'Approved by'].forEach((label, i) => {
    const x = M + i * (sw + 14)
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(x, y, x + sw, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
    doc.text(label, x + sw / 2, y + 4.5, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...MUTED)
    doc.text('Name, signature & date', x + sw / 2, y + 8, { align: 'center' })
  })

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (p > 1 && p === pages && y === 34) {
      // a signature-only page still gets the slim header
      doc.setFillColor(...GREEN); doc.rect(0, 0, W, 10, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
      doc.text('STOCK REPORT', M, 6.4)
    }
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, H - 10, W - M, H - 10)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.setTextColor(...MUTED)
    doc.text(`AHWMB  ·  Stock Report  ·  ${location}  ·  Generated ${dateText}, ${timeText}`, M, H - 6)
    doc.text(`Page ${p} of ${pages}`, W - M, H - 6, { align: 'right' })
  }
  return doc.output('blob')
}
