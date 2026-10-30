export const DIAGNOSTIC_MODULE_NAME = 'Pathology, Radiology & Neurology';

// Keep stable route keys so existing links and permissions continue to work.
export function diagnosticMasterLabel(page: string) {
  if (page === 'Pathology') return DIAGNOSTIC_MODULE_NAME;
  if (['Pathology Test','Radiology Test','Lab Test Masters','Radiology Test Masters'].includes(page)) {
    return `${DIAGNOSTIC_MODULE_NAME} Test Master`;
  }
  return page;
}
