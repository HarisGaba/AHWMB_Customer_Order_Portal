import { format } from "date-fns"
import { SHOP } from "@/lib/config"
import { fmt, type Sale } from "@/lib/store"

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function receiptHtml(sale: Sale) {
  const date = new Date(sale.createdAt)
  const units = sale.lines.reduce((s, l) => s + l.qty, 0)
  const rows = sale.lines
    .map(
      (l) => `<tr><td class="name" colspan="3">${esc(l.name)}</td></tr>
      <tr class="sub"><td>${l.qty} × ${fmt(l.rate)}</td><td></td><td class="r">${fmt(l.qty * l.rate)}</td></tr>`,
    )
    .join("")

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${sale.customerNo}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; color: #000; }
  .wrap { width: 72mm; margin: 0 auto; }
  .c { text-align: center; } .r { text-align: right; }
  h1 { font-size: 18px; margin: 0; letter-spacing: 1px; }
  .muted { color: #444; font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  td.name { font-weight: 600; padding-top: 4px; }
  tr.sub td { color: #222; }
  .meta td:last-child { text-align: right; }
  .total td { font-size: 16px; font-weight: 700; padding-top: 4px; }
  .badge { display: inline-block; border: 1px solid #000; padding: 1px 8px; border-radius: 3px; font-weight: 700; }
</style></head><body><div class="wrap">
  <div class="c">
    <h1>${esc(SHOP.name)}</h1>
    ${SHOP.tagline ? `<div class="muted">${esc(SHOP.tagline)}</div>` : ""}
    ${SHOP.address ? `<div class="muted">${esc(SHOP.address)}</div>` : ""}
    ${SHOP.phone ? `<div class="muted">Tel: ${esc(SHOP.phone)}</div>` : ""}
  </div>
  <hr>
  <table class="meta">
    <tr><td>Customer</td><td>#${sale.customerNo}</td></tr>
    <tr><td>Date</td><td>${format(date, "dd MMM yyyy")}</td></tr>
    <tr><td>Time</td><td>${format(date, "hh:mm a")}</td></tr>
  </table>
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    <tr><td>Items</td><td class="r">${sale.lines.length} (${units} units)</td></tr>
    <tr class="total"><td>TOTAL</td><td class="r">${fmt(sale.total)}</td></tr>
    <tr><td>Payment</td><td class="r"><span class="badge">${sale.payment.toUpperCase()}</span></td></tr>
  </table>
  <hr>
  <div class="c muted">${esc(SHOP.receiptFooter)}</div>
  <div class="c muted" style="margin-top:4px">Ref ${sale.id.slice(0, 8).toUpperCase()}</div>
</div></body></html>`
}

/** Print a receipt via a hidden iframe so the app's own styles don't interfere. */
export function printReceipt(sale: Sale) {
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" })
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(receiptHtml(sale))
  doc.close()
  const win = frame.contentWindow!
  const cleanup = () => setTimeout(() => frame.remove(), 500)
  win.addEventListener("afterprint", cleanup)
  setTimeout(() => {
    win.focus()
    win.print()
    // Some browsers don't fire afterprint for iframes.
    setTimeout(cleanup, 60_000)
  }, 100)
}
