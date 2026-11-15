export function validOrderQuantity(value: string | number): boolean {
 const n = Number(value)
 return String(value).trim() !== '' && Number.isFinite(n) && n > 0 && n <= 1000000
}
export function validCustomerUnit(unit: string): boolean {
 return ['KG', 'GRAMS', 'LITRE', 'PCS', 'PACKETS', 'BAGS'].includes(unit)
}
