import { format } from "date-fns"
import { SHOP } from "@/lib/config"
import { fmt, fmtKg, totalWeight, type Sale } from "@/lib/store"

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function receiptHtml(sale: Sale) {
  const date = new Date(sale.createdAt)
  const logo = new URL(SHOP.logo, window.location.origin).href
  // Two lines per item: English name + Qty/Rate/Amount on line 1, Urdu name on line 2.
  // "Rs" lives in the column headings so the figures fit on line 1 of an 80 mm roll.
  const num = (n: number) => fmt(n).replace(/^\S+\s/, "")
  const rows = sale.lines
    .map(
      (l, i) => `<tr><td class="n">${i + 1}</td><td class="name">${esc(l.name)}${
        l.nameUr ? `<div class="ur" dir="rtl" lang="ur">${esc(l.nameUr)}</div>` : ""
      }</td><td class="q">${l.qty}</td><td class="r">${num(l.rate)}</td><td class="r b">${num(l.qty * l.rate)}</td></tr>`,
    )
    .join("")

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${sale.customerNo}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=block">
<style>
  /* 80 mm thermal roll; thermal printers are black-only, so everything is pure black on white. */
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #000; background: #fff; font: 11.5px/1.4 Arial, "Helvetica Neue", sans-serif; }
  .wrap { width: 80mm; padding: 4mm 4mm 6mm; margin: 0 auto; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  .mono { font-family: ui-monospace, Consolas, "Courier New", monospace; }
  .logo { width: 26mm; height: 26mm; border-radius: 50%; object-fit: cover; display: block; margin: 0 auto 2mm;
          filter: grayscale(1) contrast(1.6) brightness(1.05); }
  .addr { font-size: 10.5px; margin-top: 1px; }
  .title { margin: 3mm 0 2.5mm; padding: 1.4mm 0; background: #000; color: #fff; font-size: 12px; font-weight: 800;
           letter-spacing: 3px; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 0.6mm 0; vertical-align: top; }
  .meta td:first-child { font-weight: 700; }
  .meta td:last-child { text-align: right; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  hr.solid { border-top: 1.5px solid #000; }
  .items th { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; text-align: left;
              border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 1mm 0; }
  .items th.r { text-align: right; }
  .items { table-layout: fixed; }
  .items col.n { width: 5mm; } .items col.q { width: 9mm; } .items col.rt { width: 15mm; } .items col.am { width: 18mm; }
  .items tbody td { padding: 1.2mm 0 0.6mm; border-bottom: 1px dotted #000; }
  .items .n { font-weight: 700; }
  .items .name { font-weight: 700; padding-right: 1.5mm; word-break: break-word; }
  .items .ur { font: 700 12px/1.75 "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", serif;
               text-align: left; margin-top: 0.3mm; }
  .items .q, .items td.r { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 10.5px; }
  .items .q { text-align: center; }
  .items th.q { text-align: center; }
  .grand { margin-top: 2mm; border: 2px solid #000; padding: 2mm 2.5mm; display: flex; align-items: center; justify-content: space-between; }
  .grand span:first-child { font-size: 12px; font-weight: 800; letter-spacing: 2px; }
  .grand span:last-child { font: 900 19px ui-monospace, Consolas, "Courier New", monospace; }
  .weight { margin-top: 1.5mm; border: 1.5px dashed #000; padding: 1.6mm 2.5mm; display: flex; align-items: center; justify-content: space-between; }
  .weight span:first-child { font-size: 11px; font-weight: 800; letter-spacing: 1.5px; }
  .weight span:last-child { font: 900 15px ui-monospace, Consolas, "Courier New", monospace; }
  .payrow { display: flex; align-items: center; justify-content: space-between; margin-top: 2mm; font-weight: 700; }
  .pay { display: inline-block; background: #000; color: #fff; padding: 0.6mm 3mm; border-radius: 2mm; font-weight: 800; letter-spacing: 1px; font-size: 10.5px; }
  .thanks { font-size: 13px; font-weight: 800; margin-top: 1mm; }
</style></head><body><div class="wrap">
  <div class="c">
    <img class="logo" src="${logo}" alt="">
    ${SHOP.address ? `<div class="addr">${esc(SHOP.address)}</div>` : ""}
    ${SHOP.phone ? `<div class="addr">Tel: ${esc(SHOP.phone)}</div>` : ""}
  </div>
  <div class="title">SALES RECEIPT</div>
  <table class="meta">
    <tr><td>Receipt No</td><td class="mono">${sale.id.slice(0, 8).toUpperCase()}</td></tr>
    ${sale.customerName ? `<tr><td>Customer Name</td><td class="b">${esc(sale.customerName)}</td></tr>` : ""}
    <tr><td>Customer No</td><td>#${sale.customerNo}</td></tr>
    <tr><td>Date</td><td>${format(date, "dd MMM yyyy")}</td></tr>
    <tr><td>Time</td><td>${format(date, "hh:mm a")}</td></tr>
  </table>
  <table class="items" style="margin-top:2.5mm">
    <colgroup><col class="n"><col><col class="q"><col class="rt"><col class="am"></colgroup>
    <thead><tr><th class="n">#</th><th>Item</th><th class="q">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="payrow"><span>Payment</span><span class="pay">${sale.payment.toUpperCase()}</span></div>
  <div class="grand"><span>TOTAL</span><span>${fmt(sale.total)}</span></div>
  <div class="weight"><span>TOTAL WEIGHT</span><span>${fmtKg(totalWeight(sale.lines))}</span></div>
  <hr>
  <div class="c">
    <div class="thanks">${esc(SHOP.receiptFooter)}</div>
  </div>
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
  const print = () => {
    win.focus()
    win.print()
    // Some browsers don't fire afterprint for iframes.
    setTimeout(cleanup, 60_000)
  }
  // Wait for the logo and the Urdu font so neither is missing from the printout (give up after 3 s).
  const img = doc.querySelector("img")
  const logoReady = new Promise<void>((resolve) => {
    if (!img || img.complete) return resolve()
    img.addEventListener("load", () => resolve())
    img.addEventListener("error", () => {
      img.remove()
      resolve()
    })
  })
  const fontsReady = sale.lines.some((l) => l.nameUr)
    ? doc.fonts.load('700 13px "Noto Nastaliq Urdu"', "اردو").then(() => doc.fonts.ready).catch(() => undefined)
    : Promise.resolve()
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000))
  void Promise.race([Promise.all([logoReady, fontsReady]), timeout]).then(() => setTimeout(print, 50))
}
