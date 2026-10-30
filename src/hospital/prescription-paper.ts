// A4 preprinted Medicity stationery: a measured 32 mm patient band.
// Band starts about 50 mm down in the supplied photo; clinical content starts at 82 mm.
// Continuation pages reserve the complete preprinted header and patient band.
export const PRESCRIPTION_PRINT_CSS = `
@page{size:A4 portrait;margin:82mm 10mm 15mm}
@page:first{margin-top:50mm}
html{margin:0;padding:0}
body,body.single-page-prescription{position:relative;box-sizing:border-box;margin:0;min-height:0;height:auto;display:block;overflow-wrap:anywhere;break-inside:auto;page-break-inside:auto}
.title{margin:0 0 3mm;padding:0 0 2mm;font-size:14px}.title h1{font-size:14px}
.patient,.meta,.details{width:100%;min-height:32mm;height:auto;break-inside:avoid;box-sizing:border-box;display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:1mm 4mm;padding:2mm 0;margin:0;background:transparent;border:0;border-radius:0;font-size:10px;line-height:1.25}
.patient div,.meta div{grid-template-columns:80px minmax(0,1fr)}
.prescription-observations{padding:2mm 0 3mm;break-inside:avoid;font-size:10px;color:#151515}
.prescription-observations h3{margin:0 0 2mm;font-size:11px}
.prescription-vitals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3mm}
.prescription-vitals span{white-space:nowrap}.prescription-allergies{margin:3mm 0 0}
.rx-notes .clinical-writing-space{min-height:27mm}.rx-notes h3{margin:0 0 3mm}
.clinical{padding:4px 0}.rx-grid{min-height:75mm;align-items:start}
.medicine{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.test,.medicine,.signature{break-inside:avoid}
.instructions{padding:6px 0;break-inside:auto}
.single-page-prescription .rx{min-height:105mm;margin:3mm 0;border-radius:0}
.single-page-prescription .signature{margin:3mm 0 0}
@media screen{html{background:#eee}body,body.single-page-prescription{width:190mm;margin:0 auto;padding:50mm 0 15mm;background:white;min-height:297mm}}
`;

const printText=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
// Reception prints leave these fields blank for handwriting; doctor prints can
// supply the recorded values through the same layout.
export function prescriptionObservationsHtml(vitals:Record<string,unknown>={},allergies:unknown=''){
  const fields=[['BP',vitals.blood_pressure,''],['Pulse',vitals.pulse,''],['Height',vitals.height,' cm'],['Weight',vitals.weight,' kg']];
  return `<section class="prescription-observations"><h3>Vital signs</h3><div class="prescription-vitals">${fields.map(([label,value,unit])=>`<span><b>${label}:</b> ${printText(value)||'____________'}${unit}</span>`).join('')}</div><p class="prescription-allergies"><b>Allergic to:</b> ${printText(allergies)||'____________________________________________________________'}</p></section>`;
}
