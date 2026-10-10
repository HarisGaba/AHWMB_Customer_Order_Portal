export type CatalogProduct = { category: string; name: string }

export const PRODUCT_CATALOG: readonly CatalogProduct[] = [
  { category: 'RICE', name: 'Basmati Rice 1121 Special' },
  { category: 'RICE', name: 'Basmati Rice 1121 Steam' },
  { category: 'RICE', name: 'Basmati Rice Ponia' },
  { category: 'RICE', name: 'Basmati Rice Toota' },
  { category: 'RICE', name: 'Sella Rice 1121 Double Steam' },
  { category: 'RICE', name: 'Sella Rice 1121 Steam' },
  { category: 'RICE', name: 'Red Rice' },
  { category: 'PULSES', name: 'Chana Dal' },
  { category: 'PULSES', name: 'Mong Dal' },
  { category: 'PULSES', name: 'Masoor Dal' },
  { category: 'PULSES', name: 'Masoor Dal (Whole)' },
  { category: 'PULSES', name: 'Kala Chana' },
  { category: 'PULSES', name: 'Safaid Chana' },
  { category: 'PULSES', name: 'Mong Sabut' },
  { category: 'PULSES', name: 'Mong Chilka' },
  { category: 'PULSES', name: 'Mash Sabut' },
  { category: 'PULSES', name: 'Mash Chilki' },
  { category: 'PULSES', name: 'Safaid Lobia' },
  { category: 'PULSES', name: 'Red Lobia' },
  { category: 'PULSES', name: 'Red Chori' },
  { category: 'PULSES', name: 'Bajra' },
  { category: 'PULSES', name: 'Sugar' },
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
  { category: 'SPICES', name: 'Clove' },
  { category: 'SPICES', name: 'Cassia Cinnamon' },
  { category: 'SPICES', name: 'Star Anise' },
  { category: 'SPICES', name: 'Haldi' },
  { category: 'SPICES', name: 'Chat Masala' },
  { category: 'SPICES', name: 'Aloo Bukhara' },
  { category: 'WHEAT', name: 'Gandum Sabut' },
  { category: 'WHEAT', name: 'Gandum Dalia' },
  { category: 'WHEAT', name: 'Jao Sabut' },
  { category: 'WHEAT', name: 'Jao Dalia' },
  { category: 'WHEAT', name: 'Jao oats' },
  { category: 'WHEAT', name: 'Gandum oats' },
  { category: 'WHEAT', name: 'Suji' },
  { category: 'WHEAT', name: 'Maida' },
  { category: 'WHEAT', name: 'Besan' },
  { category: 'DRY FRUITS', name: 'Almond' },
  { category: 'DRY FRUITS', name: 'Kaju (salted)' },
  { category: 'DRY FRUITS', name: 'Kaju (un salted)' },
  { category: 'DRY FRUITS', name: 'Pista (salted)' },
  { category: 'DRY FRUITS', name: 'Pista (unsalted)' },
  { category: 'DRY FRUITS', name: 'Akhrot (sabut)' },
  { category: 'DRY FRUITS', name: 'Akhrot (giri)' },
  { category: 'DRY FRUITS', name: 'Kishmish' },
  { category: 'DRY FRUITS', name: 'Chilghoza' },
  { category: 'SEEDS', name: 'Chia seeds' },
  { category: 'SEEDS', name: 'Flax seeds' },
  { category: 'SEEDS', name: 'Pumpkin seeds' },
  { category: 'SEEDS', name: 'Sunflower seeds' },
  { category: 'SEEDS', name: 'Sesame seeds' },
  { category: 'EXTRA ITEMS', name: 'Fried Onion' },
  { category: 'EXTRA ITEMS', name: 'American Popcorn' },
  { category: 'EXTRA ITEMS', name: 'Sabudana' },
  { category: 'EXTRA ITEMS', name: 'Meethi Soda' },
  { category: 'EXTRA ITEMS', name: 'Isphagol Indian' },
  { category: 'EXTRA ITEMS', name: 'Macaroni' },
] as const

export type PricedQuantity = {
  quantity_value: number
  unit_type: 'KG' | 'GRAMS' | 'PCS'
  unit_price?: number
  rate?: number
}

export const roundCurrency = (value: number): number =>
  Math.round((Number(value) || 0) * 100) / 100

export const sumLineTotals = (items: Array<{ total?: number | null }>): number =>
  roundCurrency(items.reduce((sum, item) => sum + (Number(item.total) || 0), 0))

/** Weight rates are per KG for both KG and gram quantities; pieces use per-piece rates. */
export const calculateLineTotal = (item: PricedQuantity): number => {
  const quantity = Number(item.quantity_value) || 0
  const price = Number(item.unit_price ?? item.rate) || 0
  const billableQuantity = item.unit_type === 'GRAMS' ? quantity / 1000 : quantity
  return roundCurrency(billableQuantity * price)
}
