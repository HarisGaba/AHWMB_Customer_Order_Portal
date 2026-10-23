export type CatalogProduct = { category: string; name: string }

export const PRODUCT_CATALOG: readonly CatalogProduct[] = [
  { category: 'RICE', name: 'Basmati Rice 1121 Special' },
  { category: 'RICE', name: 'Basmati Rice 1121 Steam' },
  { category: 'RICE', name: 'Basmati Rice Ponia' },
  { category: 'RICE', name: 'Basmati Rice Toota' },
  { category: 'RICE', name: 'Sella Rice 1121 Double Steam' },
  { category: 'RICE', name: 'Sella Rice 1121 Steam' },
  { category: 'RICE', name: 'Laal Chawal' },
  { category: 'PULSES', name: 'Arhar Dal' },
  { category: 'PULSES', name: 'Chana Dal' },
  { category: 'PULSES', name: 'Mong Dal' },
  { category: 'PULSES', name: 'Masoor Dal' },
  { category: 'PULSES', name: 'Mash Dal' },
  { category: 'PULSES', name: 'Masoor sabut' },
  { category: 'PULSES', name: 'Kala Chana' },
  { category: 'PULSES', name: 'Safaid Chana (Small)' },
  { category: 'PULSES', name: 'Safaid Chana (Medium)' },
  { category: 'PULSES', name: 'Safaid Chana (Large)' },
  { category: 'PULSES', name: 'Hari mash' },
  { category: 'PULSES', name: 'Mong Sabut' },
  { category: 'PULSES', name: 'Mong Chilka' },
  { category: 'PULSES', name: 'Mash Sabut' },
  { category: 'PULSES', name: 'Mash Chilki' },
  { category: 'PULSES', name: 'Safaid Lobia' },
  { category: 'PULSES', name: 'Laal Lobia' },
  { category: 'PULSES', name: 'Laal Chori' },
  { category: 'PULSES', name: 'Bajra' }, 
  { category: 'SPICES', name: 'Kali Mirch Sabut' },
  { category: 'SPICES', name: 'Kali Mirch Powder' },
  { category: 'SPICES', name: 'Laal Mirch Sabut' },
  { category: 'SPICES', name: 'Laal Mirch Powder' },
  { category: 'SPICES', name: 'Katar Mirch' },
  { category: 'SPICES', name: 'Talhar Mirch Sabut' },
  { category: 'SPICES', name: 'Dhaniya Sabut' },
  { category: 'SPICES', name: 'Dhaniya Powder' },
  { category: 'SPICES', name: 'Green Elaichi' },
  { category: 'SPICES', name: 'Black Elaichi' },
  { category: 'SPICES', name: 'Long' },
  { category: 'SPICES', name: 'Daar Cheeni' },
  { category: 'SPICES', name: 'Badiyan ka phool' },
  { category: 'SPICES', name: 'Haldi' },
  { category: 'SPICES', name: 'Chat Masala' },
  { category: 'SPICES', name: 'Aloo Bukhara' },
  { category: 'SPICES', name: 'Biryani Masala' },
  { category: 'SPICES', name: 'Qorma Masala' },
  { category: 'SPICES', name: 'Karhai Masala' },
  { category: 'SPICES', name: 'Nihari Masala' },
  { category: 'SPICES', name: 'Pilao Masala' },
  { category: 'SPICES', name: 'Dal Masala' },
  { category: 'SPICES', name: 'Chicken Tikka Masala' },
  { category: 'SPICES', name: 'Salan Masala' },
  { category: 'SPICES', name: 'Safaid Zeera' },
  { category: 'SPICES', name: 'Kala Zeera' },
  { category: 'SPICES', name: 'Choti Elaichi' },
  { category: 'SPICES', name: 'Bari Elaichi' },
  { category: 'WHEAT', name: 'Gandum Sabut' },
  { category: 'WHEAT', name: 'Gandum Dalia' },
  { category: 'WHEAT', name: 'Jao Sabut' },
  { category: 'WHEAT', name: 'Jao Dalia' },
  { category: 'WHEAT', name: 'Jao oats' },
  { category: 'WHEAT', name: 'Gandum oats' },
  { category: 'WHEAT', name: 'Suji' },
  { category: 'WHEAT', name: 'Maida' },
  { category: 'WHEAT', name: 'Besan' },
  { category: 'DRY FRUITS', name: 'Badaam' },
  { category: 'DRY FRUITS', name: 'Kaju (salted)' },
  { category: 'DRY FRUITS', name: 'Kaju (unsalted)' },
  { category: 'DRY FRUITS', name: 'Pista (salted)' },
  { category: 'DRY FRUITS', name: 'Pista (unsalted)' },
  { category: 'DRY FRUITS', name: 'Akhrot (sabut)' },
  { category: 'DRY FRUITS', name: 'Akhrot (giri)' },
  { category: 'DRY FRUITS', name: 'Kishmish' },
  { category: 'DRY FRUITS', name: 'Chilghoza' },
  { category: 'DRY FRUITS', name: 'Phool Makhana' },
  { category: 'SEEDS', name: 'Chia seeds' },
  { category: 'SEEDS', name: 'Flax seeds' },
  { category: 'SEEDS', name: 'Pumpkin seeds' },
  { category: 'SEEDS', name: 'Sunflower seeds' },
  { category: 'SEEDS', name: 'Sesame seeds' },
  { category: 'EXTRA ITEMS', name: 'Sugar' },
  { category: 'EXTRA ITEMS', name: 'Fried Onion' },
  { category: 'EXTRA ITEMS', name: 'American Popcorn' },
  { category: 'EXTRA ITEMS', name: 'Sabudana' },
  { category: 'EXTRA ITEMS', name: 'Meethi Soda' },
  { category: 'EXTRA ITEMS', name: 'Isphagol Indian' },
  { category: 'EXTRA ITEMS', name: 'Macaroni' },
  { category: 'EXTRA ITEMS', name: 'Chakki Atta' },
  { category: 'EXTRA ITEMS', name: 'Oil' },
  { category: 'EXTRA ITEMS', name: 'Honey' },
] as const

export type PricedQuantity = {
  quantity_value: number
  unit_type: 'KG' | 'GRAMS' | 'PCS' | 'LITRE' | 'BAGS' | 'NONE'
  unit_price?: number
  rate?: number
}

export const roundCurrency = (value: number): number =>
  Math.round((Number(value) || 0) * 100) / 100

export const sumLineTotals = (items: Array<{ total?: number | null }>): number =>
  roundCurrency(items.reduce((sum, item) => sum + (Number(item.total) || 0), 0))

/** Weight rates are per KG for both KG and gram quantities.
 *  GRAMS: convert to KG first (÷1000).
 *  LITRE / KG / PCS: multiply quantity × rate directly.
 *  NONE: flat price — quantity is irrelevant, total = rate. */
export const calculateLineTotal = (item: PricedQuantity): number => {
  const quantity = Number(item.quantity_value) || 0
  const price = Number(item.unit_price ?? item.rate) || 0
  if (item.unit_type === 'NONE') return roundCurrency(price)
  const billableQuantity = item.unit_type === 'GRAMS' ? quantity / 1000 : quantity
  return roundCurrency(billableQuantity * price)
}

export type InvoiceFinancials = { totalAmount: number; balance: number; totalBalance: number; deposit: number; remainingBalance: number }

export const calculateFinancials = (totalAmount: number, balance: number, deposit: number): InvoiceFinancials => {
  const safeTotalAmount = roundCurrency(totalAmount)
  const safeBalance = roundCurrency(balance)
  const safeDeposit = roundCurrency(deposit)
  const totalBalance = roundCurrency(safeTotalAmount + safeBalance)
  return { totalAmount: safeTotalAmount, balance: safeBalance, totalBalance, deposit: safeDeposit, remainingBalance: roundCurrency(totalBalance - safeDeposit) }
}
