/**
 * Printing that works on phones as well as desktops.
 *
 * Desktop: the document prints from a hidden same-origin frame (quick, stays on the page).
 * Phones/tablets: mobile Safari/Chrome ignore print() from hidden frames, so the document
 * opens as a page of its own in a new tab with a small "Print / Save as PDF" bar. From the
 * phone's print screen the user can print, save as PDF or share. If the tab is blocked,
 * the document opens full-screen inside the app with the same bar.
 */

export const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Bar shown above the document on phones; hidden on paper. */
const MOBILE_BAR = `
<style>
  .print-bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; padding: 10px 12px; padding-top: max(10px, env(safe-area-inset-top));
    background: #073d25; box-shadow: 0 2px 10px rgba(0,0,0,.25); font: 700 15px/1 Arial, sans-serif; }
  .print-bar button { flex: 1; min-height: 46px; border: 0; border-radius: 10px; font: inherit; cursor: pointer; }
  .print-bar .go { background: #e4aa2a; color: #073d25; flex: 2; }
  .print-bar .close { background: rgba(255,255,255,.14); color: #fff; }
  .print-hint { margin: 0; padding: 8px 12px; background: #fffbeb; color: #854d0e; font: 600 13px/1.4 Arial, sans-serif; }
  @media print { .print-bar, .print-hint { display: none !important; } }
  /* On the phone screen only (not on paper): use the full width so tables fit. */
  @media screen and (max-width: 700px) {
    .sheet { margin: 8px !important; padding: 12px !important; }
    table { font-size: 12px !important; }
    th, td { padding: 6px 5px !important; }
    .head img { width: 44px !important; height: 44px !important; }
    h1 { font-size: 19px !important; }
  }
</style>
<div class="print-bar"><button class="go" onclick="window.print()">🖨 Print / Save as PDF</button><button class="close" onclick="window.__closePrint ? window.__closePrint() : window.close()">✕ Close</button></div>
<p class="print-hint">On the next screen choose your printer, or "Save as PDF", then share the file.</p>`

/** Puts the mobile bar at the top of <body> and a base URL so relative images still load. */
function withMobileBar(html: string) {
  const base = `<base href="${window.location.origin}/">`
  const withBase = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}<meta name="viewport" content="width=device-width, initial-scale=1">`) : base + html
  return /<body[^>]*>/i.test(withBase) ? withBase.replace(/<body([^>]*)>/i, `<body$1>${MOBILE_BAR}`) : MOBILE_BAR + withBase
}

/**
 * On phones, call this synchronously at the start of the click handler when the document is
 * only ready after an await (e.g. a PDF is generated first); pass the result to printDocument.
 * Browsers only allow a new tab straight after a tap. Returns null on desktop.
 */
export function openPrintTab(): Window | null {
  if (!isMobileDevice()) return null
  const tab = window.open('', '_blank')
  if (tab) tab.document.write('<!doctype html><title>Preparing…</title><p style="font:16px Arial;padding:24px">Preparing your document…</p>')
  return tab
}

export function printDocument(html: string, preparedTab?: Window | null) {
  if (!isMobileDevice()) return printInHiddenFrame(html)
  const tab = preparedTab && !preparedTab.closed ? preparedTab : window.open('', '_blank')
  if (tab) {
    tab.document.open()
    tab.document.write(withMobileBar(html))
    tab.document.close()
    tab.focus()
    return
  }
  printInOverlay(html) // new tabs blocked: show it full-screen in the app instead
}

function printInHiddenFrame(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
  frame.srcdoc = html
  frame.onload = () => {
    const win = frame.contentWindow
    const doc = frame.contentDocument
    let printed = false
    const go = () => { if (printed) return; printed = true; win?.focus(); win?.print(); setTimeout(() => frame.remove(), 60_000) }
    // Wait for images (logo) and web fonts (Urdu) so nothing is missing on paper.
    const images = [...(doc?.images ?? [])].filter(img => !img.complete).map(img => new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }) }))
    const fonts = doc?.fonts?.ready ?? Promise.resolve()
    void Promise.race([Promise.all([...images, fonts]), new Promise(resolve => setTimeout(resolve, 3000))]).then(go)
  }
  document.body.appendChild(frame)
}

function printInOverlay(html: string) {
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#fff'
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:100%;height:100%;border:0'
  frame.srcdoc = withMobileBar(html)
  frame.onload = () => {
    const win = frame.contentWindow as (Window & { __closePrint?: () => void }) | null
    if (win) win.__closePrint = () => overlay.remove()
  }
  overlay.appendChild(frame)
  document.body.appendChild(overlay)
}
