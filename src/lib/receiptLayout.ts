export const RECEIPT_WIDTH_MM = 80
export const RECEIPT_WIDTH_PX = 80 * 96 / 25.4
export function receiptHeightMm(heightPx: number) {
 if (!Number.isFinite(heightPx) || heightPx <= 0) throw new Error('Receipt dimensions could not be measured.')
 const height = Math.ceil(heightPx * 25.4 / 96) + 3
 if (height > 5000) throw new Error('This receipt exceeds the supported 5 metre page length. Shorten item descriptions before printing; the sale is still saved.')
 return Math.max(80, height)
}
export function prepareReceiptPage(doc: Document) {
 const content = doc.querySelector<HTMLElement>('.wrap')
 if (!content) throw new Error('Receipt content is missing.')
 const heightPx = Math.max(content.scrollHeight, content.getBoundingClientRect().height)
 const heightMm = receiptHeightMm(heightPx)
 let style = doc.getElementById('receipt-page-size') as HTMLStyleElement | null
 if (!style) { style = doc.createElement('style'); style.id = 'receipt-page-size'; doc.head.appendChild(style) }
 style.textContent = `@page { size: ${RECEIPT_WIDTH_MM}mm ${heightMm}mm; margin: 0; }`
 return { heightPx, heightMm }
}
