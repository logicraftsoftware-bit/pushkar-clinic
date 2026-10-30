import { z } from 'zod';

const priceMap = z.record(z.string().uuid(), z.number().finite().nonnegative());
export function validateLabPrices(data                         ) {
  for (const field of ['amount', 'standard_charge', 'tax_percentage']) {
    if (data[field] !== undefined) z.number().finite().nonnegative().parse(data[field]);
  }
  if (data.tax_percentage !== undefined) z.number().max(100).parse(data.tax_percentage);
  const ids = new Set        ();
  for (const field of ['branch_prices', 'branch_standard_charges', 'branch_tax_percentages']) {
    if (data[field] === undefined) continue;
    const values = priceMap.parse(data[field]);
    for (const [id, value] of Object.entries(values)) {
      if (field === 'branch_tax_percentages') z.number().max(100).parse(value);
      ids.add(id);
    }
  }
  return [...ids];
}
