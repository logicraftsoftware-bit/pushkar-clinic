import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type LegacyRow = Record<string, string>;
export function parseCsv(text: string): LegacyRow[] {
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else if (!quoted && cell.length) throw new Error(`Unexpected quote at CSV character ${index}`);
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (char !== ",") {
        if (row.some(value => value.trim())) records.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  row.push(cell);
  if (row.some(value => value.trim())) records.push(row);
  const headers = records.shift()?.map(value => value.trim()) ?? [];
  if (new Set(headers).size !== headers.length) throw new Error("Duplicate CSV headers");
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2}: expected ${headers.length} columns, got ${values.length}`);
    return Object.fromEntries(headers.map((key, col) => [key, values[col]!.trim()]));
  });
}

export function readLegacyCsv(directory: string, name: string) {
  const actual = readdirSync(directory).find(file => file.toLowerCase() === `${name.toLowerCase()}.csv`);
  if (!actual) throw new Error(`Missing required CSV: ${name}.csv`);
  return parseCsv(readFileSync(join(directory, actual), "utf8"));
}
export function legacyUuid(tenant: string, kind: string, id: string) {
  const hash = createHash("sha256").update(`${tenant}:legacy-lab:${kind}:${id}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
export function csvNumber(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null") return 0;
  const number = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(number)) throw new Error(`Invalid number in ${field}`);
  return number;
}
export function legacyTimestamp(date: string, time: string = "00:00:00") {
  const normalized = /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(date) ? date.split(/[-/]/).reverse().join("-") : date.slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const calendar=new Date(`${normalized}T00:00:00Z`);
  if(Number.isNaN(calendar.getTime())||calendar.toISOString().slice(0,10)!==normalized)return null;
  const timestamp = `${normalized}T${/^\d{2}:\d{2}/.test(time) ? time.slice(0,8) : "00:00:00"}+05:30`;
  return Number.isNaN(Date.parse(timestamp)) ? null : timestamp;
}

export function inspectLabBackup(directory: string) {
  const tables: Record<string, LegacyRow[]> = {};
  const names = ["testmaster","Testparameter","Parameter_old","Units","Sample","TestSample","test_methods","test_department","test_category_master","test_summary","testmaster_sub","test_vaccu","vaccu_master","ResultType","ResultOptions","Options","ResultOption","parameter_formula","parameter_normal_check","param_fix_result","testresults","testresults_update","testresults_cancel","phlebo_sample","patient_test_details","patient_test_details_cancel","patient_test_details_delete","patient_test_details_edit","patient_test_summary","patient_info","uhid_and_opdid","invest_patient_payment_details","testreport_print","lab_doctor"];
  for (const name of names) tables[name] = readLegacyCsv(directory,name);
  const pathology = tables.testmaster!.filter(test => test.category_id === "1");
  const testIds = new Set(pathology.map(test => test.testid));
  const links = tables.Testparameter!.filter(link => testIds.has(link.TestId));
  const parameterIds = new Set(links.map(link => link.ParamaterId));
  const missingParameters = [...parameterIds].filter(id => !tables.Parameter_old!.some(parameter => parameter.ID === id));
  const history = tables.patient_test_details!.filter(row => testIds.has(row.testid));
  const results = tables.testresults!.filter(row => testIds.has(row.testid));
  const counts = Object.fromEntries(names.map(name => [name, {total: tables[name]!.length, lab: tables[name]![0]?.testid !== undefined ? tables[name]!.filter(row => testIds.has(row.testid)).length : undefined}]));
  return {tables,pathology,testIds,parameterIds,links,history,results,summary:{counts,pathology_tests:pathology.length,linked_parameters:parameterIds.size,missing_parameters:missingParameters,lab_history_rows:history.length,lab_result_rows:results.length,lab_patients:new Set(history.map(row=>row.patient_id)).size,test_categories:Object.fromEntries([...new Set(tables.testmaster!.map(row=>row.category_id))].map(id=>[id,tables.testmaster!.filter(row=>row.category_id===id).length]))}};
}
