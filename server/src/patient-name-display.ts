/** Presentation only: never modify the source record or unrelated people's names. */
export const patientName = (value: unknown): string => String(value ?? '').toUpperCase();

const nameKeys = new Set(['patient_name', 'patientName', 'patient_full_name', 'patientFullName', 'patient_first_name', 'patient_middle_name', 'patient_last_name', 'customer_name']);
const patientContainers = new Set(['patient', 'patients', 'patient_details', 'patientDetails']);
export function displayPatientNames<T>(value: T, patientContext = false): T {
  if (Array.isArray(value)) return value.map(item => displayPatientNames(item, patientContext)) as T;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const row = value as Record<string, unknown>;
  const patient = patientContext || 'medical_record_number' in row || 'uhid' in row || row.role === 'patient';
  const names = [row.patient_name, row.patientName, row.customer_name].filter((name): name is string => typeof name === 'string' && name.length > 0);
  return Object.fromEntries(Object.entries(row).map(([key, item]) => {
    if (typeof item === 'string') {
      if (nameKeys.has(key) || key === 'patient' || (patient && ['name', 'first_name', 'middle_name', 'last_name', 'full_name', 'fullName'].includes(key))) return [key, patientName(item)];
      if (key === 'title') return [key, names.reduce((title, name) => title.split(name).join(patientName(name)), item)];
      if (key === 'detail' && row.title === 'Patient registered') return [key, patientName(item)];
    }
    return [key, displayPatientNames(item, patientContainers.has(key))];
  })) as T;
}
