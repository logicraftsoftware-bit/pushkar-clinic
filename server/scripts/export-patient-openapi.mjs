import { writeFile } from 'node:fs/promises';
import { patientAppOpenAPI } from '../mongo/patient-app/index.mjs';

const spec = patientAppOpenAPI();
await writeFile(
  new URL('../../docs/patient-app.openapi.json', import.meta.url),
  JSON.stringify(spec, null, 2) + '\n'
);
console.log(
  `Exported ${Object.values(spec.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).length,
    0
  )} patient/admin/webhook operations.`
);
