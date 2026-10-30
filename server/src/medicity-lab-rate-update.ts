import { z } from 'zod';

export const medicityRateRows = z.array(z.object({id: z.string().min(1), guwahati: z.number().finite().nonnegative(), hatigaon: z.number().finite().nonnegative()}));
type Client = {query: (sql: string, values?: any[]) => Promise<any>};
const updateKey = 'medicity-lab-rates-20261007-aditya-guwahati-bgarh-hatigaon-v1';

export async function updateMedicityLabRates(client: Client, input: unknown) {
  const rates = medicityRateRows.parse(input);
  if (new Set(rates.map(rate => rate.id)).size !== rates.length || rates.length !== 1904) throw new Error('Expected 1904 unique pathology test rates');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [updateKey]);
    const branches = (await client.query(`SELECT id,tenant_id,name FROM branches WHERE is_active=true AND name IN ('Medicity Guwahati','Medicity Hatigaon')`)).rows;
    if (!branches.length) { await client.query('COMMIT'); return {skipped: 'Medicity branches absent'}; }
    const guwahati = branches.filter((branch: any) => branch.name === 'Medicity Guwahati');
    const hatigaon = branches.filter((branch: any) => branch.name === 'Medicity Hatigaon');
    // Completed imports remain complete when an administrator renames a branch.
    // Check the recorded tenant import before requiring the historical branch names.
    if (guwahati.length === 1) {
      const history = await client.query("SELECT to_regclass('lab_master_price_updates') AS table_name");
      if (history.rows[0]?.table_name) {
        const prior = await client.query('SELECT 1 FROM lab_master_price_updates WHERE tenant_id=$1 AND update_key=$2', [guwahati[0].tenant_id, updateKey]);
        if (prior.rowCount) { await client.query('COMMIT'); return {skipped: 'Branch rates already imported; subsequent edits preserved'}; }
      }
    }
    if (guwahati.length !== 1 || hatigaon.length !== 1 || guwahati[0].tenant_id !== hatigaon[0].tenant_id) throw new Error('Resolve ambiguous or missing Medicity branch identities before importing prices');
    const tenant = guwahati[0].tenant_id;
    await client.query(`CREATE TABLE IF NOT EXISTS lab_master_price_updates (tenant_id uuid NOT NULL REFERENCES hospitals(id), update_key text NOT NULL, snapshot jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,update_key))`);
    const applied = await client.query('SELECT 1 FROM lab_master_price_updates WHERE tenant_id=$1 AND update_key=$2', [tenant, updateKey]);
    if (applied.rowCount) { await client.query('COMMIT'); return {skipped: 'Branch rates already imported; subsequent edits preserved'}; }
    const masters = (await client.query(`SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' FOR UPDATE`, [tenant])).rows;
    const matched = rates.map(rate => {
      const tests = masters.filter((master: any) => String(master.data?.legacy_id ?? '') === rate.id && master.data?.import_source === 'talentbook-csv');
      if (tests.length !== 1) throw new Error(`Expected one imported pathology test for legacy ID ${rate.id}; found ${tests.length}`);
      return {rate, master: tests[0]};
    });
    await client.query('INSERT INTO lab_master_price_updates(tenant_id,update_key,snapshot) VALUES($1,$2,$3)', [tenant, updateKey, JSON.stringify({branches, masters: matched.map(item => item.master)})]);
    for (const {rate, master} of matched) {
      const prices = {[guwahati[0].id]: rate.guwahati, [hatigaon[0].id]: rate.hatigaon};
      const tax = Number(master.data.tax_percentage ?? 0);
      if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error(`Invalid tax on test ${rate.id}`);
      const standards = Object.fromEntries(Object.entries(prices).map(([id, amount]) => [id, amount / (1 + tax / 100)]));
      const taxes = Object.fromEntries(Object.keys(prices).map(id => [id, tax]));
      const data = {...master.data, branch_prices: {...master.data.branch_prices, ...prices}, branch_standard_charges: {...master.data.branch_standard_charges, ...standards}, branch_tax_percentages: {...master.data.branch_tax_percentages, ...taxes}};
      await client.query('UPDATE hospital_diagnostic_masters SET data=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3', [JSON.stringify(data), master.id, tenant]);
    }
    await client.query('COMMIT');
    return {updated: matched.length, branches, price_sources: {guwahati: 'rate_aditya', hatigaon: 'rate_bgarh'}};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
