export type LabPriceData = Record<string, any>;

export function labCharges(data: LabPriceData, branchId: string) {
  const amount = Number(data.branch_prices?.[branchId] ?? data.amount ?? 0);
  const tax = Number(data.branch_tax_percentages?.[branchId] ?? data.tax_percentage ?? 0);
  const standard = Number(data.branch_standard_charges?.[branchId] ??
    (data.branch_prices?.[branchId] !== undefined ? amount / (1 + tax / 100) : data.standard_charge ?? amount / (1 + tax / 100)));
  return { tax, standard, amount };
}
