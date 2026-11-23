import { format } from "date-fns"
import { SHOP } from "@/lib/config"
import { printDocument } from "../../lib/print"
import { fmt, fmtKg, remainingBalance, totalWeight, type Sale } from "@/lib/store"

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export function receiptHtml(sale: Sale) {
  const date = new Date(sale.createdAt)
  const logo = new URL(SHOP.logo, window.location.origin).href
  // Two lines per item: English name + Qty/Rate/Amount on line 1, Urdu name on line 2.
  // "Rs" lives in the column headings so the figures fit on line 1 of an 80 mm roll.
  const num = (n: number) => fmt(n).replace(/^\S+\s/, "")
  // Each item: full English name across the slip (row 1), then Urdu name + Qty / Rate / Amount (row 2).
  // Names are never shortened; using the full width keeps most of them on one line.
  const rows = sale.lines
    .map(
      (l, i) => `<tbody class="it"><tr class="nm"><td class="n" rowspan="2">${i + 1}</td><td class="name" colspan="4">${esc(l.name)}</td></tr><tr class="vals"><td class="urc">${
        l.nameUr ? `<span class="ur" dir="rtl" lang="ur">${esc(l.nameUr)}</span>` : ""
      }</td><td class="q">${l.qty}</td><td class="r">${num(l.rate)}</td><td class="r b">${num(l.qty * l.rate)}</td></tr></tbody>`,
    )
    .join("")

  return `<!doctype html><html><head><meta charset="utf-8"><title>&#8203;</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=block">
<style>
  /* 80 mm thermal roll; thermal printers are black-only, so everything is pure black on white. */
  /* margin 0 leaves the browser no room for its own header (date, title) and footer (URL, "1/1"). */
  @page { margin: 0; } /* Exact roll height is measured after fonts/images load. */
  @media print { html, body { margin: 0 !important; padding: 0 !important; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #000; background: #fff; font: 700 13px/1.45 Arial, "Helvetica Neue", sans-serif; text-rendering: geometricPrecision; -webkit-font-smoothing: none; }
  html, body { width: 80mm; max-width: 80mm; height: auto; overflow: visible; }
  .wrap { width: 80mm; max-width: 80mm; padding: 3mm 5mm 5mm; margin: 0; }
  td, th, .addr, .payrow, .grand, .weight { overflow-wrap: anywhere; }
  tr, .grand, .weight, .policy { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-row-group; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  .mono { font-family: ui-monospace, Consolas, "Courier New", monospace; }
  .logo { width: 26mm; height: 26mm; border-radius: 50%; object-fit: cover; display: block; margin: 0 auto 2mm;
          filter: grayscale(1) contrast(1.6) brightness(1.05); }
  .addr { font-size: 12.5px; font-weight: 700; margin-top: 1px; }
  .title { margin: 3mm 0 2.5mm; padding: 1.4mm 0; background: #000; color: #fff; font-size: 14px; font-weight: 800;
           letter-spacing: 3px; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 0.6mm 0; vertical-align: top; }
  .meta td:first-child { font-weight: 700; }
  .meta td:last-child { text-align: right; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  hr.solid { border-top: 1.5px solid #000; }
  .items th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .5px; text-align: left;
              border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 1mm 0; }
  .items th.r { text-align: right; }
  .items { table-layout: fixed; }
  .items col.n { width: 4mm; } .items col.q { width: 7mm; } .items col.rt { width: 14mm; } .items col.am { width: 17mm; }
  .items tbody td { padding: 1.2mm 0 0.6mm; border-bottom: 1px dotted #000; }
  .items tbody.it { break-inside: avoid; page-break-inside: avoid; }
  .items tr.nm td { border-bottom: 0; padding-bottom: 0; }
  .items tr.nm td.n { border-bottom: 1px dotted #000; vertical-align: top; }
  .items tr.vals td { padding-top: 0.2mm; vertical-align: middle; }
  .items .urc { padding-right: 1mm; }
  .items .n { font-weight: 700; }
  .items .name { font-size: 13.5px; font-weight: 800; line-height: 1.3; overflow-wrap: break-word; word-break: normal; }
  .items .ur { font: 700 14px/1.8 "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", serif;
               text-align: left; display: block; }
  .items .q, .items td.r { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; font-weight: 700; }
  .items .q { text-align: center; }
  .items th.q { text-align: center; }
  .grand { margin-top: 2mm; border: 2px solid #000; padding: 2mm 2.5mm; display: flex; align-items: center; justify-content: space-between; }
  .grand span:first-child { font-size: 14px; font-weight: 800; letter-spacing: 2px; }
  .grand span:last-child { font: 900 18px ui-monospace, Consolas, "Courier New", monospace; min-width:0; text-align:right; }
  .settle { margin-top: 1.5mm; border: 1.5px solid #000; padding: 1mm 2.5mm; break-inside: avoid; }
  .settle div { display: flex; justify-content: space-between; align-items: center; padding: 0.6mm 0; font-size: 13px; font-weight: 700; }
  .settle div > span:last-child { font: 800 13.5px ui-monospace, Consolas, "Courier New", monospace; }
  .settle .lbl-ur { font: 700 14.5px/1.7 "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", serif; margin-left: 1.5mm; }
  .settle .bal { border-top: 1px dashed #000; margin-top: 0.4mm; padding-top: 1mm; font-size: 14.5px; font-weight: 800; }
  .settle .bal > span:last-child { font-size: 15.5px; font-weight: 900; }
  .weight { margin-top: 1.5mm; border: 1.5px dashed #000; padding: 1.6mm 2.5mm; display: flex; align-items: center; justify-content: space-between; }
  .weight span:first-child { font-size: 13px; font-weight: 800; letter-spacing: 1.5px; }
  .weight span:last-child { font: 900 17px ui-monospace, Consolas, "Courier New", monospace; }
  .payrow { display: flex; align-items: center; justify-content: space-between; margin-top: 2mm; font-weight: 700; }
  .pay { display: inline-block; background: #000; color: #fff; padding: 0.6mm 3mm; border-radius: 2mm; font-weight: 800; letter-spacing: 1px; font-size: 12px; }
  .thanks { font-size: 15px; font-weight: 800; margin-top: 1mm; }
  .policy { font: 700 15px/2.1 "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", serif; margin-top: 1mm; text-align: center; }
</style></head><body><div class="wrap">
  <div class="c">
    <img class="logo" src="${logo}" alt="">
    ${SHOP.address ? `<div class="addr">${esc(SHOP.address)}</div>` : ""}
  </div>
  <div class="title">SALES RECEIPT</div>
  <table class="meta">
    ${sale.customerName ? `<tr><td>Customer Name</td><td class="b">${esc(sale.customerName)}</td></tr>` : ""}
    <tr><td>Customer No</td><td>#${sale.customerNo}</td></tr>
    <tr><td>Date / Time</td><td>${format(date, "dd/MM/yyyy, hh:mm a")}</td></tr>
  </table>
  <table class="items" style="margin-top:2.5mm">
    <colgroup><col class="n"><col><col class="q"><col class="rt"><col class="am"></colgroup>
    <thead><tr><th class="n">#</th><th>Item</th><th class="q">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    ${rows}
  </table>
  <div class="payrow"><span>Payment</span><span class="pay">${sale.payment.toUpperCase()}</span></div>
  <div class="grand"><span>TOTAL</span><span>${fmt(sale.total)}</span></div>
  <div class="settle">
    <div><span>Total Amount <span class="lbl-ur" dir="rtl" lang="ur">کل رقم</span></span><span>${fmt(sale.total)}</span></div>
    <div><span>Paid <span class="lbl-ur" dir="rtl" lang="ur">ادا شدہ</span></span><span>${fmt(sale.total - remainingBalance(sale))}</span></div>
    <div class="bal"><span>Balance <span class="lbl-ur" dir="rtl" lang="ur">بقایا</span></span><span>${fmt(remainingBalance(sale))}</span></div>
  </div>
  <div class="weight"><span>TOTAL WEIGHT</span><span>${fmtKg(totalWeight(sale.lines))}</span></div>
  <hr>
  <div class="c">
    <div class="thanks">${esc(SHOP.receiptFooter)}</div>
    <div class="policy" dir="rtl" lang="ur">${esc(SHOP.receiptPolicy)}</div>
  </div>
</div></body></html>`
}

/** One print job and one measured roll page per complete sale. */
export function printReceipt(sale: Sale) {
  return printDocument(receiptHtml(sale), null, { filename: `receipt-${sale.customerNo}.pdf`, format: "receipt" })
}
