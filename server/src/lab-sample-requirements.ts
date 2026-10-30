// Required-sample column, pages 1–2 of the user-provided
// blood_tests_sample_requirements_chart.pdf. Preserve its method/assay qualifiers.
// This controls report labels only; collection settings and stored results stay unchanged.
const requirements:Array<{sample:string;aliases:string[]}>= [
  {sample:'EDTA whole blood',aliases:['CBC','Hemogram','Haemogram','Complete Blood Count','Complete Blood Count (CBC)','Full Blood Count','FBC']},
  {sample:'Whole blood',aliases:['ESR','Erythrocyte Sedimentation Rate','ESR (Erythrocyte Sedimentation Rate)']},
  {sample:'EDTA whole blood',aliases:['HbA1c','HbA1c (Glycosylated Haemoglobin)','HbA1c (Glycosylated Hemoglobin)','Glycated Haemoglobin','Glycated Hemoglobin']},
  {sample:'Whole blood',aliases:['Blood Grouping & Rh Typing','Blood Grouping and Rh Typing','Blood Group & Rh','ABO & Rh Typing']},
  {sample:'EDTA blood or fresh smear',aliases:['Peripheral Blood Smear','Peripheral Smear','PBS']},
  {sample:'EDTA whole blood',aliases:['Reticulocyte Count','Retic Count']},
  {sample:'Capillary or EDTA blood',aliases:['Malaria Parasite','Malaria Parasite Smear','MP Smear']},
  {sample:'EDTA whole blood',aliases:['Hemoglobin HPLC','Haemoglobin HPLC','Hb HPLC','Hemoglobin Electrophoresis','Haemoglobin Electrophoresis','Hemoglobin HPLC / electrophoresis']},
  {sample:'Citrated plasma',aliases:['PT','INR','PT / INR','Prothrombin Time','Prothrombin Time (PT INR)']},
  {sample:'Citrated plasma',aliases:['APTT','Activated Partial Thromboplastin Time']},
  {sample:'Citrated plasma',aliases:['D-dimer']},
  {sample:'Citrated plasma',aliases:['Fibrinogen']},
  {sample:'Citrated plasma',aliases:['Lupus Anticoagulant']},
  {sample:'Serum/plasma as validated',aliases:['Fasting Blood Glucose','Fasting Blood Sugar','FBS','FBG']},
  {sample:'Serum/plasma as validated',aliases:['Post-prandial Glucose','Post Prandial Blood Glucose','Post Prandial Blood Sugar','PPBS','PPBG','PPG']},
  {sample:'Serum',aliases:['Lipid Profile','Lipid Panel']},
  {sample:'Serum',aliases:['Liver Function Test','Liver Function Tests','Liver Function Test (LFT)','LFT','LFT (Liver Function Test)']},
  {sample:'Serum or validated plasma',aliases:['Kidney Function Test','Kidney Function Tests','Kidney Function Test (KFT/RFT)','Renal Function Test','Renal Function Tests','KFT','RFT','RFT (Renal Function Test)','KFT (Kidney Function Test)']},
  {sample:'Serum',aliases:['Thyroid Profile','Thyroid Profile (T3/T4/TSH)','Thyroid Function Test','Thyroid Function Tests','TFT','TFT (T3,T4,TSH)','T3/T4/TSH']},
  {sample:'Serum',aliases:['Vitamin B12','Vitamin B-12']},
  {sample:'Serum',aliases:['Vitamin D','Vitamin D (25-OH)','25-OH Vitamin D','25 Hydroxy Vitamin D']},
  {sample:'Serum or validated plasma',aliases:['Calcium']},
  {sample:'Serum or plasma per method',aliases:['Electrolytes','Serum Electrolytes']},
  {sample:'Serum',aliases:['Uric Acid']},
  {sample:'Serum/plasma per assay',aliases:['CRP','C Reactive Protein','C-Reactive Protein (CRP)']},
  {sample:'Serum',aliases:['ASO Titre','ASO Titer','ASO','Anti Streptolysin O']},
  {sample:'Serum',aliases:['Rheumatoid Factor','Rheumatoid Factor (RF)','RF']},
  {sample:'Serum',aliases:['Anti-CCP','Anti Cyclic Citrullinated Peptide']},
  {sample:'Serum or validated plasma',aliases:['Beta-hCG','Beta HCG']},
  {sample:'Serum/plasma per assay',aliases:['HIV 1 & 2 Screening','HIV 1 & 2','HIV 1 and 2 Screening']},
  {sample:'Serum/plasma per assay',aliases:['HBsAg']},
  {sample:'Serum/plasma per assay',aliases:['Anti-HCV']},
  {sample:'Serum',aliases:['TORCH Panel','TORCH']},
  {sample:'Serum',aliases:['ANA','Antinuclear Antibody','Antinuclear Antibodies']},
  {sample:'Serum',aliases:['Anti-dsDNA','Anti Double Stranded DNA']},
  {sample:'Serum',aliases:['Antiphospholipid Antibodies','Anticardiolipin Antibodies','Anti-beta2GPI','Anti Beta 2 Glycoprotein I']},
  {sample:'Blood in culture bottles',aliases:['Blood Culture']},
  {sample:'Blood-bank sample',aliases:['Crossmatch','Compatibility Testing','Crossmatch / Compatibility Testing']},
];
const key=(name:string)=>name.trim().replace(/\s*\[\s*\d+\s*\]\s*$/,'').replace(/β/g,'beta').toLowerCase().replace(/[^a-z0-9]/g,'');
const byName=new Map(requirements.flatMap(row=>row.aliases.map(alias=>[key(alias),row.sample] as const)));
export function chartSampleForTest(name:unknown):string|undefined{
  return typeof name==='string'?byName.get(key(name)):undefined;
}
