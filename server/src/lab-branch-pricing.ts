export function laboratoryTestAvailable(data:Record<string,any>,branchId:string|null|undefined){
  return !Array.isArray(data.available_branch_ids)||Boolean(branchId&&data.available_branch_ids.includes(branchId));
}
export function laboratoryPrice(data:Record<string,any>,branchId:string|null|undefined){
  if(!laboratoryTestAvailable(data,branchId))throw Object.assign(new Error('This test is not available at the selected branch'),{status:400});
  const override=branchId?data.branch_prices?.[branchId]:undefined;
  const value=Number(override??data.amount??0);
  if(!Number.isFinite(value)||value<0)throw new Error("Laboratory test has an invalid configured price");
  return value;
}
