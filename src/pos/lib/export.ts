import { format } from "date-fns"
import { CURRENCY, type SalesByDay } from "@/lib/store"

const cell = (v: string | number) => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Download sales for the given days as CSV: one row per item line, Excel-friendly. */
export function exportSalesCsv(salesByDay: SalesByDay, days: string[], filename: string) {
  const header = ["Date", "Time", "Customer #", "Payment", "Item", "Quantity", `Rate (${CURRENCY})`, `Amount (${CURRENCY})`, `Sale Total (${CURRENCY})`]
  const rows: (string | number)[][] = []
  for (const day of [...days].sort()) {
    for (const sale of salesByDay[day] ?? []) {
      const time = format(new Date(sale.createdAt), "HH:mm:ss")
      for (const l of sale.lines) {
        rows.push([day, time, sale.customerNo, sale.payment, l.name, l.qty, l.rate.toFixed(2), (l.qty * l.rate).toFixed(2), sale.total.toFixed(2)])
      }
    }
  }
  const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const a = Object.assign(document.createElement("a"), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return rows.length
}
