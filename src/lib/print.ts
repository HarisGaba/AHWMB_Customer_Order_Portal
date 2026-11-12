/**
 * Printing that works on phones as well as desktops.
 *
 * Desktop: the document prints from a hidden same-origin frame (quick, stays on the page).
 * Phones/tablets: mobile browsers (and installed home-screen apps) ignore print() from hidden
 * frames and often block or break new tabs. So the document opens full-screen inside the app
 * with a bar on top. While it is shown, a real PDF file is made from it in the background;
 * "Share / Save PDF" then hands that file to the phone's share sheet (WhatsApp, Files, Drive…)
 * or downloads it. "Print" opens the phone's own print screen as a second option.
 */

export const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export type PrintOptions = {
  /** File name for the PDF made on phones. */
  filename?: string
  /** 'a4' (default) splits into A4 pages; 'receipt' makes one long 80 mm page. */
  format?: 'a4' | 'a5' | 'receipt'
}

/** Kept for callers that pre-open a tab; phones now use the in-app preview, so nothing is opened. */
export function openPrintTab(): Window | null { return null }

export function printDocument(html: string, _preparedTab?: Window | null, options: PrintOptions = {}) {
  if (!isMobileDevice()) return printInHiddenFrame(html)
  showMobilePreview(html, options)
}

/** Base URL so relative images (the logo) load inside srcdoc frames. */
function withBase(html: string) {
  const base = `<base href="${window.location.origin}/">`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : base + html
}

/** Waits for images (logo) and web fonts (Urdu) in a frame, at most 4 s. */
function frameReady(doc: Document | null | undefined) {
  const images = [...(doc?.images ?? [])].filter(img => !img.complete).map(img => new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }) }))
  const urdu = doc?.fonts ? Promise.all([doc.fonts.load('700 16px "Noto Naskh Arabic"', 'اردو'), doc.fonts.load('700 16px "Noto Nastaliq Urdu"', 'اردو')]).catch(() => undefined) : Promise.resolve()
  const fonts = Promise.resolve(urdu).then(() => doc?.fonts?.ready)
  return Promise.race([Promise.all([...images, fonts]), new Promise(resolve => setTimeout(resolve, 4000))])
}

function printInHiddenFrame(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
  frame.srcdoc = html
  frame.onload = () => {
    const win = frame.contentWindow
    let printed = false
    const go = () => { if (printed) return; printed = true; win?.focus(); win?.print(); setTimeout(() => frame.remove(), 60_000) }
    void frameReady(frame.contentDocument).then(go)
  }
  document.body.appendChild(frame)
}

/** Draws the document into a PDF file (A4 pages, or one 80 mm receipt page). */
async function htmlToPdf(html: string, format: 'a4' | 'a5' | 'receipt'): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const cssWidth = format === 'receipt' ? 302 : format === 'a5' ? 559 : 794 // 80 / 148 / 210 mm at 96 dpi
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${cssWidth}px;height:1200px;border:0;visibility:hidden`
  const loaded = new Promise<void>(resolve => { frame.onload = () => resolve() })
  frame.srcdoc = withBase(html)
  document.body.appendChild(frame)
  try {
    await loaded
    const doc = frame.contentDocument!
    await frameReady(doc)
    const height = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)
    frame.style.height = `${height}px`
    const canvas = await html2canvas(doc.documentElement, { scale: 2, backgroundColor: '#ffffff', useCORS: true, width: cssWidth, height, windowWidth: cssWidth, windowHeight: height, logging: false })
    if (format === 'receipt') {
      const w = 80, h = canvas.height * w / canvas.width
      const pdf = new jsPDF({ unit: 'mm', format: [w, h], orientation: 'portrait', compress: true })
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h)
      return pdf.output('blob')
    }
    const pdf = new jsPDF({ unit: 'mm', format, orientation: 'portrait', compress: true })
    const [pageW, pageH] = format === 'a5' ? [148, 210] : [210, 297]
    const slicePx = Math.floor(canvas.width * pageH / pageW) // canvas pixels per A4 page
    for (let y = 0, page = 0; y < canvas.height; y += slicePx, page++) {
      const part = document.createElement('canvas')
      part.width = canvas.width
      part.height = Math.min(slicePx, canvas.height - y)
      const ctx = part.getContext('2d')!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height)
      ctx.drawImage(canvas, 0, y, part.width, part.height, 0, 0, part.width, part.height)
      if (page) pdf.addPage()
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, part.height * pageW / part.width)
    }
    return pdf.output('blob')
  } finally {
    frame.remove()
  }
}

/** Share sheet when the phone supports sharing files, otherwise a normal download. */
async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: filename }); return } catch (e) { if ((e as Error).name === 'AbortError') return }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const PREVIEW_CSS = `
  .ahw-print-overlay { position: fixed; inset: 0; z-index: 100000; display: flex; flex-direction: column; background: #e5e7eb; }
  .ahw-print-bar { display: flex; gap: 8px; padding: 10px 12px; padding-top: max(10px, env(safe-area-inset-top)); background: #073d25; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
  .ahw-print-bar button { flex: 1; min-width: 0; padding: 0 6px; min-height: 46px; border: 0; border-radius: 10px; font: 700 15px/1.1 Arial, sans-serif; cursor: pointer; }
  .ahw-print-bar .share { flex: 2; background: #e4aa2a; color: #073d25; }
  .ahw-print-bar .share:disabled { opacity: .65; }
  .ahw-print-bar .print { background: #fff; color: #073d25; }
  .ahw-print-bar .close { flex: .8; background: rgba(255,255,255,.14); color: #fff; }
  .ahw-print-hint { margin: 0; padding: 7px 12px; background: #fffbeb; color: #854d0e; font: 600 13px/1.4 Arial, sans-serif; }
  .ahw-print-overlay iframe { flex: 1; width: 100%; border: 0; background: #fff; }
`

/** Phone view: the document full-screen in the app, with Share / Save PDF, Print and Close. */
function showMobilePreview(html: string, { filename, format = 'a4' }: PrintOptions) {
  // Default file name from the document's <title>, e.g. "Invoice ORD-12" -> invoice-ord-12.pdf
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? 'ahwmb-document'
  filename ||= `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ahwmb-document'}.pdf`
  if (!document.getElementById('ahw-print-css')) {
    const style = document.createElement('style')
    style.id = 'ahw-print-css'
    style.textContent = PREVIEW_CSS
    document.head.appendChild(style)
  }
  const overlay = document.createElement('div')
  overlay.className = 'ahw-print-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.innerHTML = `<div class="ahw-print-bar">
      <button type="button" class="share" disabled>Preparing PDF…</button>
      <button type="button" class="print">🖨 Print</button>
      <button type="button" class="close">✕ Close</button>
    </div>
    <p class="ahw-print-hint">Tap “Share / Save PDF” to send the file on WhatsApp or save it to your phone.</p>`
  const frame = document.createElement('iframe')
  frame.title = 'Document preview'
  // Fit an A4 page to the phone width in the preview only (the PDF and paper keep the A4 layout).
  frame.srcdoc = withBase(html).replace(/<\/head>/i, `<meta name="viewport" content="width=device-width, initial-scale=1"><style>@media screen and (max-width: 700px) { .sheet, .page, .invoice-document { margin: 8px !important; padding: 12px !important; } table { font-size: 12px !important; } th, td { padding: 6px 5px !important; } }</style></head>`)
  overlay.appendChild(frame)
  document.body.appendChild(overlay)
  const prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  const share = overlay.querySelector<HTMLButtonElement>('.share')!
  const close = () => { overlay.remove(); document.body.style.overflow = prevOverflow }
  overlay.querySelector<HTMLButtonElement>('.close')!.onclick = close
  overlay.querySelector<HTMLButtonElement>('.print')!.onclick = () => { frame.contentWindow?.focus(); frame.contentWindow?.print() }

  // The file is made now, so the tap on Share opens the share sheet straight away
  // (phones only allow sharing directly after a tap).
  let pdf: Blob | null = null
  htmlToPdf(html, format)
    .then(blob => { pdf = blob; share.disabled = false; share.textContent = '📤 Share / Save PDF' })
    .catch(() => { share.textContent = 'PDF unavailable — use Print' })
  share.onclick = () => { if (pdf) void shareOrDownload(pdf, filename) }
}
